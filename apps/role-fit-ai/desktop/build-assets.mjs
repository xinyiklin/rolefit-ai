import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(desktopRoot, "..", "dist-electron", "desktop");
const assets = Object.freeze([
  "companion.html",
  "companion.css",
  "companion-renderer.js"
]);

await mkdir(outputRoot, { recursive: true });
await Promise.all(
  assets.map((asset) => copyFile(join(desktopRoot, asset), join(outputRoot, asset)))
);

console.log(`Copied ${assets.length} companion assets to dist-electron/desktop.`);
