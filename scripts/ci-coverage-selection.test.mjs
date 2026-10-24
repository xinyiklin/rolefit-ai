import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { formatOutputs, JOBS, jobsForPath, outputName, selectCoverage, versionOnlyChanges } from './ci-coverage-selection.mjs';

const selected = selection => JOBS.filter(job => selection[job]);
const jobs = path => [...jobsForPath(path)].sort();
const sorted = list => [...list].sort();
const ALL_BUT_FONTS = JOBS.filter(job => job !== 'engineFonts');

test('each changed path selects only the jobs that can reach it', () => {
  for (const [paths, expected] of [
    [['packages/engine/src/typeset/layout.ts'], ['engine', 'editor', 'typeset', 'rolefit', 'server', 'browser']],
    [['packages/engine/fonts/Arimo-Bold.ttf', 'packages/engine/scripts/generate_font_assets.py',
      'packages/engine/src/typeset/metrics.gen.ts', 'packages/engine/src/typeset/metrics/inter.gen.ts',
      'packages/engine/package.json'],
    ['engine', 'engineFonts', 'editor', 'typeset', 'rolefit', 'server', 'browser']],
    [['packages/editor/src/editor.tsx'], ['editor', 'typeset', 'rolefit', 'browser']],
    [['apps/typeset/src/App.tsx'], ['typeset', 'browser']],
    [['apps/typeset/vite.config.ts', 'apps/typeset/public/icon.svg'], ['typeset']],
    [['apps/role-fit-ai/src/App.tsx', 'apps/role-fit-ai/shared/contentWarnings.ts'], ['rolefit', 'server', 'browser']],
    [['apps/role-fit-ai/server.ts', 'apps/role-fit-ai/server/ai/prompts.ts', 'apps/role-fit-ai/package.json'], ['rolefit', 'server']],
    // The browser harness reads the starter resume as its strict fixture.
    [['apps/role-fit-ai/server/starter.resume'], ['rolefit', 'server', 'browser']],
    [['apps/role-fit-ai/desktop/main.ts', 'apps/role-fit-ai/landing/index.html', 'apps/role-fit-ai/extension/manifest.json',
      'apps/role-fit-ai/scripts/desktop-release-contract.test.mjs'], ['rolefit']],
    [['scripts/editor-browser-contracts/main.tsx', 'scripts/editor-browser-contracts-chromium.mjs'], ['browser']],
    [['apps/typeset/tsconfig.json'], ['typescript', 'typeset', 'browser']],
    [['apps/role-fit-ai/tsconfig.json'], ['typescript', 'rolefit', 'browser']],
    [['apps/role-fit-ai/tsconfig.server.json'], ['typescript', 'rolefit']],
    [['scripts/tsconfig-base-probe.ts'], ['typescript']],
  ]) {
    for (const path of paths) assert.deepEqual(jobs(path), sorted(expected), path);
  }
});

test('Markdown, CI-only scripts, and unrelated tooling run no gated job', () => {
  for (const path of ['README.md', 'CONTINUITY.md', 'docs/development.md', 'packages/engine/README.md',
    'apps/typeset/AGENTS.md', 'scripts/check-dependency-contracts.mjs',
    'scripts/check-package-script-paths.mjs', 'scripts/install-git-hooks.mjs', 'scripts/ci-coverage-selection.test.mjs',
    '.github/dependabot.yml', '.github/workflows/deploy-typeset.yml', '.githooks/commit-msg', 'docs/images/shot.png']) {
    assert.deepEqual(jobs(path), [], path);
  }
  // RoleFit's rename and extension contracts read its Markdown.
  for (const path of ['apps/role-fit-ai/extension/README.md', 'apps/role-fit-ai/docs/releases/0.17.0-beta.1.md',
    'apps/role-fit-ai/docs/engineering/ai-server.md']) {
    assert.deepEqual(jobs(path), ['rolefit'], path);
  }
});

test('root inputs and unknown workspaces or root files run every job', () => {
  for (const path of ['package.json', 'package-lock.json', '.node-version', '.npmrc', 'tsconfig.base.json']) {
    assert.deepEqual(jobs(path), sorted(ALL_BUT_FONTS), path);
  }
  for (const path of ['.github/workflows/document-workflows.yml', 'scripts/ci-coverage-selection.mjs',
    'packages/new-package/src/index.ts', 'apps/new-app/src/main.ts', 'vite.config.ts', '.gitattributes']) {
    assert.deepEqual(jobs(path), sorted(JOBS), path);
  }
});

test('the selector writes exactly the outputs the workflow gates on', () => {
  const workflow = readFileSync(new URL('../.github/workflows/document-workflows.yml', import.meta.url), 'utf8');
  const written = formatOutputs(Object.fromEntries(JOBS.map(job => [job, false]))).trim().split('\n').map(line => line.split('=')[0]);
  const declared = [...workflow.matchAll(/^      ([a-z-]+): \$\{\{ steps\.coverage\.outputs\.([a-z-]+) \}\}$/gm)];
  assert.deepEqual(declared.map(([, key, output]) => { assert.equal(key, output); return key; }).sort(), [...written].sort());
  const gated = new Set([...workflow.matchAll(/needs\.changes\.outputs\.([a-z-]+)/g)].map(([, key]) => key));
  assert.deepEqual([...gated].sort(), [...written].sort());
  assert.deepEqual(written, JOBS.map(outputName));
  assert.equal(outputName('engineFonts'), 'engine-fonts');
  // A missing output must run its job, never skip it.
  const gates = workflow.match(/^\s+if: .*needs\.changes\.outputs\..*$/gm);
  for (const gate of gates) assert.match(gate, /^\s+if: needs\.changes\.outputs\.[a-z-]+ != 'false'$/, gate);
  assert.match(workflow, /if \[ "\$SELECTED" != false \]; then/);
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
    assert.deepEqual(selected(selection), ['rolefit', 'server']);
    // A rename from a renderer to an excluded directory still includes its old path.
    assert.equal(selectCoverage(name, event, () => 'packages/editor/deleted.ts\0apps/role-fit-ai/server/ai/moved.ts\0').browser, true);
  }
});

