import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const popupUrl = new URL("../popup.js", import.meta.url);
const popup = readFileSync(popupUrl, "utf8");
const manifest = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
);
const inbox = readFileSync(
  new URL("../../src/hooks/useExtensionInbox.ts", import.meta.url),
  "utf8",
);
const extensionRoutes = readFileSync(
  new URL("../../server/extension/routes.ts", import.meta.url),
  "utf8",
);

execFileSync(process.execPath, ["--check", fileURLToPath(popupUrl)], {
  stdio: "pipe",
});

for (const copy of [
  "prepare application",
  "Prepare in RoleFit AI",
  "Tailor resume after preparation",
  "Prepare job details with AI",
  "Preparing…",
  "Opened in RoleFit ✓",
]) {
  assert.ok(
    popup.includes(copy),
    `the popup exposes the revised visible copy: ${copy}`,
  );
}

for (const retiredCopy of [
  "job import",
  "Import to RoleFit AI",
  "Polish automatically after import",
  "Distill with AI",
  "Importing…",
  "Imported ✓",
]) {
  const quotedLiteral = new RegExp(
    `(["'])${retiredCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`,
    "i",
  );
  assert.doesNotMatch(
    popup,
    quotedLiteral,
    `the retired popup label is absent: ${retiredCopy}`,
  );
}
assert.match(
  manifest.description,
  /^Prepare job postings in RoleFit AI\b/,
  "the extension manifest describes preparation rather than import",
);

const handleImportStart = popup.indexOf("async function handleImport(");
const handleImportEnd = popup.indexOf("// ── Main", handleImportStart);
const handleImport = popup.slice(handleImportStart, handleImportEnd);
assert.ok(
  handleImportStart >= 0 && handleImportEnd > handleImportStart,
  "the popup retains one bounded import transport handler",
);
assert.match(
  handleImport,
  /\/api\/extension\/import/,
  "the existing extension import endpoint remains unchanged",
);
assert.match(
  handleImport,
  /body:\s*JSON\.stringify\(\{[\s\S]*?\bautoTailor:\s*Boolean\(autoTailor\),[\s\S]*?\bdistillAi:\s*Boolean\(distillAi\),[\s\S]*?\bclaimToken\s*\}\)/,
  "the existing autoTailor, distillAi, and claimToken wire fields remain unchanged",
);
assert.match(
  handleImport,
  /\?extensionImport=\$\{encodeURIComponent\(claimToken\)\}/,
  "the fresh app tab receives the same claim token submitted with the payload",
);
assert.ok(
  handleImport.indexOf("const claimToken = randomClaimToken()") <
    handleImport.indexOf("body: JSON.stringify") &&
    handleImport.indexOf("body: JSON.stringify") <
      handleImport.indexOf("?extensionImport=${encodeURIComponent(claimToken)}"),
  "one claim token is created before transport and reused for the fresh tab",
);

const createTabStart = popup.indexOf("async function createImportTab(");
const createTabEnd = popup.indexOf(
  "async function handleImport(",
  createTabStart,
);
const createImportTab = popup.slice(createTabStart, createTabEnd);
assert.match(
  createImportTab,
  /if \(cookieStoreId\)[\s\S]*?chrome\.tabs\.create\(\{\s*url,\s*cookieStoreId\s*\}\)[\s\S]*?catch[\s\S]*?chrome\.tabs\.create\(\{\s*url\s*\}\)/,
  "Firefox container creation falls back to a plain fresh tab",
);
assert.doesNotMatch(
  popup,
  /chrome\.tabs\.update\(/,
  "preparation opens a fresh RoleFit tab instead of replacing an existing one",
);
assert.match(
  popup,
  /handleImport\([\s\S]{0,160}?tab\.cookieStoreId\)/,
  "the source tab's Firefox cookieStoreId reaches fresh-tab creation",
);
assert.match(
  popup,
  /target:\s*\{\s*tabId:\s*tab\.id\s*\}/,
  "the page extraction transport keeps its tabId contract",
);

assert.match(
  inbox,
  /onDistillingRef\.current\?\.\(\)/,
  "the client retains the existing distilling progress callback",
);
assert.match(
  extensionRoutes,
  /entry\.status === "distilling"[\s\S]{0,100}?status:\s*"distilling"/,
  "the server retains the existing distilling wire token",
);

console.log("Extension popup source contract eval: PASS");
