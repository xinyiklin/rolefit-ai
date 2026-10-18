import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

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

// RoleFit release prep may change only Markdown, its release contract test, and
// the RoleFit workspace version in these documents.
const RELEASE_CONTRACT_TEST = 'apps/role-fit-ai/scripts/desktop-release-contract.test.mjs';
const RELEASE_VERSION_OWNERS = new Map([
  ['apps/role-fit-ai/package.json', manifest => manifest],
  ['package-lock.json', lockfile => lockfile.packages?.['apps/role-fit-ai']],
]);

function withoutVersion(text, owner) {
  const document = JSON.parse(text);
  const versioned = owner(document);
  if (typeof versioned?.version !== 'string') throw new Error('RoleFit version missing');
  delete versioned.version;
  return document;
}

// `read(side, path)` returns the file at the comparison's 'base' or 'head'; any
// read or parse failure throws so the caller runs everything.
export function isReleasePrep(paths, read) {
  if (!paths.some(path => RELEASE_VERSION_OWNERS.has(path)) || !paths.every(path =>
    path.endsWith('.md') || path === RELEASE_CONTRACT_TEST || RELEASE_VERSION_OWNERS.has(path))) return false;
  return paths.filter(path => RELEASE_VERSION_OWNERS.has(path)).every(path => {
    const owner = RELEASE_VERSION_OWNERS.get(path);
    return isDeepStrictEqual(withoutVersion(read('base', path), owner), withoutVersion(read('head', path), owner));
  });
}

const RUN_ALL = { extended: true, engine: true, engineFonts: true, core: true };

export function selectCoverage(eventName, event, git = execFileSync) {
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  const head = eventName === 'pull_request' ? event.pull_request?.head?.sha : event.after;
  const validSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) && !/^0+$/.test(value);
  if (!['pull_request', 'push'].includes(eventName) || !validSha(base) || !validSha(head)) {
    return { ...RUN_ALL, reason: 'Manual run or unavailable comparison; running all coverage.' };
  }
  try {
    const run = args => git('git', args, {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Disabling rename detection includes both old and new paths, including deletions.
    const comparison = `${base}${eventName === 'pull_request' ? '...' : '..'}${head}`;
    const paths = run(['diff', '--name-only', '--no-renames', '-z', comparison, '--']).split('\0').filter(Boolean);
    // A PR diff starts at the merge base, so file contents must too.
    let baseRev = eventName === 'pull_request' ? undefined : base;
    const read = (side, path) => {
      if (side === 'base' && !baseRev) {
        baseRev = run(['merge-base', base, head]).trim();
        if (!validSha(baseRev)) throw new Error('Merge base unavailable');
      }
      return run(['show', `${side === 'head' ? head : baseRev}:${path}`]);
    };
    if (isReleasePrep(paths, read)) {
      return {
        extended: false,
        engine: paths.some(path => path.startsWith('packages/engine/')),
        engineFonts: needsEngineFonts(paths),
        core: false,
        reason: `${paths.length} changed paths; RoleFit version-only release prep.`,
      };
    }
    return {
      extended: needsExtended(paths),
      engine: needsEngine(paths),
      engineFonts: needsEngineFonts(paths),
      core: true,
      reason: `${paths.length} changed paths.`,
    };
  } catch {
    return { ...RUN_ALL, reason: 'Git comparison or release version check unavailable; running all coverage.' };
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
      `extended=${selection.extended}\nengine=${selection.engine}\nengine-fonts=${selection.engineFonts}\n` +
      `core=${selection.core}\n`);
  }
}
