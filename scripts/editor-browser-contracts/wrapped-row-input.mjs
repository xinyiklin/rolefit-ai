import assert from 'node:assert/strict';

export async function runWrappedSelectionContracts(h, fixture = h.fixture(), boundary = 140) {
  const left = fixture.sections[0].items[0].titleLeft;
  const right = fixture.sections[0].items[0].titleRight;
  for (const backwards of [false, true]) {
    await h.reset(fixture);
    await h.select('titleLeft', backwards ? boundary : 5, backwards ? 5 : boundary);
    const clipboard = await h.evaluate(() => {
      const transfer = new DataTransfer();
      document.querySelector('[contenteditable=true]').dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer }));
      return transfer.getData('text/plain');
    });
    assert.equal(clipboard, left.slice(5, boundary), 'same-field wrapped copy excludes sibling');
    await h.key('Backspace', 8);
    assert.equal((await h.entry()).titleLeft, left.slice(0, 5)+left.slice(boundary), 'same-field delete follows logical offsets');
    assert.equal((await h.entry()).titleRight, right, 'same-field delete preserves sibling');
    await h.key('z', 90, 4);
    assert.equal((await h.entry()).titleLeft, left, 'undo restores wrapped deletion');
    await h.select('titleLeft', backwards ? boundary : 5, backwards ? 5 : boundary);
    await h.key('i', 73, 4);
    assert.equal((await h.entry()).titleRight, right, 'same-field formatting preserves sibling');
    assert.match((await h.entry()).titleLeft, /<i>/, 'same-field format applies');
    await h.reset(fixture);
    await h.select('titleLeft', backwards ? boundary : 5, backwards ? 5 : boundary);
    const cut = await h.evaluate(() => {
      const clipboardData = new DataTransfer();
      document.querySelector('[contenteditable=true]').dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData }));
      return clipboardData.getData('text/plain');
    });
    await h.settle();
    assert.equal(cut, left.slice(5, boundary), 'cut uses logical same-field text');
    assert.equal((await h.entry()).titleLeft, left.slice(0,5)+left.slice(boundary));
    assert.equal((await h.entry()).titleRight, right);
    await h.evaluate(text => {
      const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
      document.querySelector('[contenteditable=true]').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    }, cut);
    await h.settle();
    assert.equal((await h.entry()).titleLeft, left, 'paste restores cut continuation text without sibling contamination');
  }
  for (const backwards of [false, true]) {
    await h.reset(fixture);
    await h.select(backwards ? 'titleRight' : 'titleLeft', backwards ? 5 : boundary, backwards ? boundary : 5, backwards ? 'titleLeft' : 'titleRight');
    const clipboard = await h.evaluate(() => {
      const transfer = new DataTransfer();
      document.querySelector('[contenteditable=true]').dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer }));
      return transfer.getData('text/plain');
    });
    assert.equal(clipboard, `${left.slice(boundary)}\n${right.slice(0, 5)}`, 'cross-field copy follows logical field order despite reversed DOM endpoints');
    await h.key('i', 73, 4);
    const formatted = await h.entry();
    assert.match(formatted.titleLeft, /<i>/, 'cross-field formatting includes left suffix');
    assert.match(formatted.titleRight, /<i>/, 'cross-field formatting includes right prefix');
    assert.equal(formatted.titleLeft.replace(/<[^>]*>/g, ''), left, 'cross-field formatting preserves left text');
    assert.equal(formatted.titleRight.replace(/<[^>]*>/g, ''), right, 'cross-field formatting preserves right text');
    const restored = await h.selection();
    assert.equal(restored.anchor.key, `entry|section|entry|${backwards ? 'titleRight' : 'titleLeft'}`, 'reflow retains logical selection direction');
    assert.equal(restored.anchor.offset, backwards ? 5 : boundary);
    assert.equal(restored.focus.offset, backwards ? boundary : 5);
    await h.key('z', 90, 4);
    await h.select(backwards ? 'titleRight' : 'titleLeft', backwards ? 5 : boundary, backwards ? boundary : 5, backwards ? 'titleLeft' : 'titleRight');
    await h.key('Backspace', 8);
    assert.equal((await h.entry()).titleLeft, left.slice(0, boundary));
    assert.equal((await h.entry()).titleRight, right.slice(5));
    await h.key('z', 90, 4);
    assert.equal((await h.entry()).titleLeft, left);
    assert.equal((await h.entry()).titleRight, right);
  }
}

