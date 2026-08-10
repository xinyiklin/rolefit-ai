import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  expectedReleaseAssets,
  expectedTargetAssets,
  verifyReleaseAssets,
  writeReleaseChecksums,
} from "./desktop-release-assets.mjs";
import {
  assertRolefitReleaseVersion,
  assertScreenshotVersionStamps,
  parseRolefitPreviewTag,
  parseRolefitReleaseTag,
  validateRolefitPreviewRef,
  validateRolefitReleaseRef,
} from "./desktop-release-contract.mjs";
import { publishRelease } from "./publish-desktop-release.mjs";
import {
  ROLEFIT_DESKTOP_RUNTIME_CONTRACT,
  assertElectronPackageVersion,
  assertElectronRuntimeVersions,
  assertForgeHostNodeVersion,
} from "../desktop/runtime-versions.mjs";

const VERSION = "0.1.0";
const RELEASE_VERSION = "0.7.0";
const EXTENSION_VERSION = "1.2.0";
// 0.6.0 shipped API 12 while the source had already moved to 13. This release
// publishes that 13, so the released and current API are the same number again.
const RELEASED_DESKTOP_API_VERSION = 13;
const CURRENT_DESKTOP_API_VERSION = 13;
const PREVIEW_LABEL = "beta.1";
const PREVIEW_TAG = `rolefit-preview-v${RELEASE_VERSION}-${PREVIEW_LABEL}`;

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

function readDesktopApiVersion() {
  const source = readFileSync(
    new URL("../desktop/ipc-contract.cts", import.meta.url),
    "utf8",
  );
  const match =
    /export\s+const\s+ROLEFIT_DESKTOP_API_VERSION\s*=\s*(\d+)\s+as\s+const\s*;/.exec(source);
  assert.ok(match, "desktop API version must remain an explicit contract constant");
  return Number(match[1]);
}

test("0.7.0 beta.1 release tuple stays frozen and publishes the current desktop API", () => {
  const appPackage = readJson(new URL("../package.json", import.meta.url));
  const extensionManifest = readJson(new URL("../extension/manifest.json", import.meta.url));
  const releaseNotes = readFileSync(
    new URL(`../docs/releases/${RELEASE_VERSION}-${PREVIEW_LABEL}.md`, import.meta.url),
    "utf8",
  );

  assert.equal(assertRolefitReleaseVersion(appPackage.version), RELEASE_VERSION);
  assert.equal(extensionManifest.version, EXTENSION_VERSION);
  assert.equal(readDesktopApiVersion(), CURRENT_DESKTOP_API_VERSION);
  assert.deepEqual(parseRolefitPreviewTag(PREVIEW_TAG), {
    version: RELEASE_VERSION,
    previewLabel: PREVIEW_LABEL,
  });
  assert.ok(releaseNotes.startsWith(`# RoleFit AI ${RELEASE_VERSION}:`));
  assert.ok(
    releaseNotes.replace(/\s+/g, " ").includes(
      `includes browser extension **${EXTENSION_VERSION}** and desktop bridge API **${RELEASED_DESKTOP_API_VERSION}**`,
    ),
    "release notes must state the extension and desktop API mapping",
  );
});

async function makeScreenshotFixture(manifest, { imageName = "public/assets/desktop-app.png" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "rolefit-screenshot-manifest-"));
  const landing = join(root, "apps", "role-fit-ai", "landing");
  await mkdir(join(landing, "public", "assets"), { recursive: true });
  await writeFile(
    join(root, "apps", "role-fit-ai", "package.json"),
    JSON.stringify({ name: "role-fit-ai", version: RELEASE_VERSION }),
    "utf8",
  );
  if (imageName) await writeFile(join(landing, imageName), "png\n", "utf8");
  await writeFile(join(landing, "screenshot-manifest.json"), JSON.stringify(manifest), "utf8");
  return root;
}

