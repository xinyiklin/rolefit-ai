import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const fieldKey = field => `entry|section|entry|${field}`;
const plain = value => value.replace(/<[^>]*>/g, '');
const data = h => h.page.evaluate('window.__rowContract.data');
const copy = h => h.evaluate(() => {
  const clipboardData = new DataTransfer();
  document.querySelector('[contenteditable=true]').dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }));
  return clipboardData.getData('text/plain');
});
async function paste(h, text, html = '') {
  await h.evaluate((text, html) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    if (html) clipboardData.setData('text/html', html);
    document.querySelector('[contenteditable=true]').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text, html);
  await h.settle(); await h.settle();
}

async function fieldlessSelections(h) {
  const fixture = h.fixture();
  for (const backwards of [false, true]) {
    await h.reset(fixture);
    await h.evaluate((key, backwards) => {
      const host = document.querySelector('[contenteditable=true]');
      const field = host.querySelector(`[data-tsd-field="${key}"]`);
      host.focus();
      window.getSelection().setBaseAndExtent(field, backwards ? field.childNodes.length : 0, field, backwards ? 0 : field.childNodes.length);
    }, fieldKey('titleLeft'), backwards);
    await h.settle();
    assert.equal(await copy(h), fixture.sections[0].items[0].titleLeft, 'logical field-container endpoints copy the full wrapped field');
    await h.key('Backspace', 8);
    assert.equal((await h.entry()).titleLeft, '', 'container endpoint deletion clears exactly its field');
    assert.equal((await h.entry()).titleRight, fixture.sections[0].items[0].titleRight);
    await h.key('z', 90, 4);
    assert.deepEqual(await data(h), fixture, 'Undo restores a container endpoint edit');
  }
  await h.reset(fixture);
  await h.evaluate(() => {
    const host = document.querySelector('[contenteditable=true]');
    host.focus();
    const range = document.createRange(); range.selectNodeContents(host);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  });
  await h.settle();
  const selected = await copy(h);
  const left = fixture.sections[0].items[0].titleLeft, right = fixture.sections[0].items[0].titleRight;
  assert(selected.includes(`${left}\n${right}`), 'fieldless Select All includes complete columns in logical order');
  assert(selected.includes(fixture.header.name) && selected.includes('Earlier role'), 'Select All includes first and last document fields');
  await h.insert('Replacement');
  const replaced = await data(h);
  assert(!JSON.stringify(replaced).includes(left) && !JSON.stringify(replaced).includes(right), 'typing replaces both wrapped fields in Select All');
  await h.key('z', 90, 4);
  assert.deepEqual(await data(h), fixture, 'one Undo restores the whole Select All replacement');
}

async function queuedReplacement(h) {
  await h.reset(h.fixture()); await h.select('titleLeft', 0);
  const replacement = h.fixture('Replacement document heading', 'Replacement partner');
  await h.evaluate(replacement => {
    const host = document.querySelector('[contenteditable=true]');
    for (let i = 0; i < 50; i++) host.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true }));
    window.__rowContract.reset(replacement);
  }, replacement);
  // Allow every queued zero-delay replay timer to run, including stale callbacks.
  await h.page.evaluate('new Promise(resolve => setTimeout(resolve, 350))');
  await h.settle();
  assert.deepEqual(await data(h), replacement, 'simulated queued input cannot mutate a replacement document');
  await h.select('titleLeft', 0); await h.insert('N');
  assert.equal((await h.entry()).titleLeft, `N${replacement.sections[0].items[0].titleLeft}`, 'replacement leaves the input gate usable');
}

