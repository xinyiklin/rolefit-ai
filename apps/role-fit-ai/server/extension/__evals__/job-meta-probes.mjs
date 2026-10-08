import assert from "node:assert/strict";
import { extractJobMeta } from "../index.ts";

// extractJobMeta reads the page title and text the extension captured from any
// site, synchronously inside the analyze route, so its parses must stay linear
// and must keep reading the title formats the popup preview relies on.

let failures = 0;
function probe(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
}

probe("LinkedIn page titles name the role and employer", () => {
  assert.deepEqual(extractJobMeta("", "Backend Engineer at Acme | LinkedIn"), { title: "Backend Engineer", company: "Acme" });
  assert.deepEqual(
    extractJobMeta("", "Front-End Engineer at Acme Corp | LinkedIn"),
    { title: "Front-End Engineer", company: "Acme Corp" }
  );
  assert.deepEqual(extractJobMeta("", "Senior SRE At Big Co - LinkedIn"), { title: "Senior SRE", company: "Big Co" });
  assert.deepEqual(extractJobMeta("", "Engineer at Acme | Careers"), { title: "Engineer at Acme" }, "no LinkedIn marker");
});

probe("Indeed page titles name the role and employer", () => {
  assert.deepEqual(
    extractJobMeta("", "Software Engineer - Acme Corp - New York, NY | Indeed.com"),
    { title: "Software Engineer", company: "Acme Corp" }
  );
  assert.deepEqual(
    extractJobMeta("", "Software Engineer - Acme Corp - New York, NY - Indeed.com"),
    { title: "Software Engineer" },
    "without a trailing | segment only the generic title applies"
  );
});

probe("Handshake page titles name the role and employer ahead of LinkedIn", () => {
  assert.deepEqual(
    extractJobMeta("", "Platform Engineer - Data Tools | Example Clinic Co | Handshake"),
    { title: "Platform Engineer - Data Tools", company: "Example Clinic Co" }
  );
  assert.deepEqual(
    extractJobMeta("", "Engineering Manager at Scale | LinkedIn | Handshake"),
    { title: "Engineering Manager at Scale", company: "LinkedIn" }
  );
});

probe("body header lines and cues fill only what the title left open", () => {
  assert.deepEqual(
    extractJobMeta("\n\n  Title: Data Engineer\r\n  Company: Foo Corp\r\nbody", "Jobs"),
    { title: "Data Engineer", company: "Foo Corp" }
  );
  assert.deepEqual(
    extractJobMeta("Company: Body Co", "Backend Engineer at Acme | LinkedIn"),
    { title: "Backend Engineer", company: "Acme" }
  );
  assert.equal(extractJobMeta("Acme Corp is hiring engineers.", "Jobs").company, "Acme Corp");
  assert.equal(extractJobMeta("Join us at Acme Labs, where we build.", "Jobs").company, "Acme Labs");
});

probe("hostile titles and page text parse without stalling the analyze route", () => {
  const titles = [
    `x${`${" ".repeat(20)}-`.repeat(60)}`,
    `x${`${" ".repeat(20)}-`.repeat(60)}`,
    `${`x at ${" ".repeat(10)}-`.repeat(40)}`,
    `x${`${" ".repeat(240)}|`.repeat(40)}`,
    `${`a at ${" ".repeat(30)}`.repeat(20)}`
  ].map((title) => title.slice(0, 500));
  const bodies = ["\n".repeat(50_000), " \n".repeat(25_000), " ".repeat(50_000), " \n".repeat(25_000)];
  for (const [text, title] of [...titles.map((title) => ["", title]), ...bodies.map((body) => [body, "Jobs"])]) {
    const started = performance.now();
    extractJobMeta(text, title);
    const elapsed = performance.now() - started;
    // The replaced patterns took 4-34 s on these inputs.
    assert.ok(elapsed < 500, `parsed in ${elapsed.toFixed(0)} ms`);
  }
});

if (failures) {
  console.log(`${failures} job meta probe(s) failed`);
  process.exitCode = 1;
} else {
  console.log("PASS job meta probes");
}
