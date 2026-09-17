import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertWrappedBounds, captureWrappedEvidence, wrappedHarness } from './wrapped-harness.mjs';

const headingKey = 'heading|section';
const heading = h => h.evaluate(() => window.__rowContract.data.sections[0].heading);
const copy = h => h.evaluate(() => {
  const clipboardData = new DataTransfer();
  document.querySelector('[contenteditable=true]').dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }));
  return clipboardData.getData('text/plain');
});
const fixtureFor = (h, text) => {
  const fixture = structuredClone(h.original);
  fixture.sections[0].heading = text;
  return fixture;
};

async function sectionBounds(h, text, label) {
  const result = await assertWrappedBounds(h, fixtureFor(h, text), label);
  assert.equal(await heading(h), text, `${label}: layout preserves exact authored heading`);
  const geometry = await h.evaluate(() => {
    const root = document.querySelector('[contenteditable=true]');
    const spans = [...root.querySelectorAll('[data-tsdf]:not([data-tsdm])')];
    const heads = spans.filter(span => span.dataset.tsdf === 'heading|section');
    const collisions = [];
    for (const head of heads) {
      const rect = head.getBoundingClientRect();
      for (const next of spans.filter(span => /^(entry|bullet)\|section\|/.test(span.dataset.tsdf) && span.dataset.tsdPage === head.dataset.tsdPage)) {
        if (rect.bottom > next.getBoundingClientRect().top + 1) collisions.push({ heading: rect.toJSON(), next: next.getBoundingClientRect().toJSON() });
      }
    }
    const lines = window.__rowContract.layout().pages.flatMap((page, pageIndex) => page.lines.map(line => ({ ...line, pageIndex })))
      .filter(line => line.runs.some(run => run.src?.kind === 'heading' && run.src.sectionId === 'section'));
    return { collisions, lines: lines.length, rules: lines.flatMap((line, index) => line.rule ? [{ index, page: line.pageIndex }] : []), sectionRule: window.__rowContract.style.sectionRule };
  });
  assert.deepEqual(geometry.collisions, [], `${label}: following entry content clears every section-heading fragment`);
  assert.equal(geometry.rules.length, geometry.sectionRule ? 1 : 0, `${label}: section has exactly its configured rule count`);
  if (geometry.sectionRule) assert.equal(geometry.rules[0].index, geometry.lines-1, `${label}: rule belongs only to final continuation`);
  return { pages: result.pages, geometry };
}

