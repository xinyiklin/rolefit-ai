import assert from 'node:assert/strict';
import { reduceResumeData, rootReducer } from '../useResumeEditor.ts';
import { createHistoryClock } from '../historyClock.ts';
import { historyCaretTarget, withFieldValue } from '../../sections/editor/resumeFieldAdapter.ts';
import { newEntry } from '@typeset/engine/lib/resumeData.ts';
import { fieldKey } from '@typeset/engine/typeset/types.ts';

const entry = { id: 'entry', titleLeft: '<b>Role</b>', titleRight: '2026', subtitleLeft: '<i>Company</i>', subtitleRight: 'Remote', bullets: [] };
const base = { header: null, sections: [{ id: 'section', heading: 'Experience', type: 'standard', items: [entry, { ...entry, id: 'other' }] }] };
const rowAction = (row, present) => ({ type: 'setEntryRow', sectionId: 'section', entryId: 'entry', row, present });
const clock = createHistoryClock();
let state = rootReducer({ data: null, dirty: false, past: [], future: [], coalesceKey: null, coalesceAt: 0, coalesceEdge: null, coalesceCount: 0 }, { type: 'seed', data: base }, clock);
state = rootReducer(state, rowAction('subtitle', false), clock);
const removed = state.data;
assert.equal(state.past.length, 1);
assert.equal(removed.sections[0].items[0].subtitleLeft, null);
assert.equal(removed.sections[0].items[0].subtitleRight, null);
assert.equal(removed.sections[0].items[1], base.sections[0].items[1]);
assert.equal(rootReducer(state, rowAction('subtitle', false), clock), state, 'repeated remove is no-op history');
state = rootReducer(state, { type: 'undo' }, clock);
assert.deepEqual(state.data, base, 'one Undo restores exact formatting and content');
state = rootReducer(state, { type: 'redo' }, clock);
assert.deepEqual(state.data, removed);
const added = reduceResumeData(removed, rowAction('subtitle', true));
assert.equal(added.sections[0].items[0].subtitleLeft, '');
assert.equal(added.sections[0].items[0].subtitleRight, '');
assert.deepEqual(historyCaretTarget(removed, added), { key: 'entry|section|entry|subtitleLeft', valueIndex: 0 }, 'Undo restores a blank row caret');
assert.deepEqual(historyCaretTarget(added, removed), { key: 'entry|section|entry|titleRight', valueIndex: 4 }, 'Undo of Add returns to title end');
assert.equal(reduceResumeData(removed, { type: 'updateEntry', sectionId: 'section', entryId: 'entry', field: 'subtitleLeft', value: 'stale edit' }), removed, 'stale text edit cannot resurrect a row');
const overlay = withFieldValue(removed, { kind: 'entry', sectionId: 'section', entryId: 'entry', field: 'subtitleLeft' }, 'overlay');
assert.equal(overlay.sections[0].items[0].subtitleLeft, null);
for (const action of [
  { type: 'setStyleFieldMark', field: 'subtitleLeft', mark: 'bold', on: true },
  { type: 'setStyleFieldFont', field: 'subtitleLeft', family: 'arimo' },
  { type: 'setStyleFieldSize', field: 'subtitleLeft', sizePt: 12 },
  { type: 'resetStyleFieldFormatting' }
]) assert.equal(reduceResumeData(removed, action).sections[0].items[0].subtitleLeft, null, 'bulk formatting cannot recreate absent structure');
const empty = reduceResumeData(removed, rowAction('title', false));
assert.equal(empty.sections[0].items.length, 2);
assert.deepEqual(historyCaretTarget(removed, empty), { key: fieldKey({ kind: 'heading', sectionId: 'section' }), valueIndex: 0 });
for (const type of ['skills', 'summary']) {
  const nonstandard = { ...base, sections: [{ ...base.sections[0], type }] };
  assert.equal(reduceResumeData(nonstandard, rowAction('title', false)), nonstandard);
}
assert.equal(newEntry({ titleLeft: null, titleRight: null }).titleLeft, null);
assert.throws(() => newEntry({ titleLeft: null, titleRight: '' }));
console.log('entry row reducer, history, formatting, overlay, and constructor checks passed');
