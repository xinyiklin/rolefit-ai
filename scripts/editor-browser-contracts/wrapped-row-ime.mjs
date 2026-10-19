import assert from 'node:assert/strict';
import { rowKey } from './wrapped-harness.mjs';

// Chrome's own IME path (CDP), unlike dispatched CompositionEvents, lets the
// browser rewrite the DOM before compositionend. The model must end where
// ordinary typing would, and the page must paint what typing paints (wrapped
// lines drop break spaces, so painted text is compared with painted text).
export async function runNativeCompositionContracts(h) {
  const fixture = h.fixture();
  const send = (method, params) => h.page.connection.send(method, params, h.page.sessionId);
  const domText = field => h.evaluate(key => [...document.querySelectorAll(`[contenteditable=true] [data-tsdf="${key}"]:not([data-tsdm])`)]
    .map(span => span.textContent).join(''), rowKey(field));
  // Counting the browser's own composition events keeps the composed path from
  // silently degrading into the same insertText the typed path uses.
  const compose = async text => {
    await h.evaluate(() => {
      const host = document.querySelector('[contenteditable=true]');
      window.__imeEvents = { start: 0, end: 0 };
      host.addEventListener('compositionstart', () => { window.__imeEvents.start += 1; }, { once: true });
      host.addEventListener('compositionend', () => { window.__imeEvents.end += 1; }, { once: true });
    });
    for (let length = 1; length <= text.length; length += 1) {
      await send('Input.imeSetComposition', { text: text.slice(0, length), selectionStart: length, selectionEnd: length });
    }
    await send('Input.insertText', { text });
    await h.settle(); await h.settle();
    return h.evaluate(() => window.__imeEvents);
  };
  const cases = [
    ['caret', () => h.select('titleLeft', 120)],
    ['same-field selection', () => h.select('titleLeft', 5, 140)],
    ['same-field backward selection', () => h.select('titleLeft', 140, 5)],
    ['cross-field selection', () => h.select('titleLeft', 140, 5, 'titleRight')],
    ['cross-field backward selection', () => h.select('titleRight', 5, 140, 'titleLeft')]
  ];
  for (const [label, select] of cases) {
    const paint = async () => ({ titleLeft: await domText('titleLeft'), titleRight: await domText('titleRight') });
    await h.reset(fixture); await select();
    await h.insert('かな');
    const typed = await h.entry();
    const typedPaint = await paint();
    await h.reset(fixture); await select();
    const events = await compose('かな');
    assert.deepEqual(events, { start: 1, end: 1 }, `${label}: Chrome composed natively`);
    const composed = await h.entry();
    const composedPaint = await paint();
    const detail = JSON.stringify({ label, typed: [typed.titleLeft.length, typed.titleRight.length], composed: [composed.titleLeft.length, composed.titleRight.length] });
    assert.equal(composed.titleLeft, typed.titleLeft, `${label}: composition edits the left field as typing does ${detail}`);
    assert.equal(composed.titleRight, typed.titleRight, `${label}: composition edits the right field as typing does ${detail}`);
    assert.deepEqual(composedPaint, typedPaint, `${label}: the page paints the composed model ${detail}`);
  }
}
