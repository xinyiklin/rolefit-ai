import { rowKey, wrappedHarness, assertWrappedBounds, captureWrappedEvidence } from './wrapped-harness.mjs';
import { runWrappedAuditContracts } from './wrapped-audit.mjs';
import { runWrappedSectionContracts } from './wrapped-sections.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runWrappedSelectionContracts, runWrappedInputContracts } from './wrapped-row-input.mjs';
import { runWrappedNavigationContracts } from './wrapped-row-navigation.mjs';
import { runWrappedNativeContracts, observeWrappedNativeBoundaries } from './wrapped-row-native.mjs';

export async function runTightHeadingOutputContract(h, host, evidence) {
  const style = await h.page.evaluate('window.__rowContract.style');
  const tight = h.fixture(`<line-height=1>${'gyp heading '.repeat(20)}</line-height>`, '');
  tight.sections[0].items[0].subtitleLeft = 'HIGHLAND';
  tight.sections[0].items[0].subtitleRight = '';
  await h.evaluate(style => window.__rowContract.applyStyle(style), { ...style, titleSubGapPt: -6 });
  await assertWrappedBounds(h, tight, `${host} tight title/subtitle junction`);
  if (evidence) await captureWrappedEvidence(h, evidence, host, 'tight-title-subtitle');
  await h.evaluate(style => window.__rowContract.applyStyle(style), style);
}

