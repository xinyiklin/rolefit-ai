import assert from 'node:assert/strict';
import { assertWrappedBounds, captureWrappedEvidence, wrappedHarness } from './wrapped-harness.mjs';
import { runHeaderBaselineContracts } from './header-baseline.mjs';

async function nativeHeaderLifecycle(h, api, key, text) {
  const point = await h.evaluate(key => {
    const spans = [...document.querySelectorAll('[contenteditable=true] [data-tsdf]')].filter(span => span.getAttribute('data-tsdf') === key);
    const span = spans[Math.min(1, spans.length-1)];
    span.scrollIntoView({ block: 'center' });
    const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left+rect.width/4, y: rect.top+rect.height/2, continuation: spans.length > 1 };
  }, key);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await h.page.connection.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 }, h.page.sessionId);
  }
  await h.settle();
  const caret = await h.selection();
  assert.equal(caret.anchor.key, key, 'native pointer reaches the intended header field');
  assert.deepEqual(caret.anchor, caret.focus, 'native header click places a caret');
  if (point.continuation) assert(caret.anchor.offset > 0, 'native pointer reaches a header continuation');
  for (let i = 0; i < 3; i++) await h.key('ArrowRight', 39, 8);
  const selected = await h.selection();
  assert.equal(selected.focus.key, key, 'native shifted range stays in its header');
  assert.equal(selected.focus.offset, caret.anchor.offset+3, 'native shifted range advances three characters');
  const copied = await h.evaluate(() => {
    const clipboardData = new DataTransfer();
    document.querySelector('[contenteditable=true]').dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }));
    return clipboardData.getData('text/plain');
  });
  assert.equal(copied, text.slice(caret.anchor.offset, selected.focus.offset), 'native header range copies exact source');
  await h.insert('Z');
  const value = () => h.evaluate((api, key) => { const header = window[api].data.header; return key === 'name' ? header.name : header.contact[0]; }, api, key);
  assert.equal(await value(), text.slice(0,caret.anchor.offset)+'Z'+text.slice(selected.focus.offset), 'native header range replacement preserves surrounding source');
  await h.key('z', 90, 4);
  assert.equal(await value(), text, 'Undo restores native header range replacement');
  const before = await h.evaluate(api => window[api].data.header, api);
  if (api === '__editorContract' && text.length > 1000) {
    await assert.rejects(() => h.evaluate(api => window[api].reopen(), api), /no longer than 1,000 characters/, 'strict cover codec rejects oversized name/contact values');
  } else {
    await h.evaluate(api => window[api].reopen(), api); await h.settle(); await h.settle();
  }
  assert.deepEqual(await h.evaluate(api => window[api].data.header, api), before, 'strict file reopen preserves header content');
}

export async function captureWrappedHeaderEvidence(h, host, evidence, api = '__rowContract') {
  const combined = structuredClone(h.original);
  combined.header = {
    visible: true, name: 'Long synthetic name words '.repeat(24),
    contact: [`<link=${encodeURIComponent('https://example.test/profile')}>${'Linked contact words '.repeat(28)}</link>`, 'Neighbor contact']
  };
  await assertWrappedBounds(h, combined, `${host} combined long header`);
  await captureWrappedEvidence(h, evidence, host, 'long-header', api);
}

