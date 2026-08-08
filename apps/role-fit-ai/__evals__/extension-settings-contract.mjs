import assert from "node:assert/strict";

const settingsUrl = new URL("../extension/settings.js", import.meta.url);
const store = Object.create(null);
const calls = [];
let storageError = null;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function finish(callback, value) {
  queueMicrotask(() => {
    globalThis.chrome.runtime.lastError = storageError;
    try {
      callback(value);
    } finally {
      globalThis.chrome.runtime.lastError = undefined;
    }
  });
}

globalThis.chrome = {
  runtime: { lastError: undefined },
  storage: {
    local: {
      get(key, callback) {
        calls.push(["get", key]);
        finish(
          callback,
          Object.prototype.hasOwnProperty.call(store, key)
            ? { [key]: clone(store[key]) }
            : {}
        );
      },
      set(items, callback) {
        calls.push(["set", clone(items)]);
        if (!storageError) {
          for (const [key, value] of Object.entries(items)) store[key] = clone(value);
        }
        finish(callback);
      },
      remove(keys, callback) {
        calls.push(["remove", [...keys]]);
        if (!storageError) {
          for (const key of keys) delete store[key];
        }
        finish(callback);
      }
    }
  }
};

const {
  clearShortcutNotice,
  createLocalSiteOrigin,
  loadExtensionSettings,
  readShortcutNotice,
  resetExtensionSettings,
  saveExtensionPort,
  saveShortcutNotice,
  validateLocalSitePort
} = await import(settingsUrl);

assert.equal(validateLocalSitePort("1"), 1);
assert.equal(validateLocalSitePort("065535"), 65_535);
assert.equal(validateLocalSitePort(5_181), 5_181);
for (const invalid of [
  "",
  " ",
  " 5181",
  "5181 ",
  "http://localhost:5181",
  "localhost:5181",
  "5181/path",
  "https://5181",
  "5181?query=1",
  "5181\n",
  0,
  65_536,
  5_181.5,
  null,
  undefined
]) {
  assert.throws(
    () => validateLocalSitePort(invalid),
    /digits only|integer from 1 through 65535/
  );
}
assert.equal(createLocalSiteOrigin("5181"), "http://localhost:5181");
assert.throws(() => createLocalSiteOrigin("https://localhost:5181"));

globalThis.ROLEFIT_EXTENSION_RUNTIME_CONFIG = {
  schemaVersion: 1,
  localSitePort: 5_191
};
calls.length = 0;
assert.deepEqual(await loadExtensionSettings(), {
  schemaVersion: 1,
  localSitePort: 5_191
});
assert.deepEqual({ ...store }, {
  rolefitExtensionSettings: { schemaVersion: 1, localSitePort: 5_191 }
});
assert.deepEqual(calls.map(([operation]) => operation), ["get", "set"]);

store.rolefitExtensionSettings = { schemaVersion: 1, localSitePort: 5_299 };
globalThis.ROLEFIT_EXTENSION_RUNTIME_CONFIG = {
  schemaVersion: 1,
  localSitePort: 5_181
};
calls.length = 0;
assert.deepEqual(await loadExtensionSettings(), {
  schemaVersion: 1,
  localSitePort: 5_299
});
assert.deepEqual(calls.map(([operation]) => operation), ["get"]);

store.rolefitExtensionSettings = { schemaVersion: 2, localSitePort: 5_299 };
globalThis.ROLEFIT_EXTENSION_RUNTIME_CONFIG = {
  schemaVersion: 1,
  localSitePort: 5_181
};
calls.length = 0;
await assert.rejects(loadExtensionSettings(), /Saved RoleFit extension settings are invalid/);
assert.deepEqual(store.rolefitExtensionSettings, {
  schemaVersion: 2,
  localSitePort: 5_299
});
assert.deepEqual(calls.map(([operation]) => operation), ["get"]);

delete store.rolefitExtensionSettings;
globalThis.ROLEFIT_EXTENSION_RUNTIME_CONFIG = {
  schemaVersion: 1,
  localSitePort: "http://localhost:5 299"
};
await assert.rejects(loadExtensionSettings(), /install configuration is invalid/);
assert.equal(store.rolefitExtensionSettings, undefined);

globalThis.ROLEFIT_EXTENSION_RUNTIME_CONFIG = {
  schemaVersion: 1,
  localSitePort: 5_181
};
assert.deepEqual(await loadExtensionSettings(), {
  schemaVersion: 1,
  localSitePort: 5_181
});

await assert.rejects(saveExtensionPort("5 200"), /digits only/);
await assert.rejects(saveExtensionPort("5_200"), /digits only/);
assert.deepEqual(await saveExtensionPort("5200"), {
  schemaVersion: 1,
  localSitePort: 5_200
});
assert.deepEqual(await resetExtensionSettings(), {
  schemaVersion: 1,
  localSitePort: 5_181
});

storageError = { message: "quota exceeded" };
await assert.rejects(saveExtensionPort("5201"), /quota exceeded/);
storageError = null;
assert.deepEqual(await loadExtensionSettings(), {
  schemaVersion: 1,
  localSitePort: 5_181
});

// ── Keyboard-import notice ─────────────────────────────────────────────────
// The notice is a separate record: a headless failure must never make the port
// settings unreadable, and a stale notice must never resurface as current.

const now = 1_700_000_000_000;
await saveShortcutNotice("  Approve this extension in the RoleFit companion.  ", now);
assert.deepEqual(store.rolefitShortcutNotice, {
  schemaVersion: 1,
  message: "Approve this extension in the RoleFit companion.",
  at: now
});
assert.equal(await readShortcutNotice(now), "Approve this extension in the RoleFit companion.");
assert.equal(await readShortcutNotice(now + 1_000), "Approve this extension in the RoleFit companion.");

// Expired, future-dated, and malformed records all read as "no notice".
assert.equal(await readShortcutNotice(now + 15 * 60 * 1000 + 1), null);
assert.equal(await readShortcutNotice(now - 1), null);
for (const invalid of [
  { schemaVersion: 2, message: "x", at: now },
  { schemaVersion: 1, message: "   ", at: now },
  { schemaVersion: 1, message: 4, at: now },
  { schemaVersion: 1, message: "x", at: "now" },
  "plain string",
  null
]) {
  store.rolefitShortcutNotice = invalid;
  assert.equal(await readShortcutNotice(now), null);
}

// An oversized message is bounded rather than rejected.
await saveShortcutNotice("y".repeat(400), now);
assert.equal(store.rolefitShortcutNotice.message.length, 240);

// An empty message clears rather than storing a blank notice.
await saveShortcutNotice("   ", now);
assert.equal(store.rolefitShortcutNotice, undefined);

await saveShortcutNotice("cleared later", now);
await clearShortcutNotice();
assert.equal(store.rolefitShortcutNotice, undefined);
assert.equal(await readShortcutNotice(now), null);

// A storage failure while reading the notice resolves to null; the port record
// must stay loadable through the same failure.
await saveShortcutNotice("stored before the failure", now);
storageError = { message: "storage offline" };
assert.equal(await readShortcutNotice(now), null);
storageError = null;
assert.deepEqual(await loadExtensionSettings(), { schemaVersion: 1, localSitePort: 5_181 });

console.log("Extension settings contract eval: PASS");