async function pasteAndRepeatedEdits(h) {
  const fixture = h.fixture(), left = fixture.sections[0].items[0].titleLeft;
  for (const rich of [false, true]) {
    await h.reset(fixture); await h.select('titleLeft', 140);
    await paste(h, 'First line\nSecond line', rich ? '<p><strong>First line</strong></p><p><em>Second line</em></p>' : '');
    const entry = await h.entry();
    assert.equal(plain(entry.titleLeft), `${left.slice(0,140)}First line Second line${left.slice(140)}`, 'multiline paste flattens into a single logical heading');
    if (rich) {
      assert.match(entry.titleLeft, /<b>First line<\/b>/, 'rich paste retains first-line bold');
      assert.match(entry.titleLeft, /<i>Second line<\/i>/, 'rich paste retains second-line italic');
    }
    assert.equal(entry.titleRight, fixture.sections[0].items[0].titleRight, 'multiline paste preserves partner');
    await h.key('z', 90, 4); assert.deepEqual(await data(h), fixture);
  }
  await h.reset(fixture); await h.select('titleLeft', 0);
  const text = 'Large paste words '.repeat(300);
  assert(text.length < 10_000, 'large-paste case remains bounded');
  const start = performance.now();
  await paste(h, text);
  assert.equal((await h.entry()).titleLeft, text+left);
  for (let i = 0; i < 25; i++) { await h.insert('x'); await h.key('Backspace', 8); }
  assert.equal((await h.entry()).titleLeft, text+left, '25 native repeated insert/delete pairs lose no pasted text');
  assert.equal((await h.entry()).titleRight, fixture.sections[0].items[0].titleRight);
  const elapsedMs = Math.round(performance.now()-start);
  assert(elapsedMs < 30_000, 'bounded large-paste/repeated-edit run finishes before watchdog');
  return { pastedCharacters: text.length, editPairs: 25, elapsedMs, pages: await h.evaluate(() => document.querySelector('[contenteditable=true]').querySelectorAll('.tsd-page').length) };
}

async function crossPageNative(h) {
  const left = Array.from({ length: 500 }, (_, i) => `Heading${i}`).join(' ');
  const right = Array.from({ length: 320 }, (_, i) => `Partner${i}`).join(' ');
  await h.reset(h.fixture(left, right));
  const boundary = await h.evaluate(key => {
    const host = document.querySelector('[contenteditable=true]');
    const spans = [...host.querySelectorAll('[data-tsdf]')].filter(span => span.getAttribute('data-tsdf') === key);
    const span = spans.find(span => span.dataset.tsdPage !== spans[0].dataset.tsdPage);
    if (!span) throw new Error('Cross-page fixture did not paginate its left field');
    host.focus(); window.getSelection().collapse(span.firstChild, 0);
    return window.__rowContract.selection().focus.offset;
  }, fieldKey('titleLeft'));
  const needle = left.slice(boundary-24, boundary+24);
  const find = await h.evaluate(needle => {
    const host = document.querySelector('[contenteditable=true]');
    host.focus(); window.getSelection().collapse(host, 0);
    const found = window.find(needle, false, false, false, false, false, false);
    return { found, nativeText: window.getSelection().toString() };
  }, needle);
  assert(find.found, 'window.find locates text crossing a physical page boundary');
  assert.equal(find.nativeText, needle);
  assert.equal(await copy(h), needle, 'cross-page native search and model clipboard agree');
  const tree = await h.page.connection.send('Accessibility.getFullAXTree', {}, h.page.sessionId);
  const nodes = new Map(tree.nodes.map(node => [node.nodeId, node]));
  const strings = [];
  const visit = node => {
    if (!node) return;
    if (!node.ignored && node.role?.value === 'StaticText') strings.push(node.name?.value ?? '');
    for (const id of node.childIds ?? []) visit(nodes.get(id));
  };
  tree.nodes.filter(node => !node.parentId).forEach(visit);
  const text = strings.join(''), leftAt = text.indexOf(left), rightAt = text.indexOf(right);
  assert(leftAt >= 0 && rightAt >= leftAt+left.length, 'AX child traversal reads the entire cross-page left field before its partner');
  return { boundary, needle, find, axLeftAt: leftAt, axRightAt: rightAt, axTextCharacters: text.length };
}

async function alignmentAndLinks(h) {
  const reports = [];
  for (const align of ['left', 'center', 'right']) {
    const label = 'Linked heading words '.repeat(25);
    const fixture = h.fixture(`<align=${align}><link=https://example.com/paired>${label}</link></align>`, '<align=right>Partner words </align>'.repeat(20));
    await h.reset(fixture);
    const result = await h.evaluate(key => {
      const host = document.querySelector('[contenteditable=true]');
      const fragments = [...host.querySelectorAll('[data-tsdf]')].filter(span => span.getAttribute('data-tsdf') === key);
      return fragments.map(span => {
        const rect = span.getBoundingClientRect();
        const page = host.querySelector(`.tsd-page[data-tsd-page="${span.dataset.tsdPage}"]`).getBoundingClientRect();
        return { text: span.textContent, rect: rect.toJSON(), href: span.getAttribute('href'), withinPage: rect.left >= page.left-1 && rect.right <= page.right+1, line: span.dataset.tsdLine };
      });
    }, fieldKey('titleLeft'));
    assert(new Set(result.map(fragment => fragment.line)).size > 1, 'linked aligned heading wraps');
    assert(result.every(fragment => fragment.withinPage), `every aligned fragment stays bounded: ${JSON.stringify(result.filter(fragment => !fragment.withinPage))}`);
    // Engine space boxes preserve authored trailing whitespace without link metadata.
    assert(result.filter(fragment => fragment.text.trim()).every(fragment => fragment.href === 'https://example.com/paired'), 'every nonwhitespace aligned link fragment retains its destination');
    await h.select('titleLeft', 0, label.length);
    assert.equal(await copy(h), label, 'aligned link clipboard contains original label');
    reports.push({ align, fragments: result });
  }
  return reports;
}

