import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// Selector keys of every gated job; `Runtime and dependency contracts` scans every
// source file's imports, so it always runs.
export const JOBS = ['typescript', 'engine', 'engineFonts', 'editor', 'typeset', 'rolefit', 'server', 'browser'];

// Root inputs every job depends on: install, runtime, compiler, and CI wiring.
const ROOT_INPUTS = new Set([
  'package.json', 'package-lock.json', '.node-version', '.npmrc', 'tsconfig.base.json',
  '.github/workflows/document-workflows.yml', 'scripts/ci-coverage-selection.mjs',
]);
// The font generators use only their own Python toolchain, so of the root inputs
// only CI wiring reaches them.
const CI_WIRING = new Set(['.github/workflows/document-workflows.yml', 'scripts/ci-coverage-selection.mjs']);

// Reachable sources, measured by bundling each suite's entry: the server reaches
// RoleFit's src/ and shared/; the browser harness imports no server code but reads
// the starter resume, and its Vite transform applies each app's tsconfig.
const ROLEFIT_SERVER_INPUTS = ['apps/role-fit-ai/server.ts', 'apps/role-fit-ai/server/', 'apps/role-fit-ai/shared/',
  'apps/role-fit-ai/src/', 'apps/role-fit-ai/package.json'];
const ROLEFIT_BROWSER_INPUTS = ['apps/role-fit-ai/src/', 'apps/role-fit-ai/shared/',
  'apps/role-fit-ai/server/starter.resume', 'apps/role-fit-ai/tsconfig.json'];
const TYPESET_BROWSER_INPUTS = ['apps/typeset/src/', 'apps/typeset/tsconfig.json'];
const ENGINE_FONT_INPUTS = ['packages/engine/scripts/', 'packages/engine/fonts/',
  'packages/engine/src/typeset/metrics.gen.ts', 'packages/engine/src/typeset/metrics/', 'packages/engine/package.json'];
const within = (path, prefixes) => prefixes.some(prefix => path === prefix || (prefix.endsWith('/') && path.startsWith(prefix)));

// Release prep may change only the RoleFit workspace version in these documents.
const VERSION_OWNERS = new Map([
  ['apps/role-fit-ai/package.json', manifest => manifest],
  ['package-lock.json', lockfile => lockfile.packages?.['apps/role-fit-ai']],
]);

// Which gated jobs one changed path can affect. `versionOnly` holds the version
// documents whose only change is the RoleFit version.
export function jobsForPath(path, versionOnly = new Set()) {
  // RoleFit's rename and extension contracts read its Markdown; no other check does.
  if (path.endsWith('.md')) return path.startsWith('apps/role-fit-ai/') ? ['rolefit'] : [];
  if (versionOnly.has(path)) return path === 'package-lock.json' ? [] : ['rolefit'];
  if (ROOT_INPUTS.has(path)) return CI_WIRING.has(path) ? JOBS : JOBS.filter(job => job !== 'engineFonts');
  // TypeScript 7 native checks each platform's compiler binary; per-workspace jobs typecheck sources.
  const jobs = /(^|\/)tsconfig[^/]*\.json$/.test(path) || path === 'scripts/tsconfig-base-probe.ts' ? ['typescript'] : [];
  if (path.startsWith('packages/engine/')) {
    jobs.push('engine', 'editor', 'typeset', 'rolefit', 'server', 'browser');
    if (within(path, ENGINE_FONT_INPUTS)) jobs.push('engineFonts');
  } else if (path.startsWith('packages/editor/')) {
    jobs.push('editor', 'typeset', 'rolefit', 'browser');
  } else if (path.startsWith('apps/typeset/')) {
    jobs.push('typeset', ...(within(path, TYPESET_BROWSER_INPUTS) ? ['browser'] : []));
  } else if (path.startsWith('apps/role-fit-ai/')) {
    jobs.push('rolefit');
    if (within(path, ROLEFIT_SERVER_INPUTS)) jobs.push('server');
    if (within(path, ROLEFIT_BROWSER_INPUTS)) jobs.push('browser');
  } else if (path.startsWith('scripts/editor-browser-contracts')) {
    jobs.push('browser');
  } else if (/^(apps|packages)\//.test(path) || !path.includes('/')) {
    // An unknown workspace or root file may feed any job.
    return JOBS;
  }
  return jobs;
}

function withoutVersion(text, owner) {
  const document = JSON.parse(text);
  const versioned = owner(document);
  if (typeof versioned?.version !== 'string') throw new Error('RoleFit version missing');
  delete versioned.version;
  return document;
}

// `read(side, path)` returns the file at the comparison's 'base' or 'head'; any
// read or parse failure throws so the caller runs everything.
export function versionOnlyChanges(paths, read) {
  return new Set(paths.filter(path => VERSION_OWNERS.has(path)).filter(path => {
    const owner = VERSION_OWNERS.get(path);
    return isDeepStrictEqual(withoutVersion(read('base', path), owner), withoutVersion(read('head', path), owner));
  }));
}

const RUN_ALL = Object.fromEntries(JOBS.map(job => [job, true]));

// Workflow output lines; each gate runs its job unless the output is exactly `false`.
export const outputName = job => job.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
export const formatOutputs = selection => JOBS.map(job => `${outputName(job)}=${selection[job]}\n`).join('');

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
    if (paths.length === 0) return { ...RUN_ALL, reason: 'Empty comparison; running all coverage.' };
    // A PR diff starts at the merge base, so file contents must too.
    let baseRev = eventName === 'pull_request' ? undefined : base;
    const read = (side, path) => {
      if (side === 'base' && !baseRev) {
        baseRev = run(['merge-base', base, head]).trim();
        if (!validSha(baseRev)) throw new Error('Merge base unavailable');
      }
      return run(['show', `${side === 'head' ? head : baseRev}:${path}`]);
    };
    const versionOnly = versionOnlyChanges(paths, read);
    const selected = new Set(paths.flatMap(path => jobsForPath(path, versionOnly)));
    return {
      ...Object.fromEntries(JOBS.map(job => [job, selected.has(job)])),
      reason: `${paths.length} changed paths${versionOnly.size ? '; RoleFit version-only manifest or lockfile' : ''}.`,
    };
  } catch {
    return { ...RUN_ALL, reason: 'Git comparison or version check unavailable; running all coverage.' };
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
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, formatOutputs(selection));
}
