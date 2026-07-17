// Copies the engine's font assets into this app's public/ directory.
//
// The engine owns the fonts because they implement its measurement contract:
// the committed metrics are extracted from these exact files, and the PDF
// emitter embeds their sfnt siblings. Consumers must serve them at /fonts/ —
// fontRegistry's assetPath and the @font-face rules both hardcode that URL —
// so each app mirrors them into its own static root at predev/prebuild time.
// public/fonts/ is therefore generated output and gitignored; edit the sources
// under packages/engine/fonts/ (or regenerate them) instead.

import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve through the package's exports map rather than a relative path, so
// this keeps working if the workspace layout moves.
const anchor = import.meta.resolve("@typeset/engine/fonts/LMRoman10-Regular.woff2");
const source = dirname(fileURLToPath(anchor));
const destination = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "fonts");

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log(`sync-fonts: ${source} -> ${destination}`);
