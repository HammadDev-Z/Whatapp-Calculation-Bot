const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatAmount } = require('../src/utils/formatter');

const amounts = [
  ['30.00', '30.0'],
  ['1200.00', '1200.0'],
  ['-900.00', '-900.0'],
  ['0.00', '0.0'],
  ['-0.00', '0.0'],
  ['12.50', '12.50'],
  ['0.05', '0.05'],
  [100, '100.0']
];

for (const [input, output] of amounts) {
  test(`formatAmount(${JSON.stringify(input)}) -> ${output}`, () => {
    assert.equal(formatAmount(input), output);
  });
}
