import assert from 'node:assert/strict';
import { DOCUMENT_FONT_FAMILIES } from '../../packages/engine/src/typeset/fontRegistry.ts';

export async function runFontLoadingContracts({ makeWindow, waitFor, baseUrl }) {
  const allAssets = new Set(Object.values(DOCUMENT_FONT_FAMILIES).flatMap(def => Object.values(def.faces).map(face => face.assetPath.split('/').at(-1))));
  for (const host of ['typeset', 'rolefit']) {
    const page = await makeWindow();
    const evaluate = (fn, ...args) => page.evaluate(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`);
    await page.connection.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.clear();
      window.__fontGate = { hold: '', reject: '', held: [], calls: [] };
      const load = FontFaceSet.prototype.load;
      FontFaceSet.prototype.load = function(css, text) {
        const gate = window.__fontGate;
        gate.calls.push(css);
        if (gate.reject && css.includes(gate.reject)) return Promise.reject(new Error('Synthetic font load failure'));
        return load.call(this, css, text).then(faces => gate.hold && css.includes(gate.hold)
          ? new Promise(resolve => gate.held.push(() => resolve(faces))) : faces);
      };
    ` }, page.sessionId);
    await page.loadURL(`${baseUrl}#entry-rows-${host}`);
    await waitFor(page, 'window.__rowContract && document.querySelector("[contenteditable] [data-tsdf=name]")', `${host} initial fonts`);
    const initial = await page.evaluate('window.__rowContract.style.fontFamily');
    const allowed = new Set(Object.values(DOCUMENT_FONT_FAMILIES[initial].faces).map(face => face.assetPath.split('/').at(-1)));
    const requested = (await page.evaluate(`performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname.split('/').at(-1))`)).filter(file => allAssets.has(file));
    const calls = await page.evaluate('window.__fontGate.calls');
    assert(calls.length > 0 && calls.every(css => Object.values(DOCUMENT_FONT_FAMILIES[initial].faces).some(face => css.includes(`"${face.cssFamily}"`))), `${host} loader requests only document families: ${calls.join(', ')}`);
    // The fixture also requests this legacy regular face outside the loader.
    allowed.add('SourceSans3-Regular.woff2');
    assert(requested.length > 0 && requested.every(file => allowed.has(file)), `${host} unrelated catalog assets stay unloaded: ${requested.join(', ')}`);
    await evaluate(() => { window.__fontGate.hold = 'Typeset Work Sans'; window.__rowContract.applyStyle({ fontFamily: 'work-sans' }); });
    await waitFor(page, 'window.__fontGate.held.length > 0', `${host} held family load`);
    assert(await page.evaluate(`document.querySelector('[role=status]')?.textContent.includes('Typesetting')`), `${host} waits instead of painting fallback`);
    await evaluate(() => window.__rowContract.applyStyle({ fontFamily: 'source-sans' }));
    const paints = (label) => `document.querySelector('[contenteditable] [data-tsdf=name]') && getComputedStyle(document.querySelector('[contenteditable] [data-tsdf=name]')).fontFamily.includes(${JSON.stringify(label)})`;
    await waitFor(page, paints('Source Sans'), `${host} newer family paints`);
    await evaluate(() => { window.__fontGate.hold = ''; window.__fontGate.held.splice(0).forEach(resolve => resolve()); });
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert(await page.evaluate(paints('Source Sans')), `${host} late load cannot replace newer family`);
    await evaluate(() => { window.__fontGate.reject = 'Typeset Inter'; window.__rowContract.applyStyle({ fontFamily: 'inter' }); });
    await waitFor(page, `document.querySelector('[role=alert]')?.textContent.includes('Synthetic font load failure')`, `${host} load failure surfaces`);
    assert.equal(await page.evaluate(`document.querySelector('[contenteditable] [data-tsdf=name]') === null`), true, `${host} failed font never paints fallback`);
    await evaluate((fontFamily) => { window.__fontGate.reject = ''; window.__rowContract.applyStyle({ fontFamily }); }, initial);
    await waitFor(page, 'document.querySelector("[contenteditable] [data-tsdf=name]")', `${host} recovery paints`);
    await evaluate(() => {
      window.__fontGate.hold = 'Typeset Noto Sans';
      const data = structuredClone(window.__rowContract.data);
      data.header.name = '<font=noto-sans>Mixed family name</font>';
      window.__rowContract.reset(data);
    });
    await waitFor(page, 'window.__fontGate.held.length > 0', `${host} inline family waits`);
    assert.equal(await page.evaluate('window.__rowContract.style.fontFamily'), initial);
    await evaluate(() => { window.__fontGate.hold = ''; window.__fontGate.held.splice(0).forEach(resolve => resolve()); });
    await waitFor(page, paints('Noto Sans'), `${host} inline family paints after readiness`);
    await page.destroy();
  }
  console.log('Font loading: document-only requests, held loads, late completion, visible failures/recovery and inline family readiness passed in both hosts.');
}

