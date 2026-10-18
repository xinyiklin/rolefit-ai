import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsEngine, needsEngineFonts, needsExtended, selectCoverage } from './ci-coverage-selection.mjs';

const coverage = ({ extended, engine, engineFonts }) => [extended, engine, engineFonts];

test('only documentation or backend AI-only changes skip extended rendering', () => {
  assert.equal(needsExtended(['README.md', 'apps/role-fit-ai/server/ai/prompts.ts', 'apps/role-fit-ai/server/ai-cli/codex.ts']), false);
  for (const path of ['packages/editor/src/editor.tsx', 'packages/engine/fonts/font.ttf',
    'apps/typeset/src/App.tsx', 'apps/role-fit-ai/src/styles/index.css',
    'scripts/editor-browser-contracts/main.tsx', 'apps/role-fit-ai/server/starter.resume',
    'package.json', 'package-lock.json', '.node-version', '.npmrc', 'tsconfig.base.json',
    '.github/workflows/document-workflows.yml', 'scripts/ci-coverage-selection.mjs', 'unknown']) {
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
    const selection = selectCoverage(name, event, (command, args) => {
      assert.equal(command, 'git');
      assert.deepEqual(args, ['diff', '--name-only', '--no-renames', '-z', `${base}${separator}${head}`, '--']);
      return 'apps/role-fit-ai/server/ai/prompt.ts\0';
    });
    assert.deepEqual(coverage(selection), [false, false, false]);
    // A rename from a renderer to an excluded directory still includes its old path.
    assert.equal(selectCoverage(name, event, () => 'packages/editor/deleted.ts\0apps/role-fit-ai/server/ai/moved.ts\0').extended, true);
  }
});

test('the engine job runs only for its own tree and root inputs', () => {
  for (const path of ['apps/role-fit-ai/src/App.tsx', 'apps/typeset/src/App.tsx', 'packages/editor/src/editor.tsx',
    'docs/development.md', 'CONTINUITY.md', '.githooks/commit-msg', 'scripts/editor-browser-contracts/main.tsx',
    '.github/workflows/deploy-typeset.yml']) {
    assert.equal(needsEngine([path]), false, path);
    assert.equal(needsEngineFonts([path]), false, path);
  }
  for (const path of ['packages/engine/src/typeset/layout.ts', 'packages/engine/README.md', 'package.json',
    'package-lock.json', '.node-version', '.npmrc', 'tsconfig.base.json',
    '.github/workflows/document-workflows.yml', 'scripts/ci-coverage-selection.mjs']) {
    assert.equal(needsEngine([path]), true, path);
    assert.equal(needsEngine(['apps/typeset/src/App.tsx', path]), true, `mixed ${path}`);
  }
  assert.equal(needsEngine([]), true);
});

test('font assets run only when their generators, sources, outputs, or CI wiring change', () => {
  for (const path of ['packages/engine/src/typeset/layout.ts', 'packages/engine/src/lib/resumeData.ts',
    'package.json', 'package-lock.json', 'tsconfig.base.json', 'apps/typeset/src/App.tsx']) {
    assert.equal(needsEngineFonts([path]), false, path);
  }
  for (const path of ['packages/engine/scripts/generate_font_assets.py', 'packages/engine/scripts/requirements-fonts.txt',
    'packages/engine/scripts/additional-fonts.json', 'packages/engine/fonts/Arimo-Bold.ttf',
    'packages/engine/src/typeset/metrics.gen.ts', '.github/workflows/document-workflows.yml',
    'scripts/ci-coverage-selection.mjs']) {
    assert.equal(needsEngineFonts([path]), true, path);
  }
  assert.equal(needsEngineFonts([]), true);
});

test('manual, unknown, malformed, empty and unavailable comparisons run all coverage', () => {
  const neverGit = () => { assert.fail('must not invoke git for an invalid comparison'); };
  for (const name of ['workflow_dispatch', 'schedule', 'push', 'pull_request']) {
    assert.deepEqual(coverage(selectCoverage(name, {}, neverGit)), [true, true, true]);
  }
  assert.equal(selectCoverage('push', { before: '0'.repeat(40), after: 'b'.repeat(40) }, neverGit).extended, true);
  assert.equal(selectCoverage('push', { before: '--output=unsafe', after: 'b'.repeat(40) }, neverGit).extended, true);
  const event = { before: 'a'.repeat(40), after: 'b'.repeat(40) };
  assert.deepEqual(coverage(selectCoverage('push', event, () => { throw new Error('missing history'); })), [true, true, true]);
  assert.deepEqual(coverage(selectCoverage('push', event, () => '')), [true, true, true]);
  assert.equal(selectCoverage('push', event, () => 'packages/editor/name\nwith-newline.ts\0').extended, true);
});
