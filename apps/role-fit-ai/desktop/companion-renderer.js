"use strict";

const SUPPORTED_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "claude-cli",
    kind: "cli",
    name: "Claude Code",
    tag: "claude"
  }),
  Object.freeze({
    id: "codex-cli",
    kind: "cli",
    name: "Codex CLI",
    tag: "codex"
  }),
  Object.freeze({
    id: "antigravity-cli",
    kind: "cli",
    name: "Antigravity CLI",
    tag: "agy"
  }),
  Object.freeze({
    id: "openai",
    kind: "api",
    name: "OpenAI API",
    tag: "API"
  }),
  Object.freeze({
    id: "anthropic",
    kind: "api",
    name: "Claude API",
    tag: "API"
  })
]);

const PROVIDER_BY_ID = new Map(SUPPORTED_PROVIDERS.map((provider) => [provider.id, provider]));
const PROVIDER_VISIBLE_POLL_INTERVAL_MS = 5_000;
const WORKSPACE_POLL_INTERVAL_MS = 5_000;
const CONNECTION_POLL_INTERVAL_MS = 5_000;
const EXTENSION_COPY_FEEDBACK_HOLD_MS = 1_100;
const EXTENSION_COPY_FEEDBACK_FADE_MS = 120;
const ACTIVE_TAB_STORAGE_KEY = "rolefit:desktop:active-tab";
const EXTENSION_BROWSER_STORAGE_KEY = "rolefit:desktop:extension-browser";
const REMOVE_CONFIRM_GUARD_MS = 500;
const bridge = window.roleFitDesktop;
const EXTENSION_COPY_ACTIONS = Object.freeze({
  directory: Object.freeze({
    prompt: "Copy path",
    success: "Copied extension folder path.",
    error: "Could not copy the extension folder path. Try again."
  }),
  chrome: Object.freeze({
    prompt: "Copy address",
    success: "Copied Chrome extensions address.",
    error: "Could not copy the Chrome extensions address. Try again."
  }),
  edge: Object.freeze({
    prompt: "Copy address",
    success: "Copied Edge extensions address.",
    error: "Could not copy the Edge extensions address. Try again."
  }),
  firefox: Object.freeze({
    prompt: "Copy address",
    success: "Copied Firefox debugging address.",
    error: "Could not copy the Firefox debugging address. Try again."
  }),
  port: Object.freeze({
    prompt: "Copy port",
    success: "Copied active RoleFit port.",
    error: "Could not copy the active RoleFit port. Try again."
  })
});
const requiredBridgeMethods = Object.freeze([
  "getRuntimeInfo",
  "getLocalSiteSettings",
  "applyLocalSitePort",
  "getExtensionPairingSettings",
  "saveExtensionOrigin",
  "removeExtensionOrigin",
  "getProviderConnections",
  "saveApiProvider",
  "removeProvider",
  "setCliProviderEnabled",
  "openCliSignInTerminal",
  "openProviderInstallGuide",
  "openExtensionDirectory",
  "copyExtensionSetupValue",
  "openBrowserApp",
  "getWorkspaceOverview",
  "backupWorkspaceToFile",
  "restoreWorkspaceFromFile",
  "openWorkspaceFolder",
  "getConnectionStatus"
]);

const elements = Object.freeze({
  companionRoot: document.querySelector("[data-companion-root]"),
  workspacePath: document.getElementById("workspace-path"),
  workspaceSummary: document.getElementById("workspace-summary"),
  overviewWorkspaceSummary: document.getElementById("overview-workspace-summary"),
  openWorkspaceFolder: document.getElementById("open-workspace-folder"),
  backupWorkspace: document.getElementById("backup-workspace"),
  restoreWorkspace: document.getElementById("restore-workspace"),
  workspaceRestoreNote: document.getElementById("workspace-restore-note"),
  workspaceStatus: document.getElementById("workspace-status"),
  statBaseResume: document.getElementById("stat-base-resume"),
  statApplications: document.getElementById("stat-applications"),
  connectionSummary: document.getElementById("connection-summary"),
  connectionState: document.getElementById("connection-state"),
  connectionStateText: document.getElementById("connection-state-text"),
  connectionBrowserTabs: document.getElementById("connection-browser-tabs"),
  sitePortForm: document.getElementById("local-site-port-form"),
  sitePortInput: document.getElementById("local-site-port"),
  sitePortApply: document.getElementById("apply-local-site-port"),
  sitePortStatus: document.getElementById("local-site-port-status"),
  extensionSummary: document.getElementById("extension-summary"),
  extensionRequestList: document.getElementById("extension-request-list"),
  extensionPairingList: document.getElementById("extension-pairing-list"),
  extensionPairingStatus: document.getElementById("extension-pairing-status"),
  extensionSiteOrigin: document.getElementById("extension-site-origin"),
  openExtensionDirectory: document.getElementById("open-extension-directory"),
  extensionFolderActions: document.getElementById("extension-folder-actions"),
  extensionInstall: document.getElementById("extension-install"),
  extensionInstallSummary: document.querySelector("#extension-install > summary"),
  extensionBrowserSwitch: document.getElementById("extension-browser-switch"),
  extensionBrowserTabs: [...document.querySelectorAll("[data-extension-browser]")],
  extensionBrowserPanels: [...document.querySelectorAll("[data-extension-browser-panel]")],
  extensionCopyButtons: [...document.querySelectorAll("button[data-extension-copy-target]")],
  extensionSetupStatus: document.getElementById("extension-setup-status"),
  overviewTitle: document.getElementById("overview-title"),
  overviewSiteOrigin: document.getElementById("overview-site-origin"),
  overviewProviderSummary: document.getElementById("overview-provider-summary"),
  overviewExtensionSummary: document.getElementById("overview-extension-summary"),
  overviewExtensionAction: document.getElementById("overview-extension-action"),
  overviewServiceCard: document.getElementById("overview-card-service"),
  overviewProvidersCard: document.getElementById("overview-card-providers"),
  overviewWorkspaceCard: document.getElementById("overview-card-workspace"),
  overviewExtensionCard: document.getElementById("overview-card-extension"),
  overviewOpenRoleFit: document.getElementById("overview-open-rolefit"),
  navProvidersAttention: document.getElementById("nav-providers-attention"),
  navExtensionBadge: document.getElementById("nav-extension-badge"),
  sidebarRuntimeStatus: document.getElementById("sidebar-runtime-status"),
  openRoleFit: document.getElementById("open-rolefit-browser"),
  providerList: document.getElementById("provider-list"),
  providerSummary: document.getElementById("provider-summary"),
  providerAnnouncement: document.getElementById("provider-announcement"),
  refreshProviders: document.getElementById("refresh-providers"),
  runtimeVersion: document.getElementById("runtime-version"),
  tabButtons: [...document.querySelectorAll("[data-companion-tab]")],
  panels: [...document.querySelectorAll("[data-companion-panel]")],
  tabTargets: [...document.querySelectorAll("[data-tab-target]")]
});

const pendingProviders = new Set();
const replacingApiProviders = new Set();
let providerRecords = new Map();
let refreshGeneration = 0;
let pollTimer = 0;
let siteSettings = null;
let sitePortApplyPending = false;
let sitePortConfirmValue = null;
let extensionPairingSettings = null;
let extensionPairingLoadState = "loading";
let extensionPairingPending = false;
let extensionPairingRenderKey = "";
let renderingExtensionPairings = false;
let armedRemoveOrigin = "";
let removeArmedAt = 0;
let extensionPairingError = "";
let installDisclosureTouched = false;
let extensionCopyPending = false;
const extensionCopyFeedbackTimers = new WeakMap();
let activeTabId = "overview";
let workspaceOverview = null;
let workspaceOverviewLoaded = false;
let workspaceOverviewGeneration = 0;
let workspacePollTimer = 0;
let workspaceOperationPending = false;
let liveConnectionStatus = null;
let connectionStatusLoaded = false;
let connectionStatusGeneration = 0;
let connectionPollTimer = 0;

