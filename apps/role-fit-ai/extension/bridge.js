// The extension's only client of the local RoleFit server, shared by the popup
// and the background shortcut handler. Both entry points capture a page and
// import it, so the status-before-send order, the exact wire bodies, and the
// claim-token handoff live here once instead of being re-implemented per caller.

const extensionApi = globalThis.chrome ?? globalThis.browser;

// Every request is bounded. A local server that accepts the connection but never
// answers would otherwise hang the popup behind a progress bar with no way out,
// and strand the keyboard command until its event page is killed mid-flight.
// The handshake is two small local round trips; analyze waits on the server
// resolving the posting (which may fetch the real description from an ATS).
const HANDSHAKE_TIMEOUT_MS = 8_000;
const ANALYZE_TIMEOUT_MS = 20_000;
const IMPORT_TIMEOUT_MS = 10_000;

/**
 * Tagged failure so callers can route recovery without string matching.
 * `connection` — the port answered nothing usable; `pairing` — RoleFit is there
 * but this extension is not approved; `unsupported` — the page cannot be read.
 */
function bridgeError(message, kind) {
  const error = new Error(message);
  if (kind) error.kind = kind;
  return error;
}

function isTimeout(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError";
}

function timeoutSignal(ms) {
  // Supported by every engine this manifest targets (Chrome MV3, Firefox 128+).
  return AbortSignal.timeout(ms);
}

// The browser exposes both callback and Promise forms of extension APIs across
// Chrome, Edge, and Firefox. Keep callback completion authoritative so runtime
// errors are surfaced instead of becoming silent failures.
export function callExtensionApi(api, method, args = []) {
  if (!api || typeof api[method] !== "function") {
    return Promise.reject(new Error(`Extension API method ${method} is unavailable.`));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve(value);
    };
    const callback = (value) => {
      let lastError;
      try {
        lastError = globalThis.chrome?.runtime?.lastError ?? globalThis.browser?.runtime?.lastError;
      } catch (error) {
        settle(error);
        return;
      }
      if (lastError) {
        settle(new Error(lastError.message || `Extension API method ${method} failed.`));
        return;
      }
      settle(null, value);
    };

    let returned;
    try {
      returned = api[method](...args, callback);
    } catch (error) {
      settle(error);
      return;
    }
    if (returned && typeof returned.then === "function") {
      returned.then((value) => settle(null, value), (error) => settle(error));
    }
  });
}

