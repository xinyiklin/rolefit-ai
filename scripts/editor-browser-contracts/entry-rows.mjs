import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function runEntryRowContracts({ makeWindow, waitFor, baseUrl }) {
  for (const host of ['typeset', 'rolefit']) {
    const page = await makeWindow();
    await page.loadURL(`${baseUrl}#entry-rows-${host}`);
    await waitFor(page, 'window.__rowContract?.data.sections[0]?.id === "section" && document.querySelector("[contenteditable] [data-tsdf*=titleRight]")', `${host} row fixture`);
    const evaluate = (fn, ...args) => page.evaluate(`(${fn})(${args.map((arg) => JSON.stringify(arg)).join(',')})`);
    const original = await page.evaluate('window.__rowContract.data');
    const data = () => page.evaluate('window.__rowContract.data');
    const settle = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const reset = async (next = original) => { await evaluate((value) => window.__rowContract.reset(value), next); await settle(); };
    const entry = async () => (await data()).sections[0].items[0];
    const focus = async (field, end = false, range = false) => {
      await evaluate((field, end, selectRange) => {
        const key = field.startsWith('heading|') || field.startsWith('bullet|') ? field : `entry|section|entry|${field}`;
        const spans = [...document.querySelectorAll('[contenteditable] [data-tsdf]:not([data-tsdm])')].filter(el => el.getAttribute('data-tsdf') === key);
        const span = end ? spans.at(-1) : spans[0];
        if (!span?.firstChild) throw new Error(`Missing field ${key}`);
        span.closest('[contenteditable]').focus();
        const r = document.createRange();
        r.setStart(span.firstChild, end ? span.firstChild.textContent.length : 0);
        if (selectRange) r.setEnd(span.firstChild, span.firstChild.textContent.length); else r.collapse(true);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
      }, field, end, range);
      await settle();
    };
    const caret = () => evaluate(() => ({ key: window.getSelection()?.focusNode?.parentElement?.closest('[data-tsdf]')?.getAttribute('data-tsdf'), offset: window.getSelection()?.focusOffset }));
    const key = async (name, code, modifiers = 0) => {
      await page.connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, modifiers, ...(name === 'Enter' ? { text: '\r' } : {}) }, page.sessionId);
      await page.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code, modifiers }, page.sessionId);
      await settle();
    };
    const open = async (field, keyboard = false) => {
      if (keyboard) { await focus(field); await key('F10', 121, 8); }
      else await evaluate((field) => {
        const key = field.includes('|') ? field : `entry|section|entry|${field}`;
        const span = [...document.querySelectorAll('[contenteditable] [data-tsdf]:not([data-tsdm])')].find(el => el.getAttribute('data-tsdf') === key);
        if (!span) throw new Error(`Missing menu target ${key}`);
        const rect = span.getBoundingClientRect();
        span.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + 2, button: 2 }));
      }, field);
      await waitFor(page, 'document.querySelector(".ts-context-menu")', 'row context menu');
    };
    const command = async (label) => {
      await evaluate((label) => {
        const button = [...document.querySelectorAll('.ts-context-menu button')].find(el => el.textContent.trim() === label);
        if (!button || button.disabled) throw new Error(`Unavailable command ${label}`);
        button.click();
      }, label);
      await settle();
    };
    const labels = () => evaluate(() => [...document.querySelectorAll('.ts-context-menu button')].map(el => el.textContent.trim()));
    await focus('titleRight', true);
    await open('subtitleLeft');
    assert(await evaluate(() => {
      const rect = document.querySelector('.ts-context-menu').getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    }), 'entry menu fits the viewport');
    assert((await labels()).includes('Remove subtitle row'));
    assert(!(await labels()).some(label => /^(Hide|Show|Add subtitle)/.test(label)));
    await command('Remove subtitle row');
    assert.equal((await entry()).subtitleLeft, null);
    assert.equal((await entry()).subtitleRight, null);
    assert.deepEqual((await data()).sections[0].items[1], original.sections[0].items[1]);
    assert.equal((await caret()).key, 'entry|section|entry|titleRight');
    assert.equal((await caret()).offset, 4);
    if (host === 'rolefit') assert.equal(await page.evaluate('window.__rowContract.manualEdited'), true);
    await key('z', 90, 4);
    assert.deepEqual(await entry(), original.sections[0].items[0]);
    await key('z', 90, 12);
    await focus('titleRight', true); await key('Enter', 13);
    assert.equal((await entry()).subtitleLeft, '');
    assert.equal((await entry()).subtitleRight, '');
    assert.equal((await caret()).key, 'entry|section|entry|subtitleLeft');
    await key('Backspace', 8);
    assert.equal((await entry()).subtitleLeft, null);
    assert.equal((await caret()).key, 'entry|section|entry|titleRight');
    await key('z', 90, 4);
    assert.equal((await entry()).subtitleLeft, '');
    assert.equal((await caret()).key, 'entry|section|entry|subtitleLeft');
    await key('z', 90, 4);
    assert.equal((await entry()).subtitleLeft, null);
    assert.equal((await caret()).key, 'entry|section|entry|titleRight');
    await reset(); await focus('titleRight', true); await key('Enter', 13);
    assert.equal((await entry()).subtitleLeft, '<i>Company</i>');
    assert.equal((await caret()).key, 'entry|section|entry|subtitleLeft');
    const rightOnly = structuredClone(original); rightOnly.sections[0].items[0].subtitleLeft = '';
    await reset(); await focus('titleRight', true);
    await evaluate(() => {
      const el = document.querySelector('[contenteditable]');
      for (const [inputType, data] of [['insertText', 'X'], ['insertParagraph', null], ['insertText', 'Y']]) {
        el.dispatchEvent(new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }));
      }
    }); await settle(); await settle();
    assert.equal((await entry()).titleRight, '2026X');
    assert.match((await entry()).subtitleLeft, /Y.*Company/, 'focus-only queued Enter must drain following input');
    await reset(rightOnly); await focus('subtitleLeft'); await key('Backspace', 8);
    assert.equal((await entry()).subtitleRight, 'Remote');
    assert.equal((await entry()).subtitleLeft, '');
    const blank = structuredClone(rightOnly); blank.sections[0].items[0].subtitleRight = '';
    await reset(blank); await focus('subtitleLeft'); await key('Delete', 46);
    assert.equal((await entry()).subtitleLeft, '', 'forward Delete retains row');
    await focus('subtitleLeft'); await key('Backspace', 8, 8);
    assert.equal((await entry()).subtitleLeft, '', 'modified Backspace retains row');
    await focus('subtitleLeft');
    await evaluate(() => {
      const el = document.querySelector('[contenteditable]');
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, isComposing: true }));
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true, isComposing: true }));
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    }); await settle();
    assert.equal((await entry()).subtitleLeft, '', 'composition cannot remove row');
    await reset(blank); await focus('subtitleLeft');
    await evaluate(() => {
      const el = document.querySelector('[contenteditable]');
      for (let i = 0; i < 3; i++) el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
    }); await settle(); await settle();
    assert.equal((await entry()).subtitleLeft, null, 'queued deletion shares structural command');
    assert.equal((await entry()).titleRight, '20', 'queued repeats continue at restored title caret');
    await reset(); await focus('subtitleLeft', false, true); await key('Backspace', 8);
    assert.notEqual((await entry()).subtitleLeft, null, 'selection deletion retains row');
    const missing = structuredClone(original); missing.sections[0].items[0].subtitleLeft = null; missing.sections[0].items[0].subtitleRight = null;
    await reset(missing); await focus('titleRight', true);
    await evaluate(() => {
      const el = document.querySelector('[contenteditable]');
      for (const [inputType, data] of [['insertText', 'X'], ['insertParagraph', null], ['insertParagraph', null], ['insertText', 'Y']]) {
        el.dispatchEvent(new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }));
      }
    }); await settle(); await settle();
    assert.equal((await entry()).titleRight, '2026X');
    assert.equal((await entry()).subtitleLeft, 'Y', 'queued row creation and repeated Enter drain following input');
    await reset(missing); await focus('titleRight'); await key('Enter', 13);
    assert.equal((await entry()).subtitleLeft, null, 'mid-title Enter unchanged');
    await focus('titleRight', true); await key('Enter', 13, 8);
    assert.equal((await entry()).subtitleLeft, null, 'Shift Enter does not create a row');
    await reset(); await open('titleLeft'); await command('Remove title row');
    assert.equal((await entry()).titleLeft, null);
    await open('subtitleLeft'); await command('Remove subtitle row');
    await open('bullet|section|entry|bullet');
    assert((await labels()).includes('Add title row'));
    await command('Move entry down');
    assert.equal((await data()).sections[0].items[1].id, 'entry');
    await open('bullet|section|entry|bullet'); await command('Delete bullet');
    assert.equal((await data()).sections[0].items[1].bullets.length, 0);
    await page.evaluate('window.__rowContract.reopen()'); await settle();
    const reopened = await data();
    const sectionKey = `heading|${reopened.sections[0].id}`;
    await open(sectionKey, true);
    assert((await labels()).includes('Empty entry 2'));
    await evaluate(() => [...document.querySelectorAll('.ts-context-menu button')].find(el => el.textContent.trim() === 'Empty entry 2').focus());
    await settle(); await command('Add subtitle row');
    assert.equal((await data()).sections[0].items[1].subtitleLeft, '');
    assert((await caret()).key.endsWith('|subtitleLeft'));
    const emptyEntries = structuredClone(original);
    emptyEntries.sections[0].items.forEach(item => {
      item.titleLeft = item.titleRight = item.subtitleLeft = item.subtitleRight = null;
      item.bullets = [];
    });
    await page.connection.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 420, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    await reset(emptyEntries);
    await open('heading|section', true);
    assert((await labels()).includes('Empty entry 1'));
    assert((await labels()).includes('Empty entry 2'));
    await evaluate(() => [...document.querySelectorAll('.ts-context-menu button')].find(el => el.textContent.trim() === 'Empty entry 2').focus());
    await settle();
    assert(await evaluate(() => [...document.querySelectorAll('.ts-context-menu')].every(menu => {
      const rect = menu.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    })), 'recovery menu and flyout fit a compact viewport');
    assert(await evaluate(() => {
      const submenu = document.querySelector('.ts-context-menu__submenu');
      const rect = submenu.getBoundingClientRect();
      return submenu.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + 20));
    }), 'recovery flyout remains clickable outside the scrolling parent');
    await key('Tab', 9); await key('Enter', 13);
    assert.equal((await data()).sections[0].items[0].titleLeft, null);
    assert.equal((await data()).sections[0].items[1].titleLeft, '');
    assert.equal((await caret()).key, 'entry|section|other|titleLeft');
    await page.connection.send('Emulation.clearDeviceMetricsOverride', {}, page.sessionId);
    await reset();
    const auditDir = process.env.ROLEFIT_EDITOR_ROW_AUDIT_DIR;
    if (auditDir) {
      await mkdir(auditDir, { recursive: true });
      const visual = structuredClone(original);
      visual.sections[0].items = ['both', 'title', 'subtitle', 'bullet', 'empty'].map((mode, index) => ({
        id: `visual-${mode}`, titleLeft: ['both', 'title'].includes(mode) ? `<size=16><b>${mode}</b></size> rows` : null,
        titleRight: ['both', 'title'].includes(mode) ? '2026' : null,
        subtitleLeft: ['both', 'subtitle'].includes(mode) ? '<i>Company <size=14>and location</size></i>' : null,
        subtitleRight: ['both', 'subtitle'].includes(mode) ? 'Remote' : null,
        bullets: mode === 'empty' ? [] : [{ id: `visual-bullet-${index}`, text: `${mode}: visible content follows the remaining rows.` }]
      }));
      await reset(visual); await page.evaluate('document.fonts.ready');
      for (const media of ['screen', 'print']) {
        await page.connection.send('Emulation.setEmulatedMedia', { media }, page.sessionId);
        await settle();
        if (media === 'print') {
          assert(await evaluate(() => [...document.querySelectorAll('.resume-print-layer .tsd-line')].some(el => el.getBoundingClientRect().height > 0)), 'print layer must render visible content');
          const pdf = await page.connection.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true }, page.sessionId);
          await writeFile(join(auditDir, `${host}-browser-print.pdf`), Buffer.from(pdf.data, 'base64'));
        }
        const shot = await page.connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, page.sessionId);
        await writeFile(join(auditDir, `${host}-${media}.png`), Buffer.from(shot.data, 'base64'));
      }
      await writeFile(join(auditDir, 'rows-fixture.json'), JSON.stringify(visual));
    }
    await page.destroy();
    console.log(`Entry rows ${host}: menu, keyboard, history, composition, replay, reorder, reopen, and recovery passed`);
  }
}
