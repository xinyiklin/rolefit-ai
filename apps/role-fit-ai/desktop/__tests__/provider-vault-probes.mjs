import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ProviderVaultCorruptError,
  ProviderVaultUnavailableError,
  createProviderVault
} from "../../dist-electron/desktop/provider-vault.cjs";
import {
  isRoleFitApiProviderId,
  isRoleFitCliProviderId,
  isRoleFitProviderId
} from "../../dist-electron/desktop/ipc-contract.cjs";

const tempRoots = [];

async function tempRoot(label) {
  const root = await mkdtemp(join(tmpdir(), `rolefit-vault-${label}-`));
  tempRoots.push(root);
  return root;
}

class FakeSafeStorage {
  available = true;
  backend = "gnome_libsecret";
  shouldReEncrypt = false;
  encryptions = 0;
  decryptions = 0;

  async isAsyncEncryptionAvailable() {
    return this.available;
  }

  getSelectedStorageBackend() {
    return this.backend;
  }

  async encryptStringAsync(plainText) {
    this.encryptions += 1;
    const input = Buffer.from(plainText, "utf8");
    return Buffer.from(input, (_byte, index) => input[index] ^ 0xa5);
  }

  async decryptStringAsync(encrypted) {
    this.decryptions += 1;
    const output = Buffer.from(encrypted, (_byte, index) => encrypted[index] ^ 0xa5);
    return {
      result: output.toString("utf8"),
      shouldReEncrypt: this.shouldReEncrypt
    };
  }
}

function providerState(state, id) {
  return state.providers.find((provider) => provider.id === id);
}

assert.equal(isRoleFitApiProviderId("openai"), true);
assert.equal(isRoleFitApiProviderId("anthropic"), true);
assert.equal(isRoleFitApiProviderId("claude-cli"), false);
assert.equal(isRoleFitCliProviderId("claude-cli"), true);
assert.equal(isRoleFitCliProviderId("codex-cli"), true);
assert.equal(isRoleFitCliProviderId("antigravity-cli"), true);
assert.equal(isRoleFitCliProviderId("shell"), false);
assert.equal(isRoleFitProviderId("openai"), true);
assert.equal(isRoleFitProviderId("shell"), false);