async function contextCommand(h, key, label) {
  await h.evaluate(key => {
    const span = [...document.querySelectorAll('[contenteditable=true] [data-tsdf]')].find(span => span.getAttribute('data-tsdf') === key);
    if (!span) throw new Error(`Missing context target ${key}`);
    span.scrollIntoView({ block: 'center' });
    const rect = span.getBoundingClientRect();
    span.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left+2, clientY: rect.top+2, button: 2 }));
  }, key);
  await h.waitFor(h.page, 'document.querySelector(".ts-context-menu")', 'wrapped structure menu');
  await h.evaluate(label => {
    const button = [...document.querySelectorAll('.ts-context-menu button')].find(button => button.textContent.trim() === label);
    if (!button || button.disabled) throw new Error(`Unavailable wrapped structure command ${label}`);
    button.click();
  }, label);
  await h.settle();
}

async function structureAndHistory(h) {
  const fixture = h.fixture();
  fixture.sections.push({ ...structuredClone(fixture.sections[0]), id: 'second-section', heading: 'Other section', items: [{ ...structuredClone(fixture.sections[0].items[1]), id: 'second-entry' }] });
  for (const [key, label, check] of [
    [fieldKey('titleLeft'), 'Move entry down', value => value.sections[0].items[1].id === 'entry'],
    [fieldKey('titleLeft'), 'Delete entry', value => value.sections[0].items.every(item => item.id !== 'entry')],
    ['bullet|section|entry|bullet', 'Delete bullet', value => value.sections[0].items[0].bullets.length === 0],
    ['heading|section', 'Delete section', value => value.sections.length === 1 && value.sections[0].id === 'second-section']
  ]) {
    await h.reset(fixture);
    await contextCommand(h, key, label);
    assert(check(await data(h)), `${label} changes the intended wrapped structure`);
    await h.key('z', 90, 4);
    assert.deepEqual(await data(h), fixture, `${label} Undo restores every wrapped field and neighbor`);
    await h.key('z', 90, 12);
    assert(check(await data(h)), `${label} Redo repeats the intended structure change`);
  }
  await h.reset(fixture); await h.select('titleLeft', 140);
  await h.insert('X');
  const typed = await data(h);
  await h.select('titleLeft', 0, 5); await h.key('i', 73, 4);
  const formatted = await data(h);
  assert.notDeepEqual(formatted, typed, 'mixed history includes an actual formatting change');
  await contextCommand(h, fieldKey('titleLeft'), 'Move entry down');
  for (const expected of [formatted, typed, fixture]) {
    await h.key('z', 90, 4);
    assert.deepEqual(await data(h), expected, 'mixed structure, formatting, and content Undo preserves chronological history');
  }
}

export async function runWrappedAuditContracts(h, host, evidence) {
  await fieldlessSelections(h);
  await queuedReplacement(h);
  const workload = await pasteAndRepeatedEdits(h);
  const crossPage = await crossPageNative(h);
  const alignment = await alignmentAndLinks(h);
  await structureAndHistory(h);
  const report = { host, workload, crossPage, alignment, limitations: ['Clipboard events and queue are simulated', 'Fieldless selection endpoints are programmatic', 'window.find is not the native Find UI', 'AX traversal is not a screen-reader session', 'No section or bullet move command exists in the tested context menu'] };
  if (evidence) { await mkdir(evidence, { recursive: true }); await writeFile(join(evidence, `${host}-wrapped-audit.json`), JSON.stringify(report, null, 2)); }
  console.log(`Wrapped audit ${host}: container/Select All, queue replacement, paste, cross-page search/AX, links/alignment, and structure/history passed`);
  return report;
}