function storedTab() {
  try {
    return window.sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || "overview";
  } catch {
    return "overview";
  }
}

function rememberTab(tab) {
  try {
    window.sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // Navigation still works when session storage is unavailable.
  }
}

function activateTab(value, { persist = true, refresh = true } = {}) {
  const tab = String(value ?? "").trim();
  const panel = elements.panels.find((candidate) => candidate.dataset.companionPanel === tab);
  if (!panel) return;
  activeTabId = tab;
  if (persist) rememberTab(tab);
  for (const candidate of elements.panels) {
    const active = candidate === panel;
    candidate.hidden = !active;
    candidate.classList.toggle("is-active", active);
  }
  for (const button of elements.tabButtons) {
    const active = button.dataset.companionTab === tab;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (!refresh) return;
  if (tab === "workspace") {
    if (hasUsableBridge()) void refreshWorkspaceOverview();
  } else {
    window.clearTimeout(workspacePollTimer);
    workspacePollTimer = 0;
  }
  if (tab === "settings") {
    if (hasUsableBridge()) void refreshConnectionStatus();
  } else {
    window.clearTimeout(connectionPollTimer);
    connectionPollTimer = 0;
  }
}

function storedExtensionBrowser() {
  try {
    return window.sessionStorage.getItem(EXTENSION_BROWSER_STORAGE_KEY) || "chrome";
  } catch {
    return "chrome";
  }
}

function selectExtensionBrowser(value, { focus = false, persist = true } = {}) {
  const tab = elements.extensionBrowserTabs.find((candidate) => candidate.dataset.extensionBrowser === value) ??
    elements.extensionBrowserTabs[0];
  if (!tab) return;
  const browser = tab.dataset.extensionBrowser;
  for (const candidate of elements.extensionBrowserTabs) {
    const active = candidate === tab;
    candidate.setAttribute("aria-selected", String(active));
    candidate.tabIndex = active ? 0 : -1;
  }
  for (const panel of elements.extensionBrowserPanels) {
    const active = panel.dataset.extensionBrowserPanel === browser;
    panel.hidden = !active;
    // One folder control group serves every browser, so copy targets stay unique.
    const slot = active ? panel.querySelector("[data-extension-folder-slot]") : null;
    if (slot && elements.extensionFolderActions.parentElement !== slot) {
      slot.append(elements.extensionFolderActions);
    }
  }
  if (focus) tab.focus();
  if (!persist) return;
  try {
    window.sessionStorage.setItem(EXTENSION_BROWSER_STORAGE_KEY, browser);
  } catch {
    // The browser choice still works when session storage is unavailable.
  }
}

function setCardTone(card, attention) {
  if (attention) card.dataset.tone = "attention";
  else delete card.dataset.tone;
}

function hasUsableBridge() {
  return Boolean(
    bridge &&
    typeof bridge === "object" &&
    requiredBridgeMethods.every((method) => typeof bridge[method] === "function")
  );
}

function canonicalProviderId(value) {
  const id = String(value ?? "").trim().toLowerCase();
  return PROVIDER_BY_ID.has(id) ? id : "";
}

function safeGuidance(value, fallback) {
  const guidance = typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, 240)
    : "";
  return guidance || fallback;
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function createButton(label, action, providerId, className = "provider-card__action") {
  const button = createTextElement("button", className, label);
  button.type = "button";
  button.dataset.providerAction = action;
  button.dataset.providerId = providerId;
  button.disabled = pendingProviders.has(providerId);
  const provider = PROVIDER_BY_ID.get(providerId);
  button.setAttribute("aria-label", `${label} ${provider?.name ?? "provider"}`);
  return button;
}

function announce(message) {
  elements.providerAnnouncement.textContent = "";
  window.requestAnimationFrame(() => {
    elements.providerAnnouncement.textContent = message;
  });
}

function announceExtensionSetupCopy(message) {
  elements.extensionSetupStatus.textContent = "";
  window.requestAnimationFrame(() => {
    elements.extensionSetupStatus.textContent = message;
  });
}

function activeExtensionPort() {
  if (Number.isInteger(liveConnectionStatus?.port)) return liveConnectionStatus.port;
  return Number.isInteger(siteSettings?.localSitePort) ? siteSettings.localSitePort : null;
}

function activeExtensionPortLabel() {
  const port = activeExtensionPort();
  return port !== null
    ? `localhost:${port}`
    : "the active local service";
}

function renderActiveExtensionPort() {
  const port = activeExtensionPort();
  elements.extensionSiteOrigin.textContent = port === null ? "localhost:—" : `localhost:${port}`;
}

function extensionFolderFeedback(verb) {
  const port = activeExtensionPortLabel();
  return verb === "success"
    ? `Copied extension folder for ${port}.`
    : `Could not copy the extension folder for ${port}. Try again.`;
}

function clearExtensionSetupCopyFeedbackTimer(button) {
  const feedbackTimers = extensionCopyFeedbackTimers.get(button);
  if (!feedbackTimers) return;
  for (const feedbackTimer of feedbackTimers) window.clearTimeout(feedbackTimer);
  extensionCopyFeedbackTimers.delete(button);
}

function resetExtensionSetupCopyFeedback(button) {
  if (button.dataset.copyState !== "settled") return;
  delete button.dataset.copyState;
}

function showTemporaryExtensionSetupCopyFeedback(button, action, feedback, state) {
  clearExtensionSetupCopyFeedbackTimer(button);
  button.dataset.copyFeedback = feedback;
  button.dataset.copyState = state;
  const dismissTimer = window.setTimeout(() => {
    button.dataset.copyState = "dismissing";
    const resetTimer = window.setTimeout(() => {
      button.dataset.copyFeedback = action.prompt;
      if (button.matches(":hover, :focus-visible")) {
        button.dataset.copyState = "settled";
      } else {
        delete button.dataset.copyState;
      }
      extensionCopyFeedbackTimers.delete(button);
    }, EXTENSION_COPY_FEEDBACK_FADE_MS);
    extensionCopyFeedbackTimers.set(button, [dismissTimer, resetTimer]);
  }, EXTENSION_COPY_FEEDBACK_HOLD_MS);
  extensionCopyFeedbackTimers.set(button, [dismissTimer]);
}

async function copyExtensionSetupValue(button) {
  const target = button.dataset.extensionCopyTarget;
  const action = EXTENSION_COPY_ACTIONS[target];
  if (!action || !hasUsableBridge()) return;
  if (extensionCopyPending) {
    showTemporaryExtensionSetupCopyFeedback(button, action, "Wait", "pending");
    announceExtensionSetupCopy("Another copy is already in progress.");
    return;
  }

  clearExtensionSetupCopyFeedbackTimer(button);
  extensionCopyPending = true;
  button.dataset.copyFeedback = "Copying...";
  button.dataset.copyState = "pending";
  button.setAttribute("aria-busy", "true");
  try {
    await bridge.copyExtensionSetupValue(target);
    showTemporaryExtensionSetupCopyFeedback(button, action, "Copied", "success");
    announceExtensionSetupCopy(target === "directory" ? extensionFolderFeedback("success") : action.success);
  } catch {
    showTemporaryExtensionSetupCopyFeedback(button, action, "Try again", "error");
    announceExtensionSetupCopy(target === "directory" ? extensionFolderFeedback("error") : action.error);
  } finally {
    extensionCopyPending = false;
    button.removeAttribute("aria-busy");
  }
}

function parseLocalSitePortInput() {
  const raw = elements.sitePortInput.value.trim();
  if (!/^\d{1,5}$/.test(raw)) return null;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function currentPortStatus(settings) {
  if (settings.locked) {
    return `Locked by ROLEFIT_DESKTOP_PORT. Set the browser extension to port ${settings.localSitePort}.`;
  }
  if (settings.warning === "saved-settings-invalid") {
    return `Saved setting was invalid. Using ${settings.localSitePort}; apply to replace it.`;
  }
  if (settings.warning === "saved-settings-unreadable") {
    return `Saved setting could not be read. Using ${settings.localSitePort}; apply to replace it.`;
  }
  return `RoleFit opens at localhost:${settings.localSitePort}. Set the same port in the browser extension Settings menu.`;
}

function updateSitePortControls({ preserveStatus = false } = {}) {
  const locked = Boolean(siteSettings?.locked);
  const port = parseLocalSitePortInput();
  const unchanged = port !== null &&
    port === siteSettings?.localSitePort &&
    siteSettings?.warning === null;
  elements.sitePortInput.disabled = !siteSettings || locked || sitePortApplyPending;
  elements.sitePortApply.disabled = !siteSettings || locked || sitePortApplyPending || port === null || unchanged;
  elements.sitePortApply.textContent = sitePortConfirmValue === port
    ? "Confirm & restart"
    : "Apply & restart";
  elements.sitePortInput.setCustomValidity(
    port === null && elements.sitePortInput.value ? "Enter a whole number from 1 to 65535." : ""
  );
  if (!preserveStatus && siteSettings) {
    elements.sitePortStatus.textContent = currentPortStatus(siteSettings);
  }
  if (siteSettings) {
    elements.overviewSiteOrigin.textContent = `localhost:${siteSettings.localSitePort}`;
    renderActiveExtensionPort();
  }
}

async function loadLocalSiteSettings() {
  try {
    const settings = await bridge.getLocalSiteSettings();
    if (!settings || typeof settings !== "object") throw new Error("Invalid local site settings.");
    siteSettings = settings;
    elements.sitePortInput.value = String(settings.localSitePort);
    updateSitePortControls();
    updateExtensionPairingControls();
  } catch {
    siteSettings = null;
    elements.sitePortInput.disabled = true;
    elements.sitePortApply.disabled = true;
    elements.sitePortStatus.textContent = "Port setting unavailable. Restart RoleFit and try again.";
  }
}

function normalizeExtensionOriginInput(value) {
  const origin = String(value ?? "").trim().replace(/\/$/, "");
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return origin;
  if (/^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(origin)) {
    return origin.toLowerCase();
  }
  return "";
}

function extensionOriginLists() {
  const origins = Array.isArray(extensionPairingSettings?.origins)
    ? extensionPairingSettings.origins
    : [];
  const pendingOrigins = Array.isArray(extensionPairingSettings?.pendingOrigins)
    ? extensionPairingSettings.pendingOrigins.filter((origin) => !origins.includes(origin))
    : [];
  return { origins, pendingOrigins };
}

function extensionBrowserLabel(origin) {
  // Chrome and Edge share the chrome-extension scheme and cannot be told apart.
  return String(origin).startsWith("moz-extension://") ? "Firefox" : "Chrome or Edge";
}

function extensionPairingMessage() {
  if (extensionPairingLoadState === "error") {
    return "Extension pairing unavailable. Restart RoleFit and try again.";
  }
  if (extensionPairingLoadState === "loading") return "Loading extension access…";
  if (extensionPairingError) return extensionPairingError;
  if (!siteSettings) return "Local site settings are unavailable.";
  if (!connectionStatusLoaded) return "Checking whether this companion can manage extension access.";
  if (liveConnectionStatus?.serverState !== "owned") {
    return liveConnectionStatus?.serverState === "unreachable"
      ? "The local service is unavailable. Restart RoleFit before changing extension access."
      : "Extension access is read-only while using a service this companion did not start.";
  }
  if (armedRemoveOrigin) return "Removing access restarts RoleFit.";
  const { origins, pendingOrigins } = extensionOriginLists();
  if (pendingOrigins.length > 0) return "Approving restarts RoleFit so the extension can connect.";
  return origins.length === 0
    ? "No extension connected. Install it below, then open it on a job page."
    : "";
}

function extensionOriginRow(origin, kind, canManageExtension) {
  const pending = kind === "pending";
  const label = extensionBrowserLabel(origin);
  const item = document.createElement("li");
  item.className = "extension-origin";
  item.dataset.state = kind;
  const dot = createTextElement("span", "extension-origin__dot", "");
  dot.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "extension-origin__name";
  name.append(
    createTextElement("strong", "", label),
    createTextElement("span", "extension-origin__state", pending ? "Waiting for approval" : "Paired")
  );
  const value = createTextElement("code", "extension-origin__id", origin);
  value.title = origin;
  const text = document.createElement("div");
  text.className = "extension-origin__text";
  text.append(name, value);
  const action = createTextElement(
    "button",
    `extension-origin__action extension-origin__action--${pending ? "approve" : "remove"}`,
    pending ? "Approve & restart" : "Remove"
  );
  action.type = "button";
  if (pending) {
    action.dataset.extensionRequestOrigin = origin;
    action.setAttribute("aria-label", `Approve & restart for ${label} extension ${origin}`);
  } else {
    action.dataset.extensionOrigin = origin;
  }
  action.disabled = extensionPairingPending || !canManageExtension;
  item.append(dot, text, action);
  return item;
}

function applyRemoveArming() {
  for (const button of elements.extensionPairingList.querySelectorAll("button[data-extension-origin]")) {
    const origin = button.dataset.extensionOrigin;
    const armed = origin === armedRemoveOrigin;
    const label = extensionBrowserLabel(origin);
    button.classList.toggle("is-armed", armed);
    button.textContent = armed ? "Confirm removal" : "Remove";
    button.setAttribute(
      "aria-label",
      armed ? `Confirm removal of ${label} extension ${origin}` : `Remove ${label} extension ${origin}`
    );
  }
}

function extensionPairingButton(attribute, origin) {
  return [
    ...elements.extensionRequestList.querySelectorAll("button"),
    ...elements.extensionPairingList.querySelectorAll("button")
  ].find((button) => button.dataset[attribute] === origin) ?? null;
}

function renderExtensionPairings() {
  const { origins, pendingOrigins } = extensionOriginLists();
  const canManageExtension = liveConnectionStatus?.serverState === "owned";
  if (armedRemoveOrigin && (!canManageExtension || !origins.includes(armedRemoveOrigin))) {
    armedRemoveOrigin = "";
  }
  // Polls repeat unchanged data every few seconds; rebuilding the rows would
  // drop keyboard focus, so only replace them when their content changes.
  const renderKey = JSON.stringify([origins, pendingOrigins, canManageExtension, extensionPairingPending]);
  if (renderKey !== extensionPairingRenderKey) {
    extensionPairingRenderKey = renderKey;
    extensionPairingError = "";
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusAttribute = focused?.dataset.extensionRequestOrigin
      ? "extensionRequestOrigin"
      : focused?.dataset.extensionOrigin ? "extensionOrigin" : "";
    renderingExtensionPairings = true;
    try {
      elements.extensionRequestList.replaceChildren(
        ...pendingOrigins.map((origin) => extensionOriginRow(origin, "pending", canManageExtension))
      );
      elements.extensionPairingList.replaceChildren(
        ...origins.map((origin) => extensionOriginRow(origin, "paired", canManageExtension))
      );
      if (focusAttribute) extensionPairingButton(focusAttribute, focused.dataset[focusAttribute])?.focus();
    } finally {
      renderingExtensionPairings = false;
    }
  }
  applyRemoveArming();
  renderExtensionSummary(origins.length, pendingOrigins.length);
}

function renderExtensionSummary(pairedCount, pendingCount) {
  const failed = extensionPairingLoadState === "error";
  const loading = extensionPairingLoadState === "loading";
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  elements.extensionSummary.textContent = failed
    ? "Extension access unavailable."
    : loading
      ? "Checking extension access."
      : pendingCount > 0
        ? `${plural(pendingCount, "request")} waiting for approval.`
        : pairedCount > 0
          ? `Paired with ${plural(pairedCount, "extension")}.`
          : "No extension paired yet.";
  elements.overviewExtensionSummary.textContent = failed
    ? "Extension pairing unavailable"
    : loading
      ? "Checking extension access"
      : pendingCount > 0
        ? `${plural(pendingCount, "approval")} waiting`
        : pairedCount > 0
          ? `${plural(pairedCount, "extension")} paired`
          : "Browser extension not paired";
  elements.overviewExtensionAction.textContent = pendingCount > 0
    ? pendingCount === 1 ? "Review request" : "Review requests"
    : pairedCount > 0 ? "Manage extension" : "Set up extension";
  setCardTone(elements.overviewExtensionCard, failed || pendingCount > 0);
  elements.navExtensionBadge.hidden = pendingCount === 0;
  if (pendingCount > 0) {
    const count = createTextElement("span", "", String(pendingCount));
    count.setAttribute("aria-hidden", "true");
    elements.navExtensionBadge.replaceChildren(
      count,
      createTextElement("span", "visually-hidden", `, ${plural(pendingCount, "approval")} waiting`)
    );
  } else {
    elements.navExtensionBadge.replaceChildren();
  }
}

function updateExtensionPairingControls({ preserveStatus = false } = {}) {
  renderExtensionPairings();
  if (!preserveStatus && !extensionPairingPending) {
    elements.extensionPairingStatus.textContent = extensionPairingMessage();
  }
}

function syncInstallDisclosure() {
  if (installDisclosureTouched || extensionPairingLoadState !== "ok") return;
  if (elements.extensionInstall.contains(document.activeElement)) return;
  const { origins, pendingOrigins } = extensionOriginLists();
  elements.extensionInstall.open = !(origins.length > 0 && pendingOrigins.length === 0);
}

function failExtensionPairingAction(error, attribute, origin, hadFocus) {
  extensionPairingPending = false;
  updateExtensionPairingControls({ preserveStatus: true });
  // Set after the rebuild above, which clears errors for changed data.
  extensionPairingError = extensionPairingErrorMessage(error);
  elements.extensionPairingStatus.textContent = extensionPairingError;
  if (hadFocus && (!document.activeElement || document.activeElement === document.body)) {
    extensionPairingButton(attribute, origin)?.focus();
  }
}

function disarmExtensionRemove() {
  if (!armedRemoveOrigin) return;
  armedRemoveOrigin = "";
  applyRemoveArming();
  if (!extensionPairingPending) elements.extensionPairingStatus.textContent = extensionPairingMessage();
}

async function loadExtensionPairingSettings() {
  try {
    const settings = await bridge.getExtensionPairingSettings();
    if (!settings || typeof settings !== "object" ||
        !Array.isArray(settings.origins) || !Array.isArray(settings.pendingOrigins)) {
      throw new Error("Invalid extension pairing settings.");
    }
    extensionPairingSettings = settings;
    extensionPairingLoadState = "ok";
  } catch {
    extensionPairingSettings = null;
    extensionPairingLoadState = "error";
  }
  updateExtensionPairingControls();
  syncInstallDisclosure();
}

function extensionPairingErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("exact extension origin")) return message;
  if (message.includes("up to")) return message;
  if (message.includes("let this companion start the local service")) return message;
  if (message.includes("already restarting")) return message;
  return "The extension pairing could not be saved. Check app permissions and try again.";
}

function localSitePortErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("already in use")) return "That port is already in use. Choose another port.";
  if (message.includes("ROLEFIT_DESKTOP_PORT")) return "Remove ROLEFIT_DESKTOP_PORT before changing this setting.";
  return "The port could not be saved. Check app permissions and try again.";
}

function connectionStatus(provider, record) {
  if (!record) return { key: "checking", label: "Checking" };
  if (pendingProviders.has(provider.id)) return { key: "checking", label: "Updating" };
  if (!record.configured) {
    if (provider.kind === "cli" && record.installed === false) {
      return { key: "missing", label: "Not installed" };
    }
    return { key: "not-added", label: "Not added" };
  }
  if (record.ready) {
    return record.setupFlow === "manual-login" && record.authState === "unknown"
      ? { key: "connected", label: "Ready to verify" }
      : { key: "connected", label: "Ready" };
  }
  if (provider.kind === "cli" && record.authState === "signed-in") {
    return { key: "connected", label: "Signed in" };
  }
  if (provider.kind === "cli" && record.installed === false) {
    return { key: "missing", label: "CLI not installed" };
  }
  if (provider.kind === "cli" && record.authState === "signed-out") {
    return { key: "signed-out", label: "Sign-in required" };
  }
  return { key: "attention", label: "Needs attention" };
}

