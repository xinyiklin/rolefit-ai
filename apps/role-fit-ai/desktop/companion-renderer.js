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
const PROVIDER_SIGN_IN_POLL_INTERVAL_MS = 1_500;
const PROVIDER_VISIBLE_POLL_INTERVAL_MS = 5_000;
const WORKSPACE_POLL_INTERVAL_MS = 5_000;
const CONNECTION_POLL_INTERVAL_MS = 5_000;
const TAB_IDS = Object.freeze(["providers", "workspace", "connection"]);
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
  "beginCliSignIn",
  "cancelCliSignIn",
  "openCliSignInTerminal",
  "openProviderInstallGuide",
  "openBrowserApp",
  "getWorkspaceOverview",
  "backupWorkspaceToFile",
  "restoreWorkspaceFromFile",
  "openWorkspaceFolder",
  "getConnectionStatus"
]);

const elements = Object.freeze({
  companionRoot: document.querySelector("[data-companion-root]"),
  bridgeLine: document.getElementById("bridge-line"),
  bridgeStatus: document.getElementById("bridge-status"),
  tabList: document.getElementById("companion-tablist"),
  tabs: Object.freeze({
    providers: document.getElementById("tab-providers"),
    workspace: document.getElementById("tab-workspace"),
    connection: document.getElementById("tab-connection")
  }),
  panels: Object.freeze({
    providers: document.getElementById("panel-providers"),
    workspace: document.getElementById("panel-workspace"),
    connection: document.getElementById("panel-connection")
  }),
  workspacePath: document.getElementById("workspace-path"),
  workspaceSummary: document.getElementById("workspace-summary"),
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
  extensionRequestList: document.getElementById("extension-request-list"),
  extensionPairingList: document.getElementById("extension-pairing-list"),
  extensionPairingStatus: document.getElementById("extension-pairing-status"),
  openRoleFit: document.getElementById("open-rolefit-browser"),
  providerList: document.getElementById("provider-list"),
  providerSummary: document.getElementById("provider-summary"),
  providerAnnouncement: document.getElementById("provider-announcement"),
  refreshProviders: document.getElementById("refresh-providers"),
  runtimeVersion: document.getElementById("runtime-version")
});

const pendingProviders = new Set();
const replacingApiProviders = new Set();
const signInOperationIds = new Map();
let providerRecords = new Map();
let refreshGeneration = 0;
let pollTimer = 0;
let siteSettings = null;
let sitePortApplyPending = false;
let sitePortConfirmValue = null;
let extensionPairingSettings = null;
let extensionPairingPending = false;
// The selected tab is remembered in memory only; every launch starts on
// Providers.
let activeTabId = "providers";
let workspaceOverview = null;
let workspaceOverviewLoaded = false;
let workspaceOverviewGeneration = 0;
let workspacePollTimer = 0;
let workspaceOperationPending = false;
let liveConnectionStatus = null;
let connectionStatusLoaded = false;
let connectionStatusGeneration = 0;
let connectionPollTimer = 0;

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

