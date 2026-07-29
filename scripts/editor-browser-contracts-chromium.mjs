import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.ROLEFIT_EDITOR_BROWSER_CONTRACT_URL;
if (!baseUrl) throw new Error("Missing browser contract URL.");

const windows = new Set();
const pageErrors = [];

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (
        message.method === "Runtime.exceptionThrown" ||
        (message.method === "Runtime.consoleAPICalled" &&
          message.params?.type === "error")
      ) {
        pageErrors.push(
          message.params?.exceptionDetails?.text ??
            message.params?.args?.map((arg) => arg.value ?? arg.description).join(" ") ??
            message.method
        );
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpConnection(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {})
      })
    );
    return result;
  }

  close() {
    this.socket.close();
  }
}

class ChromiumPage {
  constructor(connection, targetId, sessionId) {
    this.connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.webContents = {
      executeJavaScript: (expression) => this.evaluate(expression)
    };
  }

  async evaluate(expression) {
    const result = await this.connection.send(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true
      },
      this.sessionId
    );
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
      );
    }
    return result.result?.value;
  }

  async loadURL(url) {
    await this.connection.send(
      "Page.navigate",
      { url },
      this.sessionId
    );
    await waitFor(
      this,
      'document.readyState === "complete"',
      `page load ${url}`
    );
  }

  async destroy() {
    windows.delete(this);
    await this.connection.send("Target.closeTarget", {
      targetId: this.targetId
    });
  }
}

let browserConnection;

async function chromiumExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next platform path.
    }
  }
  throw new Error(
    "No Chrome/Chromium executable found. Set CHROME_PATH to run browser contracts."
  );
}

async function launchChromium() {
  const executable = await chromiumExecutable();
  const profileDir = await mkdtemp(
    join(tmpdir(), "rolefit-editor-browser-")
  );
  const child = spawn(
    executable,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      "about:blank"
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  const websocketUrl = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out starting Chromium.${
              output ? `\n${output.slice(-2000)}` : ""
            }`
          )
        ),
      15_000
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Chromium exited before DevTools was ready (${code}).${
            output ? `\n${output.slice(-2000)}` : ""
          }`
        )
      );
    });
  });
  return { child, profileDir, websocketUrl };
}

async function makeWindow() {
  const { targetId } = await browserConnection.send("Target.createTarget", {
    url: "about:blank"
  });
  const { sessionId } = await browserConnection.send(
    "Target.attachToTarget",
    { targetId, flatten: true }
  );
  await Promise.all([
    browserConnection.send("Page.enable", {}, sessionId),
    browserConnection.send("Runtime.enable", {}, sessionId)
  ]);
  const page = new ChromiumPage(browserConnection, targetId, sessionId);
  windows.add(page);
  return page;
}