export function randomClaimToken() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // The compact fallback keeps import usable in older extension contexts.
  }
  return `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ── Page capture (the function body below is injected into the active tab) ──

// Injected by source, so every helper it uses is declared inside it. Only a
// Handshake posting page returns a promise; every other capture is synchronous.
export function extractPageData() {
  const capped = (page) => ({ ...page, text: page.text.slice(0, 50000) });
  if (!handshakePostingId()) return capped(extractVisiblePage());
  return extractHandshakePosting().then((page) => capped(page ?? extractVisiblePage()));

  function handshakePostingId() {
    if (!/(^|\.)joinhandshake\.com$/i.test(location.hostname)) return "";
    return location.pathname.match(/^\/(?:jobs|job-search)\/(\d+)\/?$/)?.[1] ?? "";
  }

  // Frame addresses let the server read a posting framed from a job board.
  // Only a same-origin frame's text is readable here; another origin's
  // contentDocument is null.
  function extractVisiblePage() {
    const frames = [...document.querySelectorAll("iframe")];
    const frameUrls = [...new Set(frames.map((frame) => frame.src)
      .filter((src) => /^https?:\/\//i.test(src) && src.length <= 2000))].slice(0, 8);
    const page = (text) => ({ text, url: location.href, title: document.title, frameUrls });
    const selectors = [
      "#jobDescriptionText",
      ".jobs-description",
      ".posting",
      "#content",
      ".wd-JobPostingDescription"
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && node.innerText && node.innerText.trim().length > 100) {
        return page(node.innerText.trim());
      }
    }
    const frameText = frames
      .map((frame) => frame.contentDocument?.body?.innerText?.trim() ?? "")
      .filter((text) => text.length > 100);
    return page([document.body.innerText || "", ...frameText].join("\n\n"));
  }

  // Signed-in Handshake shortens the description behind a toggle and follows
  // the posting with other jobs and students; keep only the posting's sections.
  async function extractHandshakePosting() {
    const pathId = handshakePostingId();
    const pane = () => document.querySelector('[data-hook="job-details-page"], [data-hook="right-content"]');
    const sections = () => {
      let container = pane();
      while (container?.children.length === 1) container = container.firstElementChild;
      const kept = [];
      for (const section of container?.children ?? []) {
        if (section.querySelector('[data-hook="similar-job-bookmark-action"]')) break;
        if (!section.querySelector('a[href*="/profiles/"]')) kept.push(section);
      }
      return kept;
    };
    const postingText = () => sections().map((section) => section.innerText.trim()).filter(Boolean).join("\n\n");
    const settle = async (done) => {
      const deadline = Date.now() + 1500;
      while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    };

    // A click re-renders the toggle, so it is re-found by position. Its label is
    // localized; a click that shortens the posting closed an open section.
    const toggle = (index) => sections()
      .flatMap((section) => [...section.querySelectorAll("button.view-more-button")])
      .filter((button) => !button.form && !button.closest("a"))[index];
    for (let index = 0; index < 4 && toggle(index); index += 1) {
      const before = postingText().length;
      toggle(index).click();
      await settle(() => postingText().length !== before);
      if (postingText().length < before) {
        toggle(index)?.click();
        await settle(() => postingText().length >= before);
      }
    }

    const text = postingText();
    if (text.length < 100) return null;
    const heading = pane().querySelector("h1");
    const jobId = heading?.closest("a")?.pathname.match(/^\/jobs\/(\d+)\/?$/)?.[1] ?? pathId;
    const role = heading?.innerText.replace(/\s+/g, " ").trim();
    const employer = pane().querySelector('a[href^="/e/"][aria-label]')?.getAttribute("aria-label")
      .replace(/[\s|]+/g, " ").trim();
    return {
      text,
      url: `${location.origin}/jobs/${jobId}`,
      title: role && employer ? `${role} | ${employer} | Handshake` : document.title
    };
  }
}

/**
 * Read the posting from the active tab. Returns the captured page plus the tab
 * itself, whose `cookieStoreId` keeps a Firefox container import in its container.
 */
export async function capturePageData() {
  let tabs;
  try {
    tabs = await callExtensionApi(extensionApi?.tabs, "query", [{ active: true, currentWindow: true }]);
  } catch {
    throw bridgeError("The active browser tab could not be accessed.", "unsupported");
  }
  const tab = Array.isArray(tabs) ? tabs[0] : null;
  if (!tab || typeof tab.id !== "number") {
    throw bridgeError("Open a job posting in the active tab first.", "unsupported");
  }
  let results;
  try {
    results = await callExtensionApi(extensionApi?.scripting, "executeScript", [{
      target: { tabId: tab.id },
      func: extractPageData
    }]);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (/Cannot access|chrome:\/\/|extension:\/\/|about:|Cannot inject/i.test(message)) {
      throw bridgeError("Open a job posting in a normal tab, then try again.", "unsupported");
    }
    throw bridgeError("This browser did not allow RoleFit to read the page.", "unsupported");
  }
  const pageData = results?.[0]?.result;
  if (!pageData || typeof pageData.text !== "string" || !pageData.text.trim()) {
    throw bridgeError("No readable job posting was found on this page.", "unsupported");
  }
  return { pageData, sourceTab: tab };
}

// ── Local RoleFit service ──────────────────────────────────────────────────

function validateStatusResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).sort();
  if (keys.join(",") !== "paired,schemaVersion,service,status") return false;
  return payload.service === "rolefit-ai-extension" &&
    payload.schemaVersion === 1 &&
    payload.status === "ok" &&
    typeof payload.paired === "boolean";
}

async function getExtensionStatus(apiBase) {
  let response;
  try {
    response = await fetch(`${apiBase}/api/extension/status`, {
      method: "GET",
      cache: "no-store",
      signal: timeoutSignal(HANDSHAKE_TIMEOUT_MS)
    });
  } catch (error) {
    throw bridgeError(isTimeout(error)
      ? "RoleFit did not answer on this localhost port in time."
      : "RoleFit could not be reached on this localhost port.", "connection");
  }
  if (!response.ok) throw bridgeError(`RoleFit returned status ${response.status}.`, "connection");
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw bridgeError("RoleFit returned an unreadable connection response.", "connection");
  }
  if (!validateStatusResponse(payload)) {
    throw bridgeError("The service on this port is not the RoleFit extension service.", "connection");
  }
  return payload;
}

async function requestExtensionPairing(apiBase) {
  let response;
  try {
    response = await fetch(`${apiBase}/api/extension/pairing-request`, {
      method: "POST",
      signal: timeoutSignal(HANDSHAKE_TIMEOUT_MS)
    });
  } catch (error) {
    throw bridgeError(isTimeout(error)
      ? "RoleFit did not answer the pairing request in time."
      : "RoleFit could not send the pairing request.", "pairing");
  }
  if (!response.ok && response.status !== 202) {
    throw bridgeError(`RoleFit did not accept the pairing request (${response.status}).`, "pairing");
  }
  try {
    const payload = await response.json();
    return payload?.status === "paired";
  } catch {
    return false;
  }
}

/**
 * The single gate every caller must clear before page text leaves the browser:
 * identify the exact RoleFit service on this port, then confirm this extension's
 * Origin is approved. A privileged extension-page GET may omit Origin, so an
 * unpaired status is re-checked through the origin-bearing pairing POST.
 */
export async function confirmPairedService(apiBase, { requestPairing = true } = {}) {
  const status = await getExtensionStatus(apiBase);
  if (status.paired) return { paired: true, requested: false };
  if (!requestPairing) return { paired: false, requested: false };
  const paired = await requestExtensionPairing(apiBase);
  return { paired, requested: true };
}

export async function analyzePosting(apiBase, pageData) {
  let response;
  try {
    response = await fetch(`${apiBase}/api/extension/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: pageData.text,
        url: pageData.url,
        pageTitle: pageData.title,
        frameUrls: pageData.frameUrls
      }),
      signal: timeoutSignal(ANALYZE_TIMEOUT_MS)
    });
  } catch (error) {
    // A timeout is not an unreachable port: the handshake answered seconds ago,
    // so this stays untagged and reaches the retry view instead of sending the
    // user to change a port that is already correct.
    if (isTimeout(error)) throw bridgeError("RoleFit took too long to check this posting.");
    throw bridgeError("The local app could not check this posting.", "connection");
  }
  if (!response.ok) {
    const error = bridgeError(response.status === 429
      ? "RoleFit is busy. Wait a moment and try again."
      : `RoleFit could not check this posting (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw bridgeError("RoleFit returned an unreadable posting result.");
  }
}

/**
 * Queue the posting for one fresh app tab. The body carries only the captured
 * text, its URL, the page's frame addresses, and the claim token that routes
 * it to that tab; the app owns AI-backed job analysis and stops on Prepare.
 */
export async function importPosting(apiBase, pageData, claimToken) {
  let response;
  try {
    response = await fetch(`${apiBase}/api/extension/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pageData.text, url: pageData.url, frameUrls: pageData.frameUrls, claimToken }),
      signal: timeoutSignal(IMPORT_TIMEOUT_MS)
    });
  } catch (error) {
    // The server queues the posting before it answers, so a timed-out import
    // has probably landed. Say that rather than asserting it was refused, and
    // leave it untagged so the popup does not offer a pointless port change.
    if (isTimeout(error)) {
      throw bridgeError("RoleFit did not confirm this import in time; it may already be queued.");
    }
    throw bridgeError("RoleFit stopped responding on this localhost port.", "connection");
  }
  if (response.status === 403) {
    throw bridgeError("RoleFit has not approved this extension.", "pairing");
  }
  if (!response.ok) {
    const error = bridgeError(`RoleFit could not prepare this posting (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return true;
}

async function createTab(url, cookieStoreId) {
  if (cookieStoreId) {
    try {
      await callExtensionApi(extensionApi?.tabs, "create", [{ url, cookieStoreId }]);
      return;
    } catch {
      // Private or unsupported containers fall back to a normal fresh tab.
    }
  }
  await callExtensionApi(extensionApi?.tabs, "create", [{ url }]);
}

export function openImportTab(apiBase, claimToken, cookieStoreId) {
  return createTab(`${apiBase}/?extensionImport=${encodeURIComponent(claimToken)}`, cookieStoreId);
}

export function openRoleFitTab(apiBase) {
  return createTab(apiBase);
}