function apiKeyForm(provider, replacing) {
  const form = document.createElement("form");
  form.className = "provider-key-form";
  form.dataset.apiKeyForm = provider.id;
  form.noValidate = true;

  const label = document.createElement("label");
  label.className = "provider-key-form__field";
  const labelText = replacing ? `Replacement ${provider.name} key` : `${provider.name} key`;
  label.append(createTextElement("span", "visually-hidden", labelText));
  const input = document.createElement("input");
  input.type = "password";
  input.name = "apiKey";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 16_384;
  input.placeholder = replacing ? "Enter replacement key" : "Paste API key";
  input.setAttribute("aria-label", labelText);
  input.disabled = pendingProviders.has(provider.id);
  label.append(input);
  form.append(label);

  const submit = createTextElement(
    "button",
    "provider-card__action provider-card__action--primary",
    replacing ? "Save replacement" : "Add provider"
  );
  submit.type = "submit";
  submit.disabled = pendingProviders.has(provider.id);
  form.append(submit);
  if (replacing) {
    form.append(createButton("Cancel", "cancel-replace", provider.id, "provider-card__text-action"));
  }
  return form;
}

function renderApiActions(provider, record, actions) {
  if (!record?.configured || replacingApiProviders.has(provider.id)) {
    actions.append(apiKeyForm(provider, replacingApiProviders.has(provider.id)));
    if (record?.configured) {
      actions.append(createButton("Remove", "remove", provider.id, "provider-card__text-action is-danger"));
    }
    return;
  }
  actions.append(
    createButton("Replace key", "replace-key", provider.id),
    createButton("Remove", "remove", provider.id, "provider-card__text-action is-danger")
  );
}