test("version-stamped screenshots must be recaptured when the package version moves", async () => {
  const committed = assertScreenshotVersionStamps();
  const appPackage = readJson(new URL("../package.json", import.meta.url));
  assert.ok(committed.length > 0, "the manifest must claim at least one version-stamped image");
  for (const { capturedVersion } of committed) {
    assert.equal(capturedVersion, appPackage.version);
  }
  assert.ok(
    committed.some((entry) => entry.imagePath === "public/assets/desktop-app.png"),
    "the companion screenshot prints the version in its footer and must stay covered",
  );

  const valid = await makeScreenshotFixture({
    schemaVersion: 1,
    versionStamped: { "public/assets/desktop-app.png": RELEASE_VERSION },
  });
  const stale = await makeScreenshotFixture({
    schemaVersion: 1,
    versionStamped: { "public/assets/desktop-app.png": "0.5.0" },
  });
  const missing = await makeScreenshotFixture(
    { schemaVersion: 1, versionStamped: { "public/assets/desktop-app.png": RELEASE_VERSION } },
    { imageName: null },
  );
  const unknownKey = await makeScreenshotFixture({
    schemaVersion: 1,
    unexpected: true,
    versionStamped: { "public/assets/desktop-app.png": RELEASE_VERSION },
  });
  const escaping = await makeScreenshotFixture({
    schemaVersion: 1,
    versionStamped: { "../../../secrets.png": RELEASE_VERSION },
  });
  const empty = await makeScreenshotFixture({ schemaVersion: 1, versionStamped: {} });
  const futureSchema = await makeScreenshotFixture({
    schemaVersion: 2,
    versionStamped: { "public/assets/desktop-app.png": RELEASE_VERSION },
  });

  try {
    assert.deepEqual(assertScreenshotVersionStamps(valid), [
      { imagePath: "public/assets/desktop-app.png", capturedVersion: RELEASE_VERSION },
    ]);
    assert.throws(() => assertScreenshotVersionStamps(stale), /retake the screenshot/);
    assert.throws(() => assertScreenshotVersionStamps(missing), /not a file under landing\//);
    assert.throws(() => assertScreenshotVersionStamps(unknownKey), /only schemaVersion, note, and versionStamped/);
    assert.throws(() => assertScreenshotVersionStamps(escaping), /relative to the landing directory/);
    assert.throws(() => assertScreenshotVersionStamps(empty), /at least one version-stamped image/);
    assert.throws(() => assertScreenshotVersionStamps(futureSchema), /schemaVersion must be 1/);
  } finally {
    await Promise.all(
      [valid, stale, missing, unknownKey, escaping, empty, futureSchema].map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    );
  }
});

test("desktop runtime tuple matches the release manifest and rejects drift", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assertElectronPackageVersion(manifest.devDependencies.electron);
  assertForgeHostNodeVersion("24.18.0");
  assertElectronRuntimeVersions({
    electron: ROLEFIT_DESKTOP_RUNTIME_CONTRACT.electronVersion,
    node: ROLEFIT_DESKTOP_RUNTIME_CONTRACT.embeddedNodeVersion,
  });
  assert.throws(() => assertForgeHostNodeVersion("23.11.1"), /use Node 24/);
  assert.throws(
    () => assertElectronRuntimeVersions({ electron: "43.1.9", node: "24.18.0" }),
    /does not match expected 43\.2\.x/,
  );
  assert.throws(
    () => assertElectronRuntimeVersions({ electron: "43.2.0", node: "24.17.9" }),
    /does not match expected 24\.18\.x/,
  );
});

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function makeAssetFixture(names = expectedReleaseAssets(VERSION)) {
  const root = await mkdtemp(join(tmpdir(), "rolefit-release-assets-"));
  for (const [index, name] of names.entries()) {
    const directory = join(root, `artifact-${index}`);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), `asset:${name}\n`, "utf8");
  }
  return root;
}

test("release tags and target names are strict and architecture-specific", () => {
  assert.equal(parseRolefitReleaseTag("rolefit-v0.1.0"), VERSION);
  assert.throws(() => parseRolefitReleaseTag("v0.1.0"), /rolefit-vX\.Y\.Z/);
  assert.throws(() => parseRolefitReleaseTag("rolefit-v01.1.0"), /rolefit-vX\.Y\.Z/);
  assert.throws(() => parseRolefitReleaseTag("rolefit-v0.1.0-beta.1"), /rolefit-vX\.Y\.Z/);
  assert.deepEqual(parseRolefitPreviewTag("rolefit-preview-v0.1.0-beta.1"), {
    version: VERSION,
    previewLabel: "beta.1",
  });
  assert.throws(
    () => parseRolefitPreviewTag("rolefit-preview-v0.1.0-beta.0"),
    /rolefit-preview-vX\.Y\.Z-beta\.N/,
  );
  assert.throws(
    () => parseRolefitPreviewTag("rolefit-v0.1.0"),
    /rolefit-preview-vX\.Y\.Z-beta\.N/,
  );

  assert.deepEqual(expectedTargetAssets(VERSION, "macos", "arm64"), [
    "RoleFit-AI-0.1.0-macos-arm64.dmg",
    "RoleFit-AI-0.1.0-macos-arm64.zip",
  ]);
  assert.deepEqual(expectedTargetAssets(VERSION, "windows", "x64"), [
    "RoleFit-AI-0.1.0-windows-x64.exe",
  ]);
  assert.throws(() => expectedTargetAssets(VERSION, "windows", "arm64"), /unsupported/);
});

