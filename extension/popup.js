/** Role-Fit AI — popup.js (ESM, Manifest V3) */

const API_BASE = 'http://localhost:5181';
const SVG_NS = 'http://www.w3.org/2000/svg';

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

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function scoreClass(score) {
  if (score >= 85) return 'score-strong';
  if (score >= 70) return 'score-good';
  if (score >= 55) return 'score-stretch';
  return 'score-poor';
}

function verdictLabel(score) {
  if (score >= 85) return 'Strong fit';
  if (score >= 70) return 'Reasonable fit';
  if (score >= 55) return 'Stretch';
  return "Don't apply";
}

function formatMonth(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Maps a stored application to a banner treatment. `prominent` tones (applied /
// offer / interviewing / rejected) surface a tinted banner so the user sees
// "you've been here" before deciding to import again.
function statusInfo(app) {
  if (!app) return { tone: 'idle', icon: '+', label: 'Not yet tracked', sub: '' };
  const fit = app.fitScore != null ? `stored fit ${app.fitScore}` : '';
  const join = (...parts) => parts.filter(Boolean).join('  ·  ');
  switch (app.status) {
    case 'applied':
      return { tone: 'applied', icon: '✓', label: 'Already applied', sub: join(formatMonth(app.appliedAt), fit) };
    case 'interviewing':
      return { tone: 'applied', icon: '◆', label: 'In interviews', sub: fit };
    case 'offer':
      return { tone: 'offer', icon: '★', label: 'Offer received', sub: fit };
    case 'interested':
      return { tone: 'tracking', icon: '•', label: 'Tracking — not yet applied', sub: '' };
    case 'rejected':
      return { tone: 'rejected', icon: '–', label: 'Not selected here', sub: formatMonth(app.appliedAt) };
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
    el('span', { className: 'brand-tag', textContent: 'fit check' })
  );
}

function renderLoading() {
  return el('div', { className: 'state-loading' },
    el('div', { className: 'spinner' }),
    el('span', { textContent: 'Reading job posting…' })
  );
}

function renderError(title, msg = '') {
  return el('div', { className: 'state-error' },
    el('div', { className: 'error-card' },
      el('div', { className: 'error-mark', textContent: '!' }),
      el('div', {},
        el('div', { className: 'error-title', textContent: title }),
        msg ? el('div', { className: 'error-msg', textContent: msg }) : null
      )
    )
  );
}

function renderRing(score) {
  const size = 68;
  const r = 28;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const wrap = el('div', { className: `ring ${scoreClass(score)}` });
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
  svg.append(
    svgEl('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none',
      stroke: 'var(--ring-track)', 'stroke-width': 6
    }),
    svgEl('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none',
      stroke: 'currentColor', 'stroke-width': 6, 'stroke-linecap': 'round',
      'stroke-dasharray': circ.toFixed(1),
      'stroke-dashoffset': (circ * (1 - pct)).toFixed(1),
      transform: `rotate(-90 ${size / 2} ${size / 2})`
    })
  );
  wrap.append(svg, el('div', { className: 'ring-num', textContent: String(score) }));
  return wrap;
}

function renderScore(fit) {
  if (!fit) {
    return el('div', { className: 'no-resume' },
      el('div', { className: 'no-resume-mark', textContent: 'i' }),
      'Load a base resume in RoleFit AI to see your fit score for this role.'
    );
  }
  const cls = scoreClass(fit.score);
  return el('div', { className: 'score-block' },
    renderRing(fit.score),
    el('div', { className: 'score-meta' },
      el('div', { className: `score-verdict ${cls}`, textContent: fit.verdict || verdictLabel(fit.score) }),
      el('div', { className: 'score-sub', textContent: 'estimated fit · keyword match' })
    )
  );
}

function chipGroup(label, items, kind) {
  if (!items || !items.length) return null;
  return el('div', { className: 'kw-group' },
    el('div', { className: 'kw-label' },
      label,
      el('span', { className: 'kw-count', textContent: `(${items.length})` })
    ),
    el('div', { className: 'kw-chips' },
      ...items.map((t) => el('span', { className: `chip chip--${kind}`, textContent: t }))
    )
  );
}

