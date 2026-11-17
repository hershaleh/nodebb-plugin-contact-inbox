'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../library');

test('clean trims input and enforces maximum length', () => {
  assert.equal(plugin._test.clean('  hello  ', 10), 'hello');
  assert.equal(plugin._test.clean('abcdefgh', 4), 'abcd');
  assert.equal(plugin._test.clean(null, 10), '');
});

test('validEmail accepts ordinary email addresses', () => {
  assert.equal(plugin._test.validEmail('person@example.com'), true);
  assert.equal(plugin._test.validEmail('first.last+tag@example.co.il'), true);
});

test('validEmail rejects malformed addresses', () => {
  for (const value of ['', 'not-an-email', 'x@', '@example.com', 'x y@example.com']) {
    assert.equal(plugin._test.validEmail(value), false, value);
  }
});
