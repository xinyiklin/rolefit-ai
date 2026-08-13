import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.ROLEFIT_EDITOR_BROWSER_CONTRACT_URL;
if (!baseUrl) throw new Error("Missing browser contract URL.");
const strictResumeText = await readFile(
  new URL("../apps/role-fit-ai/server/starter.resume", import.meta.url),
  "utf8"
);

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
  await setInput(
    win,
    'input[aria-label="Contact item 1"]',
    "john@example.com · New York City"
  );
  await waitFor(
    win,
    `window.__editorContract?.data?.header?.contact?.[0] ===
      "<link=mailto%3Ajohn%40example.com>john@example.com</link> · <i>New York City</i>"`,
    "contact edit with recalculated email destination"
  );
  await click(win, '[data-testid="undo"]');
  await waitFor(
    win,
    `window.__editorContract?.data?.header?.contact?.[0] ===
      "<link=mailto%3Ajane%40example.com>jane@example.com</link> · <i>New York City</i>"`,
    "contact undo restores visible text and destination"
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
    'document.querySelector(\'button[aria-label="Save"]\')',
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

  await click(win, 'button[aria-label="Save"]');
  await waitFor(
    win,
    'document.querySelector(\'[role="dialog"][aria-label="Save options"]\')',
    "Typeset save menu"
  );
  const savedResume = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(
      '[role="dialog"][aria-label="Save options"] button'
    )].find((candidate) =>
      candidate.querySelector("strong")?.textContent?.trim() === "Save .resume"
    );
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(savedResume, true, "expected the editable resume save action");
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
    "window.__recoveryContract.adoptionCount() === 1",
    "cross-tab restore adoption event"
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    await sibling.webContents.executeJavaScript(
      "window.__recoveryContract.adoptionCount()"
    ),
    1,
    "storage and BroadcastChannel delivery must invoke one logical adoption once"
  );

  await sibling.destroy();
  await adopter.destroy();
}

function workspacePayload(fileName) {
  return {
    path: `/workspace/${fileName}`,
    baseResume: {
      exists: true,
      fileName,
      kind: "resume",
      text: strictResumeText
    },
    baseResumeOptions: [],
    baseResumeHistory: [],
    files: [fileName]
  };
}

