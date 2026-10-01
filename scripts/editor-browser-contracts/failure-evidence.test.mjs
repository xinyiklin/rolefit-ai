import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { captureFailure } from './failure-evidence.mjs';

test('a disconnected browser still retains the original failure and capture errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-failure-test-'));
  try {
    const original = { error: 'Missing command', phase: 'structure' };
    const calls = [];
    const page = { sessionId: 'page', contextTarget: 'entry', connection: { send: async (...args) => {
      calls.push(args);
      throw new Error('connection closed');
    } } };
    await captureFailure([page], directory, original);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'failure.json'), 'utf8')), original);
    const details = JSON.parse(await readFile(join(directory, 'page-0.json'), 'utf8'));
    assert.equal(details.target, 'entry');
    assert.equal(details.inspectionError, 'connection closed');
    assert.equal(details.screenshotError, 'connection closed');
    assert.equal(calls.length, 2);
    assert(calls.every(call => call[3] === 5_000));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