// Status lines show state only, and only when there is one: locked ports and
// saved-setting warnings. The happy path stays empty.
function currentPortStatus(settings) {
  if (settings.locked) {
    return settings.localSitePort === 5_181
      ? "Locked by ROLEFIT_DESKTOP_PORT"
      : "Locked by ROLEFIT_DESKTOP_PORT — extension stays on 5181";
  }
  if (settings.warning === "saved-settings-invalid") {
    return `Saved port invalid — using ${settings.localSitePort}`;
  }
  if (settings.warning === "saved-settings-unreadable") {
    return `Saved port unreadable — using ${settings.localSitePort}`;
  }
  return "";
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
    port === null && elements.sitePortInput.value ? "Enter a port from 1 to 65535." : ""
  );
  if (!preserveStatus && siteSettings) {
    elements.sitePortStatus.textContent = currentPortStatus(siteSettings);
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
    elements.sitePortStatus.textContent = "Port setting unavailable";
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

// The heading count is the pairing panel's single state line; the status line
// below the lists is reserved for action feedback and errors.
function extensionPairingCountText() {
  if (!extensionPairingSettings) return "Unavailable";
  const count = extensionPairingSettings.origins?.length ?? 0;
  const pendingCount = extensionPairingSettings.pendingOrigins?.length ?? 0;
  if (pendingCount > 0) return `${pendingCount} awaiting approval`;
  if (count > 0) return `${count} paired`;
  if (siteSettings && siteSettings.localSitePort !== 5_181) return "Needs port 5181";
  return "Not paired";
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
  elements.extensionPairingCount.textContent = extensionPairingCountText();
}

function updateExtensionPairingControls({ preserveStatus = false } = {}) {
  renderExtensionPairings();
  if (!preserveStatus) elements.extensionPairingStatus.textContent = "";
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
    elements.extensionRequestList.replaceChildren();
    elements.extensionPairingList.replaceChildren();
    elements.extensionPairingStatus.textContent = "Pairing unavailable — restart the companion";
  }
}

function extensionPairingErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("exact extension origin")) return "Origin must match the extension popup";
  if (message.includes("up to")) return "Pairing limit reached";
  if (message.includes("standalone RoleFit server")) return "Stop the standalone server first";
  if (message.includes("port 5181")) return "Pairing needs port 5181";
  if (message.includes("already restarting")) return "Companion already restarting";
  return "Pairing could not be saved";
}

function localSitePortErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("already in use")) return "Port already in use";
  if (message.includes("ROLEFIT_DESKTOP_PORT")) return "Remove ROLEFIT_DESKTOP_PORT first";
  return "Port could not be saved";
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
  if (record.signInRunning) return { key: "signing-in", label: "Sign-in in progress" };
  if (record.ready) {
    return record.setupFlow === "manual-login" && record.authState === "unknown"
      ? { key: "connected", label: "Ready to verify" }
      : { key: "connected", label: "Ready" };
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

  if (record.signInRunning) {
    const operationId = signInOperationIds.get(provider.id);
    const cancel = createButton(
      operationId ? "Cancel sign-in" : "Sign-in open",
      "cancel-sign-in",
      provider.id,
      "provider-card__action is-cancel"
    );
    if (!operationId) cancel.disabled = true;
    actions.append(cancel);
  } else {
    const manual = record.setupFlow === "manual-login";
    if (manual && record.authState === "unknown") {
      actions.append(createButton(
        record.ready ? "Open Terminal" : "Sign in in terminal",
        "terminal-sign-in",
        provider.id,
        record.ready ? "provider-card__text-action" : "provider-card__action provider-card__action--primary"
      ));
    } else if (!record.ready) {
      actions.append(
        createButton(
          "Sign in",
          "sign-in",
          provider.id,
          "provider-card__action provider-card__action--primary"
        ),
        createButton("Use terminal", "terminal-sign-in", provider.id, "provider-card__text-action")
      );
    }
  }
  actions.append(createButton("Remove", "remove", provider.id, "provider-card__text-action is-danger"));
}