async function nativeLifecycle(h, text) {
  await h.reset(fixtureFor(h, text));
  const point = await h.evaluate(() => {
    const spans = [...document.querySelectorAll('[contenteditable=true] [data-tsdf="heading|section"]')];
    const firstLine = spans[0].dataset.tsdLine;
    const span = spans.find(candidate => candidate.dataset.tsdLine !== firstLine);
    if (!span) throw new Error('Section fixture needs a continuation');
    span.scrollIntoView({ block: 'center' });
    const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left+rect.width/4, y: rect.top+rect.height/2 };
  });
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await h.page.connection.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 }, h.page.sessionId);
  }
  await h.settle();
  const caret = await h.selection();
  assert.equal(caret.focus.key, headingKey, 'native continuation click reaches section field');
  assert(caret.focus.offset > 0, 'native continuation click resolves nonzero source offset');
  assert.deepEqual(caret.anchor, caret.focus);
  await h.insert('Z');
  assert.equal(await heading(h), text.slice(0,caret.focus.offset)+'Z'+text.slice(caret.focus.offset), 'native continuation typing preserves source');
  await h.key('z', 90, 4);
  assert.equal(await heading(h), text, 'Undo restores typed section continuation');
  const boundary = await h.evaluate(() => {
    const host = document.querySelector('[contenteditable=true]');
    const spans = [...host.querySelectorAll('[data-tsdf="heading|section"]')];
    const span = spans.find(candidate => candidate.dataset.tsdLine !== spans[0].dataset.tsdLine);
    host.focus(); window.getSelection().collapse(span.firstChild, 0);
    return window.__rowContract.selection().focus.offset;
  });
  await h.key('ArrowLeft', 37);
  const start = (await h.selection()).focus.offset;
  for (let i = 0; i < 6; i++) await h.key('ArrowRight', 39, 8);
  const selection = await h.selection();
  assert.equal(selection.anchor.key, headingKey); assert.equal(selection.focus.key, headingKey);
  assert(start < boundary && selection.focus.offset > boundary, 'native Shift+Arrow range crosses a physical section wrap');
  assert.equal(await copy(h), text.slice(start,selection.focus.offset), 'native shifted range copies exact section source across wrap');
  assert.equal(await h.evaluate(() => window.getSelection().toString()), await copy(h), 'native and logical section range agree');
  await h.insert('Q');
  assert.equal(await heading(h), text.slice(0,start)+'Q'+text.slice(selection.focus.offset));
  await h.key('z', 90, 4); assert.equal(await heading(h), text);
  const needle = text.slice(Math.max(0,boundary-12),boundary+18);
  const search = await h.evaluate(needle => {
    const host = document.querySelector('[contenteditable=true]');
    host.focus(); window.getSelection().collapse(host, 0);
    const found = window.find(needle, false, false, false, false, false, false);
    return { found, text: window.getSelection().toString() };
  }, needle);
  assert(search.found, 'browser text search crosses section wrap');
  assert.equal(search.text, needle); assert.equal(await copy(h), needle);
  const ax = await h.page.connection.send('Accessibility.getFullAXTree', {}, h.page.sessionId);
  const nodes = new Map(ax.nodes.map(node => [node.nodeId,node])), strings = [];
  const visit = node => {
    if (!node) return;
    if (!node.ignored && node.role?.value === 'StaticText') strings.push(node.name?.value ?? '');
    for (const id of node.childIds ?? []) visit(nodes.get(id));
  };
  ax.nodes.filter(node => !node.parentId).forEach(visit);
  const joined = strings.join(''), headingAt = joined.indexOf(text), entryAt = joined.indexOf('Engineer');
  assert(headingAt >= 0 && entryAt >= headingAt+text.length, 'AX child order reads complete section heading before entry');
  await h.evaluate(() => window.__rowContract.reopen()); await h.settle(); await h.settle();
  assert.equal(await heading(h), text, 'strict file serialization and reopen preserve exact heading source');
  return { boundary, pointerOffset: caret.focus.offset, range: selection, search, axHeadingAt: headingAt, axEntryAt: entryAt };
}

async function continuationControls(h, text) {
  const fixture = fixtureFor(h, text);
  fixture.sections.push({ id: 'second', type: 'standard', heading: 'Second section', items: [] });
  await h.reset(fixture);
  const pages = await h.evaluate(() => [...new Set([...document.querySelectorAll(
    '[contenteditable=true] [data-tsdf="heading|section"]'
  )].map(span => Number(span.dataset.tsdPage)))]);
  assert(pages.length > 1, 'control fixture spans pages');
  const receipts = [];
  for (const page of pages) {
    const point = await h.evaluate(page => {
      const span = document.querySelector(`[data-tsdf="heading|section"][data-tsd-page="${page}"]`);
      span.scrollIntoView({ block: 'center' });
      const rect = span.getBoundingClientRect();
      return { x: rect.left+3, y: rect.top+rect.height/2 };
    }, page);
    await h.settle(); await h.settle();
    await h.page.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }, h.page.sessionId);
    await h.settle();
    const geometry = await h.evaluate(page => {
      const grip = document.querySelector('[aria-label="Reorder section. Drag, or press Arrow Up or Arrow Down"]');
      const target = document.querySelector(`.tsd-page[data-tsd-page="${page}"]`);
      return { grip: grip?.getBoundingClientRect().toJSON(), target: target.getBoundingClientRect().toJSON() };
    }, page);
    assert(geometry.grip, 'hovered heading has a reorder control');
    assert(geometry.grip.top >= geometry.target.top-1 && geometry.grip.bottom <= geometry.target.bottom+1,
      `section reorder control follows hovered page ${page}`);
    receipts.push({ page, ...geometry });
  }
  return receipts;
}

