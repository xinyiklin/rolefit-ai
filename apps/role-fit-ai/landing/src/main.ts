import "./landing.css";
import {
  DOWNLOAD_TARGETS,
  fetchLatestRelease,
  formatFileSize,
  RELEASES_URL,
  type ReleaseCatalog,
} from "./releaseCatalog";
import { setupGallery } from "./gallery";
import { setupResizeGuard } from "./resizeGuard";
import { setupReveal } from "./reveal";

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

setupReveal();
setupGallery(reducedMotion);
setupResizeGuard();

// Release catalog: the static page links every row to the Releases page; a
// valid catalog upgrades rows to direct, verified asset downloads.
const statusEl = document.getElementById("release-status");

function setStatus(text: string, available = false, preview = false): void {
  if (!(statusEl instanceof HTMLParagraphElement)) return;
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.classList.toggle("release-status--available", available);
  statusEl.classList.toggle("release-status--preview", preview);
  if (available) {
    const dot = document.createElement("span");
    dot.className = "release-status__dot";
    dot.setAttribute("aria-hidden", "true");
    statusEl.prepend(dot);
  }
}

function setReleaseChannelCopy(preview: boolean): void {
  const channelLabel = document.getElementById("release-channel-label");
  const safetyNote = document.getElementById("release-safety-note");

  if (channelLabel) {
    channelLabel.replaceChildren();
    const dot = document.createElement("span");
    dot.className = preview ? "is-preview" : "is-signed";
    dot.setAttribute("aria-hidden", "true");
    channelLabel.append(
      dot,
      preview
        ? "Unsigned desktop preview · macOS (Apple silicon) and Windows (x64). No RoleFit account."
        : "Signed desktop release · macOS (Apple silicon) and Windows (x64). No RoleFit account.",
    );
  }
  if (safetyNote) {
    safetyNote.textContent = preview
      ? "This preview is unsigned. macOS Gatekeeper and Windows SmartScreen will show the expected unidentified-publisher warning."
      : "Signed release artifacts include SHA-256 checksums. Verify the checksum before opening an installer.";
  }
}

function applyCatalog(catalog: ReleaseCatalog): void {
  const preview = catalog.channel === "unsigned-preview";
  setReleaseChannelCopy(preview);
  setStatus(
    preview
      ? `Unsigned preview ${catalog.version} ${catalog.previewLabel} is available. macOS and Windows will show security warnings.`
      : `Signed version ${catalog.version} is ready to download.`,
    true,
    preview,
  );

  for (const target of DOWNLOAD_TARGETS) {
    const asset = catalog.downloads[target.id];
    if (!asset) continue;
    // The hero and the download panel each carry one button per target.
    for (const action of document.querySelectorAll<HTMLAnchorElement>(
      `a[data-download-target="${target.id}"]`,
    )) {
      // The caption under the button is also its aria-describedby, so
      // "Unsigned" reaches screen readers with the platform name.
      const format = action.parentElement?.querySelector<HTMLElement>("[data-format]");
      if (!format) continue;
      action.href = asset.url;
      action.classList.add("is-direct");
      format.textContent = `${preview ? "Unsigned " : ""}${target.format} · ${formatFileSize(asset.size)}`;
    }
  }

  const links = document.getElementById("release-links");
  if (!links) return;
  const unsigned = preview ? "Unsigned " : "";
  const archives = [
    { name: `${unsigned}Apple silicon ZIP`, url: catalog.archives.macosArm64.url },
    { name: "SHA-256 checksums", url: catalog.checksums.url },
  ];
  const allReleases = links.querySelector("a");
  // Retargeted to the verified release, so the label names that page.
  if (allReleases) {
    allReleases.href = catalog.releaseUrl;
    allReleases.textContent = "Release notes ↗";
  }
  for (const archive of archives.reverse()) {
    const anchor = document.createElement("a");
    anchor.href = archive.url;
    anchor.append(`${archive.name} ↗`);
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
