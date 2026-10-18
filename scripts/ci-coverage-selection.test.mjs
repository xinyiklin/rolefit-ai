import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isReleasePrep, needsEngine, needsEngineFonts, needsExtended, selectCoverage } from './ci-coverage-selection.mjs';

const coverage = ({ extended, engine, engineFonts, core }) => [extended, engine, engineFonts, core];

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
    assert.deepEqual(coverage(selection), [false, false, false, true]);
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
    'packages/engine/src/typeset/metrics.gen.ts', 'packages/engine/package.json',
    '.github/workflows/document-workflows.yml',
    'scripts/ci-coverage-selection.mjs']) {
    assert.equal(needsEngineFonts([path]), true, path);
  }
  assert.equal(needsEngineFonts([]), true);
});

test('manual, unknown, malformed, empty and unavailable comparisons run all coverage', () => {
  const neverGit = () => { assert.fail('must not invoke git for an invalid comparison'); };
  for (const name of ['workflow_dispatch', 'schedule', 'push', 'pull_request']) {
    assert.deepEqual(coverage(selectCoverage(name, {}, neverGit)), [true, true, true, true]);
  }
  assert.equal(selectCoverage('push', { before: '0'.repeat(40), after: 'b'.repeat(40) }, neverGit).extended, true);
  assert.equal(selectCoverage('push', { before: '--output=unsafe', after: 'b'.repeat(40) }, neverGit).extended, true);
  const event = { before: 'a'.repeat(40), after: 'b'.repeat(40) };
  assert.deepEqual(coverage(selectCoverage('push', event, () => { throw new Error('missing history'); })), [true, true, true, true]);
  assert.deepEqual(coverage(selectCoverage('push', event, () => '')), [true, true, true, true]);
  assert.equal(selectCoverage('push', event, () => 'packages/editor/name\nwith-newline.ts\0').extended, true);
});

const manifest = (version, extra = {}) => JSON.stringify({ name: 'role-fit-ai', version, scripts: { check: 'npm test' }, ...extra }, null, 2);
const lockfile = (version, { range = '1.0.0', installed = range, integrity = 'sha512-a', root = ['apps/*', 'packages/*'] } = {}) =>
  JSON.stringify({
    name: 'role-fit-ai-workspace', lockfileVersion: 3, packages: {
      '': { workspaces: root },
      'apps/role-fit-ai': { version, dependencies: { 'pdf-lib': `^${range}` } },
      'node_modules/pdf-lib': { version: installed, integrity },
    },
  }, null, 2);
const releasePaths = ['CONTINUITY.md', 'apps/role-fit-ai/docs/releases/0.17.0-beta.1.md', 'apps/role-fit-ai/package.json',
  'apps/role-fit-ai/scripts/desktop-release-contract.test.mjs', 'package-lock.json'];
const files = (head = {}) => ({
  base: { 'apps/role-fit-ai/package.json': manifest('0.16.0'), 'package-lock.json': lockfile('0.16.0') },
  head: { 'apps/role-fit-ai/package.json': manifest('0.17.0'), 'package-lock.json': lockfile('0.17.0'), ...head },
});
const reader = ({ base, head }) => (side, path) => {
  const text = (side === 'base' ? base : head)[path];
  if (text === undefined) throw new Error(`missing ${side}:${path}`);
  return text;
};
const releaseGit = (sides, paths = releasePaths, mergeBase = 'c'.repeat(40)) => (command, [verb, ...args]) => {
  if (verb === 'diff') return `${paths.join('\0')}\0`;
  if (verb === 'merge-base') return `${mergeBase}\n`;
  assert.equal(verb, 'show');
  const [rev, path] = args[0].split(':');
  return reader(sides)(rev === 'b'.repeat(40) ? 'head' : 'base', path);
};

test('a RoleFit version-only release skips engine and both Chromium suites', () => {
  assert.equal(isReleasePrep(releasePaths, reader(files())), true);
  const event = { pull_request: { base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } } };
  const shown = [];
  const git = releaseGit(files());
  const selection = selectCoverage('pull_request', event, (command, args, options) => {
    if (args[0] === 'show') shown.push(args[1]);
    return git(command, args, options);
  });
  assert.deepEqual(coverage(selection), [false, false, false, false]);
  // A PR reads its base files at the merge base, matching the three-dot diff.
  assert.deepEqual(shown.filter(rev => rev.startsWith('a')), []);
  assert.ok(shown.includes(`${'c'.repeat(40)}:package-lock.json`));
  // A push compares and reads from `before` directly.
  const pushed = [];
  assert.deepEqual(coverage(selectCoverage('push', { before: 'a'.repeat(40), after: 'b'.repeat(40) }, (command, args) => {
    assert.notEqual(args[0], 'merge-base');
    if (args[0] === 'show') pushed.push(args[1].slice(0, 40));
    return git(command, args);
  })), [false, false, false, false]);
  assert.deepEqual([...new Set(pushed)].sort(), ['a'.repeat(40), 'b'.repeat(40)]);
  // An engine document still runs the engine checks.
  assert.equal(selectCoverage('pull_request', event,
    releaseGit(files(), [...releasePaths, 'packages/engine/README.md'])).engine, true);
});

test('release prep with any non-version change falls back to the path rules', () => {
  for (const head of [
    { 'package-lock.json': lockfile('0.17.0', { range: '1.0.1' }) },
    // Changes outside the RoleFit workspace entry, which it leaves identical.
    { 'package-lock.json': lockfile('0.17.0', { installed: '1.0.1' }) },
    { 'package-lock.json': lockfile('0.17.0', { integrity: 'sha512-b' }) },
    { 'package-lock.json': lockfile('0.17.0', { root: ['apps/*'] }) },
    { 'apps/role-fit-ai/package.json': manifest('0.17.0', { scripts: { check: 'true' } }) },
    { 'apps/role-fit-ai/package.json': manifest('0.17.0', { engines: { node: '>=24' } }) },
  ]) {
    assert.equal(isReleasePrep(releasePaths, reader(files(head))), false);
    assert.deepEqual(coverage(selectCoverage('push', { before: 'a'.repeat(40), after: 'b'.repeat(40) },
      releaseGit(files(head)))), [true, true, false, true]);
  }
  for (const path of ['package.json', 'apps/role-fit-ai/src/App.tsx', 'apps/role-fit-ai/scripts/desktop-release-contract.mjs']) {
    assert.equal(isReleasePrep([...releasePaths, path], reader(files())), false, path);
  }
  // Markdown and the release contract test alone are not a version bump.
  assert.equal(isReleasePrep(['CONTINUITY.md', 'apps/role-fit-ai/scripts/desktop-release-contract.test.mjs'], reader(files())), false);
});

test('malformed or unavailable release files run all coverage', () => {
  const event = { pull_request: { base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } } };
  for (const git of [
    releaseGit(files({ 'package-lock.json': '{"packages":' })),
    releaseGit(files({ 'package-lock.json': JSON.stringify({ packages: {} }) })),
    releaseGit(files({ 'apps/role-fit-ai/package.json': 'null' })),
    releaseGit({ ...files(), head: { 'apps/role-fit-ai/package.json': manifest('0.17.0') } }),
    releaseGit(files(), releasePaths, 'not-a-sha'),
    (command, args) => { if (args[0] === 'diff') return `${releasePaths.join('\0')}\0`; throw new Error('show failed'); },
  ]) {
    assert.deepEqual(coverage(selectCoverage('pull_request', event, git)), [true, true, true, true]);
  }
});