export async function runWrappedRowContracts({ makeWindow, waitFor, baseUrl }) {
  await runWrappedSectionContracts({ makeWindow, waitFor, baseUrl });
  for (const host of ['typeset', 'rolefit']) {
    const page = await makeWindow();
    await page.connection.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    await page.loadURL(`${baseUrl}#entry-rows-${host}`);
    await waitFor(page, 'window.__rowContract?.data.sections[0]?.id === "section" && document.querySelector("[contenteditable] [data-tsdf*=titleRight]")', `${host} wrapped fixture`);
    const h = await wrappedHarness(page, waitFor);
    const evidence = process.env.ROLEFIT_EDITOR_WRAPPED_AUDIT_DIR;
    if (evidence) { await h.reset(); await captureWrappedEvidence(h, evidence, host, 'short'); }
    for (const field of ['titleLeft', 'titleRight', 'subtitleLeft', 'subtitleRight']) {
      for (const length of [80, 512, 4096]) {
        for (const spaced of [false, true]) {
          const fixture = h.fixture('Left', '2026');
          const text = spaced ? 'Heading words '.repeat(Math.ceil(length/14)).slice(0,length) : 'W'.repeat(length);
          fixture.sections[0].items[0][field] = text;
          const result = await assertWrappedBounds(h, fixture, `${host} ${field}/${length}/${spaced ? 'spaced' : 'token'}`);
          assert.equal((await h.entry())[field], text, 'paired heading layout preserves authored source');
          if (!spaced || length >= 512) assert(new Set(result.fields[rowKey(field)].map(span => span.y)).size > 1, `${field}/${length} wraps across physical lines`);
        }
      }
    }
    for (const blank of ['', '   ', null]) {
      const fixture = h.fixture('A preserved left field '.repeat(30), blank);
      const result = await assertWrappedBounds(h, fixture, `${host} blank partner ${JSON.stringify(blank)}`);
      assert.equal((await h.entry()).titleRight, blank, 'layout never normalizes empty/whitespace/absent source');
      if (blank !== null) assert(result.fields[rowKey('titleRight')]?.length, 'present empty partner retains caret target');
    }
    const paired = h.fixture();
    await assertWrappedBounds(h, paired, `${host} both long`);
    if (evidence) await captureWrappedEvidence(h, evidence, host, 'both-long');
    await runWrappedSelectionContracts(h);
    await runWrappedInputContracts(h);
    await runWrappedNavigationContracts(h);
    await runWrappedNativeContracts(h, host, evidence);
    await observeWrappedNativeBoundaries(h, host, evidence);
    await runWrappedAuditContracts(h, host, evidence);
    const style = await page.evaluate('window.__rowContract.style');
    const bounds = await page.evaluate('window.__rowContract.bounds');
    for (const zoom of [0.5, 1, 2]) {
      await h.evaluate(zoom => window.__rowContract.applyStyle({ zoom }), zoom);
      await assertWrappedBounds(h, paired, `${host} zoom ${zoom}`);
    }
    await h.evaluate(style => window.__rowContract.applyStyle(style), style);
    for (const [key, bound] of Object.entries(bounds)) {
      if (key === 'zoom') continue;
      for (const value of [bound.min, bound.max]) {
        await h.evaluate(style => window.__rowContract.applyStyle(style), { ...style, [key]: value });
        await assertWrappedBounds(h, paired, `${host} ${key}=${value}`);
      }
    }
    const fonts = await page.evaluate('window.__rowContract.fonts');
    for (const font of fonts) {
      await h.evaluate(style => window.__rowContract.applyStyle(style), { ...style, fontFamily: font.value });
      await assertWrappedBounds(h, paired, `${host} font ${font.value}`);
      if (evidence && host === 'typeset') await captureWrappedEvidence(h, evidence, host, `font-${font.value}`);
    }
    await h.evaluate(style => window.__rowContract.applyStyle(style), style);
    await h.evaluate(style => window.__rowContract.applyStyle(style), {
      ...style, baseFontSizePt: bounds.baseFontSizePt.max,
      pageMarginLeftPt: bounds.pageMarginLeftPt.max, pageMarginRightPt: bounds.pageMarginRightPt.max,
      entryIndentPt: bounds.entryIndentPt.max, entryEndIndentPt: bounds.entryEndIndentPt.max
    });
    await assertWrappedBounds(h, paired, `${host} combined narrow maximum size`);
    await h.evaluate(style => window.__rowContract.applyStyle(style), style);
    const mixed = h.fixture('<size=18><u>Mixed heading</u></size> <font=source-sans>and more words </font>'.repeat(8), '<i>Right partner words </i>'.repeat(10));
    await assertWrappedBounds(h, mixed, `${host} mixed inline styles`);
    if (evidence) await captureWrappedEvidence(h, evidence, host, 'mixed');
    const tall = h.fixture('Tall paired heading '.repeat(210), 'Tall partner '.repeat(200));
    const tallResult = await assertWrappedBounds(h, tall, `${host} taller than a page`);
    assert(tallResult.pages > 1, 'oversized paired heading paginates');
    if (evidence) await captureWrappedEvidence(h, evidence, host, 'tall');
    await runWrappedSelectionContracts(h, tall, 3000);
    await runTightHeadingOutputContract(h, host, evidence);
    const boundary = h.fixture('Near page boundary heading '.repeat(25), 'Boundary partner '.repeat(24));
    boundary.sections[0].items.unshift({ id: 'boundary-lead', titleLeft: 'Synthetic preceding entry', titleRight: '', subtitleLeft: '', subtitleRight: '', bullets: Array.from({ length: 38 }, (_, index) => ({ id: `lead-${index}`, text: 'One line of synthetic leading content.' })) });
    const boundaryResult = await assertWrappedBounds(h, boundary, `${host} near page boundary`);
    assert(boundaryResult.pages > 1, 'preceding content exercises the paired heading page boundary');
    if (evidence) await captureWrappedEvidence(h, evidence, host, 'page-boundary');
    const timings = [];
    for (const count of [1, 10, 50]) {
      const fixture = h.fixture('Heading words '.repeat(28), 'Location words '.repeat(12));
      fixture.sections[0].items = Array.from({ length: count }, (_, index) => ({ ...structuredClone(fixture.sections[0].items[0]), id: `stress-${index}`, bullets: [{ id: `bullet-${index}`, text: 'Representative prose for a bounded workload.' }] }));
      assert(JSON.stringify(fixture).length <= 50_000, 'browser stress fixture stays below 50k characters');
      const before = performance.now();
      const result = await assertWrappedBounds(h, fixture, `${host}/${count} entries`);
      const elapsedMs = performance.now()-before;
      assert(elapsedMs < 30_000, 'large document settles before watchdog');
      timings.push({ count, elapsedMs: Math.round(elapsedMs), pages: result.pages });
    }
    if (evidence) await writeFile(join(evidence, `${host}-timings.json`), JSON.stringify(timings, null, 2));
    console.log(`Wrapped rows ${host}: bounded geometry, selection, input, history, save/reopen passed; ${JSON.stringify(timings)}`);
    await page.destroy();
  }
}
