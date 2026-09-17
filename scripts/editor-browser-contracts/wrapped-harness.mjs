import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const rowKey = (field) => `entry|section|entry|${field}`;
export async function wrappedHarness(page, waitFor, api = "__rowContract") {
  const bounded = async (operation, milliseconds = 10_000) => {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Wrapped browser operation exceeded ${milliseconds}ms`)), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  };
  const evaluate = (fn, ...args) => bounded(page.evaluate(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`));
  const settle = () => bounded(page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'), 30_000);
  const original = await page.evaluate(`window.${api}.data`);
  const reset = async (data = original) => {
    await evaluate((data, api) => window[api].reset(data), data, api);
    await settle(); await settle();
  };
  const select = async (field, start, end = start, endField = field) => {
    await evaluate((key, start, endKey, end) => window.__rowContract.select(key, start, endKey, end), rowKey(field), start, rowKey(endField), end);
    await settle();
  };
  const key = async (key, code, modifiers = 0) => {
    await page.connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}) }, page.sessionId);
    await page.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, modifiers }, page.sessionId);
    await settle();
  };
  const entry = () => page.evaluate('window.__rowContract.data.sections[0].items[0]');
  const selection = () => page.evaluate(`window.${api}.selection()`);
  const insert = async text => { await page.connection.send('Input.insertText', { text }, page.sessionId); await settle(); };
  const fixture = (left = 'Left heading words '.repeat(35), right = 'Right heading words '.repeat(24)) => {
    const data = structuredClone(original);
    Object.assign(data.sections[0].items[0], { titleLeft: left, titleRight: right, subtitleLeft: 'Company', subtitleRight: 'Remote' });
    return data;
  };
  return { page, waitFor, evaluate, settle, reset, select, key, entry, selection, insert, fixture, original };
}

export async function assertWrappedBounds(h, fixture, label) {
  await h.reset(fixture);
  const result = await h.evaluate(() => {
    const root = document.querySelector('[contenteditable=true]');
    const fields = {};
    const outside = [];
    for (const span of root.querySelectorAll('[data-tsdf]:not([data-tsdm])')) {
      const key = span.getAttribute('data-tsdf');
      const rect = span.getBoundingClientRect();
      const page = (span.closest('.tsd-page') ?? root.querySelector(`.tsd-page[data-tsd-page="${span.dataset.tsdPage}"]`)).getBoundingClientRect();
      (fields[key] ??= []).push({ text: span.textContent, y: rect.y });
      if (rect.left < page.left - 1 || rect.right > page.right + 1 || rect.top < page.top - 1 || rect.bottom > page.bottom + 1) outside.push({ key, textLength: span.textContent.length, left: rect.left-page.left, right: rect.right-page.right, bottom: rect.bottom-page.bottom });
    }
    const collisions = [];
    for (const line of root.querySelectorAll('.tsd-line')) {
      for (const row of ['title', 'subtitle']) {
        const candidates = line.dataset.tsdLineBox ? root.querySelectorAll(`[data-tsdf][data-tsd-line="${line.dataset.tsdLineBox}"]:not([data-tsde])`) : line.querySelectorAll('[data-tsdf]:not([data-tsde])');
        const rects = side => [...candidates].filter(span => span.getAttribute('data-tsdf').endsWith(`|${row}${side}`)).map(span => span.getBoundingClientRect());
        const left = rects('Left'), right = rects('Right');
        if (left.length && right.length && Math.max(...left.map(r => r.right)) > Math.min(...right.map(r => r.left))+1) collisions.push({ row, y: line.getBoundingClientRect().top });
      }
    }
    return { fields, outside, collisions, pages: root.querySelectorAll('.tsd-page').length };
  });
  if (result.outside.length && process.env.ROLEFIT_EDITOR_WRAPPED_AUDIT_DIR) {
    const directory = process.env.ROLEFIT_EDITOR_WRAPPED_AUDIT_DIR;
    await mkdir(directory, { recursive: true });
    const name = label.replace(/[^a-z0-9]+/gi, '-');
    await writeFile(join(directory, `${name}-failure.json`), JSON.stringify(result, null, 2));
    const screenshot = await h.page.connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, h.page.sessionId);
    await writeFile(join(directory, `${name}-failure.png`), Buffer.from(screenshot.data, 'base64'));
  }
  assert.equal(result.outside.length, 0, `${label}: ${result.outside.length} rendered spans escape their page; first=${JSON.stringify(result.outside[0])}`);
  assert.deepEqual(result.collisions, [], `${label}: paired columns do not collide`);
  return result;
}

export async function captureWrappedEvidence(h, directory, host, label, api = "__rowContract") {
  await mkdir(directory, { recursive: true });
  await h.page.evaluate('document.fonts.ready');
  for (const media of ['screen', 'print']) {
    await h.page.connection.send('Emulation.setEmulatedMedia', { media }, h.page.sessionId);
    await h.settle();
    const shot = await h.page.connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, h.page.sessionId);
    await writeFile(join(directory, `${host}-${label}-${media}.png`), Buffer.from(shot.data, 'base64'));
    if (media === 'print') {
      const pdf = await h.page.connection.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true }, h.page.sessionId);
      await writeFile(join(directory, `${host}-${label}-print.pdf`), Buffer.from(pdf.data, 'base64'));
    }
  }
  await h.page.connection.send('Emulation.setEmulatedMedia', { media: 'screen' }, h.page.sessionId);
  const available = await h.evaluate(api => ({ pdf: typeof window[api].pdf === 'function', layout: typeof window[api].layout === 'function' }), api);
  if (available.pdf) await writeFile(join(directory, `${host}-${label}-dedicated.pdf`), Buffer.from(await h.page.evaluate(`window.${api}.pdf()`)));
  if (available.layout) await writeFile(join(directory, `${host}-${label}-layout.json`), JSON.stringify(await h.page.evaluate(`window.${api}.layout()`)));
  await writeFile(join(directory, `${host}-${label}-capture.json`), JSON.stringify({ host, label, browserPrint: true, dedicatedPdf: available.pdf, layout: available.layout }));
}