function renderCliActions(provider, record, actions) {
  if (!record?.configured) {
    actions.append(createButton("Add provider", "add-cli", provider.id, "provider-card__action provider-card__action--primary"));
    if (record?.installed === false) {
      actions.append(createButton("Install guide", "install", provider.id, "provider-card__text-action"));
    }
    return;
  }

  if (record.installed === false) {
    actions.append(
      createButton("Install guide", "install", provider.id, "provider-card__action provider-card__action--primary"),
      createButton("Check again", "refresh", provider.id, "provider-card__text-action"),
      createButton("Remove", "remove", provider.id, "provider-card__text-action is-danger")
    );
    return;
  }

  if (!record.ready && record.authState !== "signed-in") {
    actions.append(createButton(
      "Sign in",
      "terminal-sign-in",
      provider.id,
      "provider-card__action provider-card__action--primary"
    ));
  }
  actions.append(createButton("Remove", "remove", provider.id, "provider-card__text-action is-danger"));
}

function renderProviders() {
  const fragment = document.createDocumentFragment();
  const isInitialRender = elements.providerList.dataset.rendered !== "true";
  let configuredCount = 0;
  let readyCount = 0;

  SUPPORTED_PROVIDERS.forEach((provider) => {
    const record = providerRecords.get(provider.id);
    const status = connectionStatus(provider, record);
    if (record?.configured) configuredCount += 1;
    if (record?.ready) readyCount += 1;

    const item = document.createElement("li");
    item.className = `provider-card${isInitialRender ? " is-entering" : ""}`;
    item.dataset.providerId = provider.id;
    item.dataset.status = status.key;

    const body = document.createElement("div");
    body.className = "provider-card__body";
    const heading = document.createElement("div");
    heading.className = "provider-card__heading";
    heading.append(
      createTextElement("h3", "", provider.name),
      createTextElement("span", "provider-card__binary", provider.tag)
    );
    body.append(
      heading,
      createTextElement("span", "provider-card__state", status.label)
    );
    item.append(body);

    const actions = document.createElement("div");
    actions.className = "provider-card__actions";
    if (provider.kind === "api") renderApiActions(provider, record, actions);
    else renderCliActions(provider, record, actions);
    item.append(actions);
    fragment.append(item);
  });

  elements.providerList.replaceChildren(fragment);
  elements.providerList.dataset.rendered = "true";
  elements.providerList.setAttribute("aria-busy", "false");
  elements.providerSummary.textContent = configuredCount === 0
    ? "No providers added yet. Add a CLI or API provider to begin."
    : `${configuredCount} added · ${readyCount} ready for RoleFit.`;
  elements.overviewProviderSummary.textContent = configuredCount === 0
    ? "No providers connected"
    : `${readyCount} ready of ${configuredCount} connected`;
  const providerAttention = configuredCount > 0 && readyCount === 0;
  elements.navProvidersAttention.hidden = !providerAttention;
  setCardTone(elements.overviewProvidersCard, providerAttention);
  return false;
}

function renderCheckingProviders() {
  providerRecords = new Map();
  elements.providerList.setAttribute("aria-busy", "true");
  renderProviders();
  elements.providerList.setAttribute("aria-busy", "true");
}

function schedulePoll() {
  window.clearTimeout(pollTimer);
  pollTimer = 0;
  // Main owns the hidden/closed fallback refresh. While this setup window is
  // visible, keep exactly one bounded renderer timer so an external terminal
  // login/logout converges without requiring the user to press Check again.
  if (!hasUsableBridge() || document.visibilityState === "hidden") return;
  pollTimer = window.setTimeout(() => {
    void loadExtensionPairingSettings();
    void refreshProviders({ announceResult: false });
  }, PROVIDER_VISIBLE_POLL_INTERVAL_MS);
}

function recordsById(value) {
  const records = new Map();
  if (!Array.isArray(value)) return records;
  for (const record of value) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    const id = canonicalProviderId(record.id);
    if (id) records.set(id, record);
  }
  return records;
}

async function refreshProviders({ announceResult = true } = {}) {
  if (!hasUsableBridge()) return;
  // A poll schedules its successor only after this owning refresh settles.
  // Clearing here prevents a slow CLI probe from overlapping the next round.
  window.clearTimeout(pollTimer);
  pollTimer = 0;
  const generation = ++refreshGeneration;
  elements.refreshProviders.disabled = true;
  elements.refreshProviders.classList.add("is-checking");
  elements.providerList.setAttribute("aria-busy", "true");
  try {
    const response = await bridge.getProviderConnections();
    if (generation !== refreshGeneration) return;
    const nextRecords = recordsById(response);
    if (nextRecords.size !== SUPPORTED_PROVIDERS.length) {
      throw new Error("Incomplete provider status.");
    }
    providerRecords = nextRecords;
    renderProviders();
    elements.companionRoot.dataset.status = "ready";
    if (announceResult) announce("Provider status updated.");
  } catch {
    if (generation !== refreshGeneration) return;
    elements.companionRoot.dataset.status = "error";
    renderProviders();
    elements.providerSummary.textContent = "Provider status could not be checked. Try again.";
    elements.overviewProviderSummary.textContent = "Provider status unavailable";
    setCardTone(elements.overviewProvidersCard, true);
    if (announceResult) announce("Provider status could not be checked.");
  } finally {
    if (generation === refreshGeneration) {
      elements.refreshProviders.disabled = false;
      elements.refreshProviders.classList.remove("is-checking");
      elements.providerList.setAttribute("aria-busy", "false");
      schedulePoll();
    }
  }
}

async function runProviderAction(providerId, task, successMessage, failureMessage) {
  if (pendingProviders.has(providerId)) return;
  pendingProviders.add(providerId);
  renderProviders();
  try {
    await task();
    announce(successMessage);
  } catch {
    announce(failureMessage);
  } finally {
    pendingProviders.delete(providerId);
    await refreshProviders({ announceResult: false });
  }
}

async function saveApiProvider(providerId, form) {
  const input = form.elements.namedItem("apiKey");
  if (!(input instanceof HTMLInputElement)) return;
  const apiKey = input.value;
  if (!apiKey.trim()) {
    announce("Enter an API key before adding this provider.");
    input.focus();
    return;
  }
  pendingProviders.add(providerId);
  input.disabled = true;
  const request = bridge.saveApiProvider(providerId, apiKey);
  input.value = "";
  renderProviders();
  try {
    await request;
    replacingApiProviders.delete(providerId);
    announce(`${PROVIDER_BY_ID.get(providerId)?.name ?? "API provider"} added securely.`);
  } catch {
    announce("The API provider could not be saved. Check secure credential storage and try again.");
  } finally {
    input.value = "";
    pendingProviders.delete(providerId);
    await refreshProviders({ announceResult: false });
  }
}

async function openCliSignInTerminal(providerId) {
  if (pendingProviders.has(providerId)) return;
  pendingProviders.add(providerId);
  renderProviders();
  try {
    const result = await bridge.openCliSignInTerminal(providerId);
    announce(safeGuidance(
      result?.guidance,
      "The provider sign-in command opened in a terminal. Finish it there, then check again."
    ));
  } catch {
    announce("A terminal could not be opened for this provider. Open your terminal and use the provider's official sign-in command.");
  } finally {
    pendingProviders.delete(providerId);
    await refreshProviders({ announceResult: false });
  }
}

function statCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? String(value)
    : "—";
}

