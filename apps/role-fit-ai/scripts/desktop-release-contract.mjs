import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const RELEASE_TAG_PATTERN = /^rolefit-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
const PREVIEW_TAG_PATTERN = /^rolefit-preview-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-(beta\.[1-9]\d*)$/;
const RELEASE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function fail(message) {
  throw new Error(`RoleFit release contract: ${message}`);
}

function git(repoRoot, args, { allowExitCodeOne = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    fail(`could not run git ${args.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0 && !(allowExitCodeOne && result.status === 1)) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    fail(`git ${args.join(" ")} failed: ${detail}`);
  }

  return {
    status: result.status,
    stdout: result.stdout.trim(),
  };
}

export function parseRolefitReleaseTag(tag) {
  const match = RELEASE_TAG_PATTERN.exec(tag ?? "");
  if (!match) {
    fail("tag must match rolefit-vX.Y.Z with canonical, non-negative integer components");
  }
  return match[1];
}

export function parseRolefitPreviewTag(tag) {
  const match = PREVIEW_TAG_PATTERN.exec(tag ?? "");
  if (!match) {
    fail("preview tag must match rolefit-preview-vX.Y.Z-beta.N with canonical, positive beta numbering");
  }
  return { version: match[1], previewLabel: match[2] };
}

export function assertRolefitReleaseVersion(version) {
  if (!RELEASE_VERSION_PATTERN.test(version ?? "")) {
    fail("package version must be canonical X.Y.Z without a prerelease or build suffix");
  }
  return version;
}

export function readRolefitPackageVersion(repoRoot) {
  const packagePath = resolve(repoRoot, "apps", "role-fit-ai", "package.json");
  let packageJson;

  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch (error) {
    fail(`could not read ${packagePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (packageJson.name !== "role-fit-ai") {
    fail(`expected ${packagePath} to describe the role-fit-ai workspace`);
  }
  return assertRolefitReleaseVersion(packageJson.version);
}

function validateRolefitRef({
  repoRoot,
  eventName,
  ref,
  refType,
  tag,
  eventSha,
  mainRef = "refs/remotes/origin/main",
  parseTag,
}) {
  if (eventName !== "push") fail("release workflow must be triggered by a push event");
  if (refType !== "tag") fail("release workflow must run from a tag ref");

  const parsedTag = parseTag(tag);
  const tagVersion = typeof parsedTag === "string" ? parsedTag : parsedTag.version;
  if (ref !== `refs/tags/${tag}`) fail("GITHUB_REF does not exactly match GITHUB_REF_NAME");
  if (!COMMIT_SHA_PATTERN.test(eventSha ?? "")) fail("GITHUB_SHA must be a full commit SHA");

  const packageVersion = readRolefitPackageVersion(repoRoot);
  if (tagVersion !== packageVersion) {
    fail(`tag version ${tagVersion} does not match package version ${packageVersion}`);
  }

  const tagRef = `refs/tags/${tag}`;
  const tagCommit = git(repoRoot, ["rev-parse", "--verify", `${tagRef}^{commit}`]).stdout;
  const eventCommit = git(repoRoot, ["rev-parse", "--verify", `${eventSha}^{commit}`]).stdout;

  if (!COMMIT_SHA_PATTERN.test(tagCommit) || !COMMIT_SHA_PATTERN.test(eventCommit)) {
    fail("tag and event ref must both resolve to full commit SHAs");
  }
  if (tagCommit.toLowerCase() !== eventCommit.toLowerCase()) {
    fail("release tag does not resolve to the workflow event commit");
  }

  git(repoRoot, ["show-ref", "--verify", mainRef]);
  const ancestry = git(repoRoot, ["merge-base", "--is-ancestor", tagCommit, mainRef], {
    allowExitCodeOne: true,
  });
  if (ancestry.status === 1) {
    fail(`tagged commit ${tagCommit} is not an ancestor of ${mainRef}`);
  }

  return {
    commit: tagCommit.toLowerCase(),
    tag,
    version: packageVersion,
    ...(typeof parsedTag === "string" ? {} : { previewLabel: parsedTag.previewLabel }),
  };
}

export function validateRolefitReleaseRef(options) {
  return validateRolefitRef({ ...options, parseTag: parseRolefitReleaseTag });
}

export function validateRolefitPreviewRef(options) {
  return validateRolefitRef({ ...options, parseTag: parseRolefitPreviewTag });
}

export function writeReleaseOutputs(outputPath, release) {
  if (!outputPath) fail("GITHUB_OUTPUT is required");
  appendFileSync(
    outputPath,
    `version=${release.version}\ntag=${release.tag}\ncommit=${release.commit}\n${
      release.previewLabel ? `preview-label=${release.previewLabel}\n` : ""
    }`,
    "utf8",
  );
}

function runFromEnvironment() {
  const channel = process.env.ROLEFIT_RELEASE_CHANNEL ?? "signed";
  if (channel !== "signed" && channel !== "preview") {
    fail("ROLEFIT_RELEASE_CHANNEL must be signed or preview");
  }
  const validate = channel === "preview" ? validateRolefitPreviewRef : validateRolefitReleaseRef;
  const release = validate({
    repoRoot: process.cwd(),
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    refType: process.env.GITHUB_REF_TYPE,
    tag: process.env.GITHUB_REF_NAME,
    eventSha: process.env.GITHUB_SHA,
  });

  writeReleaseOutputs(process.env.GITHUB_OUTPUT, release);
  console.log(
    `Validated ${release.tag} at ${release.commit} for RoleFit ${release.version}${
      release.previewLabel ? ` ${release.previewLabel} unsigned preview` : ""
    }.`,
  );
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  try {
    runFromEnvironment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
