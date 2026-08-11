import {
  analyzePosting,
  capturePageData,
  confirmPairedService,
  importPosting,
  openImportTab,
  openRoleFitTab,
  randomClaimToken,
  callExtensionApi
} from "./bridge.js";
import {
  clearShortcutNotice,
  createLocalSiteOrigin,
  loadExtensionSettings,
  readShortcutNotice,
  resetExtensionSettings,
  saveExtensionPort,
  validateLocalSitePort
} from "./settings.js";

const STATES = Object.freeze({
  loading: "loading",
  job: "job",
  settings: "settings",
  connectionError: "connection-error",
  pairingRequired: "pairing-required",
  unsupportedPage: "unsupported-page",
  requestError: "request-error"
});

const CONNECTION_STATES = Object.freeze({
  checking: "checking",
  connected: "connected",
  approval: "approval",
  unavailable: "unavailable"
});

const IMPORT_COMMAND = "import-job";
const DEFAULT_PORT = "5181";

const extensionApi = globalThis.chrome ?? globalThis.browser;

const controller = {
  root: null,
  state: STATES.loading,
  previousState: STATES.loading,
  connection: CONNECTION_STATES.checking,
  settings: null,
  portDraft: null,
  apiBase: "",
  pageData: null,
  pageLoadPromise: null,
  pageError: null,
  sourceTab: null,
  analysis: null,
  pairingRequestBase: "",
  flowGeneration: 0,
  busy: false,
  // idle → importing → opened. "opened" is terminal for this popup: the posting
  // is queued and its tab exists, so the action must not invite a second import.
  importState: "idle",
  loadingLabel: "Connecting",
  pairingMessage: "",
  connectionMessage: "",
  requestMessage: "",
  requestRetry: null,
  settingsFeedback: "",
  // One inline line above whatever view is showing: a keyboard import that
  // failed with no popup open, or an import that failed here and then
  // reconnected cleanly — which would otherwise look like nothing happened.
  notice: "",
  pairingTitle: "",
  shortcutHint: "",
  shortcutError: "",
  shortcuts: null,
  // Last keyed control to receive focus. Held here rather than read at render
  // time because an action that disables its own control blurs it first.
  focusKey: "",
  focusListenerAttached: false
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "className") node.className = value;
    else if (key === "textContent") node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function icon(path, { size = 15 } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of path) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
    node.setAttribute("d", d);
    svg.append(node);
  }
  return svg;
}

const ICON_SETTINGS = [
  "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z",
  "M19.4 14.4a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.5 1v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-2.6-1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1-2.5h-.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1-2.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 2.5 1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0-.3 1.7v.1a1.5 1.5 0 0 0 1.4.9h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4.9Z"
];
const ICON_CLOSE = ["M6 6l12 12", "M18 6 6 18"];