try {
  const root = await tempRoot("round-trip");
  const safeStorage = new FakeSafeStorage();
  const vault = createProviderVault({
    userDataDirectory: root,
    safeStorage,
    platform: "linux"
  });

  const empty = await vault.getConfiguredState();
  assert.deepEqual(empty, {
    schemaVersion: 1,
    providers: [
      { id: "claude-cli", kind: "cli", configured: false },
      { id: "codex-cli", kind: "cli", configured: false },
      { id: "antigravity-cli", kind: "cli", configured: false },
      { id: "openai", kind: "api", configured: false },
      { id: "anthropic", kind: "api", configured: false }
    ]
  });
  assert(Object.isFrozen(empty));
  assert(Object.isFrozen(empty.providers));
  assert(empty.providers.every(Object.isFrozen));

  const afterOpenAi = await vault.saveApiCredential("openai", "  sk-rolefit-secret  ");
  assert.equal(providerState(afterOpenAi, "openai").configured, true);
  assert.equal(providerState(afterOpenAi, "anthropic").configured, false);
  assert(afterOpenAi.providers.every((provider) => !Object.hasOwn(provider, "apiKey")));
  assert(afterOpenAi.providers.every((provider) => !Object.hasOwn(provider, "ciphertext")));

  await Promise.all([
    vault.saveApiCredential("anthropic", "sk-ant-rolefit-secret"),
    vault.setCliProviderEnabled("codex-cli", true),
    vault.setCliProviderEnabled("claude-cli", true)
  ]);
  const configured = await vault.getConfiguredState();
  assert.equal(providerState(configured, "openai").configured, true);
  assert.equal(providerState(configured, "anthropic").configured, true);
  assert.equal(providerState(configured, "codex-cli").configured, true);
  assert.equal(providerState(configured, "claude-cli").configured, true);
  assert.equal(providerState(configured, "antigravity-cli").configured, false);

  const snapshot = await vault.decryptApiCredentialSnapshot();
  assert.deepEqual(snapshot, {
    openai: "sk-rolefit-secret",
    anthropic: "sk-ant-rolefit-secret"
  });
  assert(Object.isFrozen(snapshot));

  const vaultDirectory = join(root, "provider-vault");
  const vaultPath = join(vaultDirectory, "providers.json");
  const persistedText = await readFile(vaultPath, "utf8");
  assert.equal(persistedText.includes("sk-rolefit-secret"), false);
  assert.equal(persistedText.includes("sk-ant-rolefit-secret"), false);
  assert.equal(persistedText.includes("apiKey"), false);
  const persisted = JSON.parse(persistedText);
  assert.deepEqual(Object.keys(persisted).sort(), [
    "apiCredentials",
    "enabledCliProviders",
    "schemaVersion"
  ]);
  assert.deepEqual(Object.keys(persisted.apiCredentials).sort(), ["anthropic", "openai"]);
  assert(Object.values(persisted.apiCredentials).every((value) =>
    typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ));

  if (process.platform !== "win32") {
    assert.equal((await stat(vaultDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(vaultPath)).mode & 0o777, 0o600);
  }

  safeStorage.shouldReEncrypt = true;
  const ciphertextBeforeRotation = (await readFile(vaultPath, "utf8"));
  assert.deepEqual(await vault.decryptApiCredentialSnapshot(), snapshot);
  assert(safeStorage.encryptions >= 4, "key-rotation guidance re-encrypts both credentials");
  assert.equal((await readFile(vaultPath, "utf8")).includes("sk-rolefit-secret"), false);
  assert.equal(typeof ciphertextBeforeRotation, "string");
  safeStorage.shouldReEncrypt = false;

  await vault.removeProvider("openai");
  await vault.removeProvider("claude-cli");
  await vault.setCliProviderEnabled("codex-cli", false);
  const afterRemoval = await vault.getConfiguredState();
  assert.equal(providerState(afterRemoval, "openai").configured, false);
  assert.equal(providerState(afterRemoval, "anthropic").configured, true);
  assert.equal(providerState(afterRemoval, "claude-cli").configured, false);
  assert.equal(providerState(afterRemoval, "codex-cli").configured, false);
  assert.deepEqual(await vault.decryptApiCredentialSnapshot(), {
    anthropic: "sk-ant-rolefit-secret"
  });

  await assert.rejects(() => vault.saveApiCredential("claude-cli", "secret"), {
    name: "TypeError"
  });
  await assert.rejects(() => vault.saveApiCredential("openai", "   "), /cannot be empty/);
  await assert.rejects(() => vault.saveApiCredential("openai", "line\nbreak"), /control/);
  await assert.rejects(() => vault.saveApiCredential("openai", "x".repeat(16_385)), /too large/);
  await assert.rejects(() => vault.removeProvider("shell"), /Unsupported provider/);
  await assert.rejects(() => vault.setCliProviderEnabled("openai", true), /Unsupported CLI/);
  await assert.rejects(() => vault.setCliProviderEnabled("codex-cli", "yes"), /must be boolean/);

  const unavailableRoot = await tempRoot("unavailable");
  const unavailableStorage = new FakeSafeStorage();
  unavailableStorage.available = false;
  const unavailableVault = createProviderVault({
    userDataDirectory: unavailableRoot,
    safeStorage: unavailableStorage,
    platform: "darwin"
  });
  await assert.rejects(
    () => unavailableVault.saveApiCredential("openai", "secret"),
    ProviderVaultUnavailableError
  );
  assert.equal(await stat(unavailableRoot).then(() => true), true);
  await assert.rejects(
    () => unavailableVault.decryptApiCredentialSnapshot(),
    ProviderVaultUnavailableError
  );

  const basicTextRoot = await tempRoot("basic-text");
  const basicTextStorage = new FakeSafeStorage();
  basicTextStorage.backend = "basic_text";
  const basicTextVault = createProviderVault({
    userDataDirectory: basicTextRoot,
    safeStorage: basicTextStorage,
    platform: "linux"
  });
  await assert.rejects(
    () => basicTextVault.saveApiCredential("anthropic", "secret"),
    ProviderVaultUnavailableError
  );

  const unknownBackendRoot = await tempRoot("unknown-backend");
  const unknownBackendStorage = new FakeSafeStorage();
  unknownBackendStorage.backend = "unknown";
  const unknownBackendVault = createProviderVault({
    userDataDirectory: unknownBackendRoot,
    safeStorage: unknownBackendStorage,
    platform: "linux"
  });
  await assert.rejects(
    () => unknownBackendVault.saveApiCredential("openai", "secret"),
    ProviderVaultUnavailableError
  );

  const malformedRoot = await tempRoot("malformed");
  const malformedDirectory = join(malformedRoot, "provider-vault");
  await mkdir(malformedDirectory, { recursive: true });
  await writeFile(join(malformedDirectory, "providers.json"), "not json\n", "utf8");
  const malformedVault = createProviderVault({
    userDataDirectory: malformedRoot,
    safeStorage: new FakeSafeStorage(),
    platform: "darwin"
  });
  await assert.rejects(() => malformedVault.getConfiguredState(), ProviderVaultCorruptError);
  await assert.rejects(
    () => malformedVault.saveApiCredential("openai", "must-not-overwrite-corruption"),
    ProviderVaultCorruptError
  );
  assert.equal((await readFile(join(malformedDirectory, "providers.json"), "utf8")), "not json\n");

  const unknownShapeRoot = await tempRoot("unknown-shape");
  const unknownShapeDirectory = join(unknownShapeRoot, "provider-vault");
  await mkdir(unknownShapeDirectory, { recursive: true });
  await writeFile(join(unknownShapeDirectory, "providers.json"), JSON.stringify({
    schemaVersion: 1,
    apiCredentials: {},
    enabledCliProviders: [],
    unexpected: true
  }), "utf8");
  const unknownShapeVault = createProviderVault({
    userDataDirectory: unknownShapeRoot,
    safeStorage: new FakeSafeStorage(),
    platform: "darwin"
  });
  await assert.rejects(() => unknownShapeVault.getConfiguredState(), ProviderVaultCorruptError);

  const corruptCiphertextRoot = await tempRoot("corrupt-ciphertext");
  const corruptCiphertextDirectory = join(corruptCiphertextRoot, "provider-vault");
  await mkdir(corruptCiphertextDirectory, { recursive: true });
  await writeFile(join(corruptCiphertextDirectory, "providers.json"), JSON.stringify({
    schemaVersion: 1,
    apiCredentials: { openai: "not-base64!" },
    enabledCliProviders: ["codex-cli", "codex-cli"]
  }), "utf8");
  const corruptCiphertextVault = createProviderVault({
    userDataDirectory: corruptCiphertextRoot,
    safeStorage: new FakeSafeStorage(),
    platform: "darwin"
  });
  await assert.rejects(
    () => corruptCiphertextVault.getConfiguredState(),
    ProviderVaultCorruptError
  );

  assert.throws(
    () => createProviderVault({
      userDataDirectory: " ",
      safeStorage: new FakeSafeStorage(),
      platform: "darwin"
    }),
    /userData directory/
  );

  console.log("desktop provider vault probes: passed");
} finally {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
}
