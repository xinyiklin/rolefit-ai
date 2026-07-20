import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ROLEFIT_LOCAL_SITE_PORT,
  createDesktopSettingsManager,
  probeLocalSitePortAvailability,
  validateLocalSitePort
} from "../../dist-electron/desktop/desktop-settings.cjs";

function listenOnRandomLoopbackPort() {
  return new Promise((resolveListen, rejectListen) => {
    const server = createServer();
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolveListen({ server, port: address.port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

assert.equal(validateLocalSitePort(1), 1);
assert.equal(validateLocalSitePort(65_535), 65_535);
for (const invalid of [0, 65_536, 5_181.5, "5181", null]) {
  assert.throws(() => validateLocalSitePort(invalid), /integer from 1 through 65535/);
}

const occupied = await listenOnRandomLoopbackPort();
try {
  assert.equal(await probeLocalSitePortAvailability(occupied.port), false);
} finally {
  await closeServer(occupied.server);
}
assert.equal(await probeLocalSitePortAvailability(occupied.port), true);
await assert.rejects(
  probeLocalSitePortAvailability(5_181, "0.0.0.0"),
  /numeric loopback/
);

const tempRoot = await mkdtemp(join(tmpdir(), "rolefit-desktop-settings-"));
const settingsDirectory = join(tempRoot, "desktop-settings");
const settingsPath = join(settingsDirectory, "settings.json");
try {
  let portAvailable = true;
  const probedPorts = [];
  const manager = createDesktopSettingsManager({
    userDataDirectory: tempRoot,
    platform: process.platform,
    isPortAvailable: async (port) => {
      probedPorts.push(port);
      return portAvailable;
    }
  });

  const defaults = await manager.load();
  assert.deepEqual(defaults, {
    schemaVersion: 1,
    localSitePort: DEFAULT_ROLEFIT_LOCAL_SITE_PORT,
    source: "default",
    locked: false,
    warning: null
  });
  assert.equal(Object.isFrozen(defaults), true);

  await assert.rejects(manager.saveLocalSitePort(0), /integer from 1 through 65535/);
  assert.deepEqual(probedPorts, []);

  portAvailable = false;
  const unavailable = await manager.saveLocalSitePort(5_191).catch((error) => error);
  assert.equal(unavailable.code, "ROLEFIT_DESKTOP_PORT_UNAVAILABLE");
  assert.match(unavailable.message, /already in use/);
  await assert.rejects(readFile(settingsPath, "utf8"), { code: "ENOENT" });

  portAvailable = true;
  const saved = await manager.saveLocalSitePort(5_191);
  assert.deepEqual(saved, {
    schemaVersion: 1,
    localSitePort: 5_191,
    source: "saved",
    locked: false,
    warning: null
  });
  assert.equal(Object.isFrozen(saved), true);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    schemaVersion: 1,
    localSitePort: 5_191
  });
  assert.doesNotMatch(await readFile(settingsPath, "utf8"), /workspace|api|key|secret/i);
  assert.deepEqual(
    (await readdir(settingsDirectory)).filter((name) => name.endsWith(".tmp")),
    []
  );
  if (process.platform !== "win32") {
    assert.equal((await stat(settingsPath)).mode & 0o777, 0o600);
    assert.equal((await stat(settingsDirectory)).mode & 0o777, 0o700);
  }

  const reloaded = await createDesktopSettingsManager({
    userDataDirectory: tempRoot,
    platform: process.platform,
    isPortAvailable: async () => true
  }).load();
  assert.deepEqual(reloaded, saved);

  const environmentOverride = createDesktopSettingsManager({
    userDataDirectory: tempRoot,
    environmentPort: "5192",
    isPortAvailable: async () => true
  });
  assert.deepEqual(await environmentOverride.load(), {
    schemaVersion: 1,
    localSitePort: 5_192,
    source: "environment",
    locked: true,
    warning: null
  });
  const locked = await environmentOverride.saveLocalSitePort(5_193).catch((error) => error);
  assert.equal(locked.code, "ROLEFIT_DESKTOP_SETTINGS_LOCKED");
  assert.match(locked.message, /ROLEFIT_DESKTOP_PORT/);
  assert.equal(JSON.parse(await readFile(settingsPath, "utf8")).localSitePort, 5_191);

  await assert.rejects(
    createDesktopSettingsManager({
      userDataDirectory: tempRoot,
      environmentPort: "not-a-port"
    }).load(),
    /ROLEFIT_DESKTOP_PORT must be an integer/
  );

  const malformedDocuments = [
    "{not-json",
    JSON.stringify({ schemaVersion: 2, localSitePort: 5_194 }),
    JSON.stringify({ schemaVersion: 1, localSitePort: 0 }),
    JSON.stringify({ schemaVersion: 1, localSitePort: 5_194, workspaceDir: "/private" })
  ];
  for (const document of malformedDocuments) {
    await writeFile(settingsPath, document, "utf8");
    const fallback = await manager.load();
    assert.deepEqual(fallback, {
      schemaVersion: 1,
      localSitePort: DEFAULT_ROLEFIT_LOCAL_SITE_PORT,
      source: "default",
      locked: false,
      warning: "saved-settings-invalid"
    });
  }

  await manager.saveLocalSitePort(5_195);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    schemaVersion: 1,
    localSitePort: 5_195
  });

  await mkdir(join(tempRoot, "queued", "desktop-settings"), { recursive: true });
  const queuedManager = createDesktopSettingsManager({
    userDataDirectory: join(tempRoot, "queued"),
    isPortAvailable: async () => true
  });
  const [firstSave, secondSave] = await Promise.all([
    queuedManager.saveLocalSitePort(5_196),
    queuedManager.saveLocalSitePort(5_197)
  ]);
  assert.equal(firstSave.localSitePort, 5_196);
  assert.equal(secondSave.localSitePort, 5_197);
  assert.equal(
    JSON.parse(await readFile(join(tempRoot, "queued", "desktop-settings", "settings.json"), "utf8")).localSitePort,
    5_197
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("desktop local-site settings probes: passed");
