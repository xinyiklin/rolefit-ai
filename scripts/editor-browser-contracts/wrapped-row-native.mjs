import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function clipboard(h) {
  return h.evaluate(() => {
    const clipboardData = new DataTransfer();
    document.querySelector('[contenteditable=true]').dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }));
    return clipboardData.getData('text/plain');
  });
}

async function nativeWordOffsets(h, text, offset, modifier) {
  await h.evaluate((text, offset) => {
    const control = document.createElement('div');
    control.id = 'native-word-reference';
    control.contentEditable = 'true';
    control.style.cssText = 'position:fixed;inset:0 auto auto 0;width:1000px;white-space:pre-wrap';
    control.textContent = text;
    document.body.append(control);
    control.focus();
    window.getSelection().collapse(control.firstChild, offset);
  }, text, offset);
  try {
    await h.key('ArrowLeft', 37, modifier);
    const backward = await h.evaluate(() => window.getSelection().focusOffset);
    await h.key('ArrowRight', 39, modifier);
    const forward = await h.evaluate(() => window.getSelection().focusOffset);
    return { backward, forward };
  } finally {
    await h.evaluate(() => document.getElementById('native-word-reference').remove());
  }
}

export async function runWrappedNativeContracts(h, host, evidence) {
  const fixture = h.fixture();
  const wordModifier = process.platform === 'darwin' ? 1 : 2;
  for (const field of ['titleLeft', 'titleRight']) {
    await h.reset(fixture);
    const text = fixture.sections[0].items[0][field];
    const wordStart = text.indexOf('heading', 140);
    const wordEnd = wordStart+'heading'.length;
    const native = await nativeWordOffsets(h, text, wordEnd, wordModifier);
    assert.equal(native.backward, wordStart, 'plain browser control reaches the expected previous word');
    await h.select(field, wordEnd);
    await h.key('ArrowLeft', 37, wordModifier);
    assert.equal((await h.selection()).focus.key, `entry|section|entry|${field}`);
    assert.equal((await h.selection()).focus.offset, wordStart, 'native word-left reaches previous word start in the same field');
    await h.key('ArrowRight', 39, wordModifier);
    const forward = (await h.selection()).focus;
    assert.equal(forward.key, `entry|section|entry|${field}`);
    assert.equal(forward.offset, native.forward, 'word-right matches the plain browser control');
    await h.select(field, wordEnd);
    await h.key('Backspace', 8, wordModifier);
    assert.equal((await h.entry())[field], text.slice(0,wordStart)+text.slice(wordEnd), 'native word deletion preserves neighboring columns');
    assert.equal((await h.entry())[field === 'titleLeft' ? 'titleRight' : 'titleLeft'], fixture.sections[0].items[0][field === 'titleLeft' ? 'titleRight' : 'titleLeft']);
  }
  await h.reset(fixture);
  const point = await h.evaluate(() => {
    const span = [...document.querySelectorAll('[contenteditable=true] [data-tsdf]')].find(span => span.getAttribute('data-tsdf') === 'entry|section|entry|titleLeft');
    span.scrollIntoView({ block: 'center' });
    const range = document.createRange(); range.setStart(span.firstChild, 1); range.setEnd(span.firstChild, 2);
    const rect = range.getBoundingClientRect();
    return { x: rect.left+rect.width/2, y: rect.top+rect.height/2 };
  });
  const click = async count => {
    for (const type of ['mousePressed', 'mouseReleased']) await h.page.connection.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: count }, h.page.sessionId);
    await h.settle();
  };
  await click(2);
  assert.equal(await clipboard(h), 'Left', 'native double-click selects one word without the sibling');
  await click(3);
  const tripleClick = { selection: await h.selection(), logicalPlain: await clipboard(h) };
  // Browser text search and the exposed AX tree are evidence, not substitutes
  // for the native Find UI or an actual screen-reader session.
  const find = await h.evaluate(() => {
    const root = document.querySelector('[contenteditable=true]');
    root.focus(); window.getSelection().collapse(root, 0);
    const found = window.find('heading words', false, false, false, false, false, false);
    return { found, nativeText: window.getSelection().toString(), selection: window.__rowContract.selection() };
  });
  const ax = await h.page.connection.send('Accessibility.getFullAXTree', {}, h.page.sessionId);
  const text = ax.nodes.filter(node => node.role?.value === 'StaticText' && !node.ignored).map(node => ({ nodeId: node.nodeId, parentId: node.parentId, name: node.name?.value }));
  const report = { host, wordModifier: process.platform === 'darwin' ? 'Alt' : 'Control', tripleClick, windowFind: find, exposedStaticText: text, limitations: ['Native Find UI not exercised', 'No screen reader session', 'No actual OS IME'] };
  if (evidence) await writeFile(join(evidence, `${host}-native-observations.json`), JSON.stringify(report, null, 2));
  console.log(`Wrapped native ${host}: double-click and word navigation/deletion passed; triple-click ${tripleClick.selection.anchor?.key} → ${tripleClick.selection.focus?.key}; window.find=${find.found}; AX StaticText nodes=${text.length}`);
  return report;
}

