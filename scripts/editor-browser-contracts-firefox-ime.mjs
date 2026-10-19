// Opt-in Firefox IME contract: trusted composition through Firefox's own
// nsITextInputProcessor must edit and paint the document exactly as typing the
// same text does, for the caret and selection cases of the Chromium contract
// (`editor-browser-contracts/wrapped-row-ime.mjs`), in both hosts.
//
// Usage: ROLEFIT_FIREFOX_BINARY=/path/to/firefox npm run test:editor:firefox-ime
//
// Use a Firefox build without a staged update, such as Playwright's
// (`npx playwright install firefox`): an installed Firefox applies a staged
// update before it starts, and its updater then waits on the running browser.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const firefoxBinary = process.env.ROLEFIT_FIREFOX_BINARY;
if (!firefoxBinary) {
  console.error("Set ROLEFIT_FIREFOX_BINARY to a Firefox executable without a staged update.");
  process.exit(2);
}

// Marionette frames are `<byte length>:<json>`; commands are [0, id, name,
// params] and replies [1, id, error, result].
class Marionette {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.id = 0;
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on("close", () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error("Firefox closed the Marionette connection."));
      this.pending.clear();
    });
  }
  drain() {
    for (;;) {
      const colon = this.buffer.indexOf(":");
      if (colon < 0) return;
      const length = Number(this.buffer.subarray(0, colon).toString());
      if (this.buffer.length < colon + 1 + length) return;
      const message = JSON.parse(this.buffer.subarray(colon + 1, colon + 1 + length).toString("utf8"));
      this.buffer = this.buffer.subarray(colon + 1 + length);
      if (!Array.isArray(message)) continue; // the connection handshake
      const [, id, error, result] = message;
      const waiter = this.pending.get(id);
      this.pending.delete(id);
      if (error) waiter?.reject(new Error(`${error.error}: ${error.message}`));
      else waiter?.resolve(result);
    }
  }
  send(command, params = {}) {
    const id = ++this.id;
    const body = Buffer.from(JSON.stringify([0, id, command, params]));
    this.socket.write(Buffer.concat([Buffer.from(`${body.length}:`), body]));
    return new Promise((resolveReply, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Marionette ${command} timed out.`));
      }, 60_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolveReply(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
    });
  }
}

// Port 0 lets Firefox pick a free port; it writes the one it bound into the
// profile, so the client never reaches an unrelated listener.
async function connect(profile, exited) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (exited.code !== undefined) throw new Error(`Firefox exited early (${exited.code}).`);
    const port = Number(await readFile(join(profile, "MarionetteActivePort"), "utf8").catch(() => ""));
    if (port) {
      const socket = await new Promise((resolveSocket) => {
        const candidate = net.connect(port, "127.0.0.1", () => resolveSocket(candidate));
        candidate.once("error", () => resolveSocket(null));
      });
      if (socket) return new Marionette(socket);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Firefox Marionette did not start within 60 seconds.");
}

async function stopFirefox(firefox, exited) {
  if (!firefox?.pid || exited.code !== undefined) return;
  const gone = new Promise((resolveExit) => firefox.once("close", resolveExit));
  firefox.kill("SIGTERM");
  const timer = setTimeout(() => firefox.kill("SIGKILL"), 5_000);
  await gone;
  clearTimeout(timer);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root: join(repoRoot, "scripts", "editor-browser-contracts"),
  publicDir: join(repoRoot, "packages", "engine"),
  plugins: [react()],
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: false, fs: { allow: [repoRoot] } }
});
const profile = await mkdtemp(join(tmpdir(), "rolefit-firefox-ime-"));
const exited = {};
let firefox;
let client;
try {
  await server.listen();
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
  await writeFile(join(profile, "user.js"), `user_pref("marionette.port", 0);\n`);
  firefox = spawn(firefoxBinary, ["-headless", "-no-remote", "-new-instance", "-profile", profile, "--marionette", "-remote-allow-system-access"], { stdio: "ignore" });
  const started = new Promise((resolveStart, reject) => {
    firefox.once("spawn", resolveStart);
    firefox.once("error", reject);
  });
  firefox.once("exit", (code, signal) => { exited.code = code ?? signal; });
  await started;
  client = await connect(profile, exited);
  const session = await client.send("WebDriver:NewSession", { capabilities: { alwaysMatch: {} } });
  const content = async (script, args = []) => (await client.send("WebDriver:ExecuteScript", { script, args })).value;
  const settle = () => client.send("WebDriver:ExecuteAsyncScript", {
    script: "const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => done(true)));",
    args: []
  });
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (await content(`return Boolean(${expression});`)) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };
  // Trusted input from the parent process, dispatched to the focused page the
  // way a native IME or keyboard delivers it.
  const input = async (mode, text) => {
    await client.send("Marionette:SetContext", { value: "chrome" });
    try {
      await client.send("WebDriver:ExecuteScript", {
        args: [mode, text],
        script: `
          const [mode, text] = arguments;
          const win = Services.wm.getMostRecentWindow("navigator:browser");
          const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
          if (!tip.beginInputTransactionForTests(win)) throw new Error("Firefox refused the input transaction.");
          if (mode === "type") {
            for (const key of text) {
              const event = new win.KeyboardEvent("", { key });
              tip.keydown(event);
              tip.keyup(event);
            }
            return;
          }
          for (let length = 1; length <= text.length; length += 1) {
            tip.setPendingCompositionString(text.slice(0, length));
            tip.appendClauseToPendingComposition(length, tip.ATTR_RAW_CLAUSE);
            tip.setCaretInPendingComposition(length);
            tip.flushPendingComposition();
          }
          tip.commitComposition();`
      });
    } finally {
      await client.send("Marionette:SetContext", { value: "content" });
    }
    await settle();
    await settle();
  };

  let passed = 0;
  for (const host of ["typeset", "rolefit"]) {
    await client.send("WebDriver:SetWindowRect", { width: 1400, height: 1000 });
    // The harness reads its hash once, so each host gets its own document.
    await client.send("WebDriver:Navigate", { url: `${baseUrl}?host=${host}#entry-rows-${host}` });
    await waitFor(`document.querySelector('[data-row-host="${host}"]') && window.__rowContract?.data.sections[0]?.id === "section" && document.querySelector("[contenteditable] [data-tsdf*=titleRight]")`, `${host} fixture`);
    const fixture = await content("return window.__rowContract.data;");
    Object.assign(fixture.sections[0].items[0], {
      titleLeft: "Left heading words ".repeat(35),
      titleRight: "Right heading words ".repeat(24),
      subtitleLeft: "Company",
      subtitleRight: "Remote"
    });
    const key = (field) => `entry|section|entry|${field}`;
    const reset = async () => {
      await content("window.__rowContract.reset(arguments[0]);", [fixture]);
      await settle();
      await waitFor(`document.querySelector('[contenteditable=true] .tsd-page') && !document.querySelector('.preview-overlay__loading')`, `${host} pages`);
      await settle();
    };
    const select = async (field, start, end = start, endField = field) => {
      await content("document.querySelector('[contenteditable=true]').focus(); window.__rowContract.select(...arguments);", [key(field), start, key(endField), end]);
      await settle();
    };
    const entry = () => content("return window.__rowContract.data.sections[0].items[0];");
    const paint = () => content(`const text = key => [...document.querySelectorAll('[contenteditable=true] [data-tsdf="' + key + '"]:not([data-tsdm])')].map(span => span.textContent).join('');
      return { titleLeft: text(arguments[0]), titleRight: text(arguments[1]) };`, [key("titleLeft"), key("titleRight")]);
    await content(`window.__imeEvents = { start: 0, end: 0 };
      for (const type of ['compositionstart', 'compositionend']) document.addEventListener(type, event => {
        if (event.isTrusted) window.__imeEvents[type === 'compositionstart' ? 'start' : 'end'] += 1;
      }, true);`);
    const cases = [
      ["caret", () => select("titleLeft", 120)],
      ["same-field selection", () => select("titleLeft", 5, 140)],
      ["same-field backward selection", () => select("titleLeft", 140, 5)],
      ["cross-field selection", () => select("titleLeft", 140, 5, "titleRight")],
      ["cross-field backward selection", () => select("titleRight", 5, 140, "titleLeft")]
    ];
    for (const [label, choose] of cases) {
      await reset();
      await choose();
      await input("type", "かな");
      const typed = await entry();
      const typedPaint = await paint();
      assert.notDeepEqual(typed, fixture.sections[0].items[0], `${host} ${label}: typing edits the document`);
      await reset();
      await choose();
      await content("window.__imeEvents = { start: 0, end: 0 };");
      await input("compose", "かな");
      const events = await content("return window.__imeEvents;");
      const composed = await entry();
      const detail = JSON.stringify({ typed: [typed.titleLeft.length, typed.titleRight.length], composed: [composed.titleLeft.length, composed.titleRight.length] });
      assert.deepEqual(events, { start: 1, end: 1 }, `${host} ${label}: Firefox composed with trusted events`);
      assert.equal(composed.titleLeft, typed.titleLeft, `${host} ${label}: composition edits the left field as typing does ${detail}`);
      assert.equal(composed.titleRight, typed.titleRight, `${host} ${label}: composition edits the right field as typing does ${detail}`);
      assert.deepEqual(await paint(), typedPaint, `${host} ${label}: the page paints the composed document ${detail}`);
      passed += 1;
    }
  }
  console.log(`Firefox ${session.capabilities.browserVersion} IME: ${passed} caret/selection cases compose exactly as typing in Typeset and RoleFit.`);
  await client.send("WebDriver:DeleteSession").catch(() => {});
} finally {
  // Each step runs even if an earlier one fails, so a failure never leaks a
  // browser, the server, or the profile, and never hides the real error.
  client?.socket.destroy();
  await stopFirefox(firefox, exited).catch((error) => console.error(`Firefox did not stop: ${error.message}`));
  await server.close().catch((error) => console.error(`Server did not close: ${error.message}`));
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch((error) => console.error(`Profile not removed: ${error.message}`));
}
