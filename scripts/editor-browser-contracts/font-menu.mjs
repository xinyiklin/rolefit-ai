import assert from 'node:assert/strict';
import { FONT_FAMILIES } from '../../packages/engine/src/lib/fontFamilies.ts';

export async function runFontMenuContracts({ makeWindow, waitFor, baseUrl }) {
  const firstFont = FONT_FAMILIES[0].label;
  const lastFont = FONT_FAMILIES.at(-1).label;
  for (const host of ['typeset', 'resume', 'cover']) {
    const page = await makeWindow();
    const call = (method, params) => page.connection.send(method, params, page.sessionId);
    const key = async (key, code) => {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code });
    };
    await call('Page.addScriptToEvaluateOnNewDocument', { source: 'localStorage.clear();' });
    await page.loadURL(`${baseUrl}#${host === 'typeset' ? 'typeset' : `host-audit-${host}`}`);
    await waitFor(page, `document.querySelector('[contenteditable=true] [data-tsdf=name]:not([data-tsdm])')?.textContent.length > 0`, `${host} font menu document`);
    // RoleFit intentionally replaces resume authoring at widths <=720px.
    for (const [width, height] of [[1440, 900], [host === 'resume' ? 800 : 390, 500]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await waitFor(page, `document.querySelector('[contenteditable=true] [data-tsdf=name]:not([data-tsdm])')?.textContent.length > 0`, `${host}/${width} populated name`);
      const before = await page.evaluate(`(() => {
        const span = document.querySelector('[contenteditable=true] [data-tsdf=name]:not([data-tsdm])');
        span.closest('[contenteditable]').focus();
        const range = document.createRange(); range.selectNodeContents(span);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
        return { text: span.closest('[data-tsd-field]').textContent, selection: window.getSelection().toString() };
      })()`);
      await waitFor(page, `Array.from(document.querySelectorAll('button[aria-label="Font family for selected text"]')).some(el => !el.disabled)`, `${host} formatting selection`);
      await page.evaluate(`(() => {
        const visible = el => el.getClientRects().length > 0;
        if (!Array.from(document.querySelectorAll('button[aria-label="Font family for selected text"]')).some(visible)) {
          document.querySelector('button[aria-label="More formatting"]').click();
        }
      })()`);
      const open = async () => {
        await page.evaluate(`Array.from(document.querySelectorAll('button[aria-label="Font family for selected text"]')).find(el => el.getClientRects().length > 0).click()`);
        await waitFor(page, 'document.querySelector(".font-family-control__menu")?.contains(document.activeElement)', `${host} menu focus`);
      };
      const snapshot = () => page.evaluate(`(() => {
        const menu = document.querySelector('.font-family-control__menu');
        const rect = menu.getBoundingClientRect(); const focus = document.activeElement.getBoundingClientRect();
        return { count: menu.querySelectorAll('[role=option]').length, top: rect.top, bottom: rect.bottom,
          left: rect.left, right: rect.right, scrollable: menu.scrollHeight > menu.clientHeight,
          focused: document.activeElement.textContent.trim(), visible: focus.top >= rect.top && focus.bottom <= rect.bottom };
      })()`);
      await open();
      let state = await snapshot();
      assert.equal(state.count, FONT_FAMILIES.length);
      assert(state.scrollable && state.top >= 0 && state.bottom <= height && state.left >= 0 && state.right <= width, `${host}/${width}: ${JSON.stringify(state)}`);
      await key('End', 35);
      await waitFor(page, `document.activeElement?.textContent.includes(${JSON.stringify(lastFont)})`, `${host} last font`);
      assert.equal((await snapshot()).visible, true, `${host} keyboard scroll reaches last choice`);
      await key('Enter', 13);
      await waitFor(page, `!document.querySelector('.font-family-control__menu') && document.activeElement?.matches('[contenteditable=true]')`, `${host} font commit restores editor`);
      await waitFor(page, `getComputedStyle(document.querySelector('[contenteditable=true] [data-tsdf=name]:not([data-tsdm])')).fontFamily.includes(${JSON.stringify(lastFont)})`, `${host} selected font renders`);
      assert.equal(await page.evaluate(`document.querySelector('[contenteditable=true] [data-tsd-field=name]').textContent`), before.text);
      assert.equal(await page.evaluate('window.getSelection().toString()'), before.selection, `${host} font commit preserves the selected text`);
      await open();
      state = await snapshot();
      assert(state.focused.includes(lastFont) && state.visible, `${host} reopening reveals late selection`);
      await page.evaluate(`document.querySelector('.font-family-control__menu').scrollTop = 0`);
      await page.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
      assert.equal(await page.evaluate(`document.querySelector('.font-family-control__menu').scrollTop`), 0, `${host} manual scrolling does not reset to selection`);
      await key('Home', 36);
      await waitFor(page, `document.activeElement?.textContent.includes(${JSON.stringify(firstFont)})`, `${host} first font`);
      assert.equal((await snapshot()).visible, true);
      await key('Escape', 27);
      await waitFor(page, `document.activeElement?.getAttribute('aria-label') === 'Font family for selected text'`, `${host} Escape restores trigger`);
    }
    await page.destroy();
  }
  console.log(`Font menu: ${FONT_FAMILIES.length} choices, keyboard/scroll/focus and selection commit in Typeset, RoleFit resume and cover at desktop and narrow/short sizes passed.`);
}