function renderWorkspaceOverview() {
  const overview = workspaceOverview;
  const overviewUsable = Boolean(overview) && hasUsableBridge();
  const summary = overviewUsable
    ? overview.workspaceTransferReady
      ? "Ready to back up"
      : overview.serverReady
        ? "Restart RoleFit to transfer"
        : "Local service not running"
    : workspaceOverviewLoaded
      ? "Workspace unavailable"
      : "Checking workspace";
  elements.workspaceSummary.textContent = summary;
  elements.overviewWorkspaceSummary.textContent = summary;
  setCardTone(
    elements.overviewWorkspaceCard,
    workspaceOverviewLoaded && !(overviewUsable && overview.workspaceTransferReady)
  );
  elements.workspacePath.textContent = overview
    ? overview.workspaceDisplayPath
    : workspaceOverviewLoaded
      ? "Unavailable"
      : "Checking…";
  elements.workspacePath.title = overview ? overview.workspaceDisplayPath : "";
  elements.openWorkspaceFolder.disabled = !overviewUsable || workspaceOperationPending;
  elements.statBaseResume.textContent = overviewUsable && overview.hasBaseResume === true ? "✓" : "—";
  elements.statApplications.textContent = overviewUsable ? statCount(overview.applicationCount) : "—";

  const activeTabs = overview && typeof overview.activeBrowserTabs === "number" &&
    Number.isInteger(overview.activeBrowserTabs) && overview.activeBrowserTabs >= 0
    ? overview.activeBrowserTabs
    : null;
  const busy = workspaceOperationPending || !overviewUsable || !overview?.workspaceTransferReady;
  elements.backupWorkspace.disabled = busy;
  const restoreBlocked = activeTabs !== null && activeTabs > 0;
  elements.restoreWorkspace.disabled = busy || restoreBlocked;
  elements.workspaceRestoreNote.hidden = !(restoreBlocked && overviewUsable && overview.workspaceTransferReady);
  if (restoreBlocked) {
    elements.restoreWorkspace.title = "Close the open RoleFit browser tabs before restoring.";
  } else {
    elements.restoreWorkspace.title =
      overviewUsable && !overview?.workspaceTransferReady
        ? "Restart RoleFit so the desktop app owns the local service before restoring."
        : "Replaces the saved workspace; the previous one is kept as a local safety copy";
  }
  elements.backupWorkspace.title = overviewUsable && !overview?.workspaceTransferReady
    ? "Restart RoleFit so the desktop app owns the local service before backing up."
    : "Save a portable copy of the app-managed workspace";
}

function scheduleWorkspacePoll() {
  window.clearTimeout(workspacePollTimer);
  workspacePollTimer = 0;
  if (!hasUsableBridge() || activeTabId !== "workspace" || document.visibilityState === "hidden") {
    return;
  }
  workspacePollTimer = window.setTimeout(() => {
    void refreshWorkspaceOverview();
  }, WORKSPACE_POLL_INTERVAL_MS);
}

async function refreshWorkspaceOverview() {
  if (!hasUsableBridge()) return;
  window.clearTimeout(workspacePollTimer);
  workspacePollTimer = 0;
  const generation = ++workspaceOverviewGeneration;
  try {
    const overview = await bridge.getWorkspaceOverview();
    if (generation !== workspaceOverviewGeneration) return;
    if (!overview || typeof overview !== "object" ||
        typeof overview.workspaceDisplayPath !== "string" ||
        !overview.workspaceDisplayPath) {
      throw new Error("Invalid workspace overview.");
    }
    workspaceOverview = overview;
  } catch {
    if (generation !== workspaceOverviewGeneration) return;
    workspaceOverview = null;
  } finally {
    if (generation === workspaceOverviewGeneration) {
      workspaceOverviewLoaded = true;
      renderWorkspaceOverview();
      scheduleWorkspacePoll();
    }
  }
}

function renderServiceIndicators(status) {
  let state = "unknown";
  let text = "Checking service";
  let title = "Checking your workbench…";
  if (!status) {
    if (connectionStatusLoaded) {
      state = "error";
      text = "Service status unavailable";
      title = "Local service status unavailable.";
    }
  } else if (status.serverState === "owned") {
    state = "ok";
    text = `Running on ${status.port}`;
    title = "Your workbench is ready.";
  } else if (status.serverState === "reused-standalone") {
    state = "warn";
    text = `Dev server on ${status.port}`;
    title = "Your workbench is ready.";
  } else if (status.serverState === "reused-companion") {
    state = "warn";
    text = `Other session on ${status.port}`;
    title = "Your workbench is ready.";
  } else if (status.serverState === "unreachable") {
    state = "error";
    text = "Not responding";
    title = "The local service isn't responding.";
  } else {
    text = "Starting service";
    title = "Starting your workbench…";
  }
  elements.sidebarRuntimeStatus.dataset.state = state;
  elements.sidebarRuntimeStatus.textContent = text;
  elements.overviewTitle.textContent = title;
  setCardTone(elements.overviewServiceCard, state === "error");
}

function renderConnectionStatus() {
  const status = liveConnectionStatus;
  renderServiceIndicators(status);
  if (!status) {
    renderActiveExtensionPort();
    elements.connectionState.dataset.state = connectionStatusLoaded ? "error" : "unknown";
    elements.connectionStateText.textContent = connectionStatusLoaded ? "Status unavailable" : "Checking…";
    elements.connectionBrowserTabs.textContent = "—";
    elements.connectionSummary.textContent = connectionStatusLoaded
      ? "Local service status unavailable."
      : "Checking the local service.";
    return;
  }
  let state = "unknown";
  let text = "Starting…";
  let summary = "Starting the local service.";
  if (status.serverState === "owned") {
    state = "ok";
    text = `Serving ${status.siteUrl} — managed by this companion`;
    summary = "Managed local service running.";
  } else if (status.serverState === "reused-standalone") {
    state = "warn";
    text = `Port ${status.port} — development server`;
    summary = "Using a standalone RoleFit development server.";
  } else if (status.serverState === "reused-companion") {
    state = "warn";
    text = `Port ${status.port} — another companion session`;
    summary = "Using a service this companion did not start.";
  } else if (status.serverState === "unreachable") {
    state = "error";
    text = `Port ${status.port} — not responding`;
    summary = "Local service not responding.";
  }
  elements.connectionState.dataset.state = state;
  renderActiveExtensionPort();
  elements.connectionStateText.textContent = text;
  elements.connectionSummary.textContent = summary;
  const tabs = typeof status.activeBrowserTabs === "number" &&
    Number.isInteger(status.activeBrowserTabs) && status.activeBrowserTabs >= 0
    ? status.activeBrowserTabs
    : null;
  elements.connectionBrowserTabs.textContent = tabs === null
    ? "Browser tabs unknown"
    : tabs === 0
      ? "No browser tabs connected"
      : `${tabs} browser tab${tabs === 1 ? "" : "s"} connected`;
}

function scheduleConnectionPoll() {
  window.clearTimeout(connectionPollTimer);
  connectionPollTimer = 0;
  if (!hasUsableBridge() || activeTabId !== "settings" || document.visibilityState === "hidden") {
    return;
  }
  connectionPollTimer = window.setTimeout(() => {
    void refreshConnectionStatus();
  }, CONNECTION_POLL_INTERVAL_MS);
}