test('manual, unknown, malformed, empty and unavailable comparisons run all coverage', () => {
  const neverGit = () => { assert.fail('must not invoke git for an invalid comparison'); };
  for (const name of ['workflow_dispatch', 'schedule', 'push', 'pull_request']) {
    assert.deepEqual(selected(selectCoverage(name, {}, neverGit)), JOBS);
  }
  assert.deepEqual(selected(selectCoverage('push', { before: '0'.repeat(40), after: 'b'.repeat(40) }, neverGit)), JOBS);
  assert.deepEqual(selected(selectCoverage('push', { before: '--output=unsafe', after: 'b'.repeat(40) }, neverGit)), JOBS);
  const event = { before: 'a'.repeat(40), after: 'b'.repeat(40) };
  assert.deepEqual(selected(selectCoverage('push', event, () => { throw new Error('missing history'); })), JOBS);
  assert.deepEqual(selected(selectCoverage('push', event, () => '')), JOBS);
  assert.equal(selectCoverage('push', event, () => 'packages/editor/name\nwith-newline.ts\0').browser, true);
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
const VERSIONED = ['apps/role-fit-ai/package.json', 'package-lock.json'];
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
const prEvent = { pull_request: { base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } } };
const pushEvent = { before: 'a'.repeat(40), after: 'b'.repeat(40) };

test('a RoleFit version-only release runs only the RoleFit app job', () => {
  assert.deepEqual(sorted(versionOnlyChanges(releasePaths, reader(files()))), VERSIONED);
  const shown = [];
  const git = releaseGit(files());
  assert.deepEqual(selected(selectCoverage('pull_request', prEvent, (command, args) => {
    if (args[0] === 'show') shown.push(args[1]);
    return git(command, args);
  })), ['rolefit']);
  // A PR reads its base files at the merge base, matching the three-dot diff.
  assert.deepEqual(shown.filter(rev => rev.startsWith('a')), []);
  assert.ok(shown.includes(`${'c'.repeat(40)}:package-lock.json`));
  // A push compares and reads from `before` directly.
  const pushed = [];
  assert.deepEqual(selected(selectCoverage('push', pushEvent, (command, args) => {
    assert.notEqual(args[0], 'merge-base');
    if (args[0] === 'show') pushed.push(args[1].slice(0, 40));
    return git(command, args);
  })), ['rolefit']);
  assert.deepEqual([...new Set(pushed)].sort(), ['a'.repeat(40), 'b'.repeat(40)]);
  // Each version document alone selects its own jobs.
  assert.deepEqual(selected(selectCoverage('push', pushEvent, releaseGit(files(), ['apps/role-fit-ai/package.json']))), ['rolefit']);
  assert.deepEqual(selected(selectCoverage('push', pushEvent, releaseGit(files(), ['package-lock.json']))), []);
  // Other paths in a release still select their own jobs.
  assert.deepEqual(selected(selectCoverage('push', pushEvent, releaseGit(files(), [...releasePaths, 'apps/role-fit-ai/src/App.tsx']))),
    ['rolefit', 'server', 'browser']);
});

test('any non-version manifest or lockfile change keeps its root coverage', () => {
  for (const head of [
    { 'package-lock.json': lockfile('0.17.0', { range: '1.0.1' }) },
    // Changes outside the RoleFit workspace entry, which it leaves identical.
    { 'package-lock.json': lockfile('0.17.0', { installed: '1.0.1' }) },
    { 'package-lock.json': lockfile('0.17.0', { integrity: 'sha512-b' }) },
    { 'package-lock.json': lockfile('0.17.0', { root: ['apps/*'] }) },
  ]) {
    assert.deepEqual(sorted(versionOnlyChanges(releasePaths, reader(files(head)))), ['apps/role-fit-ai/package.json']);
    assert.deepEqual(selected(selectCoverage('push', pushEvent, releaseGit(files(head)))), ALL_BUT_FONTS);
  }
  for (const head of [
    { 'apps/role-fit-ai/package.json': manifest('0.17.0', { scripts: { check: 'true' } }) },
    { 'apps/role-fit-ai/package.json': manifest('0.17.0', { engines: { node: '>=24' } }) },
  ]) {
    assert.deepEqual(sorted(versionOnlyChanges(releasePaths, reader(files(head)))), ['package-lock.json']);
    assert.deepEqual(selected(selectCoverage('push', pushEvent, releaseGit(files(head)))), ['rolefit', 'server']);
  }
});

test('malformed or unavailable version documents run all coverage', () => {
  for (const git of [
    releaseGit(files({ 'package-lock.json': '{"packages":' })),
    releaseGit(files({ 'package-lock.json': JSON.stringify({ packages: {} }) })),
    releaseGit(files({ 'apps/role-fit-ai/package.json': 'null' })),
    releaseGit({ ...files(), head: { 'apps/role-fit-ai/package.json': manifest('0.17.0') } }),
    releaseGit(files(), releasePaths, 'not-a-sha'),
    (command, args) => { if (args[0] === 'diff') return `${releasePaths.join('\0')}\0`; throw new Error('show failed'); },
  ]) {
    assert.deepEqual(selected(selectCoverage('pull_request', prEvent, git)), JOBS);
  }
});
