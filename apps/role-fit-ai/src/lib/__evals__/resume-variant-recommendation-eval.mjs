import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const entry = fileURLToPath(new URL("../resumeVariantRecommendation.ts", import.meta.url));
const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const module = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const { recommendResumeVariant } = module;

const job = `
Platform Engineer
Required Qualifications
TypeScript, Node.js, React, AWS, Docker, Kubernetes, PostgreSQL, Terraform.
Build cloud APIs and improve backend service reliability.
`;

const recommendation = recommendResumeVariant(job, [
  {
    fileName: "general.resume",
    label: "General SDE",
    text: "Software engineer with Java, Python, SQL, testing, algorithms, and data structures experience.".repeat(3)
  },
  {
    fileName: "fullstack.resume",
    label: "Full-stack",
    text: "Full-stack engineer using TypeScript, Node.js, React, AWS, Docker, Kubernetes, PostgreSQL, Terraform, cloud APIs, and backend services.".repeat(
      3
    )
  }
]);

assert.equal(recommendation?.fileName, "fullstack.resume");
assert.equal(recommendation?.confidence, "high");
assert.ok((recommendation?.lead ?? 0) >= 2);
assert.ok(recommendation?.matchedKeywords.includes("typescript"));

const ambiguous = recommendResumeVariant("Build reliable software with testing.", [
  {
    fileName: "one.resume",
    label: "One",
    text: "Built reliable software and automated testing.".repeat(4)
  },
  {
    fileName: "two.resume",
    label: "Two",
    text: "Built reliable software and automated testing.".repeat(4)
  }
]);
assert.equal(ambiguous?.confidence, "low");
assert.equal(ambiguous?.lead, 0);

const incomplete = recommendResumeVariant(
  job,
  [
    {
      fileName: "fullstack.resume",
      label: "Full-stack",
      text: "Full-stack engineer using TypeScript, Node.js, React, AWS, Docker, Kubernetes, PostgreSQL, Terraform, cloud APIs, and backend services.".repeat(
        3
      )
    }
  ],
  2
);
assert.equal(incomplete?.fileName, "fullstack.resume");
assert.equal(
  incomplete?.confidence,
  "low",
  "a failed candidate read cannot turn the sole survivor into a high-confidence winner"
);
assert.match(
  incomplete?.detail ?? "",
  /incomplete/i,
  "an incomplete comparison tells the user why automatic selection was withheld"
);

assert.equal(
  recommendResumeVariant(job, [{ fileName: "empty.resume", label: "Empty", text: "short" }]),
  null,
  "unusable resume files are not recommended"
);

console.log("Resume variant recommendation eval passed");
