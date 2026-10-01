import assert from 'node:assert/strict';
import { test } from 'node:test';
import { includesSuite, parseSuite, wrappingCases } from './suites.mjs';

test('only explicit known suite selections are accepted', () => {
  assert.equal(parseSuite([]), 'all');
  for (const suite of ['all', 'core', 'extended']) assert.equal(parseSuite([`--suite=${suite}`]), suite);
  for (const args of [['core'], ['--suite=typo'], ['--suite=core', '--suite=extended']]) {
    assert.throws(() => parseSuite(args), /Usage:/);
  }
});

test('core and extended wrapping cases partition the original six combinations', () => {
  const core = wrappingCases('core'), extended = wrappingCases('extended');
  assert.deepEqual(core, [{ length: 512, spaced: true }]);
  const keys = cases => cases.map(({ length, spaced }) => `${length}/${spaced}`).sort();
  const original = ['80/false', '80/true', '512/false', '512/true', '4096/false', '4096/true'].sort();
  assert.deepEqual(keys([...core, ...extended]), original);
  assert.deepEqual(keys(wrappingCases('all')), original);
  assert.equal(new Set(keys([...core, ...extended])).size, 6);
  for (const owner of ['core', 'extended']) {
    assert(includesSuite('all', owner));
    assert(includesSuite(owner, owner));
    assert(!includesSuite(owner === 'core' ? 'extended' : 'core', owner));
  }
});