async function refreshConnectionStatus() {
  if (!hasUsableBridge()) return;
  window.clearTimeout(connectionPollTimer);
  connectionPollTimer = 0;
  const generation = ++connectionStatusGeneration;
  try {
    const status = await bridge.getConnectionStatus();
    if (generation !== connectionStatusGeneration) return;
    if (!status || typeof status !== "object" || typeof status.serverState !== "string") {
      throw new Error("Invalid connection status.");
    }
    liveConnectionStatus = status;
  } catch {
    if (generation !== connectionStatusGeneration) return;
    liveConnectionStatus = null;
  } finally {
    if (generation === connectionStatusGeneration) {
      connectionStatusLoaded = true;
      renderConnectionStatus();
      updateExtensionPairingControls();
      scheduleConnectionPoll();
    }
  }
}

async function runWorkspaceTransfer(kind) {
  if (!hasUsableBridge() || workspaceOperationPending) return;
  workspaceOperationPending = true;
  renderWorkspaceOverview();
  elements.workspaceStatus.textContent = kind === "backup" ? "Backing up…" : "Restoring…";
  try {
    const result = kind === "backup"
      ? await bridge.backupWorkspaceToFile()
      : await bridge.restoreWorkspaceFromFile();
    const status = result && typeof result === "object" ? result.status : "";
    if (kind === "backup" && status === "saved") {
      const fileName = typeof result.filePath === "string" ? result.filePath.trim() : "";
      elements.workspaceStatus.textContent = fileName ? `Backup saved to ${fileName}` : "Backup saved.";
    } else if (kind === "restore" && status === "restored") {
      elements.workspaceStatus.textContent = "Workspace restored — reopen RoleFit in your browser.";
    } else if (status === "cancelled") {
      elements.workspaceStatus.textContent = kind === "backup" ? "Backup cancelled." : "Restore cancelled.";
    } else {
      const message = status === "error" && typeof result.message === "string"
        ? result.message.trim()
        : "";
      elements.workspaceStatus.textContent = message ||
        (kind === "backup"
          ? "The workspace could not be backed up."
          : "The workspace could not be restored.");
    }
  } catch {
    elements.workspaceStatus.textContent = kind === "backup"
      ? "The workspace could not be backed up."
      : "The workspace could not be restored.";
  } finally {
    workspaceOperationPending = false;
    await refreshWorkspaceOverview();
  }
}

async function openWorkspaceFolder() {
  if (!hasUsableBridge() || workspaceOperationPending) return;
  elements.openWorkspaceFolder.disabled = true;
  try {
    await bridge.openWorkspaceFolder();
  } catch {
    elements.workspaceStatus.textContent = "The workspace folder could not be opened.";
  } finally {
    renderWorkspaceOverview();
  }
}

async function loadRuntimeInfo() {
  try {
    const info = await bridge.getRuntimeInfo();
    const version = info && typeof info === "object" ? String(info.appVersion ?? "").trim() : "";
    elements.runtimeVersion.textContent = version ? `RoleFit ${version}` : "Unavailable";
  } catch {
    elements.runtimeVersion.textContent = "Unavailable";
  }
}

function initializeUnavailableState() {
  elements.companionRoot.dataset.status = "error";
  elements.openRoleFit.disabled = true;
  elements.overviewOpenRoleFit.disabled = true;
  elements.openExtensionDirectory.disabled = true;
  elements.refreshProviders.disabled = true;
  for (const button of elements.extensionCopyButtons) button.disabled = true;
  elements.sitePortInput.disabled = true;
  elements.sitePortApply.disabled = true;
  elements.sitePortStatus.textContent = "Port setting unavailable.";
  extensionPairingSettings = null;
  extensionPairingLoadState = "error";
  elements.runtimeVersion.textContent = "Unavailable";
  workspaceOverview = null;
  workspaceOverviewLoaded = true;
  renderWorkspaceOverview();
  elements.workspaceStatus.textContent = "Workspace unavailable. Restart RoleFit and try again.";
  liveConnectionStatus = null;
  connectionStatusLoaded = true;
  renderConnectionStatus();
  updateExtensionPairingControls();
  renderProviders();
  elements.providerSummary.textContent = "Restart RoleFit to manage providers.";
  elements.overviewProviderSummary.textContent = "Provider status unavailable";
  setCardTone(elements.overviewProvidersCard, true);
}

elements.providerList.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!(event.target instanceof HTMLFormElement) || !hasUsableBridge()) return;
  const providerId = canonicalProviderId(event.target.dataset.apiKeyForm);
  const provider = PROVIDER_BY_ID.get(providerId);
  if (!provider || provider.kind !== "api") return;
  void saveApiProvider(providerId, event.target);
});

elements.providerList.addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-provider-action]")
    : null;
  if (!(button instanceof HTMLButtonElement) || button.disabled || !hasUsableBridge()) return;
  const providerId = canonicalProviderId(button.dataset.providerId);
  if (!providerId) return;
  const action = button.dataset.providerAction;
  if (action === "add-cli") {
    void runProviderAction(
      providerId,
      () => bridge.setCliProviderEnabled(providerId, true),
      `${PROVIDER_BY_ID.get(providerId)?.name ?? "CLI provider"} added to RoleFit.`,
      "The CLI provider could not be added."
    );
  } else if (action === "remove") {
    replacingApiProviders.delete(providerId);
    void runProviderAction(
      providerId,
      () => bridge.removeProvider(providerId),
      `${PROVIDER_BY_ID.get(providerId)?.name ?? "Provider"} removed from RoleFit.`,
      "The provider could not be removed."
    );
  } else if (action === "replace-key") {
    replacingApiProviders.add(providerId);
    renderProviders();
    elements.providerList.querySelector(`[data-api-key-form="${providerId}"] input`)?.focus();
  } else if (action === "cancel-replace") {
    replacingApiProviders.delete(providerId);
    renderProviders();
  } else if (action === "terminal-sign-in") {
    void openCliSignInTerminal(providerId);
  } else if (action === "install") {
    void runProviderAction(
      providerId,
      () => bridge.openProviderInstallGuide(providerId),
      "Official installation instructions opened in your browser.",
      "The official installation instructions could not be opened."
    );
  } else if (action === "refresh") {
    void refreshProviders({ announceResult: true });
  }
});

elements.refreshProviders.addEventListener("click", () => {
  if (hasUsableBridge()) void refreshProviders({ announceResult: true });
});

for (const button of elements.tabButtons) {
  button.addEventListener("click", () => activateTab(button.dataset.companionTab));
}

for (const button of elements.tabTargets) {
  button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
}

for (const tab of elements.extensionBrowserTabs) {
  tab.addEventListener("click", () => selectExtensionBrowser(tab.dataset.extensionBrowser));
}

elements.extensionBrowserSwitch.addEventListener("keydown", (event) => {
  const tabs = elements.extensionBrowserTabs;
  const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
  const next = event.key === "ArrowRight"
    ? (current + 1) % tabs.length
    : event.key === "ArrowLeft"
      ? (current - 1 + tabs.length) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  selectExtensionBrowser(tabs[next].dataset.extensionBrowser, { focus: true });
});

elements.extensionInstallSummary.addEventListener("click", () => {
  installDisclosureTouched = true;
});

elements.extensionPairingList.addEventListener("focusout", (event) => {
  if (renderingExtensionPairings || !armedRemoveOrigin) return;
  const next = event.relatedTarget;
  if (next instanceof HTMLElement && next.dataset.extensionOrigin === armedRemoveOrigin) return;
  disarmExtensionRemove();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !armedRemoveOrigin) return;
  const origin = armedRemoveOrigin;
  disarmExtensionRemove();
  extensionPairingButton("extensionOrigin", origin)?.focus();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    window.clearTimeout(pollTimer);
    pollTimer = 0;
    window.clearTimeout(workspacePollTimer);
    workspacePollTimer = 0;
    window.clearTimeout(connectionPollTimer);
    connectionPollTimer = 0;
    return;
  }
  if (hasUsableBridge()) {
    void loadExtensionPairingSettings();
    void refreshProviders({ announceResult: false });
    void refreshConnectionStatus();
    if (activeTabId === "workspace") void refreshWorkspaceOverview();
  }
});

