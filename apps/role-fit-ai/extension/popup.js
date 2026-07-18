/** RoleFit AI popup (ESM, Manifest V3). */

const API_BASE = 'http://localhost:5181';

// ── DOM helpers ───────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// `appliedAt` is a calendar day (stored as YYYY-MM-DD). Parse the date parts as
// a LOCAL date rather than `new Date(iso)`, which reads a bare date as UTC
// midnight and would render the day before in US timezones.
function formatDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function randomClaimToken() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // Fall through to the compact fallback below.
  }
  return `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Maps a stored application to a banner treatment. `prominent` tones (applied /
// offer / interviewing / rejected) surface a tinted banner so the user sees
// "you've been here" before deciding to import again.
function statusInfo(app) {
  if (!app) return { tone: 'idle', icon: '+', label: 'Not yet tracked', sub: '' };
  switch (app.status) {
    case 'applied':
      return { tone: 'applied', icon: '✓', label: 'Already applied', sub: formatDate(app.appliedAt) };
    case 'interviewing':
      return { tone: 'applied', icon: '◆', label: 'In interviews', sub: '' };
    case 'offer':
      return { tone: 'offer', icon: '★', label: 'Offer received', sub: '' };
    case 'interested':
      return { tone: 'tracking', icon: '•', label: 'Tracking, not yet applied', sub: '' };
    case 'rejected':
      return { tone: 'rejected', icon: '–', label: 'Not selected here', sub: formatDate(app.appliedAt) };
    case 'withdrawn':
      return { tone: 'idle', icon: '–', label: 'Withdrew application', sub: '' };
    default:
      return { tone: 'tracking', icon: '•', label: String(app.status || 'Tracked'), sub: '' };
  }
}

// ── Component builders ────────────────────────────────────────────────────

function renderMasthead() {
  return el('div', { className: 'masthead' },
    el('div', { className: 'brand-mark', textContent: 'R' }),
    el('span', { className: 'brand-name', textContent: 'RoleFit AI' }),
    el('span', { className: 'brand-tag', textContent: 'job import' })
  );
}

function renderLoading() {
  return el('div', { className: 'state-loading', role: 'status', 'aria-live': 'polite' },
    el('div', { className: 'spinner', 'aria-hidden': 'true' }),
    el('span', { textContent: 'Reading job posting…' })
  );
}

function renderError(title, msg = '') {
  return el('div', { className: 'state-error', role: 'alert' },
    el('div', { className: 'error-card' },
      el('div', { className: 'error-mark', textContent: '!' }),
      el('div', {},
        el('div', { className: 'error-title', textContent: title }),
        msg ? el('div', { className: 'error-msg', textContent: msg }) : null
      )
    )
  );
}

function renderResult(data, onImport) {
  const { title, company, previousApp } = data;
  const si = statusInfo(previousApp);

  const importBtn = el('button', { className: 'btn-import', type: 'button', 'aria-live': 'polite' },
    el('span', { className: 'btn-arrow', textContent: '↧' }),
    'Import to RoleFit AI'
  );

  // Optional shortcut: when checked, the app auto-runs the polish once the
  // imported posting finishes distilling — no second click. The preference
  // persists across popups via chrome.storage.local.
  const autoTailorInput = el('input', { type: 'checkbox', className: 'auto-tailor__input' });
  // Restore the saved preference, but never clobber a value the user toggled while
  // the async storage read was still in flight (open popup → click before get resolves).
  let autoTailorTouched = false;
  chrome.storage?.local?.get?.(['autoTailor'], (saved) => {
    if (!autoTailorTouched) autoTailorInput.checked = Boolean(saved && saved.autoTailor);
  });
  autoTailorInput.addEventListener('change', () => {
    autoTailorTouched = true;
    chrome.storage?.local?.set?.({ autoTailor: autoTailorInput.checked });
  });
  const autoTailorToggle = el('label', { className: 'auto-tailor' },
    autoTailorInput,
    el('span', { className: 'auto-tailor__label', textContent: 'Polish automatically after import' })
  );

  // Distill with AI: default TRUE (preserves current behavior). Off → the app
  // uses the deterministic parser instead of an AI provider call for this import.
  const distillAiInput = el('input', { type: 'checkbox', className: 'auto-tailor__input' });
  let distillAiTouched = false;
  chrome.storage?.local?.get?.(['distillAi'], (saved) => {
    // Default true: treat a never-set key as checked so a first-time user gets
    // the prior distill-by-default behavior. Same touched-flag race guard as
    // autoTailor so the async read can't clobber a click that landed first.
    if (!distillAiTouched) distillAiInput.checked = !saved || saved.distillAi !== false;
  });
  distillAiInput.addEventListener('change', () => {
    distillAiTouched = true;
    chrome.storage?.local?.set?.({ distillAi: distillAiInput.checked });
  });
  const distillAiToggle = el('label', { className: 'auto-tailor' },
    distillAiInput,
    el('span', { className: 'auto-tailor__label', textContent: 'Distill with AI' })
  );

  importBtn.addEventListener('click', () => onImport(importBtn, autoTailorInput.checked, distillAiInput.checked));

  // Layered-match evidence for the previously-saved card: a compact muted line
  // (e.g. "Same LinkedIn posting (#123) · Same posting URL"). A non-"exact" match
  // is a softer signal, so prefix "Possible duplicate:" to keep the user from
  // over-trusting it. Only shown when a tracked application matched.
  const match = data.match;
  const evidenceLine =
    previousApp && match && Array.isArray(match.evidence) && match.evidence.length
      ? el('div', {
          className: 'applied-evidence',
          textContent:
            (match.confidence !== 'exact' ? 'Possible duplicate: ' : '') + match.evidence.join(' · ')
        })
      : null;

  return el('div', { className: 'state-result' },
    el('div', { className: 'job-meta' },
      el('div', { className: 'job-title', textContent: title || 'Job posting' }),
      company ? el('div', { className: 'job-company', textContent: company }) : null
    ),
    el('div', { className: `applied-banner tone-${si.tone}` },
      el('span', { className: 'applied-icon', textContent: si.icon }),
      el('div', { className: 'applied-body' },
        el('div', { className: 'applied-label', textContent: si.label }),
        si.sub ? el('div', { className: 'applied-sub', textContent: si.sub }) : null,
        evidenceLine
      )
    ),
    el('div', { className: 'no-resume' },
      el('div', { className: 'no-resume-mark', textContent: 'AI' }),
      'Import this role, then run AI Review for the score and verdict.'
    ),
    importBtn,
    autoTailorToggle,
    distillAiToggle,
    el('div', { className: 'foot', textContent: 'RoleFit does not estimate fit locally.' })
  );
}

// ── Page text extraction (injected into the active tab) ────────────────────

function extractPageData() {
  const selectors = [
    '#jobDescriptionText',       // Indeed
    '.jobs-description',         // LinkedIn
    '.posting',                  // Lever
    '#content',                  // Greenhouse
    '.wd-JobPostingDescription'  // Workday
  ];
  let text = '';
  for (const sel of selectors) {
    const node = document.querySelector(sel);
    if (node && node.innerText && node.innerText.trim().length > 100) {
      text = node.innerText.trim();
      break;
    }
  }
  if (!text) text = document.body.innerText || '';
  return { text: text.slice(0, 50000), url: location.href, title: document.title };
}

// ── Import handler ─────────────────────────────────────────────────────────

// Open the fresh RoleFit tab in the same Firefox Multi-Account Container as the
// job posting it was imported from. Only Firefox tabs carry a `cookieStoreId`;
// on Chrome it's undefined, so this is a no-op there. If the browser rejects the
// container (unsupported, or a private/uncreatable store), fall back to a plain
// tab so the import always opens.
async function createImportTab(url, cookieStoreId) {
  if (cookieStoreId) {
    try {
      await chrome.tabs.create({ url, cookieStoreId });
      return;
    } catch {
    // Container not usable here. Fall through to a container-less tab.
    }
  }
  await chrome.tabs.create({ url });
}

async function handleImport(btn, pageData, autoTailor, distillAi, cookieStoreId) {
  btn.disabled = true;
  // The import returns immediately; the server resolves the raw job text in the
  // background and the receiving app tab distills it client-side (honoring its
  // own Distill provider and this popup's "Distill with AI" toggle). Stays fast.
  btn.textContent = 'Importing…';
  const claimToken = randomClaimToken();

  try {
    const res = await fetch(`${API_BASE}/api/extension/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: pageData.text,
        url: pageData.url,
        autoTailor: Boolean(autoTailor),
        distillAi: Boolean(distillAi),
        claimToken
      })
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
  } catch {
    // The import never reached the inbox — don't mislead the user into
    // thinking the job was captured. Re-enable so they can retry.
    btn.disabled = false;
    btn.textContent = 'Import failed. Is RoleFit AI running?';
    return;
  }

  // The import already reached the server (inbox populated, background distill
  // kicked off). Open a fresh RoleFit tab with a claim token so this posting
  // lands in a new independent tailoring session instead of replacing an
  // in-progress app tab. Match the source tab's container so the session opens
  // in the same Firefox Multi-Account Container the job was viewed in.
  try {
    await createImportTab(`${API_BASE}/?extensionImport=${encodeURIComponent(claimToken)}`, cookieStoreId);
    btn.textContent = 'Imported ✓';
  } catch {
    // The capture succeeded; only the redirect/focus failed.
    btn.textContent = 'Imported ✓. Open RoleFit AI.';
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const root = document.getElementById('root');
  root.appendChild(renderMasthead());

  const loadingEl = renderLoading();
  root.appendChild(loadingEl);

  let tab;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTab;
  } catch {
    loadingEl.replaceWith(renderError('Could not access the current tab.'));
    return;
  }
  if (!tab || typeof tab.id !== 'number') {
    loadingEl.replaceWith(renderError('No active page found', 'Open a job posting and try again.'));
    return;
  }

  let pageData;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageData
    });
    pageData = results?.[0]?.result;
    if (!pageData) throw new Error('No result from script injection');
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    const isRestricted =
      msg.includes('Cannot access') ||
      msg.includes('chrome://') ||
      msg.includes('extension://') ||
      msg.includes('about:') ||
      msg.includes('Cannot inject');
    loadingEl.replaceWith(
      isRestricted
        ? renderError("Can't analyze this page", 'Navigate to a job posting first, then reopen.')
        : renderError('Could not read page content', 'This browser did not allow the popup to read the current page. Reload the job posting and try again.')
    );
    return;
  }

  let data;
  try {
    const res = await fetch(`${API_BASE}/api/extension/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: pageData.text, url: pageData.url, pageTitle: pageData.title })
    });
    if (!res.ok) {
      throw new Error(`server-status:${res.status}`);
    }
    data = await res.json();
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    const isConnRefused =
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('net::ERR');
    loadingEl.replaceWith(
      isConnRefused
        ? renderError('RoleFit AI is not running', 'Open the app at localhost:5181, then reopen this popup.')
        : renderError(
            'Could not check this posting',
            msg.includes('server-status:429')
              ? 'RoleFit AI is busy. Wait a moment and reopen the popup.'
              : 'The local app could not analyze this page. Reload RoleFit AI and try again.'
          )
    );
    return;
  }

  loadingEl.replaceWith(renderResult(data, (btn, autoTailor, distillAi) => handleImport(btn, pageData, autoTailor, distillAi, tab.cookieStoreId)));
}

main().catch(() => {
  const root = document.getElementById('root');
  root.replaceChildren(
    renderMasthead(),
    renderError('Unexpected error', 'Close the popup, reload the job posting, and try again.')
  );
});