test("asset verification rejects missing, duplicate, and unexpected files", async () => {
  const expected = expectedReleaseAssets(VERSION);

  const missingRoot = await makeAssetFixture(expected.slice(1));
  const duplicateRoot = await makeAssetFixture(expected);
  const unexpectedRoot = await makeAssetFixture(expected);
  try {
    await assert.rejects(() => verifyReleaseAssets(missingRoot, expected), /missing assets/);

    const duplicateDirectory = join(duplicateRoot, "duplicate");
    await mkdir(duplicateDirectory);
    await writeFile(join(duplicateDirectory, expected[0]), "duplicate\n", "utf8");
    await assert.rejects(() => verifyReleaseAssets(duplicateRoot, expected), /duplicate asset name/);

    await writeFile(join(unexpectedRoot, "unexpected.blockmap"), "unexpected\n", "utf8");
    await assert.rejects(() => verifyReleaseAssets(unexpectedRoot, expected), /unexpected asset/);
  } finally {
    await Promise.all([
      rm(missingRoot, { recursive: true, force: true }),
      rm(duplicateRoot, { recursive: true, force: true }),
      rm(unexpectedRoot, { recursive: true, force: true }),
    ]);
  }
});

test("checksum manifest covers every verified asset by deterministic basename", async () => {
  const expected = expectedReleaseAssets(VERSION);
  const root = await makeAssetFixture(expected);
  try {
    const assets = await verifyReleaseAssets(root, expected);
    const manifestPath = await writeReleaseChecksums(assets, join(root, "SHA256SUMS.txt"));
    const manifest = await readFile(manifestPath, "utf8");
    const expectedManifest = expected
      .map((name) => {
        const hash = createHash("sha256").update(`asset:${name}\n`).digest("hex");
        return `${hash}  ${name}`;
      })
      .join("\n");
    assert.equal(manifest, `${expectedManifest}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tag validation requires matching package version and origin/main ancestry", async () => {
  const root = await mkdtemp(join(tmpdir(), "rolefit-release-git-"));
  try {
    await mkdir(join(root, "apps", "role-fit-ai"), { recursive: true });
    await writeFile(
      join(root, "apps", "role-fit-ai", "package.json"),
      `${JSON.stringify({ name: "role-fit-ai", version: VERSION }, null, 2)}\n`,
      "utf8",
    );
    runGit(root, ["init", "-b", "main"]);
    runGit(root, ["config", "user.name", "RoleFit release probe"]);
    runGit(root, ["config", "user.email", "release-probe@rolefit.invalid"]);
    runGit(root, ["add", "apps/role-fit-ai/package.json"]);
    runGit(root, ["commit", "-m", "release fixture"]);
    const releaseCommit = runGit(root, ["rev-parse", "HEAD"]);
    runGit(root, ["tag", "rolefit-v0.1.0"]);
    runGit(root, ["tag", "rolefit-preview-v0.1.0-beta.1"]);
    runGit(root, ["update-ref", "refs/remotes/origin/main", releaseCommit]);

    assert.deepEqual(
      validateRolefitReleaseRef({
        repoRoot: root,
        eventName: "push",
        ref: "refs/tags/rolefit-v0.1.0",
        refType: "tag",
        tag: "rolefit-v0.1.0",
        eventSha: releaseCommit,
      }),
      { commit: releaseCommit, tag: "rolefit-v0.1.0", version: VERSION },
    );
    assert.deepEqual(
      validateRolefitPreviewRef({
        repoRoot: root,
        eventName: "push",
        ref: "refs/tags/rolefit-preview-v0.1.0-beta.1",
        refType: "tag",
        tag: "rolefit-preview-v0.1.0-beta.1",
        eventSha: releaseCommit,
      }),
      {
        commit: releaseCommit,
        tag: "rolefit-preview-v0.1.0-beta.1",
        version: VERSION,
        previewLabel: "beta.1",
      },
    );

    await writeFile(join(root, "outside.txt"), "not on origin/main\n", "utf8");
    runGit(root, ["add", "outside.txt"]);
    runGit(root, ["commit", "-m", "outside main"]);
    const outsideCommit = runGit(root, ["rev-parse", "HEAD"]);
    runGit(root, ["tag", "-f", "rolefit-v0.1.0", outsideCommit]);
    assert.throws(
      () =>
        validateRolefitReleaseRef({
          repoRoot: root,
          eventName: "push",
          ref: "refs/tags/rolefit-v0.1.0",
          refType: "tag",
          tag: "rolefit-v0.1.0",
          eventSha: outsideCommit,
        }),
      /not an ancestor/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function createFakeGitHub({ commit, moveTagAfterDraft = false, failUpload = false } = {}) {
  const calls = [];
  let draft = null;
  let tagReads = 0;

  function executeGh(args) {
    calls.push(args);
    if (args[0] === "api") {
      tagReads += 1;
      const sha = moveTagAfterDraft && tagReads > 1 ? "f".repeat(40) : commit;
      return JSON.stringify({ object: { type: "commit", sha } });
    }
    if (args[0] !== "release") throw new Error(`unexpected fake gh call: ${args.join(" ")}`);

    if (args[1] === "create") {
      assert.equal(draft, null, "the fake release must be created once");
      draft = {
        tagName: args[2],
        isDraft: true,
        isPrerelease: args.includes("--prerelease"),
        assets: [],
      };
      return "";
    }
    if (args[1] === "upload") {
      if (failUpload) throw new Error("simulated upload failure");
      assert.ok(draft?.isDraft, "assets may be uploaded only to the draft");
      const repoIndex = args.indexOf("--repo");
      const paths = args.slice(3, repoIndex);
      draft.assets = paths.map((path) => {
        const bytes = readFileSync(path);
        return {
          name: path.split(/[\\/]/).at(-1),
          size: statSync(path).size,
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        };
      });
      return "";
    }
    if (args[1] === "view") {
      assert.ok(draft, "the fake release must exist before it is read");
      return JSON.stringify(draft);
    }
    if (args[1] === "edit") {
      assert.ok(draft?.isDraft, "only the draft may be published");
      draft.isDraft = false;
      return "";
    }
    throw new Error(`unexpected fake release call: ${args.join(" ")}`);
  }

  return {
    calls,
    executeGh,
    readRelease: () => draft,
  };
}

test("publication keeps the release draft until every exact remote asset is verified", async () => {
  const commit = "a".repeat(40);
  const root = await makeAssetFixture();
  const fake = createFakeGitHub({ commit });
  try {
    await publishRelease({
      repository: "rolefit/example",
      tag: `rolefit-v${VERSION}`,
      version: VERSION,
      commit,
      assetsRoot: root,
      executeGh: fake.executeGh,
    });
    assert.equal(fake.readRelease().isDraft, false);
    assert.equal(fake.readRelease().assets.length, expectedReleaseAssets(VERSION).length + 1);
    assert.equal(fake.calls.filter((args) => args[1] === "edit").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview publication stays marked as a prerelease and uses the preview tag contract", async () => {
  const commit = "d".repeat(40);
  const root = await makeAssetFixture();
  const fake = createFakeGitHub({ commit });
  try {
    await publishRelease({
      repository: "rolefit/example",
      tag: `rolefit-preview-v${VERSION}-beta.1`,
      version: VERSION,
      commit,
      assetsRoot: root,
      channel: "preview",
      executeGh: fake.executeGh,
    });
    assert.equal(fake.readRelease().isDraft, false);
    assert.equal(fake.readRelease().isPrerelease, true);
    const createCall = fake.calls.find((args) => args[1] === "create");
    assert.ok(createCall.includes("--prerelease"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication never publishes after an upload failure", async () => {
  const commit = "b".repeat(40);
  const root = await makeAssetFixture();
  const fake = createFakeGitHub({ commit, failUpload: true });
  try {
    await assert.rejects(
      () => publishRelease({
        repository: "rolefit/example",
        tag: `rolefit-v${VERSION}`,
        version: VERSION,
        commit,
        assetsRoot: root,
        executeGh: fake.executeGh,
      }),
      /simulated upload failure/,
    );
    assert.equal(fake.readRelease().isDraft, true);
    assert.equal(fake.calls.some((args) => args[1] === "edit"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication stops if the remote tag moves after draft creation", async () => {
  const commit = "c".repeat(40);
  const root = await makeAssetFixture();
  const fake = createFakeGitHub({ commit, moveTagAfterDraft: true });
  try {
    await assert.rejects(
      () => publishRelease({
        repository: "rolefit/example",
        tag: `rolefit-v${VERSION}`,
        version: VERSION,
        commit,
        assetsRoot: root,
        executeGh: fake.executeGh,
      }),
      /remote tag .* moved/,
    );
    assert.equal(fake.readRelease().isDraft, true);
    assert.equal(fake.calls.some((args) => args[1] === "upload"), false);
    assert.equal(fake.calls.some((args) => args[1] === "edit"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
