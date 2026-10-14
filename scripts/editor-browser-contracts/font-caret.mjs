import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export async function runFontCaretContracts({ makeWindow, waitFor, baseUrl }) {
  const moduleUrl = new URL(`@fs${fileURLToPath(new URL('../../packages/engine/src/typeset/render/dom.tsx', import.meta.url))}?font-caret-audit`, baseUrl).href;
  for (const host of ['typeset', 'resume', 'cover']) {
    const page = await makeWindow();
    const evaluate = (fn, ...args) => page.evaluate(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`);
    const call = (method, params) => page.connection.send(method, params, page.sessionId);
    const settle = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await call('Page.addScriptToEvaluateOnNewDocument', { source: 'localStorage.clear();' });
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.loadURL(`${baseUrl}#${host === 'typeset' ? 'typeset' : `host-audit-${host}`}`);
    await waitFor(page, `document.querySelector('[contenteditable] [data-tsdf="contact|0"]')`, `${host} caret document`);
    await page.evaluate('document.fonts.ready'); await settle();
    await evaluate(() => {
      const span = document.querySelector('[contenteditable] [data-tsdf="contact|0"]');
      span.closest('[contenteditable]').focus();
      const range = document.createRange();
      range.setStart(span.firstChild, Math.min(4, span.firstChild.textContent.length));
      range.collapse(true);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    });
    await settle();
    assert(await evaluate(() => {
      const selection = window.getSelection();
      return selection.isCollapsed && selection.anchorOffset === 4 &&
        selection.anchorNode.parentElement.closest('[data-tsdf]')?.dataset.tsdf === 'contact|0';
    }), `${host}: synthetic caret is settled at the authored contact offset`);
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'i', windowsVirtualKeyCode: 73, modifiers: 4 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'i', windowsVirtualKeyCode: 73, modifiers: 4 });
    await settle();
    await evaluate(() => {
      window.__caretFontGate = { hold: 'Typeset Work Sans', reject: '', held: [] };
      const load = FontFaceSet.prototype.load;
      FontFaceSet.prototype.load = function(css, text) {
        const gate = window.__caretFontGate;
        if (gate.reject && css.includes(gate.reject)) return Promise.reject(new Error('Synthetic caret font load failure'));
        if (gate.hold && css.includes(gate.hold)) return new Promise((resolve, reject) => {
          gate.held.push(() => load.call(this, css, text).then(resolve, reject));
        });
        return load.call(this, css, text);
      };
    });
    const choose = async label => {
      await evaluate(() => document.querySelector('button[aria-label="Font family for selected text"]').click());
      await waitFor(page, 'document.querySelector(".font-family-control__menu")', `${host} caret font menu`);
      await evaluate(label => [...document.querySelectorAll('.font-family-control__menu [role=option]')].find(option => option.textContent.trim().startsWith(label)).click(), label);
      await settle();
    };
    const before = await page.evaluate(`document.querySelector('[contenteditable] [data-tsd-field="contact|0"]').textContent`);
    await choose('Work Sans');
    await waitFor(page, 'window.__caretFontGate.held.length > 0', `${host} next-typing family waits`);
    assert.equal(await page.evaluate('document.fonts.check(\'italic 400 16px "Typeset Work Sans Italic"\', "Mg")'), false);
    assert.equal(await page.evaluate('document.querySelector(".typeset-caret") === null'), true, `${host}: unloaded next-typing face never measures a fallback caret`);
    assert.equal(await page.evaluate(`document.querySelector('[contenteditable] [data-tsd-field="contact|0"]').textContent`), before, 'caret choice does not rewrite content');
    await choose('Tinos');
    await waitFor(page, 'document.querySelector(".typeset-caret")', `${host} newer caret family ready`);
    const newer = await page.evaluate('document.querySelector(".typeset-caret").getAttribute("style")');
    await evaluate(() => { window.__caretFontGate.hold = ''; window.__caretFontGate.held.splice(0).forEach(release => release()); });
    await page.evaluate('document.fonts.ready'); await settle();
    assert.equal(await page.evaluate('document.querySelector(".typeset-caret").getAttribute("style")'), newer, `${host}: stale completion cannot replace the newer caret`);
    await choose('Work Sans');
    await waitFor(page, 'document.querySelector(".typeset-caret")', `${host} loaded caret family ready`);
    const geometry = await evaluate(async moduleUrl => {
      const box = (await import(moduleUrl)).browserFaceBox('work-sans', 'italic');
      const caret = document.querySelector('.typeset-caret');
      const size = parseFloat(getComputedStyle(document.querySelector('[contenteditable] [data-tsdf="contact|0"]')).fontSize);
      return { height: parseFloat(caret.style.height), baseline: parseFloat(caret.style.transformOrigin.split(' ')[1]), expectedHeight: (box.ascent + box.descent) * size, expectedBaseline: box.ascent * size };
    }, moduleUrl);
    assert(Math.abs(geometry.height - geometry.expectedHeight) < .02 && Math.abs(geometry.baseline - geometry.expectedBaseline) < .02, `${host}: caret uses loaded CSS face metrics: ${JSON.stringify(geometry)}`);
    await call('Input.insertText', { text: 'h' }); await settle();
    assert(await page.evaluate(`[...document.querySelectorAll('[contenteditable] [data-tsdf="contact|0"]')].some(span => getComputedStyle(span).fontFamily.includes('Work Sans') && getComputedStyle(span).fontStyle === 'italic' && span.textContent.includes('h'))`), `${host}: next character uses the chosen italic family`);
    await evaluate(() => { window.__caretFontGate.reject = 'Typeset Inter'; });
    await choose('Inter');
    await waitFor(page, 'document.querySelector("[role=alert]")?.textContent.includes("Synthetic caret font load failure")', `${host} caret font failure surfaces`);
    await evaluate(() => { window.__caretFontGate.reject = ''; });
    await choose('Tinos');
    await waitFor(page, 'document.querySelector(".typeset-caret") && !document.querySelector("[role=alert]")', `${host} caret font recovery`);
    await page.destroy();
  }
  console.log('Font caret: held italic family, loaded metrics, stale completion, native insertion and visible failure/recovery passed in all three hosts.');
}