async function waitFor(win, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  })()`);
  assert.equal(clicked, true, `expected clickable ${selector}`);
}

async function setInput(win, selector, value) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  assert.equal(changed, true, `expected editable ${selector}`);
}

async function runEditorContracts() {
  const win = await makeWindow();
  await win.loadURL(baseUrl);
  await waitFor(
    win,
    "window.__editorContract?.data?.header",
    "editor fixture"
  );

  await click(win, 'button[aria-label="Header"]');
  await waitFor(
    win,
    'document.querySelector(\'input[aria-label="Header name"]\')',
    "open header popover"
  );
  await setInput(win, 'input[aria-label="Header name"]', "Jane Roe");
  await waitFor(
    win,
    'window.__editorContract?.data?.header?.name === "<b>Jane</b> R<i>oe</i>"',
    "mark-aware header edit"
  );

  await click(win, '[data-testid="undo"]');
  await waitFor(
    win,
    'window.__editorContract?.data?.header?.name === "<b>Jane</b> <i>Doe</i>"',
    "header undo"
  );

  await setInput(
    win,
    'input[aria-label="Contact item 1"]',
    "jane@example.com · New York City"
  );
  await waitFor(
    win,
    `window.__editorContract?.data?.header?.contact?.[0] ===
      "<link=mailto%3Ajane%40example.com>jane@example.com</link> · <i>New York City</i>"`,
    "contact edit with preserved link and marks"
  );

  await win.webContents.executeJavaScript(
    'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))'
  );
  await waitFor(
    win,
    'document.activeElement?.getAttribute("aria-label") === "Header"',
    "popover focus restoration"
  );

  await click(win, 'button[aria-label="Header"]');
  await waitFor(
    win,
    'document.querySelector(\'input[type="range"]\')',
    "header spacing sliders"
  );
  const spacingBefore = await win.webContents.executeJavaScript(
    "window.__editorContract.spacing.nameContactGapPt"
  );
  await win.webContents.executeJavaScript(
    "window.__editorContract.setDisabled(true)"
  );
  await waitFor(
    win,
    '[...document.querySelectorAll(\'input[type="range"]\')].every((input) => input.disabled)',
    "disabled open spacing controls"
  );
  const rangePoint = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[type="range"]');
    const rect = input.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await browserConnection.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: rangePoint.x,
      y: rangePoint.y,
      button: "left",
      clickCount: 1
    },
    win.sessionId
  );
  await browserConnection.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: rangePoint.x,
      y: rangePoint.y,
      button: "left",
      clickCount: 1
    },
    win.sessionId
  );
  await browserConnection.send(
    "Input.dispatchKeyEvent",
    {
      type: "keyDown",
      key: "ArrowRight",
      code: "ArrowRight",
      windowsVirtualKeyCode: 39
    },
    win.sessionId
  );
  await browserConnection.send(
    "Input.dispatchKeyEvent",
    {
      type: "keyUp",
      key: "ArrowRight",
      code: "ArrowRight",
      windowsVirtualKeyCode: 39
    },
    win.sessionId
  );
  const spacingAfter = await win.webContents.executeJavaScript(
    "window.__editorContract.spacing.nameContactGapPt"
  );
  assert.equal(
    spacingAfter,
    spacingBefore,
    "disabled range input must not mutate style"
  );

  await win.webContents.executeJavaScript(`(() => {
    const richItem = {
      types: ["text/html", "text/plain"],
      getType: async (type) =>
        new Blob([
          type === "text/html"
            ? '<p><strong>Rich</strong> <a href="https://example.com">link</a></p>'
            : "Rich link"
        ], { type })
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: async () => [richItem],
        readText: async () => "Rich link"
      }
    });
  })()`);
  await win.webContents.executeJavaScript(
    "window.__editorContract.pasteAsDocument()"
  );
  await waitFor(
    win,
    'document.querySelector(\'[role="dialog"][aria-labelledby="ts-document-paste-title"]\')',
    "document paste dialog"
  );
  const replaced = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Replace document"
    );
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(replaced, true, "expected document paste confirmation");
  await waitFor(
    win,
    `window.__editorContract?.data?.sections?.[0]?.items?.[0]?.bullets?.[0]?.text ===
      "<b>Rich</b> <link=https%3A%2F%2Fexample.com%2F>link</link>"`,
    "single-block rich document paste"
  );

  await win.destroy();
}

async function runTypesetSaveContract() {
  const win = await makeWindow();
  await win.loadURL(`${baseUrl}#typeset`);
  await waitFor(
    win,
    'document.querySelector(\'button[aria-label="Save resume file"]\')',
    "Typeset app"
  );
  await waitFor(
    win,
    'document.querySelector(\'[role="status"]\')?.textContent?.includes("Saved locally")',
    "initial Typeset autosave"
  );

  await click(win, 'button[aria-label="Spacing"]');
  await waitFor(
    win,
    'document.querySelector(\'[aria-label="Document spacing"] input[type="range"]\')',
    "Typeset spacing popover"
  );
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(
      '[aria-label="Document spacing"] input[type="range"]'
    );
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, String(Math.min(Number(input.max), Number(input.value) + Number(input.step))));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const dirtyPrevented = await win.webContents.executeJavaScript(`(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  assert.equal(
    dirtyPrevented,
    true,
    "style-only Typeset changes must arm beforeunload"
  );

  await click(win, 'button[aria-label="Save resume file"]');
  await waitFor(
    win,
    'document.querySelector(\'[role="status"]\')?.textContent?.includes("Saved")',
    "explicit Typeset save"
  );
  const cleanPrevented = await win.webContents.executeJavaScript(`(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  assert.equal(
    cleanPrevented,
    false,
    "explicit Typeset save must clear content and style dirty state"
  );

  await win.destroy();
}

async function runRecoveryContracts() {
  const sibling = await makeWindow();
  const adopter = await makeWindow();
  await Promise.all([
    sibling.loadURL(`${baseUrl}#recovery`),
    adopter.loadURL(`${baseUrl}#recovery`)
  ]);
  await Promise.all([
    waitFor(sibling, "window.__recoveryContract", "sibling recovery fixture"),
    waitFor(adopter, "window.__recoveryContract", "adopter recovery fixture")
  ]);

  const siblingId = await sibling.webContents.executeJavaScript(
    "window.__recoveryContract.publish()"
  );
  const adopterId = await adopter.webContents.executeJavaScript(
    "window.__recoveryContract.publish()"
  );
  assert.notEqual(siblingId, adopterId, "browser tabs need distinct owners");
  const saved = await sibling.webContents.executeJavaScript(
    "window.__recoveryContract.saveResumeDraft()"
  );
  assert.ok(saved.value, "the sibling draft should be stored");

  await adopter.webContents.executeJavaScript(
    "window.__recoveryContract.adopt()"
  );
  const preserved = await adopter.webContents.executeJavaScript(
    `window.__recoveryContract.read(${JSON.stringify(saved.key)})`
  );
  assert.equal(
    preserved,
    saved.value,
    "workspace adoption must preserve a live sibling draft"
  );
  await waitFor(
    sibling,
    "window.__recoveryContract.adoptionCount() > 0",
    "cross-tab restore adoption event"
  );

  await sibling.destroy();
  await adopter.destroy();
}

let chromium;
try {
  console.log("Chromium contracts: starting headless Chrome");
  chromium = await launchChromium();
  browserConnection = await CdpConnection.connect(chromium.websocketUrl);
  await browserConnection.send("Browser.setDownloadBehavior", {
    behavior: "deny"
  });
  console.log("Chromium contracts: editor behaviors");
  await runEditorContracts();
  console.log("Chromium contracts: Typeset save lifecycle");
  await runTypesetSaveContract();
  console.log("Chromium contracts: two-tab recovery");
  await runRecoveryContracts();
  assert.deepEqual(pageErrors, [], "browser pages must not report console/load errors");
  console.log(
    "editor Chromium contracts passed: header marks/undo, disabled controls, focus, rich paste, Typeset dirty baseline, two-tab restore"
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([...windows].map((win) => win.destroy()));
  browserConnection?.close();
  if (chromium?.child.exitCode === null) {
    chromium.child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => chromium.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000))
    ]);
  }
  if (chromium?.profileDir) {
    await rm(chromium.profileDir, { recursive: true, force: true });
  }
}
