import { strict as assert } from "node:assert";

import {
  DOWNLOAD_TARGETS,
  formatFileSize,
  parseLatestRelease,
  parseReleaseList,
} from "../releaseCatalog.ts";

const version = "0.1.0";
const tag = `rolefit-v${version}`;
const previewTag = `rolefit-preview-v${version}-beta.1`;

function asset(name, overrides = {}, releaseTag = tag) {
  return {
    name,
    size: 18 * 1024 * 1024,
    browser_download_url:
      `https://github.com/xinyiklin/rolefit-ai/releases/download/${releaseTag}/${name}`,
    ...overrides,
  };
}

function validPayload({ preview = false } = {}) {
  const releaseTag = preview ? previewTag : tag;
  return {
    draft: false,
    prerelease: preview,
    tag_name: releaseTag,
    html_url: `https://github.com/xinyiklin/rolefit-ai/releases/tag/${releaseTag}`,
    assets: [
      ...DOWNLOAD_TARGETS.map((target) =>
        asset(target.assetName(version), {}, releaseTag)),
      asset(`RoleFit-Local-Companion-${version}-macos-arm64.zip`, {}, releaseTag),
      asset(`RoleFit-Local-Companion-${version}-macos-x64.zip`, {}, releaseTag),
      asset("SHA256SUMS.txt", { size: 512 }, releaseTag),
    ],
  };
}

const parsed = parseLatestRelease(validPayload());
assert.ok(parsed);
assert.equal(parsed.version, version);
assert.equal(parsed.tag, tag);
assert.equal(parsed.channel, "signed");
assert.equal(parsed.previewLabel, undefined);
assert.equal(parsed.downloads["macos-arm64"].name.endsWith(".dmg"), true);
assert.equal(parsed.downloads["macos-x64"].name.endsWith(".dmg"), true);
assert.equal(parsed.downloads["windows-x64"].name.endsWith(".exe"), true);
assert.equal(parsed.archives.macosArm64.name.endsWith("arm64.zip"), true);
assert.equal(parsed.checksums.name, "SHA256SUMS.txt");

const parsedPreview = parseLatestRelease(validPayload({ preview: true }));
assert.ok(parsedPreview);
assert.equal(parsedPreview.version, version);
assert.equal(parsedPreview.tag, previewTag);
assert.equal(parsedPreview.channel, "unsigned-preview");
assert.equal(parsedPreview.previewLabel, "beta.1");

for (const mutation of [
  (payload) => { payload.tag_name = "v0.1.0"; },
  (payload) => { payload.draft = true; },
  (payload) => { payload.prerelease = true; },
  (payload) => { payload.html_url = "https://attacker.example/release"; },
  (payload) => { payload.assets.pop(); },
  (payload) => { payload.assets.push(payload.assets[0]); },
  (payload) => { payload.assets.push(asset("unexpected.bin")); },
  (payload) => { payload.assets[0].size = 0; },
  (payload) => {
    payload.assets[0].browser_download_url =
      `https://attacker.example/releases/download/${tag}/${payload.assets[0].name}`;
  },
  (payload) => {
    payload.assets[0].browser_download_url =
      `https://user:pass@github.com/xinyiklin/rolefit-ai/releases/download/${tag}/${payload.assets[0].name}`;
  },
  (payload) => {
    payload.assets[0].browser_download_url =
      `https://github.com:444/xinyiklin/rolefit-ai/releases/download/${tag}/${payload.assets[0].name}`;
  },
]) {
  const payload = validPayload();
  mutation(payload);
  assert.equal(parseLatestRelease(payload), null);
}

assert.equal(parseLatestRelease(null), null);
assert.equal(parseReleaseList([]), null);
assert.equal(parseReleaseList([{ tag_name: "typeset-v1.0.0" }, validPayload()])?.tag, tag);
assert.equal(parseReleaseList([validPayload({ preview: true })])?.tag, previewTag);
assert.equal(
  parseReleaseList([validPayload({ preview: true }), validPayload()])?.channel,
  "signed",
);
assert.equal(parseReleaseList({ releases: [validPayload()] }), null);
assert.equal(formatFileSize(18 * 1024 * 1024), "18 MB");
assert.equal(formatFileSize(Math.round(1.5 * 1024 * 1024)), "1.5 MB");

console.log("public landing release catalog probes: passed");
