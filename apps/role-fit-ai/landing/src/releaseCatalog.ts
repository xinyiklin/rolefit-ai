export const RELEASES_URL = "https://github.com/xinyiklin/rolefit-ai/releases";
export const RELEASES_API_URL =
  "https://api.github.com/repos/xinyiklin/rolefit-ai/releases?per_page=100";

export const DOWNLOAD_TARGETS = [
  {
    id: "macos-arm64",
    platform: "macOS",
    title: "Apple silicon",
    detail: "M1 or newer",
    format: "DMG",
    assetName: (version: string) =>
      `RoleFit-Local-Companion-${version}-macos-arm64.dmg`,
  },
  {
    id: "macos-x64",
    platform: "macOS",
    title: "Intel",
    detail: "Intel processor",
    format: "DMG",
    assetName: (version: string) =>
      `RoleFit-Local-Companion-${version}-macos-x64.dmg`,
  },
  {
    id: "windows-x64",
    platform: "Windows",
    title: "64-bit",
    detail: "x64 setup",
    format: "EXE",
    assetName: (version: string) =>
      `RoleFit-Local-Companion-${version}-windows-x64.exe`,
  },
] as const;

export type DownloadTargetId = (typeof DOWNLOAD_TARGETS)[number]["id"];

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface ReleaseCatalog {
  version: string;
  tag: string;
  releaseUrl: string;
  downloads: Record<DownloadTargetId, ReleaseAsset>;
  archives: {
    macosArm64: ReleaseAsset;
    macosX64: ReleaseAsset;
  };
  checksums: ReleaseAsset;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalAssetUrl(tag: string, assetName: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const expectedPath = `/xinyiklin/rolefit-ai/releases/download/${tag}/${assetName}`;
  return url.origin === "https://github.com" &&
    !url.username &&
    !url.password &&
    url.pathname === expectedPath &&
    !url.search &&
    !url.hash
    ? url.href
    : null;
}

function parseAsset(
  value: unknown,
  expectedName: string,
  tag: string,
): ReleaseAsset | null {
  if (!isRecord(value) || value.name !== expectedName) return null;
  const size = value.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) return null;
  const url = canonicalAssetUrl(tag, expectedName, value.browser_download_url);
  return url ? { name: expectedName, url, size } : null;
}

export function parseLatestRelease(value: unknown): ReleaseCatalog | null {
  if (!isRecord(value) || value.draft !== false || value.prerelease !== false) return null;

  const tag = value.tag_name;
  if (typeof tag !== "string") return null;
  const tagMatch = /^rolefit-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!tagMatch) return null;
  const version = `${tagMatch[1]}.${tagMatch[2]}.${tagMatch[3]}`;

  const expectedReleaseUrl = `${RELEASES_URL}/tag/${tag}`;
  if (value.html_url !== expectedReleaseUrl || !Array.isArray(value.assets)) return null;

  const assetsByName = new Map<string, unknown>();
  for (const asset of value.assets) {
    if (!isRecord(asset) || typeof asset.name !== "string" || assetsByName.has(asset.name)) {
      return null;
    }
    assetsByName.set(asset.name, asset);
  }

  const resolvedDownloads = {} as Record<DownloadTargetId, ReleaseAsset>;
  for (const target of DOWNLOAD_TARGETS) {
    const assetName = target.assetName(version);
    const asset = parseAsset(assetsByName.get(assetName), assetName, tag);
    if (!asset) return null;
    resolvedDownloads[target.id] = asset;
  }

  const macosArm64ArchiveName = `RoleFit-Local-Companion-${version}-macos-arm64.zip`;
  const macosX64ArchiveName = `RoleFit-Local-Companion-${version}-macos-x64.zip`;
  const macosArm64 = parseAsset(
    assetsByName.get(macosArm64ArchiveName),
    macosArm64ArchiveName,
    tag,
  );
  const macosX64 = parseAsset(
    assetsByName.get(macosX64ArchiveName),
    macosX64ArchiveName,
    tag,
  );
  if (!macosArm64 || !macosX64) return null;

  const checksumName = "SHA256SUMS.txt";
  const checksums = parseAsset(assetsByName.get(checksumName), checksumName, tag);
  if (!checksums) return null;
  if (assetsByName.size !== DOWNLOAD_TARGETS.length + 3) return null;

  return {
    version,
    tag,
    releaseUrl: expectedReleaseUrl,
    downloads: resolvedDownloads,
    archives: { macosArm64, macosX64 },
    checksums,
  };
}

export function parseReleaseList(value: unknown): ReleaseCatalog | null {
  if (!Array.isArray(value)) return null;
  for (const candidate of value) {
    const release = parseLatestRelease(candidate);
    if (release) return release;
  }
  return null;
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<ReleaseCatalog | null> {
  const response = await fetch(RELEASES_API_URL, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });
  if (!response.ok) throw new Error(`GitHub release request failed with ${response.status}`);
  return parseReleaseList(await response.json());
}

export function formatFileSize(size: number): string {
  const mebibytes = size / (1024 * 1024);
  return `${mebibytes >= 10 ? Math.round(mebibytes) : mebibytes.toFixed(1)} MB`;
}
