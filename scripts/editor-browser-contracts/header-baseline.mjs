import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { captureWrappedEvidence, wrappedHarness } from './wrapped-harness.mjs';

async function geometry(h, api) {
  return h.evaluate(api => {
    const layout = window[api].layout();
    const root = document.querySelector('[contenteditable=true]');
    return {
      lines: layout.pages.map(page => page.lines.map(line => ({ baseline: line.baseline, leading: line.leading }))),
      spans: [...root.querySelectorAll('[data-tsdf]:not([data-tsdm])')].map(span => {
        const page = root.querySelector(`.tsd-page[data-tsd-page="${span.dataset.tsdPage}"]`);
        const style = getComputedStyle(span);
        return { key: span.dataset.tsdf, line: span.dataset.tsdLine, font: style.font,
          top: span.getBoundingClientRect().top - page.getBoundingClientRect().top };
      })
    };
  }, api);
}

function stable(before, after, label) {
  assert.deepEqual(after.lines, before.lines, `${label}: every engine line keeps its baseline and leading`);
  assert.deepEqual(after.spans, before.spans, `${label}: same-font DOM field spans keep their page-relative top`);
}

async function exercise(h, api, host, scenario, evidence) {
  const data = structuredClone(h.original);
  data.header = { visible: true, name: scenario.name, contact: [scenario.contact ?? 'contact@example.test'] };
  const key = scenario.key ?? 'name';
  const text = key === 'name' ? data.header.name : data.header.contact[0];
  const display = scenario.display ?? text;
  const beforeText = () => h.evaluate((api, key) => key === 'name' ? window[api].data.header.name : window[api].data.header.contact[0], api, key);
  await h.reset(data);
  const before = await geometry(h, api);
  const label = `${host}-${scenario.label}`;
  if (evidence) await captureWrappedEvidence(h, evidence, host, `${scenario.label}-before`, api);
  let appended = '';
  for (const character of scenario.characters ?? 'hdjklpq') {
    await h.evaluate((api, key, offset) => window[api].select(key, offset), api, key, display.length + appended.length);
    await h.insert(character);
    appended += character;
    const expected = scenario.sourceWith ? scenario.sourceWith(display + appended) : text + appended;
    assert.equal(await beforeText(), expected, `${label}: native insertion preserves exact authored text and marks`);
    stable(before, await geometry(h, api), `${label} append ${JSON.stringify(character)}`);
    await h.key('Backspace', 8);
    const prior = appended.slice(0, -character.length);
    assert.equal(await beforeText(), scenario.sourceWith ? scenario.sourceWith(display + prior) : text + prior, `${label}: native Backspace removes only inserted character`);
    stable(before, await geometry(h, api), `${label} delete ${JSON.stringify(character)}`);
    await h.key('z', 90, 4);
    assert.equal(await beforeText(), expected, `${label}: Undo restores deleted character and marks`);
    stable(before, await geometry(h, api), `${label} Undo deletion`);
  }
  if (evidence) await captureWrappedEvidence(h, evidence, host, `${scenario.label}-after`, api);
  await h.evaluate((api, key, start, end) => window[api].select(key, start, key, end), api, key, display.length, display.length + appended.length);
  await h.key('Backspace', 8);
  assert.equal(await beforeText(), text, `${label}: deleting appended range restores exact original source`);
  stable(before, await geometry(h, api), `${label} restore original`);
  await h.evaluate(api => window[api].reopen(), api); await h.settle(); await h.settle();
  assert.deepEqual(await h.evaluate(api => window[api].data.header, api), data.header, `${label}: file reopen preserves exact original header`);
  return { label: scenario.label, characters: scenario.characters ?? 'hdjklpq', before, after: await geometry(h, api) };
}

export async function runHeaderBaselineContracts({ makeWindow, waitFor, baseUrl }) {
  const evidence = process.env.ROLEFIT_EDITOR_WRAPPED_AUDIT_DIR;
  for (const host of ['typeset', 'rolefit', 'cover']) {
    const page = await makeWindow();
    await page.connection.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    const api = host === 'cover' ? '__editorContract' : '__rowContract';
    await page.loadURL(`${baseUrl}#${host === 'cover' ? 'editor' : `entry-rows-${host}`}`);
    await waitFor(page, `window.${api}?.data?.header && document.querySelector('[contenteditable=true] [data-tsdf="name"]')`, `${host} baseline fixture`);
    const h = await wrappedHarness(page, waitFor, api);
    const report = { host, cases: [], limitations: ['Isolated Chromium fixture; native CDP text/key input, not OS IME', 'Cases deliberately fit one line; wrap changes are verified by wrapped-header contracts'] };
    report.cases.push(await exercise(h, api, host, { label: 'baseline-default', name: 'aceonmzx' }, evidence));
    if (host !== 'cover') {
      const style = await h.evaluate(api => window[api].style, api);
      for (const font of await h.evaluate(api => window[api].fonts, api)) {
        if (font.value === style.fontFamily) continue;
        await h.evaluate((api, style) => window[api].applyStyle(style), api, { ...style, fontFamily: font.value });
        report.cases.push(await exercise(h, api, host, { label: `baseline-${font.value}`, name: 'aceonmzx' }));
      }
      await h.evaluate((api, style) => window[api].applyStyle(style), api, style);
    }
    for (const name of ['', 'ACEONMZX', 'gypqj', 'éàöñç']) {
      report.cases.push(await exercise(h, api, host, { label: name ? `variant-${name}` : 'empty-first-character', name }));
    }
    report.cases.push(await exercise(h, api, host, { label: 'uppercase-diacritic-insertion', name: 'aceonmzx', characters: 'HÉÜÅÇ' }));
    const mixed = value => `<size=32><font=source-sans>${value}X</font></size><size=16> Small</size>`;
    // Use an interior caret so this geometry check does not depend on mark-boundary affinity.
    report.cases.push(await exercise(h, api, host, {
      label: 'baseline-mixed', name: mixed('aceonmzx'), display: 'aceonmzx', sourceWith: mixed
    }, evidence));
    const oversized = value => `<size=32><font=source-sans>${value}X</font></size>`;
    report.cases.push(await exercise(h, api, host, {
      label: 'no-name-oversized-contact', name: null, key: 'contact|0', contact: oversized('aceonmzx'), display: 'aceonmzx', sourceWith: oversized
    }));
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await writeFile(join(evidence, `${host}-baseline-report.json`), JSON.stringify(report, null, 2));
    }
    console.log(`Header baseline ${host}: ${report.cases.length} cases passed native character insertion/Backspace/Undo, exact source/reopen, engine baselines and DOM tops`);
    await page.destroy();
  }
}