async function runWorkspaceResumeContracts() {
  const win = await makeWindow();
  await win.loadURL(`${baseUrl}#workspace-resume`);
  await waitFor(
    win,
    "window.__workspaceResumeContract",
    "workspace resume hook fixture"
  );

  await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.makeStyleDirty()"
  );
  await waitFor(
    win,
    "window.__workspaceResumeContract.snapshot().dirty === true",
    "style-only resume dirty state"
  );
  await win.webContents.executeJavaScript(`(() => {
    window.__workspaceResumeContract.resetStats();
    window.__workspaceResumeContract.setConfirmAllowed(false);
  })()`);
  const starter = await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.startLoadStarter()"
  );
  await win.webContents.executeJavaScript(
    `window.__workspaceResumeContract.resolveRequest(
      ${starter.requestId},
      ${JSON.stringify({
        ...workspacePayload("default.resume"),
        starterResume: {
          exists: true,
          fileName: "starter.resume",
          kind: "resume",
          text: strictResumeText
        }
      })}
    )`
  );
  await win.webContents.executeJavaScript(
    `window.__workspaceResumeContract.waitTask(${starter.taskId})`
  );
  let snapshot = await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.snapshot()"
  );
  assert.equal(snapshot.confirmCount, 1, "style-only starter replacement must confirm");
  assert.equal(snapshot.appliedCount, 0, "declining starter replacement preserves style edits");
  assert.equal(snapshot.recoveryCommitCount, 0, "declined starter replacement keeps recovery");

  await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.markClean()"
  );
  await waitFor(
    win,
    "window.__workspaceResumeContract.snapshot().dirty === false",
    "clean reset before upload"
  );
  await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.makeStyleDirty()"
  );
  await waitFor(
    win,
    "window.__workspaceResumeContract.snapshot().dirty === true",
    "style-only upload dirty state"
  );
  await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.resetStats()"
  );
  const upload = await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.startResumeUpload()"
  );
  await win.webContents.executeJavaScript(
    `window.__workspaceResumeContract.waitTask(${upload.taskId})`
  );
  snapshot = await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.snapshot()"
  );
  assert.equal(snapshot.confirmCount, 1, "style-only upload replacement must confirm");
  assert.equal(snapshot.appliedCount, 0, "declining upload replacement preserves style edits");
  assert.equal(snapshot.uploadInputValue, "", "a declined upload can be selected again");

  await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.markClean()"
  );
  await waitFor(
    win,
    "window.__workspaceResumeContract.snapshot().dirty === false",
    "clean reset before delayed workspace fetch"
  );
  await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.resetStats()"
  );
  const delayed = await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.startLoadWorkspace(true)"
  );
  await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.makeContentDirty()"
  );
  await waitFor(
    win,
    "window.__workspaceResumeContract.snapshot().dirty === true",
    "edit begun during workspace fetch"
  );
  await win.webContents.executeJavaScript(
    `window.__workspaceResumeContract.resolveRequest(
      ${delayed.requestId},
      ${JSON.stringify(workspacePayload("delayed.resume"))}
    )`
  );
  await win.webContents.executeJavaScript(
    `window.__workspaceResumeContract.waitTask(${delayed.taskId})`
  );
  snapshot = await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.snapshot()"
  );
  assert.equal(snapshot.confirmCount, 1, "a response that began clean rechecks dirty state");
  assert.equal(snapshot.appliedCount, 0, "edits begun during fetch survive a declined replacement");

  await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.markClean()"
  );
  await waitFor(
    win,
    "window.__workspaceResumeContract.snapshot().dirty === false",
    "clean reset before reordered fetches"
  );
  const older = await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.startLoadWorkspace(false)"
  );
  const latest = await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.startLoadWorkspace(false)"
  );
  await win.webContents.executeJavaScript(
    `window.__workspaceResumeContract.resolveRequest(
      ${latest.requestId},
      ${JSON.stringify(workspacePayload("latest.resume"))}
    )`
  );
  await win.webContents.executeJavaScript(
    `window.__workspaceResumeContract.waitTask(${latest.taskId})`
  );
  await waitFor(
    win,
    'window.__workspaceResumeContract.snapshot().baseResumeName === "latest.resume"',
    "latest workspace response"
  );
  await win.webContents.executeJavaScript(
    `window.__workspaceResumeContract.resolveRequest(
      ${older.requestId},
      ${JSON.stringify(workspacePayload("older.resume"))}
    )`
  );
  await win.webContents.executeJavaScript(
    `window.__workspaceResumeContract.waitTask(${older.taskId})`
  );
  snapshot = await win.webContents.executeJavaScript(
    "window.__workspaceResumeContract.snapshot()"
  );
  assert.equal(
    snapshot.baseResumeName,
    "latest.resume",
    "a stale earlier response cannot replace the latest workspace generation"
  );

  await win.destroy();
}