export async function runLoadedInlineFontContracts({ makeWindow, waitFor, baseUrl }) {
  for (const host of ['typeset', 'resume', 'cover']) {
    const page = await makeWindow();
    const evaluate = (fn, ...args) => page.evaluate(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`);
    const call = (method, params) => page.connection.send(method, params, page.sessionId);
    const settle = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const key = async (modifiers) => {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers });
      await settle();
    };
    await call('Page.addScriptToEvaluateOnNewDocument', { source: 'localStorage.clear();' });
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.loadURL(`${baseUrl}#${host === 'typeset' ? 'typeset' : `host-audit-${host}`}`);
    await waitFor(page, `document.querySelector('[contenteditable] [data-tsdf="contact|0"]')`, `${host} inline font document`);
    await page.evaluate('document.fonts.ready'); await settle();
    await evaluate(() => {
      const span = document.querySelector('[contenteditable] [data-tsdf="contact|0"]');
      span.closest('[contenteditable]').focus();
      const range = document.createRange();
      range.setStart(span.firstChild, 0);
      range.setEnd(span.firstChild, Math.min(4, span.firstChild.textContent.length));
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    });
    await settle();
    await evaluate(() => {
      window.__inlineFontSpinners = 0;
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          // React may reuse the host <div> for the loading state, so watch its spinner child.
          if (node instanceof Element && (node.matches('.preview-overlay__spinner') || node.querySelector('.preview-overlay__spinner'))) window.__inlineFontSpinners += 1;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await evaluate(() => document.querySelector('button[aria-label="Font family for selected text"]').click());
    await waitFor(page, 'document.querySelector(".font-family-control__menu")', `${host} inline font menu`);
    await evaluate(() => [...document.querySelectorAll('.font-family-control__menu [role=option]')].find(option => option.textContent.trim().startsWith('Work Sans')).click());
    const usesWorkSans = `[...document.querySelectorAll('[contenteditable] [data-tsdf="contact|0"]')].some(span => getComputedStyle(span).fontFamily.includes('Work Sans'))`;
    await waitFor(page, usesWorkSans, `${host} first inline Work Sans load paints`);
    await settle();
    assert(await page.evaluate('window.__inlineFontSpinners > 0'), `${host}: an unloaded inline family waits behind the loading state`);
    // Work Sans is now loaded; removing and restoring it must keep the painted pages mounted.
    await evaluate(() => {
      window.__inlineFontPage = document.querySelector('[contenteditable=true] .tsd-page');
      window.__inlineFontSpinners = 0;
    });
    const pagesStayMounted = async (label) => {
      const state = await evaluate(() => ({
        spinners: window.__inlineFontSpinners,
        samePage: window.__inlineFontPage.isConnected && document.querySelector('[contenteditable=true] .tsd-page') === window.__inlineFontPage,
        focused: Boolean(document.activeElement?.closest('[contenteditable=true]'))
      }));
      assert.deepEqual(state, { spinners: 0, samePage: true, focused: true }, `${host}: ${label} keeps the loaded pages mounted`);
    };
    assert(await page.evaluate('Boolean(document.activeElement?.closest("[contenteditable=true]"))'), `${host}: font menu restores editor focus`);
    await key(4);
    await waitFor(page, `!(${usesWorkSans})`, `${host} undo removes inline Work Sans`);
    await pagesStayMounted('undoing an inline font');
    await key(12);
    await waitFor(page, usesWorkSans, `${host} redo restores inline Work Sans`);
    await pagesStayMounted('redoing an already-loaded inline font');
    await page.destroy();
  }
  console.log('Loaded inline fonts: undo/redo of an already-loaded inline family keeps focus and the painted pages mounted in all three hosts.');
}
