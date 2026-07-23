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
const ACTIVE_TAB_STORAGE_KEY = "rolefit:desktop:active-tab";
const bridge = window.roleFitDesktop;
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
  extensionPairingCount: document.getElementById("extension-pairing-count"),
  extensionPairingPopover: document.getElementById("extension-pairing-popover"),
  extensionRequestList: document.getElementById("extension-request-list"),
  extensionPairingList: document.getElementById("extension-pairing-list"),
  extensionPairingStatus: document.getElementById("extension-pairing-status"),
  openExtensionDirectory: document.getElementById("open-extension-directory"),
  overviewSiteOrigin: document.getElementById("overview-site-origin"),
  overviewProviderSummary: document.getElementById("overview-provider-summary"),
  overviewExtensionSummary: document.getElementById("overview-extension-summary"),
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
let extensionPairingPending = false;
let extensionPairingPopoverOpen = false;
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
  if (tab !== "extension") setExtensionPairingPopover(false);
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

function setExtensionPairingPopover(open) {
  extensionPairingPopoverOpen = Boolean(open);
  elements.extensionPairingPopover.hidden = !extensionPairingPopoverOpen;
  elements.extensionPairingCount.setAttribute(
    "aria-expanded",
    String(extensionPairingPopoverOpen)
  );
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

function parseLocalSitePortInput() {
  const raw = elements.sitePortInput.value.trim();
  if (!/^\d{1,5}$/.test(raw)) return null;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function currentPortStatus(settings) {
  if (settings.locked) {
    return settings.localSitePort === 5_181
      ? "Locked by ROLEFIT_DESKTOP_PORT."
      : "Locked by ROLEFIT_DESKTOP_PORT. Extension imports still use localhost:5181.";
  }
  if (settings.warning === "saved-settings-invalid") {
    return `Saved setting was invalid. Using ${settings.localSitePort}; apply to replace it.`;
  }
  if (settings.warning === "saved-settings-unreadable") {
    return `Saved setting could not be read. Using ${settings.localSitePort}; apply to replace it.`;
  }
  return settings.localSitePort === 5_181
    ? "RoleFit opens at localhost:5181."
    : `RoleFit opens at localhost:${settings.localSitePort}. Browser storage is separate by port; extension imports still use localhost:5181.`;
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

function extensionPairingMessage() {
  if (!siteSettings) return "Local site settings are unavailable.";
  if (siteSettings.localSitePort !== 5_181) return "Set the local site port to 5181 before pairing.";
  const count = extensionPairingSettings?.origins?.length ?? 0;
  const pendingCount = extensionPairingSettings?.pendingOrigins?.length ?? 0;
  if (pendingCount > 0) return "Approve the extension request to enable job imports.";
  return count === 0
    ? "Open the RoleFit browser extension once to request access."
    : `${count} browser extension${count === 1 ? "" : "s"} paired.`;
}

function renderExtensionPairings() {
  const pendingFragment = document.createDocumentFragment();
  const pairedFragment = document.createDocumentFragment();
  const origins = Array.isArray(extensionPairingSettings?.origins)
    ? extensionPairingSettings.origins
    : [];
  const pendingOrigins = Array.isArray(extensionPairingSettings?.pendingOrigins)
    ? extensionPairingSettings.pendingOrigins.filter((origin) => !origins.includes(origin))
    : [];
  for (const origin of pendingOrigins) {
    const item = document.createElement("li");
    const value = createTextElement("code", "", origin);
    value.title = origin;
    const approve = createTextElement("button", "", "Approve");
    approve.type = "button";
    approve.dataset.extensionRequestOrigin = origin;
    approve.disabled = extensionPairingPending || siteSettings?.localSitePort !== 5_181;
    approve.setAttribute("aria-label", `Approve browser extension ${origin}`);
    item.append(value, approve);
    pendingFragment.append(item);
  }
  for (const origin of origins) {
    const item = document.createElement("li");
    const value = createTextElement("code", "", origin);
    value.title = origin;
    const remove = createTextElement("button", "", "Remove");
    remove.type = "button";
    remove.dataset.extensionOrigin = origin;
    remove.disabled = extensionPairingPending;
    remove.setAttribute("aria-label", `Remove paired extension ${origin}`);
    item.append(value, remove);
    pairedFragment.append(item);
  }
  elements.extensionRequestList.replaceChildren(pendingFragment);
  elements.extensionPairingList.replaceChildren(pairedFragment);
  elements.extensionPairingCount.textContent = pendingOrigins.length > 0
    ? `${pendingOrigins.length} awaiting approval`
    : origins.length > 0
      ? `${origins.length} paired`
      : "Not paired";
  elements.extensionPairingCount.setAttribute(
    "aria-label",
    `${elements.extensionPairingCount.textContent}. Manage extension access.`
  );
  elements.overviewExtensionSummary.textContent = pendingOrigins.length > 0
    ? `${pendingOrigins.length} approval${pendingOrigins.length === 1 ? "" : "s"} waiting`
    : origins.length > 0
      ? `${origins.length} extension${origins.length === 1 ? "" : "s"} paired`
      : "Browser extension not paired";
}

function updateExtensionPairingControls({ preserveStatus = false } = {}) {
  renderExtensionPairings();
  if (!preserveStatus) elements.extensionPairingStatus.textContent = extensionPairingMessage();
}

async function loadExtensionPairingSettings() {
  try {
    const settings = await bridge.getExtensionPairingSettings();
    if (!settings || typeof settings !== "object" ||
        !Array.isArray(settings.origins) || !Array.isArray(settings.pendingOrigins)) {
      throw new Error("Invalid extension pairing settings.");
    }
    extensionPairingSettings = settings;
    updateExtensionPairingControls();
  } catch {
    extensionPairingSettings = null;
    elements.extensionPairingCount.textContent = "Unavailable";
    elements.extensionPairingCount.setAttribute("aria-label", "Extension access unavailable");
    elements.extensionRequestList.replaceChildren();
    elements.extensionPairingList.replaceChildren();
    elements.extensionPairingStatus.textContent = "Extension pairing unavailable. Restart RoleFit and try again.";
    elements.overviewExtensionSummary.textContent = "Extension pairing unavailable";
  }
}

function extensionPairingErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("exact extension origin")) return message;
  if (message.includes("up to")) return message;
  if (message.includes("standalone RoleFit server")) return message;
  if (message.includes("port 5181")) return message;
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

function renderConnectionStatus() {
  const status = liveConnectionStatus;
  if (!status) {
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
    text = `Serving ${status.siteUrl} — this desktop app`;
    summary = "Local service running.";
  } else if (status.serverState === "reused") {
    state = "warn";
    text = `Already running at ${status.port} — another RoleFit process`;
    summary = "Standalone RoleFit service detected.";
  } else if (status.serverState === "unreachable") {
    state = "error";
    text = `Port ${status.port} — not responding`;
    summary = "Local service not responding.";
  }
  elements.connectionState.dataset.state = state;
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
    elements.runtimeVersion.textContent = version ? `RoleFit ${version}` : "RoleFit";
  } catch {
    elements.runtimeVersion.textContent = "RoleFit";
  }
}

function initializeUnavailableState() {
  elements.companionRoot.dataset.status = "error";
  elements.openRoleFit.disabled = true;
  elements.refreshProviders.disabled = true;
  elements.sitePortInput.disabled = true;
  elements.sitePortApply.disabled = true;
  elements.sitePortStatus.textContent = "Port setting unavailable.";
  elements.extensionPairingCount.textContent = "Unavailable";
  elements.extensionPairingCount.setAttribute("aria-label", "Extension access unavailable");
  elements.extensionPairingStatus.textContent = "Extension pairing unavailable.";
  elements.overviewExtensionSummary.textContent = "Extension pairing unavailable";
  elements.overviewProviderSummary.textContent = "Provider status unavailable";
  elements.sidebarRuntimeStatus.textContent = "Service unavailable";
  elements.runtimeVersion.textContent = "RoleFit";
  workspaceOverview = null;
  workspaceOverviewLoaded = true;
  renderWorkspaceOverview();
  elements.workspaceStatus.textContent = "Workspace unavailable. Restart RoleFit and try again.";
  liveConnectionStatus = null;
  connectionStatusLoaded = true;
  renderConnectionStatus();
  renderProviders();
  elements.providerSummary.textContent = "Restart RoleFit to manage providers.";
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

elements.extensionPairingCount.addEventListener("click", () => {
  setExtensionPairingPopover(!extensionPairingPopoverOpen);
});

document.addEventListener("click", (event) => {
  if (!extensionPairingPopoverOpen || !(event.target instanceof Node)) return;
  if (elements.extensionPairingCount.contains(event.target) ||
      elements.extensionPairingPopover.contains(event.target)) return;
  setExtensionPairingPopover(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !extensionPairingPopoverOpen) return;
  setExtensionPairingPopover(false);
  elements.extensionPairingCount.focus();
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
    if (activeTabId === "workspace") void refreshWorkspaceOverview();
    if (activeTabId === "settings") void refreshConnectionStatus();
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
      : `Apply to restart RoleFit at localhost:${port}.`;
});

elements.extensionRequestList.addEventListener("click", async (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-extension-request-origin]")
    : null;
  if (!(button instanceof HTMLButtonElement) || button.disabled || extensionPairingPending) return;
  const origin = normalizeExtensionOriginInput(button.dataset.extensionRequestOrigin);
  if (!origin) return;
  extensionPairingPending = true;
  updateExtensionPairingControls({ preserveStatus: true });
  elements.extensionPairingStatus.textContent = "Approving extension…";
  try {
    extensionPairingSettings = await bridge.saveExtensionOrigin(origin);
    updateExtensionPairingControls({ preserveStatus: true });
    elements.extensionPairingStatus.textContent = "Paired. Restarting the local service…";
  } catch (error) {
    extensionPairingPending = false;
    updateExtensionPairingControls({ preserveStatus: true });
    elements.extensionPairingStatus.textContent = extensionPairingErrorMessage(error);
  }
});

elements.extensionPairingList.addEventListener("click", async (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-extension-origin]")
    : null;
  if (!(button instanceof HTMLButtonElement) || button.disabled || extensionPairingPending) return;
  const origin = normalizeExtensionOriginInput(button.dataset.extensionOrigin);
  if (!origin) return;
  extensionPairingPending = true;
  updateExtensionPairingControls({ preserveStatus: true });
  elements.extensionPairingStatus.textContent = "Removing pairing…";
  try {
    extensionPairingSettings = await bridge.removeExtensionOrigin(origin);
    updateExtensionPairingControls({ preserveStatus: true });
    elements.extensionPairingStatus.textContent = "Removed. Restarting the local service…";
  } catch (error) {
    extensionPairingPending = false;
    updateExtensionPairingControls({ preserveStatus: true });
    elements.extensionPairingStatus.textContent = extensionPairingErrorMessage(error);
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
      "Changing ports uses separate browser storage. Extension imports remain on localhost:5181.";
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
    elements.sitePortStatus.textContent = `Saved. Restarting at localhost:${port}…`;
    updateExtensionPairingControls();
  } catch (error) {
    sitePortApplyPending = false;
    sitePortConfirmValue = null;
    updateSitePortControls({ preserveStatus: true });
    elements.sitePortStatus.textContent = localSitePortErrorMessage(error);
    elements.sitePortInput.focus();
  }
});