async function runDocumentWorkbenchContracts() {
  const win = await makeWindow();
  await win.loadURL(`${baseUrl}#document-workbench`);
  await waitFor(
    win,
    "window.__documentWorkbenchContract",
    "document workbench fixture"
  );
  await win.webContents.executeJavaScript(`(() => {
    localStorage.removeItem("rolefit:document-rail:resume-review");
    localStorage.removeItem("rolefit:document-rail:cover-tailoring");
  })()`);
  await win.loadURL(`${baseUrl}#document-workbench`);
  await waitFor(
    win,
    'document.querySelector(\'button[aria-label="Hide Tailoring panel"]\')',
    "default expanded document rail"
  );

  const expandedGeometry = await win.webContents.executeJavaScript(`(() => {
    const editor = document.querySelector(".document-workbench__editor");
    const rail = document.querySelector(".document-workbench__rail");
    const content = document.querySelector(".document-workbench__rail-content");
    return {
      editorWidth: editor.getBoundingClientRect().width,
      railWidth: rail.getBoundingClientRect().width,
      rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      railTagName: rail.tagName,
      asideCount: document.querySelectorAll("aside").length,
      editorOverflow: getComputedStyle(editor).overflow,
      railOverflow: getComputedStyle(content).overflowY,
      controlled: document.querySelector('button[aria-label="Hide Tailoring panel"]')
        .getAttribute("aria-controls") === content.id
    };
  })()`);
  assert.ok(
    Math.abs(expandedGeometry.railWidth - expandedGeometry.rootFontSize * 18) <= 1,
    "expanded desktop rail resolves the shared 18rem readable width"
  );
  assert.equal(expandedGeometry.editorOverflow, "auto", "desktop editor scrolls independently");
  assert.equal(expandedGeometry.railOverflow, "auto", "desktop rail scrolls independently");
  assert.equal(expandedGeometry.controlled, true, "toggle aria-controls resolves to the rail content");
  assert.equal(expandedGeometry.railTagName, "DIV", "the structural rail wrapper is not a second landmark");
  assert.equal(expandedGeometry.asideCount, 1, "the feature content owns the only complementary landmark");

  // Resizing the rail: a pointer drag from its divider, bounded, persisted, and
  // shared by both documents. Each sequence uses its own pointer id — Chrome
  // rejects capture for an id it no longer considers active.
  const resizeGeometry = await win.webContents.executeJavaScript(`(() => {
    const handle = document.querySelector(".document-workbench__rail-resize");
    const rail = document.querySelector(".document-workbench__rail");
    const workbench = document.querySelector(".document-workbench");
    const layout = document.querySelector(".document-workbench__layout");
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const railWidth = () => Math.round(rail.getBoundingClientRect().width);
    const drag = (pointerId, offset, type) => {
      const box = handle.getBoundingClientRect();
      handle.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: Math.round(box.left + 3) + offset,
        clientY: Math.round(box.top + 40)
      }));
    };
    drag(11, 0, "pointerdown");
    drag(11, -90, "pointermove");
    const duringDrag = {
      width: railWidth(),
      resizing: workbench.dataset.resizing === "true",
      transition: getComputedStyle(layout).transitionProperty
    };
    drag(11, -90, "pointerup");
    const afterDrag = { width: railWidth(), resizing: workbench.dataset.resizing };
    // A pull far past the ceiling stops at the bound rather than eating the page.
    drag(12, 0, "pointerdown");
    drag(12, -400, "pointermove");
    drag(12, -400, "pointerup");
    return {
      rem,
      duringDrag,
      afterDrag,
      atCeiling: railWidth(),
      stored: Number.parseFloat(localStorage.getItem("rolefit:document-rail:width")),
      role: handle.getAttribute("role"),
      valueNow: Number.parseFloat(handle.getAttribute("aria-valuenow")),
      valueMax: Number.parseFloat(handle.getAttribute("aria-valuemax"))
    };
  })()`);
  const floorPx = Math.round(resizeGeometry.rem * 18);
  const ceilingPx = Math.round(resizeGeometry.rem * 28);
  assert.equal(
    resizeGeometry.duringDrag.width,
    floorPx + 90,
    "dragging the divider outward widens the rail by exactly the distance dragged"
  );
  assert.equal(resizeGeometry.duringDrag.resizing, true, "the workbench marks itself resizing for the duration of the drag");
  assert.equal(
    resizeGeometry.duringDrag.transition,
    "none",
    "which suspends the disclosure clock, so the rail cannot trail the cursor"
  );
  assert.equal(resizeGeometry.afterDrag.width, floorPx + 90, "release keeps the width the drag arrived at");
  assert.equal(resizeGeometry.afterDrag.resizing, undefined, "and clears the resizing mark");
  assert.equal(resizeGeometry.atCeiling, ceilingPx, "a longer pull stops at the shared 28rem ceiling");
  assert.equal(
    resizeGeometry.stored,
    ceilingPx,
    "the resized width persists under one shared key for both documents"
  );
  assert.equal(resizeGeometry.role, "separator", "the affordance is a separator");
  // The width lands on the element during the drag; the separator's reported
  // value follows on the commit, so wait for the render rather than the frame.
  await waitFor(
    win,
    `document.querySelector(".document-workbench__rail-resize").getAttribute("aria-valuenow") === "${ceilingPx}"`,
    "separator reports the width it settled on"
  );
  const separatorBounds = await win.webContents.executeJavaScript(`(() => {
    const handle = document.querySelector(".document-workbench__rail-resize");
    return {
      valueMin: Number.parseFloat(handle.getAttribute("aria-valuemin")),
      valueMax: Number.parseFloat(handle.getAttribute("aria-valuemax")),
      orientation: handle.getAttribute("aria-orientation"),
      focusable: handle.tabIndex
    };
  })()`);
  assert.equal(separatorBounds.valueMin, floorPx, "and its floor");
  assert.equal(separatorBounds.valueMax, ceilingPx, "and its ceiling");
  assert.equal(separatorBounds.orientation, "vertical", "as a vertical splitter");
  assert.equal(separatorBounds.focusable, 0, "reachable by keyboard");

  // Keyboard parity, and the floor.
  await win.webContents.executeJavaScript(`(() => {
    const handle = document.querySelector(".document-workbench__rail-resize");
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  })()`);
  await waitFor(
    win,
    `Math.round(document.querySelector(".document-workbench__rail").getBoundingClientRect().width) === ${floorPx}`,
    "Home returns the rail to its 18rem floor from the keyboard"
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      'Number.parseFloat(localStorage.getItem("rolefit:document-rail:width"))'
    ),
    floorPx,
    "and the keyboard resize persists like the drag"
  );

  await click(win, 'input[aria-label="Page zoom"]');
  await waitFor(
    win,
    'document.querySelector(\'.zoom-control__menu button[role="option"]\')',
    "document workbench Fit option"
  );
  await click(win, '.zoom-control__menu button[role="option"]');
  await waitFor(
    win,
    "window.__documentWorkbenchContract.fitSnapshot().calls === 1",
    "initial document workbench Fit"
  );
  const fitBeforeCollapse = await win.webContents.executeJavaScript(
    "window.__documentWorkbenchContract.fitSnapshot()"
  );

  await setInput(win, 'input[aria-label="Tailoring detail"]', "Keep this answer");
  await win.webContents.executeJavaScript(`(() => {
    document.querySelector('input[aria-label="Tailoring detail"]').focus();
    document.querySelector('button[aria-label="Hide Tailoring panel"]').click();
  })()`);
  await waitFor(
    win,
    'document.querySelector(\'button[aria-label="Show Tailoring panel, 2 issues"]\')',
    "collapsed document rail"
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      'document.activeElement === document.querySelector(".document-workbench__rail-tab")'
    ),
    true,
    "collapsing focused content moves focus to the edge tab that replaced the toggle"
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      'document.querySelectorAll(".document-workbench__rail-tab").length'
    ),
    1,
    "a collapsed rail exposes exactly one reopen control"
  );
  // The collapse animates the rail track shut; measure after it settles.
  await waitFor(
    win,
    'document.querySelector(".document-workbench__rail").getBoundingClientRect().width <= 1',
    "rail track finished closing"
  );
  await waitFor(
    win,
    `window.__documentWorkbenchContract.fitSnapshot().calls > ${fitBeforeCollapse.calls}`,
    "Fit refit after the document rail changed width"
  );
  const fitAfterCollapse = await win.webContents.executeJavaScript(
    "window.__documentWorkbenchContract.fitSnapshot()"
  );
  assert.ok(
    fitAfterCollapse.zoom > fitBeforeCollapse.zoom,
    "Fit expands the page after the collapsed rail returns width to the editor"
  );
  const collapsedGeometry = await win.webContents.executeJavaScript(`(() => {
    const editor = document.querySelector(".document-workbench__editor");
    const layout = document.querySelector(".document-workbench__layout");
    const rail = document.querySelector(".document-workbench__rail");
    const tab = document.querySelector(".document-workbench__rail-tab");
    const input = document.querySelector('input[aria-label="Tailoring detail"]');
    return {
      editorWidth: editor.getBoundingClientRect().width,
      layoutWidth: layout.getBoundingClientRect().width,
      railInert: rail.inert,
      tabControls: tab.getAttribute("aria-controls") ===
        document.querySelector(".document-workbench__rail-content").id,
      noOverflow: layout.scrollWidth <= layout.clientWidth,
      inputConnected: input.isConnected,
      attentionText: tab.querySelector(".document-workbench__rail-attention")?.textContent,
      attentionHidden: tab.querySelector(".document-workbench__rail-attention")?.getAttribute("aria-hidden"),
      value: input.value,
      stored: localStorage.getItem("rolefit:document-rail:cover-tailoring")
    };
  })()`);
  assert.ok(
    collapsedGeometry.layoutWidth - collapsedGeometry.editorWidth <= 1,
    "the collapsed rail returns its entire track to the editor"
  );
  assert.ok(
    collapsedGeometry.editorWidth > expandedGeometry.editorWidth,
    "collapsing the rail returns width to the editor"
  );
  assert.equal(collapsedGeometry.noOverflow, true, "the departed rail never widens the workbench");
  assert.equal(collapsedGeometry.railInert, true, "collapsed content leaves the accessibility tree");
  assert.equal(collapsedGeometry.tabControls, true, "the edge tab owns the rail content region");
  assert.equal(collapsedGeometry.inputConnected, true, "collapsed feature content remains mounted");
  assert.equal(collapsedGeometry.attentionText, "2", "the closed tab keeps the bounded issue count visible");
  assert.equal(collapsedGeometry.attentionHidden, "true", "the visible count does not duplicate the button label");
  assert.equal(collapsedGeometry.value, "Keep this answer", "collapsed inputs retain their value");
  assert.equal(collapsedGeometry.stored, "collapsed", "collapse persists under the document key");

  // What is left of the collapsed rail must read as one docked object, not as a
  // loose action floating beside a loose tab.
  const dockGeometry = await win.webContents.executeJavaScript(`(() => {
    const layout = document.querySelector(".document-workbench__layout");
    const dock = document.querySelector(".document-workbench__rail-dock");
    const action = dock.querySelector(":scope > :not(.document-workbench__rail-tab)");
    const tab = document.querySelector(".document-workbench__rail-tab");
    const dockRect = dock.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();
    return {
      dockPosition: getComputedStyle(dock).position,
      dockSurface: getComputedStyle(dock).backgroundColor,
      actionSurface: getComputedStyle(action).backgroundColor,
      actionText: action.textContent.trim(),
      tabSurface: getComputedStyle(tab).backgroundColor,
      actionInsideDock:
        actionRect.left >= dockRect.left - 0.5 && actionRect.right <= dockRect.right + 0.5,
      tabInsideDock:
        tabRect.left >= dockRect.left - 0.5 && tabRect.right <= dockRect.right + 0.5,
      actionLeadsTab: actionRect.right <= tabRect.left + 0.5,
      insetFromEdge: layoutRect.right - dockRect.right,
      floatingActionCount: document.querySelectorAll(".document-workbench__collapsed-action").length
    };
  })()`);
  assert.equal(dockGeometry.dockPosition, "absolute", "the collapsed pair hangs on the document's edge");
  assert.equal(dockGeometry.actionInsideDock, true, "the collapsed action sits in the pair");
  assert.equal(dockGeometry.tabInsideDock, true, "so does the reopen tab");
  assert.equal(dockGeometry.actionLeadsTab, true, "the action leads and the disclosure closes the pair");
  assert.ok(
    dockGeometry.insetFromEdge >= 0 && dockGeometry.insetFromEdge <= 24,
    "the pair stays in the document's top-right corner"
  );
  assert.equal(
    dockGeometry.dockSurface,
    "rgba(0, 0, 0, 0)",
    "no card wraps the pair — the dock is placement only"
  );
  assert.notEqual(
    dockGeometry.tabSurface,
    "rgba(0, 0, 0, 0)",
    "off the panel, the tab carries its own sheet"
  );
  assert.match(
    dockGeometry.actionText,
    /^Polish/,
    "the collapsed action keeps its label — it is the same button the open header shows"
  );
  assert.equal(
    dockGeometry.floatingActionCount,
    0,
    "no free-floating collapsed action survives beside the pair"
  );

  await win.webContents.executeJavaScript(
    "window.__documentWorkbenchContract.setResultVersion(2)"
  );
  await waitFor(
    win,
    'document.querySelector(\'[data-testid="document-workbench-result"]\')?.textContent === "Result 2"',
    "new hidden review result"
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      'Boolean(document.querySelector(\'button[aria-label="Show Tailoring panel, 2 issues"]\'))'
    ),
    true,
    "a new result does not override an explicit collapsed preference"
  );

  await win.loadURL(`${baseUrl}#document-workbench`);
  await waitFor(
    win,
    'document.querySelector(\'button[aria-label="Show Tailoring panel, 2 issues"]\')',
    "persisted collapsed rail after reload"
  );
  await click(win, 'button[aria-label="Show Tailoring panel, 2 issues"]');
  await waitFor(
    win,
    'document.querySelector(\'button[aria-label="Hide Tailoring panel"]\')',
    "reopened rail"
  );

  await win.webContents.executeJavaScript(
    "window.__documentWorkbenchContract.setWidth(700)"
  );
  await waitFor(
    win,
    'document.querySelector(\'[data-testid="document-workbench-host"]\')?.getBoundingClientRect().width === 700',
    "narrow workbench width"
  );
  const narrowGeometry = await win.webContents.executeJavaScript(`(() => {
    const host = document.querySelector('[data-testid="document-workbench-host"]');
    const layout = document.querySelector(".document-workbench__layout");
    const editor = document.querySelector(".document-workbench__editor");
    const rail = document.querySelector(".document-workbench__rail");
    return {
      noOverflow: host.scrollWidth <= host.clientWidth,
      stacked: rail.getBoundingClientRect().top >= editor.getBoundingClientRect().bottom,
      editorOverflow: getComputedStyle(editor).overflow,
      layoutOverflowY: getComputedStyle(layout).overflowY,
      layoutScrollable: layout.scrollHeight > layout.clientHeight
    };
  })()`);
  assert.equal(narrowGeometry.noOverflow, true, "narrow workbench has no horizontal overflow");
  assert.equal(narrowGeometry.stacked, true, "narrow rail stacks below the editor");
  assert.equal(narrowGeometry.editorOverflow, "visible", "narrow editor removes desktop overflow");
  assert.equal(narrowGeometry.layoutOverflowY, "auto", "the stacked layout owns vertical scrolling");
  assert.equal(narrowGeometry.layoutScrollable, true, "stacked content remains reachable inside the clipped host");

  await win.webContents.executeJavaScript(`(() => {
    document.querySelector(".document-workbench__layout").scrollTop = 180;
    window.__documentWorkbenchContract.setWorkbenchMounted(false);
  })()`);
  await waitFor(
    win,
    '!document.querySelector(".document-workbench__layout")',
    "narrow workbench unmount"
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "window.__documentWorkbenchContract.savedScrollTop()"
    ),
    180,
    "the narrow workbench saves the active layout scroll offset"
  );
  await win.webContents.executeJavaScript(
    "window.__documentWorkbenchContract.setWorkbenchMounted(true)"
  );
  await waitFor(
    win,
    'document.querySelector(".document-workbench__layout")?.scrollTop === 180',
    "narrow workbench scroll restoration"
  );

  await click(win, 'button[aria-label="Hide Tailoring panel"]');
  await waitFor(
    win,
    'document.querySelector(".document-workbench__rail-tab")',
    "narrow collapsed rail"
  );
  const narrowCollapsed = await win.webContents.executeJavaScript(`(() => {
    const layout = document.querySelector(".document-workbench__layout");
    const rail = document.querySelector(".document-workbench__rail");
    const dock = document.querySelector(".document-workbench__rail-dock");
    const tab = document.querySelector(".document-workbench__rail-tab");
    const editor = document.querySelector(".document-workbench__editor");
    layout.scrollTop = layout.scrollHeight;
    const layoutRect = layout.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    return {
      railHidden: getComputedStyle(rail).display === "none",
      dockPosition: getComputedStyle(dock).position,
      fullWidth: Math.round(dockRect.width) === Math.round(layout.clientWidth),
      tabTrailing: tabRect.right <= dockRect.right + 0.5 &&
        tabRect.left > dockRect.left + dockRect.width / 2,
      belowEditor: dockRect.top >= editor.getBoundingClientRect().bottom,
      reopenVisible:
        tabRect.top >= layoutRect.top &&
        tabRect.bottom <= layoutRect.bottom
    };
  })()`);
  assert.equal(narrowCollapsed.railHidden, true, "the stacked collapsed rail leaves the flow");
  assert.equal(
    narrowCollapsed.dockPosition,
    "relative",
    "the stacked dock stays in flow while positioning its issue count"
  );
  assert.equal(narrowCollapsed.fullWidth, true, "the stacked dock spans the workbench as one bar");
  assert.equal(narrowCollapsed.tabTrailing, true, "the stacked bar keeps its disclosure at the end");
  assert.equal(narrowCollapsed.belowEditor, true, "the stacked reopen bar sits below the document");
  assert.equal(narrowCollapsed.reopenVisible, true, "the stacked reopen bar can be scrolled into view");

  await win.destroy();
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
  console.log("Chromium contracts: workspace replacement races");
  await runWorkspaceResumeContracts();
  console.log("Chromium contracts: shared document workbench rail");
  await runDocumentWorkbenchContracts();
  assert.deepEqual(pageErrors, [], "browser pages must not report console/load errors");
  console.log(
    "editor Chromium contracts passed: header marks/link undo, disabled controls, focus, rich paste, Typeset dirty baseline, deduplicated two-tab restore, live resume replacement guards, shared document rail disclosure/layout/persistence/Fit/landmarks/scroll restoration"
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
    if (chromium.child.exitCode === null) {
      chromium.child.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => chromium.child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000))
      ]);
    }
  }
  if (chromium?.profileDir) {
    // Chrome may finish releasing Default/ cache handles just after process
    // exit on CI filesystems. Node retries ENOTEMPTY/EBUSY for recursive rm
    // when maxRetries is nonzero, so cleanup cannot turn a passing behavior
    // contract into a false-negative job.
    await rm(chromium.profileDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    });
  }
}
