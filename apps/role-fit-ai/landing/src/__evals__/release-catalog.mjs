import { strict as assert } from "node:assert";

import {
  DOWNLOAD_TARGETS,
  fetchLatestRelease,
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
      asset(`RoleFit-AI-${version}-macos-arm64.zip`, {}, releaseTag),
      asset(`RoleFit-AI-${version}-macos-x64.zip`, {}, releaseTag),
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

// ── Asset `size` edge cases: parseAsset requires a positive safe integer.
// Every one of these must sink the whole release (fail-closed), same as the
// existing size===0 mutation above.
for (const [name, mutation] of [
  ["negative size", (payload) => { payload.assets[0].size = -1024; }],
  ["non-integer (fractional) size", (payload) => { payload.assets[0].size = 1.5; }],
  ["size as a numeric string, not a number", (payload) => { payload.assets[0].size = "18874368"; }],
  ["size missing entirely", (payload) => { delete payload.assets[0].size; }],
  ["size as null", (payload) => { payload.assets[0].size = null; }],
  ["size as NaN", (payload) => { payload.assets[0].size = NaN; }],
  ["size as Infinity", (payload) => { payload.assets[0].size = Infinity; }],
]) {
  const payload = validPayload();
  mutation(payload);
  assert.equal(parseLatestRelease(payload), null, `size edge case rejected: ${name}`);
}

// ── Asset `name` edge cases: the assets-by-name scan requires every asset's
// name to be a string before any target/archive/checksum lookup runs, so a
// malformed name anywhere in the array sinks the whole release, not just that
// one slot.
for (const [name, mutation] of [
  ["a non-string asset.name (number)", (payload) => { payload.assets[0].name = 12345; }],
  ["a non-string asset.name (null)", (payload) => { payload.assets[0].name = null; }],
  ["asset.name missing entirely", (payload) => { delete payload.assets[0].name; }],
  ["an extra asset with a non-string name appended", (payload) => { payload.assets.push({ name: 999, size: 10, browser_download_url: "https://github.com/xinyiklin/rolefit-ai/releases/download/" + tag + "/x" }); }],
]) {
  const payload = validPayload();
  mutation(payload);
  assert.equal(parseLatestRelease(payload), null, `asset.name edge case rejected: ${name}`);
}

// KNOWN PRODUCT LIMITATION (not fixed here — this eval only locks current
// parsing behavior): parseAsset validates an asset's declared `name`, `size`,
// and canonical `browser_download_url` only. It never fetches or hashes
// SHA256SUMS.txt content against the other assets' actual bytes, so a
// same-named, same-declared-size checksum file with tampered digests inside
// would still parse as a valid release. Checksum *content* verification (if
// ever added) would need to happen after download, not in this pure parser.
assert.equal(parsed.checksums.name, "SHA256SUMS.txt", "checksums asset is located by name/size/URL only — content is out of scope for this parser");

// ── fetchLatestRelease: non-ok response throws; AbortSignal propagates ──
// Both probes stub `globalThis.fetch` so this stays fully offline — no real
// network request is ever made.
{
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(
      () => fetchLatestRelease(),
      /GitHub release request failed with 503/,
      "a non-ok GitHub API response throws rather than silently resolving to null",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}
{
  const realFetch = globalThis.fetch;
  try {
    const controller = new AbortController();
    let capturedSignal;
    let capturedUrl;
    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      capturedSignal = init?.signal;
      return { ok: true, json: async () => [] };
    };
    const result = await fetchLatestRelease(controller.signal);
    assert.equal(capturedSignal, controller.signal, "the caller's AbortSignal is forwarded to fetch unchanged (identity-equal, not just truthy)");
    assert.equal(capturedUrl, "https://api.github.com/repos/xinyiklin/rolefit-ai/releases?per_page=100", "fetchLatestRelease always requests the bounded releases list, never repo-wide /latest");
    assert.equal(result, null, "an empty releases array (no signed or preview release) resolves to null, not a throw");
  } finally {
    globalThis.fetch = realFetch;
  }
}
{
  const realFetch = globalThis.fetch;
  try {
    let capturedSignal = "unset";
    globalThis.fetch = async (_url, init) => {
      capturedSignal = init?.signal;
      return { ok: true, json: async () => [validPayload()] };
    };
    const result = await fetchLatestRelease();
    assert.equal(capturedSignal, undefined, "calling with no signal forwards undefined, not a synthetic default");
    assert.equal(result?.tag, tag, "a well-formed stubbed response still parses through to a real ReleaseCatalog");
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("public landing release catalog probes: passed");
