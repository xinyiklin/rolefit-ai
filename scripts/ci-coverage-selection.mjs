import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Root inputs every engine check depends on: install, runtime, compiler, and CI wiring.
const ENGINE_ROOT_INPUTS = new Set([
  'package.json', 'package-lock.json', '.node-version', '.npmrc', 'tsconfig.base.json',
  '.github/workflows/document-workflows.yml', 'scripts/ci-coverage-selection.mjs',
]);
const CI_WIRING = new Set(['.github/workflows/document-workflows.yml', 'scripts/ci-coverage-selection.mjs']);

export function needsExtended(paths) {
  return paths.length === 0 || paths.some(path => !(
    path.endsWith('.md') || path.startsWith('apps/role-fit-ai/server/ai/') ||
    path.startsWith('apps/role-fit-ai/server/ai-cli/')
  ));
}

// The engine depends on no app or editor code, so only its own tree and root inputs change it.
export function needsEngine(paths) {
  return paths.length === 0 || paths.some(path => path.startsWith('packages/engine/') || ENGINE_ROOT_INPUTS.has(path));
}

// The font generators read and write only these engine paths; the manifest
// defines the `fonts:check` command itself.
export function needsEngineFonts(paths) {
  return paths.length === 0 || paths.some(path =>
    path.startsWith('packages/engine/scripts/') || path.startsWith('packages/engine/fonts/') ||
    path === 'packages/engine/src/typeset/metrics.gen.ts' || path === 'packages/engine/package.json' ||
    CI_WIRING.has(path));
}

const RUN_ALL = { extended: true, engine: true, engineFonts: true };

export function selectCoverage(eventName, event, git = execFileSync) {
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  const head = eventName === 'pull_request' ? event.pull_request?.head?.sha : event.after;
  const validSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) && !/^0+$/.test(value);
  if (!['pull_request', 'push'].includes(eventName) || !validSha(base) || !validSha(head)) {
    return { ...RUN_ALL, reason: 'Manual run or unavailable comparison; running all coverage.' };
  }
  try {
    // Disabling rename detection includes both old and new paths, including deletions.
    const comparison = `${base}${eventName === 'pull_request' ? '...' : '..'}${head}`;
    const paths = git('git', ['diff', '--name-only', '--no-renames', '-z', comparison, '--'], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\0').filter(Boolean);
    return {
      extended: needsExtended(paths),
      engine: needsEngine(paths),
      engineFonts: needsEngineFonts(paths),
      reason: `${paths.length} changed paths.`,
    };
  } catch {
    return { ...RUN_ALL, reason: 'Git comparison unavailable; running all coverage.' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let selection;
  try {
    selection = selectCoverage(process.env.GITHUB_EVENT_NAME, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
  } catch {
    selection = { ...RUN_ALL, reason: 'Event context unavailable; running all coverage.' };
  }
  console.log(JSON.stringify(selection));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,
      `extended=${selection.extended}\nengine=${selection.engine}\nengine-fonts=${selection.engineFonts}\n`);
  }
}