export async function runWrappedSectionContracts({ makeWindow, waitFor, baseUrl }) {
  const evidence = process.env.ROLEFIT_EDITOR_WRAPPED_AUDIT_DIR;
  for (const host of ['typeset', 'rolefit']) {
    const page = await makeWindow();
    await page.connection.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    await page.loadURL(`${baseUrl}#entry-rows-${host}`);
    await waitFor(page, 'window.__rowContract?.data.sections[0]?.id === "section"', `${host} section fixture`);
    const h = await wrappedHarness(page, waitFor);
    const style = await h.evaluate(() => window.__rowContract.style);
    const report = { host, cases: [], native: [], limitations: ['Synthetic clipboard events', 'window.find is not native Find UI', 'AX tree is not an actual screen-reader session'] };
    for (const length of [80, 512, 4096]) {
      for (const spaced of [false, true]) {
        const text = spaced ? 'Section words '.repeat(Math.ceil(length/14)).slice(0,length) : 'W'.repeat(length);
        const label = `${host} section/${length}/${spaced ? 'spaced' : 'token'}`;
        const result = await sectionBounds(h, text, label);
        if (length >= 512) assert(result.geometry.lines > 1, `${label}: section heading wraps`);
        await h.evaluate(() => window.__rowContract.reopen()); await h.settle(); await h.settle();
        assert.equal(await heading(h), text, `${label}: file round trip preserves exact source`);
        report.cases.push({ length, spaced, ...result });
      }
    }
    const wrapped = Array.from({ length: 75 }, (_, index) => `Section${index}`).join(' ');
    for (const headingCase of ['smallcaps', 'uppercase', 'none']) {
      for (const headingAlign of ['left', 'center', 'right']) {
        await h.evaluate(style => window.__rowContract.applyStyle(style), { ...style, headingCase, headingAlign });
        const result = await sectionBounds(h, wrapped, `${host} section ${headingCase}/${headingAlign}`);
        report.cases.push({ headingCase, headingAlign, ...result });
      }
    }
    await h.evaluate(style => window.__rowContract.applyStyle(style), { ...style, headingCase: 'none' });
    report.native.push(await nativeLifecycle(h, wrapped));
    const tall = Array.from({ length: 650 }, (_, index) => `Heading${index}`).join(' ');
    const tallResult = await sectionBounds(h, tall, `${host} section taller than page`);
    assert(tallResult.pages > 1, 'tall section paginates');
    report.native.push(await nativeLifecycle(h, tall));
    report.continuationControls = await continuationControls(h, tall);
    await h.evaluate(style => window.__rowContract.applyStyle(style), style);
    for (const [label, text] of [
      ['section-short', 'Experience'], ['section-wrapped', wrapped], ['section-tall', tall],
      ['section-mixed', '<size=18><u>Mixed section heading </u></size><i>smaller words </i>'.repeat(14)]
    ]) {
      await sectionBounds(h, text, `${host} ${label}`);
      if (evidence) await captureWrappedEvidence(h, evidence, host, label);
    }
    if (host === 'typeset') {
      for (const font of await h.evaluate(() => window.__rowContract.fonts)) {
        await h.evaluate(style => window.__rowContract.applyStyle(style), { ...style, fontFamily: font.value });
        await sectionBounds(h, wrapped, `${host} section font ${font.value}`);
        if (evidence) await captureWrappedEvidence(h, evidence, host, `section-font-${font.value}`);
      }
    }
    await h.evaluate(style => window.__rowContract.applyStyle(style), { ...style, sectionRule: false });
    await sectionBounds(h, wrapped, `${host} section without rule`);
    await h.evaluate(style => window.__rowContract.applyStyle(style), style);
    if (evidence) { await mkdir(evidence, { recursive: true }); await writeFile(join(evidence, `${host}-sections.json`), JSON.stringify(report, null, 2)); }
    console.log(`Wrapped sections ${host}: 80/512/4096 spaced/token geometry and exact file round trips, case/alignment, native continuation/Shift range/typing/Undo, search/AX order, tall pagination, rule placement and outputs passed`);
    await page.destroy();
  }
}
