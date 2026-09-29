const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatAmount } = require('../src/utils/formatter');
const { randomDelayMs } = require('../src/utils/delay');

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

test('randomDelayMs returns whole seconds within the inclusive range', () => {
  assert.equal(randomDelayMs(3, 6, () => 0), 3000);
  assert.equal(randomDelayMs(3, 6, () => 0.26), 4000);
  assert.equal(randomDelayMs(3, 6, () => 0.5), 5000);
  assert.equal(randomDelayMs(3, 6, () => 0.9999), 6000);
});