elements.openWorkspaceFolder.addEventListener("click", () => {
  void openWorkspaceFolder();
});

elements.backupWorkspace.addEventListener("click", () => {
  void runWorkspaceTransfer("backup");
});

elements.restoreWorkspace.addEventListener("click", () => {
  void runWorkspaceTransfer("restore");
});

elements.sitePortInput.addEventListener("input", () => {
  if (!siteSettings || siteSettings.locked || sitePortApplyPending) return;
  sitePortConfirmValue = null;
  const port = parseLocalSitePortInput();
  updateSitePortControls({ preserveStatus: true });
  elements.sitePortStatus.textContent = port === null
    ? "Enter a whole number from 1 to 65535."
    : port === siteSettings.localSitePort && siteSettings.warning === null
      ? currentPortStatus(siteSettings)
      : `RoleFit will restart on localhost:${port}. Update the browser extension port to ${port} after restart.`;
});

elements.extensionRequestList.addEventListener("click", async (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-extension-request-origin]")
    : null;
  if (!(button instanceof HTMLButtonElement) || button.disabled || extensionPairingPending) return;
  const origin = normalizeExtensionOriginInput(button.dataset.extensionRequestOrigin);
  if (!origin) return;
  const requestOrigin = button.dataset.extensionRequestOrigin;
  const hadFocus = document.activeElement === button;
  disarmExtensionRemove();
  extensionPairingError = "";
  extensionPairingPending = true;
  updateExtensionPairingControls({ preserveStatus: true });
  elements.extensionPairingStatus.textContent = "Approving extension…";
  try {
    extensionPairingSettings = await bridge.saveExtensionOrigin(origin);
    updateExtensionPairingControls({ preserveStatus: true });
    elements.extensionPairingStatus.textContent = "Approved. Restarting RoleFit…";
  } catch (error) {
    failExtensionPairingAction(error, "extensionRequestOrigin", requestOrigin, hadFocus);
  }
});

// Auto-repeated Enter clicks the focused button again; confirming Remove needs a
// fresh key press, however long the key is held.
elements.extensionPairingList.addEventListener("keydown", (event) => {
  if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
});

elements.extensionPairingList.addEventListener("click", async (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-extension-origin]")
    : null;
  if (!(button instanceof HTMLButtonElement) || button.disabled || extensionPairingPending) return;
  const origin = normalizeExtensionOriginInput(button.dataset.extensionOrigin);
  if (!origin) return;
  const pairedOrigin = button.dataset.extensionOrigin;
  if (armedRemoveOrigin !== pairedOrigin) {
    armedRemoveOrigin = pairedOrigin;
    removeArmedAt = event.timeStamp;
    extensionPairingError = "";
    applyRemoveArming();
    elements.extensionPairingStatus.textContent = extensionPairingMessage();
    return;
  }
  // A double-click or held Enter must not arm and confirm in one gesture.
  if (event.detail > 1 || event.timeStamp - removeArmedAt < REMOVE_CONFIRM_GUARD_MS) return;
  const hadFocus = document.activeElement === button;
  armedRemoveOrigin = "";
  extensionPairingPending = true;
  updateExtensionPairingControls({ preserveStatus: true });
  elements.extensionPairingStatus.textContent = "Removing access…";
  try {
    extensionPairingSettings = await bridge.removeExtensionOrigin(origin);
    updateExtensionPairingControls({ preserveStatus: true });
    elements.extensionPairingStatus.textContent = "Removed. Restarting RoleFit…";
  } catch (error) {
    failExtensionPairingAction(error, "extensionOrigin", pairedOrigin, hadFocus);
  }
});

elements.sitePortForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!hasUsableBridge() || !siteSettings || siteSettings.locked || sitePortApplyPending) return;
  const port = parseLocalSitePortInput();
  if (port === null) {
    elements.sitePortInput.setCustomValidity("Enter a whole number from 1 to 65535.");
    elements.sitePortStatus.textContent = "Enter a whole number from 1 to 65535.";
    elements.sitePortInput.focus();
    return;
  }
  if (port !== siteSettings.localSitePort && sitePortConfirmValue !== port) {
    sitePortConfirmValue = port;
    updateSitePortControls({ preserveStatus: true });
    elements.sitePortStatus.textContent =
      `RoleFit will restart on localhost:${port}. Update the browser extension port to ${port} after restart.`;
    return;
  }

  sitePortApplyPending = true;
  updateSitePortControls({ preserveStatus: true });
  elements.sitePortStatus.textContent = "Checking port availability…";
  try {
    siteSettings = await bridge.applyLocalSitePort(port);
    elements.sitePortInput.value = String(siteSettings.localSitePort);
    updateSitePortControls({ preserveStatus: true });
    elements.sitePortInput.disabled = true;
    elements.sitePortApply.disabled = true;
    elements.sitePortStatus.textContent =
      `Saved. Restarting at localhost:${port}… Update the browser extension port to ${port} after restart.`;
    updateExtensionPairingControls();
  } catch (error) {
    sitePortApplyPending = false;
    sitePortConfirmValue = null;
    updateSitePortControls({ preserveStatus: true });
    elements.sitePortStatus.textContent = localSitePortErrorMessage(error);
    elements.sitePortInput.focus();
  }
});

async function openRoleFitInBrowser(button) {
  if (!hasUsableBridge()) return;
  button.disabled = true;
  try {
    await bridge.openBrowserApp();
    announce("RoleFit opened in your default browser.");
  } catch {
    announce("RoleFit could not be opened. Keep the desktop app running and try again.");
  } finally {
    button.disabled = false;
  }
}

for (const button of [elements.openRoleFit, elements.overviewOpenRoleFit]) {
  button.addEventListener("click", () => {
    void openRoleFitInBrowser(button);
  });
}

elements.openExtensionDirectory.addEventListener("click", async () => {
  if (!hasUsableBridge()) return;
  elements.openExtensionDirectory.disabled = true;
  try {
    await bridge.openExtensionDirectory();
    announce(`Opened the bundled browser-extension folder for ${activeExtensionPortLabel()}.`);
  } catch {
    announce(`The browser-extension folder for ${activeExtensionPortLabel()} could not be opened. Restart RoleFit and try again.`);
  } finally {
    elements.openExtensionDirectory.disabled = false;
  }
});

for (const button of elements.extensionCopyButtons) {
  button.addEventListener("click", () => {
    void copyExtensionSetupValue(button);
  });
  button.addEventListener("pointerleave", () => {
    resetExtensionSetupCopyFeedback(button);
  });
  button.addEventListener("blur", () => {
    resetExtensionSetupCopyFeedback(button);
  });
}

renderCheckingProviders();
selectExtensionBrowser(storedExtensionBrowser(), { persist: false });
activateTab(storedTab(), { persist: false, refresh: false });
if (hasUsableBridge()) {
  void loadRuntimeInfo();
  void loadLocalSiteSettings();
  void loadExtensionPairingSettings();
  void refreshWorkspaceOverview();
  void refreshConnectionStatus();
  void refreshProviders({ announceResult: false });
} else {
  initializeUnavailableState();
}
