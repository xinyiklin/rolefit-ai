import "./landing.css";
import {
  DOWNLOAD_TARGETS,
  fetchLatestRelease,
  formatFileSize,
  RELEASES_URL,
  type ReleaseCatalog,
} from "./releaseCatalog";

// In-page navigation without URL hashes: buttons carry data-scroll-to="<id>".
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function scrollToTarget(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  const behavior: ScrollBehavior = reducedMotion.matches ? "auto" : "smooth";
  if (id === "top") {
    window.scrollTo({ top: 0, behavior });
    return;
  }
  target.scrollIntoView({ behavior, block: "start" });
  if (id === "main") {
    (target as HTMLElement).focus({ preventScroll: true });
  }
}

for (const trigger of document.querySelectorAll<HTMLElement>("[data-scroll-to]")) {
  trigger.addEventListener("click", () => {
    const id = trigger.dataset.scrollTo;
    if (id) scrollToTarget(id);
  });
}

// Release catalog: the static page links every row to the Releases page; a
// valid catalog upgrades rows to direct, verified asset downloads.
const statusEl = document.getElementById("release-status");

function setStatus(text: string, available = false): void {
  if (!(statusEl instanceof HTMLParagraphElement)) return;
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.classList.toggle("release-status--available", available);
  if (available) {
    const dot = document.createElement("span");
    dot.className = "release-status__dot";
    dot.setAttribute("aria-hidden", "true");
    statusEl.prepend(dot);
  }
}

function applyCatalog(catalog: ReleaseCatalog): void {
  setStatus(`Version ${catalog.version} is ready to download.`, true);

  for (const target of DOWNLOAD_TARGETS) {
    const asset = catalog.downloads[target.id];
    const row = document.querySelector<HTMLElement>(`[data-download-target="${target.id}"]`);
    if (!asset || !row) continue;
    const action = row.querySelector<HTMLAnchorElement>("[data-action]");
    const label = row.querySelector<HTMLElement>("[data-action-label]");
    const format = row.querySelector<HTMLElement>("[data-format]");
    if (!action || !label || !format) continue;
    action.href = asset.url;
    action.classList.add("is-direct");
    action.setAttribute("aria-label", `Download RoleFit for ${target.platform} ${target.title}`);
    label.textContent = "Download";
    format.textContent = `${target.format} · ${formatFileSize(asset.size)}`;
  }

  const links = document.getElementById("release-links");
  if (!links) return;
  const archives = [
    { name: "Apple silicon ZIP", url: catalog.archives.macosArm64.url },
    { name: "Intel ZIP", url: catalog.archives.macosX64.url },
    { name: "SHA-256 checksums", url: catalog.checksums.url },
  ];
  const allReleases = links.querySelector("a");
  if (allReleases) allReleases.href = catalog.releaseUrl;
  for (const archive of archives.reverse()) {
    const anchor = document.createElement("a");
    anchor.href = archive.url;
    anchor.append(archive.name);
    const releasesIcon = allReleases?.querySelector("svg");
    if (releasesIcon) anchor.append(releasesIcon.cloneNode(true));
    links.prepend(anchor);
  }
}

setStatus("Checking the latest verified release…");

const controller = new AbortController();
const timeout = window.setTimeout(() => controller.abort(), 8_000);
void fetchLatestRelease(controller.signal)
  .then((catalog) => {
    window.clearTimeout(timeout);
    if (catalog) {
      applyCatalog(catalog);
    } else {
      setStatus(
        "No complete verified RoleFit installer set is available yet. GitHub Releases remains the source of truth while a full build is prepared.",
      );
    }
  })
  .catch(() => {
    window.clearTimeout(timeout);
    setStatus("Release status is temporarily unavailable. GitHub Releases remains the download source of truth.");
  });

// Fail-closed reference so the fallback URL cannot be tree-shaken out of sync.
if (import.meta.env.DEV) {
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("[data-action]")) {
    if (!anchor.classList.contains("is-direct") && anchor.href !== RELEASES_URL) {
      console.warn("landing: static row fallback does not match RELEASES_URL", anchor.href);
    }
  }
}
