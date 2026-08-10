import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const runtimeUrl = new URL("../../runtime.ts", import.meta.url);
const clientUrl = new URL("../../../src/lib/aiJobAnalysis.ts", import.meta.url);
const serverModuleUrl = new URL("../jobAnalysis.ts", import.meta.url);
const legacyClientUrl = new URL("../../../src/lib/aiDistill.ts", import.meta.url);
const legacyServerModuleUrl = new URL("../distill.ts", import.meta.url);

assert.equal(existsSync(clientUrl), true, "the client module uses the Job analysis filename");
assert.equal(existsSync(serverModuleUrl), true, "the server module uses the Job analysis filename");
assert.equal(existsSync(legacyClientUrl), false, "the retired client filename is gone");
assert.equal(existsSync(legacyServerModuleUrl), false, "the retired server filename is gone");

const runtime = readFileSync(runtimeUrl, "utf8");
const client = readFileSync(clientUrl, "utf8");

assert.match(runtime, /import \{ handleJobAnalysis \} from "\.\/ai\/jobAnalysis\.ts";/);
assert.match(runtime, /pathname === "\/api\/job-analysis"/, "the canonical Job analysis route is dispatched");
assert.doesNotMatch(runtime, /pathname === "\/api\/distill"/, "the retired route alias is gone");
assert.equal(
  runtime.match(/handleJobAnalysis\(req, res\)/g)?.length,
  1,
  "Job analysis has one route and one handler dispatch"
);
assert.match(client, /fetch\("\/api\/job-analysis"/, "new browser code calls only the canonical route");
assert.doesNotMatch(client, /fetch\("\/api\/distill"/, "new browser code never writes the legacy route");

console.log("job-analysis route contract passed");