function formatDate(iso) {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isMacPlatform() {
  return /Mac/i.test(navigator?.platform || navigator?.userAgent || "");
}

// Browser shortcut strings ("Command+Shift+U") read as prose in a key cap.
// macOS uses its glyphs; every other platform keeps the words it labels keys with.
function formatShortcut(shortcut) {
  if (!shortcut) return "";
  if (!isMacPlatform()) return shortcut.replace(/\+/g, " + ");
  const glyphs = { Command: "⌘", Shift: "⇧", Alt: "⌥", Option: "⌥", Ctrl: "⌃", MacCtrl: "⌃" };
  return shortcut.split("+").map((part) => glyphs[part] ?? part).join("");
}

// The glyph cap is a visual affordance — "⌘⇧U" does not read aloud usefully —
// so the browser's own chord string is carried alongside it for assistive tech.
function keyCap(shortcut, status) {
  if (status !== "ok") return el("span", { className: "value-pending", textContent: "unavailable" });
  if (!shortcut) return el("span", { className: "value-pending", textContent: "not assigned" });
  return el("span", {},
    el("kbd", { className: "kbd", "aria-hidden": "true", textContent: formatShortcut(shortcut) }),
    el("span", { className: "sr-only", textContent: shortcut.replace(/\+/g, " plus ") })
  );
}

async function readShortcuts() {
  try {
    const all = await callExtensionApi(extensionApi?.commands, "getAll");
    if (!Array.isArray(all)) return { status: "unavailable" };
    const find = (name) => all.find((command) => command?.name === name)?.shortcut || "";
    // An empty list means the browser registered no commands for this install —
    // report that as unreadable rather than as two deliberately cleared keys.
    if (!all.length) return { status: "unavailable" };
    return { status: "ok", import: find(IMPORT_COMMAND), popup: find("_execute_action") };
  } catch {
    return { status: "unavailable" };
  }
}

// getBrowserInfo is Firefox-only and long-standing. Detecting the engine by
// openShortcutSettings instead (Firefox 137+) misread every older Firefox as
// Chrome and sent it to a chrome:// URL it is not allowed to open.
function isFirefoxRuntime() {
  return typeof globalThis.browser?.runtime?.getBrowserInfo === "function";
}

/**
 * Open the browser's own shortcut editor. Returns a hint when the browser
 * cannot be taken there directly, so the caller can say where to go instead of
 * reporting a failure.
 */
async function openShortcutSettings() {
  const firefoxCommands = globalThis.browser?.commands;
  if (typeof firefoxCommands?.openShortcutSettings === "function") {
    const result = firefoxCommands.openShortcutSettings();
    if (result && typeof result.then === "function") await result;
    return "";
  }
  if (isFirefoxRuntime()) {
    const hint = "In Add-ons, open the gear menu → Manage Extension Shortcuts.";
    try {
      await callExtensionApi(extensionApi?.tabs, "create", [{ url: "about:addons" }]);
    } catch {
      // Firefox may refuse an extension-opened about: page; the hint is then
      // the entire answer, and that is not an error worth alarming about.
    }
    return hint;
  }
  const url = /Edg\//i.test(navigator.userAgent || "")
    ? "edge://extensions/shortcuts"
    : "chrome://extensions/shortcuts";
  await callExtensionApi(extensionApi?.tabs, "create", [{ url }]);
  return "";
}

function getManifestVersion() {
  try {
    return String(extensionApi?.runtime?.getManifest?.()?.version || "");
  } catch {
    return "";
  }
}

// The badge is the keyboard import's only live feedback; opening the popup is the
// user reading that result, so it clears here alongside the stored notice.
function clearShortcutBadge() {
  try {
    // Firefox returns a promise here, so a bare call would surface an unhandled
    // rejection; the try alone only guards the synchronous form.
    const cleared = extensionApi?.action?.setBadgeText?.({ text: "" });
    if (cleared && typeof cleared.then === "function") cleared.catch(() => {});
  } catch {
    // Badge support is optional; the popup still shows the stored notice.
  }
}

function displayPort() {
  if (controller.settings?.localSitePort) return String(controller.settings.localSitePort);
  if (controller.portDraft) return controller.portDraft;
  return "—";
}

function connectionWord() {
  switch (controller.connection) {
    case CONNECTION_STATES.connected: return "Connected";
    case CONNECTION_STATES.approval: return "Not approved";
    case CONNECTION_STATES.unavailable: return "Offline";
    default: return "Checking";
  }
}

function dot(tone) {
  return el("span", { className: `dot dot-${tone}`, "aria-hidden": "true" });
}

// ── Chrome ─────────────────────────────────────────────────────────────────

function renderMasthead() {
  const inSettings = controller.state === STATES.settings;
  const toggle = el("button", {
    className: "icon-button",
    type: "button",
    "aria-expanded": String(inSettings),
    "aria-label": inSettings ? "Close settings" : "Settings",
    title: inSettings ? "Close settings" : "Settings",
    "data-focus-key": "settings-toggle"
  }, icon(inSettings ? ICON_CLOSE : ICON_SETTINGS, { size: 16 }));
  toggle.addEventListener("click", () => {
    if (inSettings) {
      leaveSettings();
      return;
    }
    // Bumping the generation abandons any in-flight connect, which then returns
    // at an isCurrent() guard without reaching its own cleanup. Clear the
    // progress state here or the working rule animates for the rest of the
    // session, claiming work that nothing is doing.
    controller.flowGeneration += 1;
    controller.busy = false;
    controller.previousState = controller.state;
    controller.state = STATES.settings;
    controller.settingsFeedback = "";
    render();
  });

  return el("header", { className: "masthead" },
    el("span", { className: "wordmark", textContent: "RoleFit" }),
    el("span", {
      className: `port-status port-${controller.connection}`,
      role: "status",
      "aria-label": `${connectionWord()} on localhost port ${displayPort()}`
    }, dot(controller.connection), el("span", { className: "mono", textContent: displayPort() })),
    toggle
  );
}

function renderWorkingRule() {
  return el("div", {
    className: controller.busy ? "working-rule is-active" : "working-rule",
    "aria-hidden": "true"
  });
}

function renderInlineNotice() {
  if (!controller.notice) return null;
  return el("p", {
    className: "inline-notice",
    role: "status",
    textContent: controller.notice
  });
}

function renderButton(label, className, onClick, attrs = {}) {
  const button = el("button", { className, type: "button", ...attrs }, label);
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

function ledgerRow(label, value, { className = "" } = {}) {
  return el("div", { className: `ledger-row ${className}`.trim() },
    el("dt", { textContent: label }),
    el("span", { className: "leader", "aria-hidden": "true" }),
    el("dd", {}, value)
  );
}

// ── Views ──────────────────────────────────────────────────────────────────

function renderLoading() {
  return el("main", { className: "view view-loading" },
    renderInlineNotice(),
    el("p", { className: "value-status", role: "status", "aria-live": "polite" },
      dot("checking"),
      `${controller.loadingLabel}…`
    )
  );
}

function renderNotice(className, title, copy, actions = []) {
  const view = el("main", { className: `view view-notice ${className}`.trim() },
    renderInlineNotice(),
    el("h1", { className: "notice-title", textContent: title }),
    el("p", { className: "notice-copy", role: "alert", textContent: copy })
  );
  const present = actions.filter(Boolean);
  if (present.length) view.append(el("div", { className: "actions" }, ...present));
  return view;
}

function trackerStatus(app) {
  if (!app) return { tone: "idle", label: "Not tracked" };
  switch (app.status) {
    case "applied": {
      const on = formatDate(app.appliedAt);
      return { tone: "filed", label: on ? `Applied · ${on}` : "Applied" };
    }
    case "interviewing": return { tone: "active", label: "Interviewing" };
    case "offer": return { tone: "active", label: "Offer" };
    case "rejected": {
      const on = formatDate(app.appliedAt);
      return { tone: "closed", label: on ? `Not selected · ${on}` : "Not selected" };
    }
    case "withdrawn": return { tone: "idle", label: "Withdrawn" };
    default: return { tone: "watch", label: String(app.status || "Tracked") };
  }
}

function sourceHost(url) {
  try {
    // A file:// or data: posting parses cleanly but has no host; an empty
    // ledger value reads as a rendering failure.
    return new URL(url).hostname.replace(/^www\./, "") || "this page";
  } catch {
    return "this page";
  }
}

function countWords(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function renderJob(data) {
  const { title, company, previousApp } = data;
  const tracker = trackerStatus(previousApp);
  const match = data.match;
  const evidence = previousApp && match && Array.isArray(match.evidence) && match.evidence.length
    ? `${match.confidence !== "exact" ? "Possible duplicate · " : ""}${match.evidence.join(" · ")}`
    : "";
  const words = countWords(controller.pageData?.text);

  // The import phase is controller state, not a DOM mutation: any re-render (the
  // working rule, a resolved shortcut) rebuilds this button and would drop a
  // local flag. "opened" is a real terminal label — without it a completed
  // import leaves the action reading "Preparing" for as long as the popup lives.
  const labels = {
    idle: "Prepare in RoleFit",
    importing: "Preparing",
    opened: "Opened in RoleFit"
  };
  const label = labels[controller.importState] ?? labels.idle;
  const idle = controller.importState === "idle";
  const prepare = el("button", {
    className: "btn-primary",
    type: "button",
    "aria-label": label,
    disabled: idle ? null : "disabled",
    "data-focus-key": "primary"
  }, el("span", { textContent: label }));
  // A bare greyed-out button reads as broken; the house status dot marks it done.
  if (controller.importState === "opened") prepare.prepend(dot("active"));
  const shortcut = idle ? formatShortcut(controller.shortcuts?.import) : "";
  if (shortcut) prepare.append(el("kbd", { className: "kbd", "aria-hidden": "true", textContent: shortcut }));
  prepare.addEventListener("click", () => {
    if (controller.importState !== "idle") return;
    void handleImport();
  });

  return el("main", { className: "view view-job" },
    renderInlineNotice(),
    el("div", { className: "capture" },
      el("h1", { className: "job-title", textContent: title || "Job posting" }),
      company ? el("p", { className: "job-company", textContent: company }) : null
    ),
    el("dl", { className: "ledger" },
      ledgerRow("Source", el("span", { className: "mono", textContent: sourceHost(controller.pageData?.url) })),
      words ? ledgerRow("Captured", el("span", { className: "mono", textContent: `${words.toLocaleString("en-US")} words` })) : null,
      ledgerRow("Tracker", el("span", { className: "value-status" }, dot(tracker.tone), tracker.label))
    ),
    evidence ? el("p", { className: "evidence", textContent: evidence }) : null,
    el("div", { className: "actions" },
      prepare,
      renderButton("Open RoleFit", "btn-quiet", () => { void openRoleFit(); })
    )
  );
}

function portField(idPrefix, { autofocus = false } = {}) {
  if (controller.portDraft == null) {
    controller.portDraft = controller.settings?.localSitePort
      ? String(controller.settings.localSitePort)
      : "";
  }
  const input = el("input", {
    id: `${idPrefix}-port`,
    className: "port-input mono",
    type: "text",
    inputmode: "numeric",
    autocomplete: "off",
    spellcheck: "false",
    maxlength: "5",
    pattern: "[0-9]+",
    value: controller.portDraft,
    "aria-describedby": `${idPrefix}-port-error`,
    autofocus: autofocus ? "autofocus" : null,
    "data-focus-key": "port"
  });
  const error = el("p", { id: `${idPrefix}-port-error`, className: "field-error", role: "alert" });
  input.addEventListener("input", () => {
    controller.portDraft = input.value;
    error.textContent = "";
  });
  // Must be a submit button: the form's submit handler owns validation, so a
  // type="button" here silently does nothing on click and on Enter.
  const save = el("button", { className: "btn-inline", type: "submit", "data-focus-key": "save-port" }, "Save");
  const form = el("form", { className: "port-form" },
    el("label", { className: "field-label", for: `${idPrefix}-port`, textContent: "Port" }),
    input,
    save
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveAndReconnect(input.value, error, save);
  });
  return { form, error };
}

function renderSettings() {
  const { form, error } = portField("settings");
  const reset = renderButton("Reset to 5181", "btn-quiet-sm", null, { "data-focus-key": "reset-port" });
  reset.addEventListener("click", () => { void resetAndReconnect(reset); });

  const shortcuts = controller.shortcuts ?? { status: "unavailable" };
  const version = getManifestVersion();

  return el("main", { className: "view view-settings" },
    // Shown here too: a connection notice is most actionable next to the port.
    renderInlineNotice(),
    el("h1", { className: "section-label", textContent: "Connection" }),
    form,
    el("p", { className: "field-help", textContent: "Match the port shown in the RoleFit companion." }),
    error,
    controller.settingsFeedback
      ? el("p", { className: "field-error", role: "alert", textContent: controller.settingsFeedback })
      : null,
    el("div", { className: "settings-row" },
      el("span", { className: "value-status" }, dot(controller.connection), connectionWord()),
      reset
    ),

    el("h2", { className: "section-label", textContent: "Shortcuts" }),
    el("dl", { className: "ledger" },
      ledgerRow("Import this page", keyCap(shortcuts.import, shortcuts.status), { className: "ledger-row-plain" }),
      ledgerRow("Open this popup", keyCap(shortcuts.popup, shortcuts.status), { className: "ledger-row-plain" })
    ),
    renderButton("Change in browser settings", "btn-quiet-sm", () => {
      controller.shortcutHint = "";
      controller.shortcutError = "";
      void openShortcutSettings().then((hint) => {
        controller.shortcutHint = hint;
        render();
      }, () => {
        controller.shortcutError = "This browser did not open its shortcut settings.";
        render();
      });
    }, { "aria-label": "Change shortcuts in browser settings", "data-focus-key": "change-shortcuts" }),
    controller.shortcutHint
      ? el("p", { className: "field-help", role: "status", textContent: controller.shortcutHint })
      : null,
    controller.shortcutError
      ? el("p", { className: "field-error", role: "alert", textContent: controller.shortcutError })
      : null,
    shortcuts.status !== "ok"
      ? el("p", { className: "field-help", textContent: "Reload the extension in your browser to register its shortcuts." })
      : null,

    version ? el("p", { className: "version mono", textContent: `Extension ${version}` }) : null
  );
}

function renderConnectionError() {
  const { form, error } = portField("recovery", { autofocus: true });
  return renderNotice(
    "is-danger",
    "RoleFit isn't answering",
    controller.connectionMessage || `Nothing responded on localhost:${displayPort()}.`,
    [
      form,
      error,
      el("p", { className: "field-help", textContent: "Match the port shown in the RoleFit companion." })
    ]
  );
}

function renderPairingRequired() {
  return renderNotice(
    "is-warn",
    // A refused pairing and an unanswered one are different facts. Only the
    // first means the user has something to approve.
    controller.pairingTitle || "Approval needed",
    controller.pairingMessage || "Approve this extension in the RoleFit companion, then check again.",
    [
      renderButton("Check again", "btn-primary", () => {
        void connectAndAnalyze({ requestPairing: true, forcePairing: true });
      }),
      renderButton("Open RoleFit", "btn-quiet", () => { void openRoleFit(); })
    ]
  );
}

function renderUnsupportedPage() {
  return renderNotice(
    "",
    "Nothing to capture",
    controller.requestMessage || "Open a job posting in a normal tab, then reopen this popup.",
    [renderButton("Open RoleFit", "btn-quiet", () => { void openRoleFit(); })]
  );
}

function renderRequestError() {
  return renderNotice(
    "is-danger",
    "That didn't go through",
    controller.requestMessage || "The local app did not complete the request.",
    [
      controller.requestRetry
        ? renderButton("Try again", "btn-primary", () => { void controller.requestRetry(); })
        : null,
      renderButton("Open RoleFit", "btn-quiet", () => { void openRoleFit(); })
    ]
  );
}

function renderView() {
  switch (controller.state) {
    case STATES.settings: return renderSettings();
    case STATES.job: return renderJob(controller.analysis);
    case STATES.connectionError: return renderConnectionError();
    case STATES.pairingRequired: return renderPairingRequired();
    case STATES.unsupportedPage: return renderUnsupportedPage();
    case STATES.requestError: return renderRequestError();
    default: return renderLoading();
  }
}

// What the popup is doing right now, for the persistent live region. Only
// asynchronous state earns an announcement: a settled view is there to be read,
// but progress and import phases change with nothing on screen to notice.
function liveStatus() {
  if (controller.state === STATES.loading) return `${controller.loadingLabel}…`;
  if (controller.state === STATES.job) {
    if (controller.importState === "importing") return "Preparing the posting…";
    if (controller.importState === "opened") return "Opened in RoleFit.";
  }
  return "";
}

let lastAnnouncement = "";

function announce(text) {
  const node = document.getElementById("announcer");
  if (!node || text === lastAnnouncement) return;
  lastAnnouncement = text;
  node.textContent = text;
}

function render() {
  if (!controller.root) return;
  // replaceChildren destroys the focused control, dropping keyboard focus to
  // <body> after every action. The key comes from the focusin tracker, not from
  // activeElement: a handler that disables its own button (Save, Reset) has
  // already blurred it by the time this runs.
  const active = document.activeElement;
  // Prefer what is focused right now; fall back to the tracker for the case it
  // exists to cover — a handler that disabled its own control already blurred it.
  const focusKey = active?.getAttribute?.("data-focus-key") || controller.focusKey;
  const caret = active && typeof active.selectionStart === "number" ? active.selectionStart : null;

  controller.root.replaceChildren(renderMasthead(), renderWorkingRule(), renderView());

  // The view itself is a focus target of last resort, and carries a key so a
  // multi-render transition (loading → job) keeps handing focus forward instead
  // of losing it on the second hop.
  const view = controller.root.querySelector(".view");
  if (view) {
    view.setAttribute("tabindex", "-1");
    view.setAttribute("data-focus-key", "view");
  }

  if (focusKey) {
    const restored = controller.root.querySelector(`[data-focus-key="${focusKey}"]`);
    if (restored && !restored.disabled) {
      restored.focus();
      if (caret != null && typeof restored.setSelectionRange === "function") {
        restored.setSelectionRange(caret, caret);
      }
    } else if (view) {
      // Save and Reset both end on another view, so their control is gone. Park
      // on the new view rather than dropping the keyboard user back to <body>.
      controller.focusKey = "view";
      view.focus();
    }
  }
  announce(liveStatus());
}

// Display data that resolves on its own (the assigned shortcuts, a pending
// keyboard-import notice) must not yank focus out of a field mid-keystroke.
function rerenderQuietly() {
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
  render();
}

// ── Flow ───────────────────────────────────────────────────────────────────

function leaveSettings() {
  // Every message this view produced dies with it; otherwise reopening Settings
  // shows a hint left over from an earlier click.
  controller.settingsFeedback = "";
  controller.shortcutHint = "";
  controller.shortcutError = "";
  if (controller.previousState === STATES.loading) {
    void connectAndAnalyze({ requestPairing: true });
    return;
  }
  controller.state = controller.previousState || STATES.job;
  render();
}

async function openRoleFit() {
  try {
    await openRoleFitTab(controller.apiBase || createLocalSiteOrigin(controller.portDraft || DEFAULT_PORT));
  } catch {
    controller.requestMessage = "RoleFit could not be opened from this browser context.";
    controller.requestRetry = null;
    controller.state = STATES.requestError;
    render();
  }
}

async function saveAndReconnect(rawPort, errorNode, button) {
  errorNode.textContent = "";
  let port;
  try {
    port = validateLocalSitePort(rawPort);
  } catch (error) {
    errorNode.textContent = error instanceof Error
      ? error.message
      : "Enter a localhost port using digits only.";
    return;
  }

  button.disabled = true;
  button.textContent = "Saving";
  try {
    const previousApiBase = controller.apiBase;
    controller.settings = await saveExtensionPort(String(port));
    controller.portDraft = String(port);
    controller.apiBase = createLocalSiteOrigin(controller.settings.localSitePort);
    if (controller.apiBase !== previousApiBase) controller.pairingRequestBase = "";
    controller.settingsFeedback = "";
    await connectAndAnalyze({ requestPairing: true });
  } catch (error) {
    controller.settingsFeedback = error instanceof Error ? error.message : "Could not save extension settings.";
    controller.connection = CONNECTION_STATES.unavailable;
    controller.state = STATES.settings;
    render();
  }
}

async function resetAndReconnect(button) {
  button.disabled = true;
  button.textContent = "Resetting";
  try {
    const previousApiBase = controller.apiBase;
    controller.settings = await resetExtensionSettings();
    controller.portDraft = String(controller.settings.localSitePort);
    controller.apiBase = createLocalSiteOrigin(controller.settings.localSitePort);
    if (controller.apiBase !== previousApiBase) controller.pairingRequestBase = "";
    controller.settingsFeedback = "";
    await connectAndAnalyze({ requestPairing: true });
  } catch (error) {
    controller.settingsFeedback = error instanceof Error ? error.message : "Could not reset extension settings.";
    controller.connection = CONNECTION_STATES.unavailable;
    controller.state = STATES.settings;
    render();
  }
}

function applyPageFailure(error) {
  controller.requestMessage = error instanceof Error
    ? error.message
    : "The active page could not be read.";
  const unsupported = error?.kind === "unsupported";
  // The unsupported view offers no retry — the popup cannot outlive a page
  // navigation, so reopening it is the retry. Only the error view reads this.
  controller.requestRetry = unsupported ? null : () => main();
  controller.state = unsupported ? STATES.unsupportedPage : STATES.requestError;
}

async function connectAndAnalyze({ requestPairing = true, forcePairing = false } = {}) {
  const generation = controller.flowGeneration + 1;
  controller.flowGeneration = generation;
  const isCurrent = () => generation === controller.flowGeneration;
  if (!controller.apiBase) {
    controller.busy = false;
    controller.connection = CONNECTION_STATES.unavailable;
    controller.state = STATES.connectionError;
    controller.connectionMessage = "Enter the port shown in the RoleFit companion.";
    render();
    return;
  }
  controller.busy = true;
  controller.connection = CONNECTION_STATES.checking;
  controller.loadingLabel = "Connecting";
  controller.state = STATES.loading;
  render();

  try {
    // Identify the exact local service and confirm approval before any page text
    // is sent. Every send path in this popup sits below this gate.
    //
    // A privileged extension-page status GET can omit Origin, so an approval
    // granted after the first request is only visible through another pairing
    // POST. The per-port guard therefore throttles automatic requests only:
    // "Check again" forces one, or approving in the companion would never land.
    const pairing = await confirmPairedService(controller.apiBase, {
      requestPairing: requestPairing &&
        (forcePairing || controller.pairingRequestBase !== controller.apiBase)
    });
    if (!isCurrent()) return;
    if (!pairing.paired) {
      controller.connection = CONNECTION_STATES.approval;
      if (pairing.requested) controller.pairingRequestBase = controller.apiBase;
      controller.pairingTitle = "";
      controller.pairingMessage = `RoleFit is running on localhost:${displayPort()}. Approve this extension in the companion, then check again.`;
      controller.busy = false;
      controller.state = STATES.pairingRequired;
      render();
      return;
    }

    controller.connection = CONNECTION_STATES.connected;
    controller.pairingRequestBase = "";
    controller.pairingMessage = "";
    controller.loadingLabel = "Reading this page";
    render();
    if (!controller.pageData && controller.pageLoadPromise) {
      await controller.pageLoadPromise;
      if (!isCurrent()) return;
    }
    if (controller.pageError) {
      controller.busy = false;
      applyPageFailure(controller.pageError);
      render();
      return;
    }
    if (!controller.pageData) {
      controller.busy = false;
      controller.state = STATES.unsupportedPage;
      render();
      return;
    }
    controller.loadingLabel = "Checking your tracker";
    render();
    controller.analysis = await analyzePosting(controller.apiBase, controller.pageData);
    if (!isCurrent()) return;
    controller.busy = false;
    controller.state = STATES.job;
    controller.requestMessage = "";
    controller.requestRetry = null;
    render();
  } catch (error) {
    if (!isCurrent()) return;
    controller.busy = false;
    if (error?.kind === "connection") {
      controller.connection = CONNECTION_STATES.unavailable;
      controller.connectionMessage = error.message;
      controller.state = STATES.connectionError;
    } else if (error?.kind === "pairing") {
      // Only a transport failure lands here — an unapproved extension returns
      // normally above. So the approval may well be in place; saying "approve
      // this" would send the user to fix something that is not broken.
      controller.connection = CONNECTION_STATES.approval;
      controller.pairingRequestBase = "";
      controller.pairingTitle = "Approval unconfirmed";
      controller.pairingMessage = `${error.message} Check again.`;
      controller.state = STATES.pairingRequired;
    } else {
      controller.requestMessage = error instanceof Error
        ? error.message
        : "The local app did not complete the request.";
      controller.requestRetry = () => connectAndAnalyze({ requestPairing: true });
      controller.state = STATES.requestError;
    }
    render();
  }
}

async function handleImport() {
  controller.importState = "importing";
  controller.busy = true;
  controller.notice = "";
  render();
  const claimToken = randomClaimToken();

  try {
    await importPosting(controller.apiBase, controller.pageData, claimToken);
  } catch (error) {
    controller.busy = false;
    controller.importState = "idle";
    if (error?.kind === "pairing") {
      // The pairing view states the problem and offers the recovery itself.
      controller.pairingRequestBase = "";
      await connectAndAnalyze({ requestPairing: true });
      return;
    }
    // Every other failure keeps the user on the posting with the action live
    // again. The reason is carried as an inline notice because a reconnect that
    // then succeeds would otherwise redraw an identical card, making a failed
    // import look like a button that simply did nothing.
    controller.notice = error instanceof Error && error.message
      ? error.message
      : "RoleFit could not prepare this posting.";
    if (error?.kind === "connection") {
      await connectAndAnalyze({ requestPairing: true });
      return;
    }
    render();
    return;
  }

  try {
    await openImportTab(controller.apiBase, claimToken, controller.sourceTab?.cookieStoreId);
    controller.busy = false;
    controller.importState = "opened";
    render();
  } catch {
    // Queued server-side but unreachable without its tab. Staying idle lets the
    // user import again; the reserved entry expires on its own.
    controller.busy = false;
    controller.importState = "idle";
    controller.requestMessage = "The posting was captured, but the new RoleFit tab could not be opened.";
    controller.requestRetry = () => { void openRoleFit(); };
    controller.state = STATES.requestError;
    render();
  }
}

function beginPageLoad() {
  const ownedLoad = capturePageData().then(
    ({ pageData, sourceTab }) => {
      if (controller.pageLoadPromise !== ownedLoad) return;
      controller.pageData = pageData;
      controller.sourceTab = sourceTab;
      controller.pageError = null;
    },
    (error) => {
      if (controller.pageLoadPromise !== ownedLoad) return;
      controller.pageError = error;
    }
  );
  controller.pageLoadPromise = ownedLoad;
}

async function main() {
  const generation = controller.flowGeneration + 1;
  controller.flowGeneration = generation;
  controller.root = document.getElementById("root");
  if (!controller.focusListenerAttached) {
    controller.focusListenerAttached = true;
    document.addEventListener("focusin", (event) => {
      const key = event.target?.getAttribute?.("data-focus-key");
      if (key) controller.focusKey = key;
    });
  }
  controller.state = STATES.loading;
  controller.connection = CONNECTION_STATES.checking;
  controller.loadingLabel = "Connecting";
  controller.busy = true;
  controller.importState = "idle";
  controller.pageData = null;
  controller.pageLoadPromise = null;
  controller.pageError = null;
  controller.sourceTab = null;
  controller.analysis = null;
  controller.requestMessage = "";
  controller.requestRetry = null;
  render();

  // Opening the popup is the user reading the keyboard import's result. Both
  // halves absorb their own rejection: a storage failure here must not surface
  // as an unhandled rejection, and it must not stop the popup from loading.
  readShortcutNotice().then((notice) => {
    if (!notice) return;
    controller.notice = notice;
    clearShortcutNotice().catch(() => {});
    rerenderQuietly();
  }, () => {});
  clearShortcutBadge();
  void readShortcuts().then((shortcuts) => {
    controller.shortcuts = shortcuts;
    rerenderQuietly();
  });

  try {
    const settings = await loadExtensionSettings();
    if (generation !== controller.flowGeneration) return;
    controller.settings = settings;
    controller.portDraft = String(settings.localSitePort);
    controller.apiBase = createLocalSiteOrigin(settings.localSitePort);
  } catch (error) {
    if (generation !== controller.flowGeneration) return;
    controller.busy = false;
    controller.connection = CONNECTION_STATES.unavailable;
    controller.connectionMessage = error instanceof Error
      ? "Saved settings are unreadable. Enter the RoleFit companion port to recover."
      : "RoleFit extension settings could not be loaded.";
    controller.portDraft = "";
    controller.state = STATES.connectionError;
    render();
    return;
  }

  // Extraction can start immediately, but the result is not sent anywhere
  // until the same-port status handshake identifies an approved RoleFit service.
  beginPageLoad();
  await connectAndAnalyze({ requestPairing: true });
}

main().catch(() => {
  controller.busy = false;
  controller.state = STATES.requestError;
  controller.requestMessage = "RoleFit could not finish loading this popup.";
  controller.requestRetry = () => main();
  render();
});
