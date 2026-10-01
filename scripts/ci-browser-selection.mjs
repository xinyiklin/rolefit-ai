import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function needsExtended(paths) {
  return paths.length === 0 || paths.some(path => !(
    path.endsWith('.md') || path.startsWith('apps/role-fit-ai/server/ai/') ||
    path.startsWith('apps/role-fit-ai/server/ai-cli/')
  ));
}

export function selectExtended(eventName, event, git = execFileSync) {
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  const head = eventName === 'pull_request' ? event.pull_request?.head?.sha : event.after;
  const validSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) && !/^0+$/.test(value);
  if (!['pull_request', 'push'].includes(eventName) || !validSha(base) || !validSha(head)) {
    return { run: true, reason: 'Manual run or unavailable comparison; running extended coverage.' };
  }
  try {
    // Disabling rename detection includes both old and new paths, including deletions.
    const comparison = `${base}${eventName === 'pull_request' ? '...' : '..'}${head}`;
    const paths = git('git', ['diff', '--name-only', '--no-renames', '-z', comparison, '--'], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).split('\0').filter(Boolean);
    return { run: needsExtended(paths), reason: `${paths.length} changed paths; only Markdown and backend AI-only changes may skip extended coverage.` };
  } catch {
    return { run: true, reason: 'Git comparison unavailable; running extended coverage.' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let selection;
  try {
    selection = selectExtended(process.env.GITHUB_EVENT_NAME, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
  } catch {
    selection = { run: true, reason: 'Event context unavailable; running extended coverage.' };
  }
  console.log(JSON.stringify(selection));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `extended=${selection.run}\n`);
}
