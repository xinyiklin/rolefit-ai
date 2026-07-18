// Mirror the shared engine's exact measurement/PDF font assets into RoleFit's
// static root. The destination is generated and gitignored; the package remains
// the sole source of truth for fonts and their metrics.
import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const anchor = import.meta.resolve("@typeset/engine/fonts/LMRoman10-Regular.woff2");
const source = dirname(fileURLToPath(anchor));
const destination = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "fonts");

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log(`sync-fonts: ${source} -> ${destination}`);