function renderProviders() {
  const fragment = document.createDocumentFragment();
  const isInitialRender = elements.providerList.dataset.rendered !== "true";
  let configuredCount = 0;
  let readyCount = 0;
  let signInRunning = false;

  SUPPORTED_PROVIDERS.forEach((provider) => {
    const record = providerRecords.get(provider.id);
    const status = connectionStatus(provider, record);
    if (record?.configured) configuredCount += 1;
    if (record?.ready) readyCount += 1;
    if (record?.signInRunning) signInRunning = true;

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
    ? "No providers added yet"
    : `${configuredCount} added · ${readyCount} ready`;
  return signInRunning;
}

function renderCheckingProviders() {
  providerRecords = new Map();
  elements.providerList.setAttribute("aria-busy", "true");
  renderProviders();
  elements.providerList.setAttribute("aria-busy", "true");
}

function schedulePoll(signInRunning) {
  window.clearTimeout(pollTimer);
  pollTimer = 0;
  // Main owns the hidden/closed fallback refresh. While this setup window is
  // visible, keep exactly one bounded renderer timer so an external terminal
  // login/logout converges without requiring the user to press Check again.
  if (!hasUsableBridge() || document.visibilityState === "hidden") return;
  const delay = signInRunning
    ? PROVIDER_SIGN_IN_POLL_INTERVAL_MS
    : PROVIDER_VISIBLE_POLL_INTERVAL_MS;
  pollTimer = window.setTimeout(() => {
    void loadExtensionPairingSettings();
    void refreshProviders({ announceResult: false });
  }, delay);
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
  let signInRunning = false;
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
    for (const provider of SUPPORTED_PROVIDERS) {
      const record = providerRecords.get(provider.id);
      if (!record?.signInRunning) signInOperationIds.delete(provider.id);
    }
    signInRunning = renderProviders();
    elements.companionRoot.dataset.status = "ready";
    if (announceResult) announce("Provider status updated.");
  } catch {
    if (generation !== refreshGeneration) return;
    elements.companionRoot.dataset.status = "error";
    signInRunning = renderProviders();
    elements.providerSummary.textContent = "Provider status check failed";
    if (announceResult) announce("Provider status could not be checked.");
  } finally {
    if (generation === refreshGeneration) {
      elements.refreshProviders.disabled = false;
      elements.refreshProviders.classList.remove("is-checking");
      elements.providerList.setAttribute("aria-busy", "false");
      schedulePoll(signInRunning);
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

async function beginCliSignIn(providerId) {
  if (pendingProviders.has(providerId)) return;
  pendingProviders.add(providerId);
  renderProviders();
  try {
    const result = await bridge.beginCliSignIn(providerId);
    const operationId = result && typeof result.operationId === "string"
      ? result.operationId.trim()
      : "";
    if (operationId) signInOperationIds.set(providerId, operationId);
    announce(safeGuidance(result?.guidance, "Complete sign-in with the provider, then check again."));
  } catch {
    announce("The provider-owned sign-in flow could not start. Check the CLI and try again.");
  } finally {
    pendingProviders.delete(providerId);
    await refreshProviders({ announceResult: false });
  }
}

async function cancelCliSignIn(providerId) {
  const operationId = signInOperationIds.get(providerId);
  if (!operationId) return;
  await runProviderAction(
    providerId,
    () => bridge.cancelCliSignIn(operationId),
    "CLI sign-in canceled.",
    "The CLI sign-in flow could not be canceled cleanly."
  );
  signInOperationIds.delete(providerId);
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

function setActiveTab(tabId, { focusTab = false } = {}) {
  if (!TAB_IDS.includes(tabId)) return;
  activeTabId = tabId;
  for (const id of TAB_IDS) {
    const selected = id === tabId;
    elements.tabs[id].setAttribute("aria-selected", selected ? "true" : "false");
    elements.tabs[id].tabIndex = selected ? 0 : -1;
    elements.panels[id].hidden = !selected;
  }
  if (focusTab) elements.tabs[tabId].focus();
  // The ~5s workspace/connection polls run only while their tab is active;
  // leaving a tab stops its poll until the next activation refresh.
  if (tabId === "workspace") {
    if (hasUsableBridge()) void refreshWorkspaceOverview();
  } else {
    window.clearTimeout(workspacePollTimer);
    workspacePollTimer = 0;
  }
  if (tabId === "connection") {
    if (hasUsableBridge()) void refreshConnectionStatus();
  } else {
    window.clearTimeout(connectionPollTimer);
    connectionPollTimer = 0;
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
  elements.workspaceSummary.textContent = overviewUsable
    ? overview.serverReady
      ? "Ready to back up"
      : "Local server not running"
    : workspaceOverviewLoaded
      ? "Workspace unavailable"
      : "Checking workspace…";
  elements.workspacePath.textContent = overview
    ? overview.workspaceDisplayPath
    : workspaceOverviewLoaded
      ? "Unavailable"
      : "Checking…";
  elements.workspacePath.title = overview ? overview.workspaceDisplayPath : "";
  elements.openWorkspaceFolder.disabled = !overviewUsable || workspaceOperationPending;

  elements.statBaseResume.textContent = overviewUsable
    ? overview.hasBaseResume === true ? "✓" : "—"
    : "—";
  elements.statApplications.textContent = overviewUsable ? statCount(overview.applicationCount) : "—";

  // The Connection tab owns the visible session indicator; the overview's tab
  // count still gates Restore here so a live Drafting Desk cannot be replaced.
  const activeTabs = overview && typeof overview.activeBrowserTabs === "number" &&
    Number.isInteger(overview.activeBrowserTabs) && overview.activeBrowserTabs >= 0
    ? overview.activeBrowserTabs
    : null;
  const busy = workspaceOperationPending || !overviewUsable || !overview?.serverReady;
  elements.backupWorkspace.disabled = busy;
  const restoreBlocked = activeTabs !== null && activeTabs > 0;
  elements.restoreWorkspace.disabled = busy || restoreBlocked;
  if (restoreBlocked) {
    elements.restoreWorkspace.title = "Close the open RoleFit browser tabs before restoring.";
  } else {
    elements.restoreWorkspace.title =
      "Replaces the saved workspace; the previous one is kept as a local safety copy";
  }
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
  // Mirror the provider polling discipline: clear the pending timer, let the
  // owning refresh settle, then schedule exactly one successor.
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
    elements.connectionStateText.textContent = connectionStatusLoaded
      ? "Status unavailable"
      : "Checking…";
    elements.connectionBrowserTabs.textContent = "—";
    elements.connectionSummary.textContent = connectionStatusLoaded
      ? "Status unavailable"
      : "Checking the local site…";
    return;
  }
  let state = "unknown";
  let text = "Starting…";
  let summary = "Starting…";
  if (status.serverState === "owned") {
    state = "ok";
    text = `Serving ${status.siteUrl} — this companion`;
    summary = "Local server running";
  } else if (status.serverState === "reused") {
    state = "warn";
    text = `Already running at ${status.port} — another RoleFit`;
    summary = "Standalone server detected";
  } else if (status.serverState === "unreachable") {
    state = "error";
    text = `Port ${status.port} — not responding`;
    summary = "Server not responding";
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
  if (!hasUsableBridge() || activeTabId !== "connection" || document.visibilityState === "hidden") {
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
  elements.workspaceStatus.textContent = kind === "backup"
    ? "Backing up…"
    : "Restoring…";
  try {
    const result = kind === "backup"
      ? await bridge.backupWorkspaceToFile()
      : await bridge.restoreWorkspaceFromFile();
    const status = result && typeof result === "object" ? result.status : "";
    if (kind === "backup" && status === "saved") {
      const fileName = typeof result.filePath === "string" ? result.filePath.trim() : "";
      elements.workspaceStatus.textContent = fileName
        ? `Backup saved to ${fileName}`
        : "Backup saved.";
    } else if (kind === "restore" && status === "restored") {
      elements.workspaceStatus.textContent = "Workspace restored — reopen RoleFit in your browser";
    } else if (status === "cancelled") {
      elements.workspaceStatus.textContent = kind === "backup"
        ? "Backup cancelled."
        : "Restore cancelled.";
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
    elements.runtimeVersion.textContent = version ? `RoleFit ${version} / local` : "RoleFit companion / local";
  } catch {
    elements.runtimeVersion.textContent = "RoleFit companion / local";
  }
}

function initializeUnavailableState() {
  elements.companionRoot.dataset.status = "error";
  elements.bridgeLine.classList.add("is-error");
  elements.bridgeStatus.textContent = "Companion bridge unavailable";
  elements.openRoleFit.disabled = true;
  elements.refreshProviders.disabled = true;
  elements.sitePortInput.disabled = true;
  elements.sitePortApply.disabled = true;
  elements.sitePortStatus.textContent = "Port setting unavailable";
  elements.extensionPairingCount.textContent = "Unavailable";
  elements.runtimeVersion.textContent = "Companion unavailable";
  workspaceOverview = null;
  workspaceOverviewLoaded = true;
  renderWorkspaceOverview();
  elements.workspaceStatus.textContent = "Workspace unavailable — restart the companion";
  liveConnectionStatus = null;
  connectionStatusLoaded = true;
  renderConnectionStatus();
  renderProviders();
  elements.providerSummary.textContent = "Restart the companion to manage providers";
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
  } else if (action === "sign-in") {
    void beginCliSignIn(providerId);
  } else if (action === "terminal-sign-in") {
    void openCliSignInTerminal(providerId);
  } else if (action === "cancel-sign-in") {
    void cancelCliSignIn(providerId);
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
    if (activeTabId === "connection") void refreshConnectionStatus();
  }
});

elements.tabList.addEventListener("click", (event) => {
  const tab = event.target instanceof Element
    ? event.target.closest("[role='tab']")
    : null;
  if (!(tab instanceof HTMLButtonElement)) return;
  setActiveTab(tab.dataset.tabId ?? "");
});

elements.tabList.addEventListener("keydown", (event) => {
  const currentIndex = TAB_IDS.indexOf(activeTabId);
  let nextIndex = -1;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TAB_IDS.length;
  else if (event.key === "ArrowLeft") nextIndex = (currentIndex + TAB_IDS.length - 1) % TAB_IDS.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = TAB_IDS.length - 1;
  if (nextIndex === -1) return;
  event.preventDefault();
  setActiveTab(TAB_IDS[nextIndex], { focusTab: true });
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
    ? "Enter a port from 1 to 65535"
    : port === siteSettings.localSitePort
      ? currentPortStatus(siteSettings)
      : "";
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
  elements.extensionPairingStatus.textContent = "Approving…";
  try {
    extensionPairingSettings = await bridge.saveExtensionOrigin(origin);
    updateExtensionPairingControls({ preserveStatus: true });
    elements.extensionPairingStatus.textContent = "Paired — restarting…";
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
  elements.extensionPairingStatus.textContent = "Removing…";
  try {
    extensionPairingSettings = await bridge.removeExtensionOrigin(origin);
    updateExtensionPairingControls({ preserveStatus: true });
    elements.extensionPairingStatus.textContent = "Removed — restarting…";
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
    elements.sitePortInput.setCustomValidity("Enter a port from 1 to 65535.");
    elements.sitePortStatus.textContent = "Enter a port from 1 to 65535";
    elements.sitePortInput.focus();
    return;
  }
  if (port !== siteSettings.localSitePort && sitePortConfirmValue !== port) {
    sitePortConfirmValue = port;
    updateSitePortControls({ preserveStatus: true });
    elements.sitePortStatus.textContent = "Press Apply again to confirm";
    return;
  }

  sitePortApplyPending = true;
  updateSitePortControls({ preserveStatus: true });
  elements.sitePortStatus.textContent = "Checking port…";
  try {
    siteSettings = await bridge.applyLocalSitePort(port);
    elements.sitePortInput.value = String(siteSettings.localSitePort);
    updateSitePortControls({ preserveStatus: true });
    elements.sitePortInput.disabled = true;
    elements.sitePortApply.disabled = true;
    elements.sitePortStatus.textContent = `Saved — restarting on ${port}…`;
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
    announce("RoleFit could not be opened. Keep the companion running and try again.");
  } finally {
    elements.openRoleFit.disabled = false;
  }
});

renderCheckingProviders();
if (hasUsableBridge()) {
  elements.bridgeLine.classList.add("is-ready");
  elements.bridgeStatus.textContent = "Companion ready";
  void loadRuntimeInfo();
  void loadLocalSiteSettings();
  void loadExtensionPairingSettings();
  void refreshProviders({ announceResult: false });
} else {
  initializeUnavailableState();
}