export async function observeWrappedNativeBoundaries(h, host, evidence) {
  const reports = [];
  for (const [name, fixture] of [
    ['short', h.fixture('Left heading words', 'Right heading words')],
    ['wrapped', h.fixture()],
    ['hard-token', h.fixture('W'.repeat(250), 'R'.repeat(160))]
  ]) {
    await h.reset(fixture);
    const clicks = [];
    for (const field of ['titleLeft', 'titleRight']) {
      const point = await h.evaluate(field => {
        const span = [...document.querySelectorAll('[contenteditable=true] [data-tsdf]')].find(span => span.getAttribute('data-tsdf') === `entry|section|entry|${field}`);
        span.scrollIntoView({ block: 'center' });
        const end = span.textContent.trimEnd().length;
        const range = document.createRange(); range.setStart(span.firstChild, end-1); range.setEnd(span.firstChild, end);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left+rect.width/2, y: rect.top+rect.height/2,
          hitElements: document.elementsFromPoint(rect.left+rect.width/2, rect.top+rect.height/2).slice(0,5).map(element => element.outerHTML.slice(0,300)),
          viewport: { width: innerWidth, height: innerHeight },
          clickedCharacter: span.textContent.slice(end-1,end),
          fragmentText: span.textContent,
          fragmentRect: span.getBoundingClientRect().toJSON(), characterRect: rect.toJSON()
        };
      }, field);
      await h.page.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, h.page.sessionId);
      for (const type of ['mousePressed', 'mouseReleased']) await h.page.connection.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 }, h.page.sessionId);
      await h.settle();
      for (const count of [2, 3]) {
        for (const type of ['mousePressed', 'mouseReleased']) await h.page.connection.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: count }, h.page.sessionId);
        await h.settle();
        clicks.push({ field, count, point, selection: await h.selection(), nativeText: await h.evaluate(() => window.getSelection().toString()), logicalPlain: await clipboard(h), rawSelection: await h.evaluate(() => {
          const selection = window.getSelection();
          const endpoint = (node, offset) => ({ nodeName: node?.nodeName, offset, text: node?.textContent?.slice(0,160), parent: node?.parentElement?.outerHTML.slice(0,300) });
          return { anchor: endpoint(selection.anchorNode, selection.anchorOffset), focus: endpoint(selection.focusNode, selection.focusOffset) };
        }) });
        if (evidence && field === 'titleLeft' && count === 3) {
          const screenshot = await h.page.connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, h.page.sessionId);
          await writeFile(join(evidence, `${host}-${name}-native-triple-click.png`), Buffer.from(screenshot.data, 'base64'));
        }
      }
    }
    const ax = await h.page.connection.send('Accessibility.getFullAXTree', {}, h.page.sessionId);
    const nodes = new Map(ax.nodes.map(node => [node.nodeId, node]));
    const orderedText = [];
    const visit = node => {
      if (!node) return;
      if (!node.ignored && node.role?.value === 'StaticText') orderedText.push(node.name?.value ?? '');
      for (const id of node.childIds ?? []) visit(nodes.get(id));
    };
    ax.nodes.filter(node => !node.parentId).forEach(visit);
    const needle = name === 'hard-token' ? 'W'.repeat(100) : fixture.sections[0].items[0].titleLeft.slice(0,100);
    const found = await h.evaluate(needle => {
      const root = document.querySelector('[contenteditable=true]');
      root.focus(); window.getSelection().collapse(root, 0);
      return window.find(needle, false, false, false, false, false, false);
    }, needle);
    reports.push({ name, clicks, axTextInChildOrder: orderedText, find: { needle, found }, axNodes: ax.nodes });
    if (evidence) await writeFile(join(evidence, `${host}-native-boundaries.json`), JSON.stringify(reports, null, 2));
    for (const click of clicks) {
      const label = `${host}/${name}/${click.field}/click${click.count}`;
      assert.equal(click.logicalPlain, click.nativeText, `${label}: native and model clipboard agree`);
      assert.equal(click.selection.anchor.key, `entry|section|entry|${click.field}`, `${label}: anchor stays in clicked field`);
      assert.equal(click.selection.focus.key, `entry|section|entry|${click.field}`, `${label}: focus stays in clicked field`);
      const source = fixture.sections[0].items[0][click.field];
      const clickedOffset = click.point.fragmentText.trimEnd().length - 1;
      const wordStart = source.slice(0, clickedOffset + 1).search(/\S+$/);
      const suffix = source.slice(clickedOffset + 1).match(/^\S*/)[0];
      const expected = click.count === 3 ? source : source.slice(wordStart, clickedOffset + 1) + suffix;
      assert.equal(click.nativeText, expected, `${label}: native selection contains the clicked word or field`);
    }
    assert(found, `${host}/${name}: browser text search spans logical field fragments`);
    const axJoined = orderedText.join('');
    const leftText = fixture.sections[0].items[0].titleLeft;
    const rightText = fixture.sections[0].items[0].titleRight;
    const leftAt = axJoined.indexOf(leftText), rightAt = axJoined.indexOf(rightText);
    assert(leftAt >= 0 && rightAt >= leftAt+leftText.length, `${host}/${name}: AX reads complete left field before right field`);
    console.log(`Native boundary observation ${host}/${name}: ${clicks.map(click => `${click.field} click${click.count} native=${click.nativeText.length} logical=${click.logicalPlain.length}`).join('; ')}; window.find=${found}`);
  }
  if (evidence) await writeFile(join(evidence, `${host}-native-boundaries.json`), JSON.stringify(reports, null, 2));
  return reports;
}