export async function runWrappedInputContracts(h) {
  await runQueuedGraphemeContracts(h);
  await runQueuedWordDeletionContracts(h);
  const fixture = h.fixture();
  const left = fixture.sections[0].items[0].titleLeft;
  await h.reset(fixture);
  await h.select('titleLeft', 120);
  await h.insert('X');
  assert.equal((await h.entry()).titleLeft, left.slice(0,120)+'X'+left.slice(120), 'native continuation insertion retains source text');
  await h.reset(fixture);
  await h.select('titleLeft', 0);
  await h.evaluate(() => {
    const el = document.querySelector('[contenteditable=true]');
    for (let index=0; index<100; index++) el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true }));
  });
  await h.waitFor(h.page, `window.__rowContract.data.sections[0].items[0].titleLeft === ${JSON.stringify('x'.repeat(100)+left)}`, '100 queued insertions');
  await h.evaluate(() => {
    const el = document.querySelector('[contenteditable=true]');
    for (let index=0; index<100; index++) el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
  });
  await h.waitFor(h.page, `window.__rowContract.data.sections[0].items[0].titleLeft === ${JSON.stringify(left)}`, '100 queued deletions');
  const unicode = 'café e\u0301 😀 👩‍💻';
  await h.select('titleLeft', 120);
  await h.insert(unicode);
  assert.equal((await h.entry()).titleLeft, left.slice(0,120)+unicode+left.slice(120), 'native Unicode insertion preserves UTF-16 source');
  await h.reset(fixture);
  await h.select('titleLeft', 120);
  await h.evaluate(() => {
    const el = document.querySelector('[contenteditable=true]');
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'é' }));
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'é' }));
  });
  await h.settle();
  assert.equal((await h.entry()).titleLeft, left.slice(0,120)+'é'+left.slice(120), 'simulated composition commits once');
  assert.equal((await h.entry()).titleRight, fixture.sections[0].items[0].titleRight, 'simulated composition preserves neighboring field');
  await h.reset(fixture);
  const before = await h.page.evaluate('window.__rowContract.data');
  await h.page.evaluate('window.__rowContract.reopen()'); await h.settle();
  const after = await h.page.evaluate('window.__rowContract.data');
  const content = data => data.sections.map(section => section.items.map(({titleLeft,titleRight,subtitleLeft,subtitleRight,bullets}) => ({ titleLeft,titleRight,subtitleLeft,subtitleRight,bullets:bullets.map(b => b.text) })));
  assert.deepEqual(content(after), content(before), 'strict save/reopen preserves all wrapped content');
}

export async function runQueuedGraphemeContracts(h) {
  const base = h.fixture();
  const left = base.sections[0].items[0].titleLeft;
  for (const grapheme of ['e\u0301', '😀', '👩‍💻']) {
    for (const direction of ['backward', 'forward']) {
      const fixture = structuredClone(base);
      if (direction === 'forward') fixture.sections[0].items[0].titleLeft = `X${grapheme}${left}`;
      await h.reset(fixture); await h.select('titleLeft', 0);
      await h.evaluate((grapheme, direction) => {
        const host = document.querySelector('[contenteditable=true]');
        const events = direction === 'backward'
          ? [['insertText', grapheme], ['deleteContentBackward', null]]
          : [['deleteContentForward', null], ['deleteContentForward', null]];
        for (const [inputType, data] of events) host.dispatchEvent(new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }));
      }, grapheme, direction);
      await h.settle(); await h.settle();
      assert.equal((await h.entry()).titleLeft, left, `queued ${direction} delete removes whole ${JSON.stringify(grapheme)} grapheme`);
    }
  }
  await runQueuedNoopContract(h);
}

export async function runQueuedNoopContract(h) {
  const base = h.fixture();
  const left = base.sections[0].items[0].titleLeft;
  await h.reset(base); await h.select('titleLeft', 0);
  await h.evaluate(() => {
    const host = document.querySelector('[contenteditable=true]');
    for (const [inputType, data] of [['insertText','X'],['deleteContentBackward',null],['deleteContentBackward',null],['insertText','Q']]) {
      host.dispatchEvent(new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }));
    }
  });
  await h.settle(); await h.settle();
  assert.equal((await h.entry()).titleLeft, `Q${left}`, 'queued no-op Backspace at field start does not drop following insertion');
}

export async function runQueuedWordDeletionContracts(h) {
  const fixture = h.fixture('Alpha beta gamma ' + 'long heading words '.repeat(30), 'Partner words '.repeat(20));
  const modifier = process.platform === 'darwin' ? 1 : 2;
  for (const direction of ['Backward', 'Forward']) {
    const offset = direction === 'Backward' ? 16 : 0;
    await h.reset(fixture); await h.select('titleLeft', offset); await h.insert('X');
    for (let index = 0; index < 2; index++) await h.key(direction === 'Backward' ? 'Backspace' : 'Delete', direction === 'Backward' ? 8 : 46, modifier);
    const expected = (await h.entry()).titleLeft;
    await h.reset(fixture); await h.select('titleLeft', offset);
    await h.evaluate(direction => {
      const host = document.querySelector('[contenteditable=true]');
      host.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'X', bubbles: true, cancelable: true }));
      for (let index = 0; index < 2; index++) host.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteWord' + direction, bubbles: true, cancelable: true }));
    }, direction);
    await h.waitFor(h.page, `window.__rowContract.data.sections[0].items[0].titleLeft === ${JSON.stringify(expected)}`, `queued word deletion ${direction} matches settled native deletion`);
    await h.settle();
    assert.equal((await h.entry()).titleLeft, expected, 'queued word deletion preserves native granularity and order');
    assert.equal((await h.entry()).titleRight, fixture.sections[0].items[0].titleRight, 'queued word deletion preserves its partner');
  }
  const emptyPair = structuredClone(fixture);
  emptyPair.sections[0].items[0].subtitleLeft = '';
  emptyPair.sections[0].items[0].subtitleRight = '';
  await h.reset(emptyPair); await h.select('subtitleLeft', 0);
  await h.evaluate(async () => {
    const host = document.querySelector('[contenteditable=true]');
    host.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'X', bubbles: true, cancelable: true }));
    for (let index = 0; index < 2; index++) host.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteWordBackward', bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 350));
  });
  await h.settle();
  const entry = await h.entry();
  assert.equal(entry.subtitleLeft, '', 'queued word deletion at the empty subtitle start preserves its row');
  assert.equal(entry.subtitleRight, '', 'queued word deletion preserves the empty subtitle partner');
}