export async function runWrappedHeaderContracts({ makeWindow, waitFor, baseUrl }) {
  await runHeaderBaselineContracts({ makeWindow, waitFor, baseUrl });
  for (const host of ['typeset', 'rolefit', 'cover']) {
    const page = await makeWindow();
    await page.connection.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    const api = host === 'cover' ? '__editorContract' : '__rowContract';
    await page.loadURL(`${baseUrl}#${host === 'cover' ? 'editor' : `entry-rows-${host}`}`);
    await waitFor(page, `window.${api}?.data?.header && document.querySelector('[contenteditable=true] [data-tsdf="name"]')`, `${host} wrapped header fixture`);
    const h = await wrappedHarness(page, waitFor, api);
    const header = () => page.evaluate(`window.${api}.data.header`);
    const select = async (key, start, end = start) => {
      await h.evaluate((api, key, start, end) => window[api].select(key, start, key, end), api, key, start, end);
      await h.settle();
    };
    for (const key of ['name', 'contact|0']) {
      for (const length of [80, 512, 4096]) {
        for (const spaced of [false, true]) {
          const data = structuredClone(h.original);
          const text = spaced ? 'Header words '.repeat(Math.ceil(length/13)).slice(0,length) : 'W'.repeat(length);
          data.header = { visible: true, name: 'Header contract', contact: ['contact@example.test'] };
          if (key === 'name') data.header.name = text; else data.header.contact[0] = text;
          const result = await assertWrappedBounds(h, data, `${host} ${key}/${length}/${spaced ? 'spaced' : 'token'}`);
          const value = key === 'name' ? (await header()).name : (await header()).contact[0];
          assert.equal(value, text, 'header layout preserves authored source');
          if (length >= 512) assert(new Set(result.fields[key].map(span => span.y)).size > 1, `${key} creates continuation lines`);
          await nativeHeaderLifecycle(h, api, key, text);
        }
      }
    }
    for (const key of ['name', 'contact|0']) {
      const text = 'Editable header words '.repeat(28);
      const data = structuredClone(h.original);
      data.header = { visible: true, name: 'Header contract', contact: ['contact@example.test'] };
      if (key === 'name') data.header.name = text; else data.header.contact[0] = text;
      for (const reverse of [false, true]) {
        await h.reset(data);
        await select(key, reverse ? 160 : 5, reverse ? 5 : 160);
        const copied = await h.evaluate(() => {
          const clipboardData = new DataTransfer();
          document.querySelector('[contenteditable=true]').dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }));
          return clipboardData.getData('text/plain');
        });
        assert.equal(copied, text.slice(5,160), 'wrapped header copy matches logical selection');
        await h.key('Backspace', 8);
        assert.equal(key === 'name' ? (await header()).name : (await header()).contact[0], text.slice(0,5)+text.slice(160));
        await h.key('z', 90, 4);
        assert.equal(key === 'name' ? (await header()).name : (await header()).contact[0], text, 'Undo restores wrapped header selection');
      }
      await select(key, 140);
      await h.insert('X');
      assert.equal(key === 'name' ? (await header()).name : (await header()).contact[0], text.slice(0,140)+'X'+text.slice(140), 'native continuation typing preserves header source');
    }
    const linked = structuredClone(h.original);
    const destination = 'https://example.test/profile';
    const label = 'Linked contact words '.repeat(28);
    linked.header = { visible: true, name: 'Linked header', contact: [`<link=${encodeURIComponent(destination)}>${label}</link>`, 'Neighbor contact'] };
    await h.reset(linked);
    const links = () => h.evaluate(() => [...document.querySelectorAll('[contenteditable=true] [data-tsdf="contact|0"]')].map(el => el.closest('a')?.getAttribute('href') ?? el.querySelector('a')?.getAttribute('href')).filter(Boolean));
    assert((await links()).length > 1, 'wrapped contact paints linked continuation fragments');
    assert((await links()).every(href => href === destination), 'all contact fragments retain one link destination');
    await select('contact|0', 140); await h.insert('X');
    assert((await header()).contact[0].includes(`<link=${encodeURIComponent(destination)}>`));
    assert.equal((await header()).contact[1], 'Neighbor contact');
    await h.key('z', 90, 4);
    assert.equal((await header()).contact[0], linked.header.contact[0]);
    const evidence = process.env.ROLEFIT_EDITOR_WRAPPED_AUDIT_DIR;
    if (evidence) await captureWrappedHeaderEvidence(h, host, evidence, api);
    console.log(`Wrapped header ${host}: name/contact 80/512/4096 spaced/token bounds, logical copy/delete/Undo, native continuation edits, linked destinations passed`);
    await page.destroy();
  }
}
