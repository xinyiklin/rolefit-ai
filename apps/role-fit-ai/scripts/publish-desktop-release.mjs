import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  expectedReleaseAssets,
  verifyReleaseAssets,
  writeReleaseChecksums,
} from "./desktop-release-assets.mjs";
import {
  assertRolefitReleaseVersion,
  parseRolefitPreviewTag,
  parseRolefitReleaseTag,
} from "./desktop-release-contract.mjs";

const CHECKSUM_ASSET = "SHA256SUMS.txt";
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(`RoleFit release publication: ${message}`);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value?.trim()) fail(`${name} is required`);
  return value.trim();
}

function runGh(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) fail(`could not run gh: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    fail(`gh ${args.slice(0, 2).join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function parseGhJson(args, label, executeGh) {
  const output = executeGh(args);
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(`could not parse ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireGitObject(value, label) {
  const object = value && typeof value === "object" ? value.object : null;
  if (!object || typeof object !== "object" ||
      (object.type !== "commit" && object.type !== "tag") ||
      !COMMIT_SHA_PATTERN.test(object.sha ?? "")) {
    fail(`${label} did not return a valid Git object`);
  }
  return { type: object.type, sha: object.sha.toLowerCase() };
}

function resolveRemoteTagCommit(repository, tag, executeGh) {
  let object = requireGitObject(
    parseGhJson(
      ["api", `repos/${repository}/git/ref/tags/${tag}`],
      "remote release tag response",
      executeGh,
    ),
    "remote release tag",
  );
  for (let depth = 0; object.type === "tag"; depth += 1) {
    if (depth >= 8) fail("remote release tag has an unsupported annotation chain");
    object = requireGitObject(
      parseGhJson(
        ["api", `repos/${repository}/git/tags/${object.sha}`],
        "annotated release tag response",
        executeGh,
      ),
      "annotated release tag",
    );
  }
  return object.sha;
}

function assertRemoteTagCommit(repository, tag, expectedCommit, executeGh) {
  const currentCommit = resolveRemoteTagCommit(repository, tag, executeGh);
  if (currentCommit !== expectedCommit.toLowerCase()) {
    fail(`remote tag ${tag} moved from validated commit ${expectedCommit} to ${currentCommit}`);
  }
}

function assertRemoteAssets(
  release,
  expectedAssets,
  expectedDraftState,
  expectedPrereleaseState,
) {
  if (release.isDraft !== expectedDraftState) {
    fail(`release draft state is ${release.isDraft}; expected ${expectedDraftState}`);
  }
  if (release.isPrerelease !== expectedPrereleaseState) {
    fail(`release prerelease state is ${release.isPrerelease}; expected ${expectedPrereleaseState}`);
  }

  const expectedByName = new Map(expectedAssets.map((asset) => [asset.name, asset]));
  const seen = new Set();
  for (const asset of release.assets ?? []) {
    if (seen.has(asset.name)) fail(`remote release contains duplicate asset ${asset.name}`);
    const expected = expectedByName.get(asset.name);
    if (!expected) fail(`remote release contains unexpected asset ${asset.name}`);
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      fail(`remote release asset has an invalid size: ${asset.name}`);
    }
    if (asset.size !== expected.size) {
      fail(`remote release asset size differs from the verified local file: ${asset.name}`);
    }
    if (asset.digest !== expected.digest) {
      fail(`remote release asset digest differs from the verified local file: ${asset.name}`);
    }
    seen.add(asset.name);
  }

  const missing = expectedAssets.map((asset) => asset.name).filter((name) => !seen.has(name));
  if (missing.length > 0) fail(`remote release is missing assets: ${missing.join(", ")}`);
  if (seen.size !== expectedAssets.length) fail("remote release asset count does not match the contract");
}

function readRemoteRelease(repository, tag, executeGh) {
  const output = executeGh([
    "release",
    "view",
    tag,
    "--repo",
    repository,
    "--json",
    "tagName,isDraft,isPrerelease,assets",
  ]);
  let release;
  try {
    release = JSON.parse(output);
  } catch (error) {
    fail(`could not parse gh release view output: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (release.tagName !== tag) fail(`remote release tag ${release.tagName} does not match ${tag}`);
  return release;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function readLocalAssetMetadata(assets) {
  return Promise.all(assets.map(async (asset) => {
    const metadata = await stat(asset.path);
    if (!metadata.isFile() || metadata.size <= 0) fail(`verified local asset is not a file: ${asset.name}`);
    return {
      ...asset,
      size: metadata.size,
      digest: `sha256:${await sha256(asset.path)}`,
    };
  }));
}

async function requireReleaseNotes(version, previewLabel) {
  const notesVersion = previewLabel ? `${version}-${previewLabel}` : version;
  const path = resolve(appRoot, "docs", "releases", `${notesVersion}.md`);
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) {
    fail(`curated release notes are missing for ${version}`);
  }
  return path;
}

export async function publishRelease({
  repository,
  tag,
  version,
  commit,
  assetsRoot,
  channel = "signed",
  executeGh = runGh,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    fail("GITHUB_REPOSITORY must be an owner/name pair");
  }
  assertRolefitReleaseVersion(version);
  if (channel !== "signed" && channel !== "preview") {
    fail("release channel must be signed or preview");
  }
  const preview = channel === "preview";
  const previewTag = preview ? parseRolefitPreviewTag(tag) : null;
  const tagVersion = previewTag?.version ?? parseRolefitReleaseTag(tag);
  if (tagVersion !== version) fail("release tag does not match release version");
  if (!COMMIT_SHA_PATTERN.test(commit ?? "")) fail("validated release commit must be a full SHA");

  const expectedAssets = expectedReleaseAssets(version);
  const releaseNotesPath = await requireReleaseNotes(version, previewTag?.previewLabel);
  const localAssets = await verifyReleaseAssets(assetsRoot, expectedAssets);
  const checksumPath = await writeReleaseChecksums(
    localAssets,
    resolve(assetsRoot, CHECKSUM_ASSET),
  );
  const remoteAssets = await readLocalAssetMetadata([
    ...localAssets,
    { name: CHECKSUM_ASSET, path: checksumPath },
  ]);

  let draftCreated = false;
  try {
    assertRemoteTagCommit(repository, tag, commit, executeGh);
    const createArguments = [
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--verify-tag",
      "--draft",
      "--title",
      preview
        ? `RoleFit Local Companion ${version} — unsigned preview ${previewTag.previewLabel}`
        : `RoleFit Local Companion ${version}`,
      "--notes-file",
      releaseNotesPath,
    ];
    if (preview) createArguments.push("--prerelease");
    executeGh(createArguments);
    draftCreated = true;
    assertRemoteTagCommit(repository, tag, commit, executeGh);

    executeGh([
      "release",
      "upload",
      tag,
      ...localAssets.map((asset) => asset.path),
      checksumPath,
      "--repo",
      repository,
    ]);

    assertRemoteAssets(readRemoteRelease(repository, tag, executeGh), remoteAssets, true, preview);
    assertRemoteTagCommit(repository, tag, commit, executeGh);
    executeGh(["release", "edit", tag, "--repo", repository, "--draft=false"]);
    assertRemoteAssets(readRemoteRelease(repository, tag, executeGh), remoteAssets, false, preview);
  } catch (error) {
    if (draftCreated) {
      console.error(
        `A draft release for ${tag} may remain for inspection. It was not intentionally published or deleted.`,
      );
    }
    throw error;
  }

  console.log(
    `Published ${tag} with ${remoteAssets.length} verified ${preview ? "unsigned preview" : "signed release"} assets.`,
  );
}

async function runFromEnvironment() {
  requiredEnvironment("GH_TOKEN");
  await publishRelease({
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    tag: requiredEnvironment("ROLEFIT_RELEASE_TAG"),
    version: requiredEnvironment("ROLEFIT_RELEASE_VERSION"),
    commit: requiredEnvironment("ROLEFIT_RELEASE_COMMIT"),
    assetsRoot: requiredEnvironment("ROLEFIT_RELEASE_ASSETS_DIR"),
    channel: process.env.ROLEFIT_RELEASE_CHANNEL ?? "signed",
  });
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  runFromEnvironment().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
