// The link card listens for Escape at document capture so it can close before
// the editor sees the key. It must only claim Escape aimed at the editor page or
// the card itself; dialogs, menus, and toolbar drafts keep their own Escape.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const vite = await createServer({
  root: fileURLToPath(new URL("../../../..", import.meta.url)),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true }
});
let linkCardOwnsEscape;
try {
  ({ linkCardOwnsEscape } = await vite.ssrLoadModule("/src/sections/editor/TypesetLinkCard.tsx"));
} finally {
  await vite.close();
}

const page = { isContentEditable: true };
const cardButton = { isContentEditable: false };
const pasteDialogInput = { isContentEditable: false };
const contextMenuItem = { isContentEditable: false };
const toolbarInput = { isContentEditable: false };
const wrapper = { contains: (node) => [page, cardButton, pasteDialogInput, contextMenuItem].includes(node) };
const card = { contains: (node) => node === cardButton, parentElement: wrapper };

assert.equal(linkCardOwnsEscape(card, page), true, "Escape in the editable page dismisses the card");
assert.equal(linkCardOwnsEscape(card, cardButton), true, "Escape on a card action dismisses the card");
assert.equal(linkCardOwnsEscape(card, pasteDialogInput), false, "a paste dialog inside the editor keeps its Escape");
assert.equal(linkCardOwnsEscape(card, contextMenuItem), false, "the right-click menu keeps its Escape");
assert.equal(linkCardOwnsEscape(card, toolbarInput), false, "a toolbar draft or popover outside the editor keeps its Escape");
assert.equal(linkCardOwnsEscape(null, page), false, "an unmounted card claims nothing");
assert.equal(linkCardOwnsEscape(card, null), false, "an event without a target is not claimed");

const source = readFileSync(new URL("../TypesetLinkCard.tsx", import.meta.url), "utf8");
assert.match(
  source,
  /event\.key !== "Escape" \|\| !linkCardOwnsEscape\(ref\.current, event\.target\)\) return;\s*event\.stopPropagation\(\);/,
  "the capture listener claims Escape only after the ownership check"
);

console.log("link card Escape probes: PASS");