elements.openRoleFit.addEventListener("click", async () => {
  if (!hasUsableBridge()) return;
  elements.openRoleFit.disabled = true;
  try {
    await bridge.openBrowserApp();
    announce("RoleFit opened in your default browser.");
  } catch {
    announce("RoleFit could not be opened. Keep the desktop app running and try again.");
  } finally {
    elements.openRoleFit.disabled = false;
  }
});

elements.openExtensionDirectory.addEventListener("click", async () => {
  if (!hasUsableBridge()) return;
  elements.openExtensionDirectory.disabled = true;
  try {
    await bridge.openExtensionDirectory();
    announce("Opened the bundled browser-extension folder.");
  } catch {
    announce("The browser-extension folder could not be opened. Restart RoleFit and try again.");
  } finally {
    elements.openExtensionDirectory.disabled = false;
  }
});

renderCheckingProviders();
activateTab(storedTab(), { persist: false, refresh: false });
if (hasUsableBridge()) {
  elements.sidebarRuntimeStatus.textContent = "Service ready";
  void loadRuntimeInfo();
  void loadLocalSiteSettings();
  void loadExtensionPairingSettings();
  void refreshWorkspaceOverview();
  void refreshConnectionStatus();
  void refreshProviders({ announceResult: false });
} else {
  initializeUnavailableState();
}
