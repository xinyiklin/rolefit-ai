import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsExtended, selectExtended } from './ci-browser-selection.mjs';

test('only documentation or backend AI-only changes skip extended rendering', () => {
  assert.equal(needsExtended(['README.md', 'apps/role-fit-ai/server/ai/prompts.ts', 'apps/role-fit-ai/server/ai-cli/codex.ts']), false);
  for (const path of ['packages/editor/src/editor.tsx', 'packages/engine/fonts/font.ttf',
    'apps/typeset/src/App.tsx', 'apps/role-fit-ai/src/styles/index.css',
    'scripts/editor-browser-contracts/main.tsx', 'apps/role-fit-ai/server/starter.resume',
    'package.json', 'package-lock.json', '.node-version', '.npmrc', 'tsconfig.base.json',
    '.github/workflows/document-workflows.yml', 'scripts/ci-browser-selection.mjs', 'unknown']) {
    assert.equal(needsExtended([path]), true, path);
    assert.equal(needsExtended(['apps/role-fit-ai/server/ai/prompts.ts', path]), true, `mixed ${path}`);
  }
  assert.equal(needsExtended([]), true);
});

test('PR comparisons use the merge base; pushes include every commit since before', () => {
  const base = 'a'.repeat(40), head = 'b'.repeat(40);
  for (const [name, event, separator] of [
    ['pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }, '...'],
    ['push', { before: base, after: head }, '..'],
  ]) {
    const selection = selectExtended(name, event, (command, args) => {
      assert.equal(command, 'git');
      assert.deepEqual(args, ['diff', '--name-only', '--no-renames', '-z', `${base}${separator}${head}`, '--']);
      return 'apps/role-fit-ai/server/ai/prompt.ts\0';
    });
    assert.equal(selection.run, false);
    // A rename from a renderer to an excluded directory still includes its old path.
    assert.equal(selectExtended(name, event, () => 'packages/editor/deleted.ts\0apps/role-fit-ai/server/ai/moved.ts\0').run, true);
  }
});

test('manual, unknown, malformed, empty and unavailable comparisons run extended', () => {
  const neverGit = () => { assert.fail('must not invoke git for an invalid comparison'); };
  for (const name of ['workflow_dispatch', 'schedule', 'push', 'pull_request']) {
    assert.equal(selectExtended(name, {}, neverGit).run, true);
  }
  assert.equal(selectExtended('push', { before: '0'.repeat(40), after: 'b'.repeat(40) }, neverGit).run, true);
  assert.equal(selectExtended('push', { before: '--output=unsafe', after: 'b'.repeat(40) }, neverGit).run, true);
  const event = { before: 'a'.repeat(40), after: 'b'.repeat(40) };
  assert.equal(selectExtended('push', event, () => { throw new Error('missing history'); }).run, true);
  assert.equal(selectExtended('push', event, () => '').run, true);
  assert.equal(selectExtended('push', event, () => 'packages/editor/name\nwith-newline.ts\0').run, true);
});