function renderResult(data, pageData, onImport) {
  const { title, company, fit, previousApp } = data;
  const si = statusInfo(previousApp);

  const keywordGroups = fit
    ? el('div', { className: 'kw-groups' },
        chipGroup('Matches', fit.matched, 'match'),
        chipGroup('Gaps', fit.missing, 'gap')
      )
    : null;
  const hasKeywords = fit && ((fit.matched && fit.matched.length) || (fit.missing && fit.missing.length));

  const importBtn = el('button', { className: 'btn-import' },
    el('span', { className: 'btn-arrow', textContent: '↧' }),
    'Import to RoleFit AI'
  );
  importBtn.addEventListener('click', () => onImport(importBtn));

  return el('div', { className: 'state-result' },
    el('div', { className: 'job-meta' },
      el('div', { className: 'job-title', textContent: title || 'Job posting' }),
      company ? el('div', { className: 'job-company', textContent: company }) : null
    ),
    el('div', { className: `applied-banner tone-${si.tone}` },
      el('span', { className: 'applied-icon', textContent: si.icon }),
      el('div', { className: 'applied-body' },
        el('div', { className: 'applied-label', textContent: si.label }),
        si.sub ? el('div', { className: 'applied-sub', textContent: si.sub }) : null
      )
    ),
    renderScore(fit),
    hasKeywords ? keywordGroups : null,
    importBtn,
    el('div', { className: 'foot', textContent: 'Fit is a local keyword estimate — polish in the app for the AI verdict.' })
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

async function handleImport(btn, pageData) {
  btn.disabled = true;
  btn.textContent = 'Opening RoleFit AI…';

  try {
    const res = await fetch(`${API_BASE}/api/extension/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: pageData.text, url: pageData.url })
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
  } catch {
    // The import never reached the inbox — don't mislead the user into
    // thinking the job was captured. Re-enable so they can retry.
    btn.disabled = false;
    btn.textContent = 'Import failed — is RoleFit AI running?';
    return;
  }

  const tabs = await chrome.tabs.query({ url: `${API_BASE}/*` });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) {
      // The optional chain must extend through .catch — chrome.windows being
      // undefined would otherwise call .catch on undefined and throw.
      await chrome.windows?.update?.(tabs[0].windowId, { focused: true })?.catch(() => {});
    }
  } else {
    await chrome.tabs.create({ url: API_BASE });
  }

  btn.textContent = 'Imported ✓';
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

  let pageData;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageData
    });
    pageData = results?.[0]?.result;
    if (!pageData) throw new Error('No result from script injection');
  } catch (err) {
    const msg = String(err.message || err);
    const isRestricted =
      msg.includes('Cannot access') ||
      msg.includes('chrome://') ||
      msg.includes('extension://') ||
      msg.includes('about:') ||
      msg.includes('Cannot inject');
    loadingEl.replaceWith(
      isRestricted
        ? renderError("Can't analyze this page", 'Navigate to a job posting first, then reopen.')
        : renderError('Could not read page content', msg)
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
      const body = await res.text().catch(() => '');
      throw new Error(`Server error ${res.status}${body ? ': ' + body : ''}`);
    }
    data = await res.json();
  } catch (err) {
    const msg = String(err.message || err);
    const isConnRefused =
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('net::ERR');
    loadingEl.replaceWith(
      isConnRefused
        ? renderError('RoleFit AI is not running', 'Open the app at localhost:5181, then reopen this popup.')
        : renderError('Analyze request failed', msg)
    );
    return;
  }

  loadingEl.replaceWith(renderResult(data, pageData, (btn) => handleImport(btn, pageData)));
}

main().catch((err) => {
  const root = document.getElementById('root');
  root.innerHTML = '';
  root.appendChild(renderMasthead());
  root.appendChild(renderError('Unexpected error', String(err?.message ?? err)));
});
