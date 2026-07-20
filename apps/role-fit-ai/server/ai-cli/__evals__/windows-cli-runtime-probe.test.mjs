import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { runCli } from "../index.ts";

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

async function readPid(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await readFile(path, "utf8").catch(() => "");
    const pid = Number(value.trim().split(/\s+/).at(-1));
    if (Number.isInteger(pid) && pid > 0) return pid;
    await delay(20);
  }
  throw new Error("The fake Windows CLI did not report its process id.");
}

async function runWindowsProbe() {
  const root = await mkdtemp(join(tmpdir(), "rolefit windows-cli "));
  const shimPath = join(root, "rolefit-fake.cmd");
  const implementationPath = join(root, "fake-cli.mjs");
  const pidPath = join(root, "child.pid");
  const originalPath = process.env.PATH;
  try {
    await writeFile(
      implementationPath,
      [
        'import { appendFileSync } from "node:fs";',
        'let stdin = "";',
        'for await (const chunk of process.stdin) stdin += chunk;',
        'const pidFlagIndex = process.argv.indexOf("--rolefit-probe-pid-file");',
        'if (pidFlagIndex >= 0) {',
        '  appendFileSync(process.argv[pidFlagIndex + 1], `${process.pid}\\n`);',
        '  process.argv.splice(pidFlagIndex, 2);',
        '}',
        'if (process.argv[2] === "--sleep") {',
        '  await new Promise((resolve) => setTimeout(resolve, Number(process.argv[3])));',
        '} else {',
        '  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), stdin }));',
        '}'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      shimPath,
      `@echo off\r\n\"${process.execPath}\" \"%~dp0fake-cli.mjs\" %*\r\n`,
      "utf8"
    );
    process.env.PATH = `${root}${delimiter}${originalPath ?? ""}`;

    const privateArgument = 'private & | < > ^ %PATH% ! " ( ) , ; * ? [ ] space\\tail';
    const stdin = "private stdin payload";
    const completed = await runCli(
      "rolefit-fake",
      ["--rolefit-probe-pid-file", pidPath, "--probe", privateArgument],
      stdin,
      { timeoutMs: 5_000, cwd: root }
    );
    assert.deepEqual(JSON.parse(completed.stdout), {
      args: ["--probe", privateArgument],
      stdin
    }, "Windows .cmd execution must preserve private argv without shell interpretation");

    await assert.rejects(
      () => runCli(
        "rolefit-fake",
        ["--rolefit-probe-pid-file", pidPath, "--sleep", "120000"],
        undefined,
        { timeoutMs: 250, cwd: root },
      ),
      /timed out/
    );
    const childPid = await readPid(pidPath);
    for (let attempt = 0; attempt < 100 && isPidAlive(childPid); attempt += 1) {
      await delay(20);
    }
    assert.equal(isPidAlive(childPid), false, `Windows CLI descendant ${childPid} survived timeout cleanup.`);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
}

if (process.platform === "win32") {
  await runWindowsProbe();
  console.log("Windows AI CLI runtime probe: passed");
} else {
  console.log("Windows AI CLI runtime probe: skipped on non-Windows host");
}
