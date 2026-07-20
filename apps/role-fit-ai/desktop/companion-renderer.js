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
  "openBrowserApp"
]);

const elements = Object.freeze({
  companionRoot: document.querySelector("[data-companion-root]"),
  bridgeLine: document.getElementById("bridge-line"),
  bridgeStatus: document.getElementById("bridge-status"),
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
    elements.sitePortStatus.textContent = "Port setting unavailable. Restart the companion and try again.";
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
    elements.extensionRequestList.replaceChildren();
    elements.extensionPairingList.replaceChildren();
    elements.extensionPairingStatus.textContent = "Extension pairing unavailable. Restart the companion and try again.";
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
    ? "No providers added yet. Add a CLI or API provider to begin."
    : `${configuredCount} added · ${readyCount} ready for RoleFit.`;
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
    elements.providerSummary.textContent = "Provider status could not be checked. Try again.";
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
  elements.bridgeStatus.textContent = "The local companion bridge is unavailable.";
  elements.openRoleFit.disabled = true;
  elements.refreshProviders.disabled = true;
  elements.sitePortInput.disabled = true;
  elements.sitePortApply.disabled = true;
  elements.sitePortStatus.textContent = "Port setting unavailable.";
  elements.extensionPairingCount.textContent = "Unavailable";
  elements.extensionPairingStatus.textContent = "Extension pairing unavailable.";
  elements.runtimeVersion.textContent = "Companion unavailable";
  renderProviders();
  elements.providerSummary.textContent = "Restart the RoleFit companion to manage providers.";
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
    return;
  }
  if (hasUsableBridge()) {
    void loadExtensionPairingSettings();
    void refreshProviders({ announceResult: false });
  }
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
    announce("RoleFit could not be opened. Keep the companion running and try again.");
  } finally {
    elements.openRoleFit.disabled = false;
  }
});

renderCheckingProviders();
if (hasUsableBridge()) {
  elements.bridgeLine.classList.add("is-ready");
  elements.bridgeStatus.textContent = "Companion ready.";
  void loadRuntimeInfo();
  void loadLocalSiteSettings();
  void loadExtensionPairingSettings();
  void refreshProviders({ announceResult: false });
} else {
  initializeUnavailableState();
}
