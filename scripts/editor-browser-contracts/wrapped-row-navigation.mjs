import assert from 'node:assert/strict';

async function fragmentBoundary(h, field, index, end) {
  return h.evaluate((field, index, end) => {
    const key = `entry|section|entry|${field}`;
    const spans = [...document.querySelectorAll('[contenteditable=true] [data-tsdf]:not([data-tsdm])')].filter(span => span.getAttribute('data-tsdf') === key);
    const span = spans[index];
    document.querySelector('[contenteditable=true]').focus();
    window.getSelection().setBaseAndExtent(span.firstChild, end ? span.textContent.length : 0, span.firstChild, end ? span.textContent.length : 0);
    return window.__rowContract.selection().focus.offset;
  }, field, index, end);
}

export async function runWrappedNavigationContracts(h) {
  const fixture = h.fixture();
  const left = fixture.sections[0].items[0].titleLeft;
  const right = fixture.sections[0].items[0].titleRight;
  await h.reset(fixture);
  const lineStart = await fragmentBoundary(h, 'titleLeft', 1, false);
  const lineEnd = await fragmentBoundary(h, 'titleLeft', 1, true);
  await h.select('titleLeft', lineStart+2);
  await h.key('Home', 36);
  assert.equal((await h.selection()).focus.offset, lineStart, 'Home uses current field fragment');
  await h.key('End', 35);
  assert.equal((await h.selection()).focus.offset, lineEnd, 'End uses current field fragment');
  await h.key('ArrowRight', 39);
  assert.equal((await h.selection()).focus.key, 'entry|section|entry|titleLeft', 'Right across soft wrap stays in same field');
  assert.equal((await h.selection()).focus.offset, lineEnd+1, 'Right across soft wrap advances one display character');
  await h.key('ArrowLeft', 37);
  assert.equal((await h.selection()).focus.offset, lineEnd, 'Left across soft wrap returns to logical offset');
  await h.key('ArrowRight', 39, 8);
  assert.equal((await h.selection()).anchor.offset, lineEnd);
  assert.equal((await h.selection()).focus.offset, lineEnd+1, 'Shift Right selects wrap boundary character');
  await h.select('titleLeft', lineStart+2);
  await h.key('ArrowDown', 40);
  assert.equal((await h.selection()).focus.key, 'entry|section|entry|titleLeft', 'Down prefers continuation in current column');
  assert((await h.selection()).focus.offset > lineEnd);
  await h.key('ArrowUp', 38);
  assert.equal((await h.selection()).focus.key, 'entry|section|entry|titleLeft', 'Up preserves paired field');

  const point = await h.evaluate(() => {
    const span = [...document.querySelectorAll('[contenteditable=true] [data-tsdf]')].filter(span => span.getAttribute('data-tsdf') === 'entry|section|entry|titleLeft')[2];
    span.scrollIntoView({ block: 'center' });
    const r = document.createRange(); r.setStart(span.firstChild, 2); r.setEnd(span.firstChild, 3);
    const rect = r.getBoundingClientRect();
    return { x: rect.left+1, y: rect.top+rect.height/2 };
  });
  for (const type of ['mousePressed', 'mouseReleased']) await h.page.connection.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, h.page.sessionId);
  await h.settle();
  const clicked = (await h.selection()).focus;
  assert.equal(clicked.key, 'entry|section|entry|titleLeft', 'native pointer targets left continuation');
  await h.insert('P');
  assert.equal((await h.entry()).titleLeft, left.slice(0,clicked.offset)+'P'+left.slice(clicked.offset), 'native pointer then typing uses displayed continuation offset');
  assert.equal((await h.entry()).titleRight, right);

  const missing = h.fixture(left, right);
  missing.sections[0].items[0].subtitleLeft = missing.sections[0].items[0].subtitleRight = null;
  await h.reset(missing);
  const visualEnd = await fragmentBoundary(h, 'titleRight', 0, true);
  await h.select('titleRight', visualEnd);
  await h.key('Enter', 13);
  assert.equal((await h.entry()).subtitleLeft, null, 'Enter at visual end does not create subtitle row');
  await h.select('titleRight', right.length);
  await h.key('Enter', 13);
  assert.equal((await h.entry()).subtitleLeft, '', 'Enter at true wrapped field end creates subtitle');
  assert.equal((await h.selection()).focus.key, 'entry|section|entry|subtitleLeft');
  await h.key('Backspace', 8);
  assert.equal((await h.entry()).subtitleLeft, null);
  for (let cycle=0; cycle<25; cycle++) {
    await h.select('titleRight', right.length);
    await h.key('Enter', 13);
    await h.key('Backspace', 8);
    await h.key('z', 90, 4);
    assert.equal((await h.entry()).subtitleLeft, '', `row cycle ${cycle} undo removal`);
    await h.key('z', 90, 12);
    assert.equal((await h.entry()).subtitleLeft, null, `row cycle ${cycle} redo removal`);
  }
  assert.equal((await h.entry()).titleLeft, left, 'repeated structural history preserves wrapped title');
  assert.equal((await h.entry()).titleRight, right);
}
