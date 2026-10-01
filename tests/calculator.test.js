const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCalculation } = require('../src/services/calculatorService');

const expressions = [
  ['10+20-5', '25.00'],
  ['4*6-8', '16.00'],
  ['3-8+50', '45.00'],
  ['30/4+70', '77.50'],
  ['90.29/3', '30.10'],
  ['90.38÷5', '18.08'],
  ['2560+32+487-273', '2806.00'],
  ['2+3*4-10/5', '12.00'],
  ['1/3*3', '1.00'],
  ['.5+.5', '1.00'],
  ['0.005+0', '0.01'],
  ['2.675+0', '2.68'],
  ['0.004+0', '0.00'],
  ['12/05/2026', '0.00'],
  ['0300-1234567', '-1234267.00'],
  ['5-5', '0.00'],
  ['0/5+0', '0.00'],
  ['0-0.001', '0.00'],
  ['1+'.repeat(99) + '1', '100.00'],
  ['-32*4', '-128.00'],
  ['-5+3', '-2.00'],
  ['-5-3', '-8.00'],
  ['-10/4', '-2.50'],
  ['-2*3+10', '4.00'],
  ['-.5*4', '-2.00'],
  ['-10 + 20', '10.00'],
  ['-0*5', '0.00']
];

for (const [input, amount] of expressions) {
  test(`expression ${JSON.stringify(input.length > 30 ? `${input.slice(0, 12)}… (${input.length} chars)` : input)} -> ${amount}`, () => {
    assert.deepEqual(parseCalculation(input), { expression: input, amount, type: 'expression' });
  });
}

test('trims surrounding whitespace but keeps internal spacing and newlines', () => {
  assert.deepEqual(parseCalculation(' 10 + 20 '), { expression: '10 + 20', amount: '30.00', type: 'expression' });
  assert.deepEqual(parseCalculation('10+\n20'), { expression: '10+\n20', amount: '30.00', type: 'expression' });
});

const adjustments = [
  ['+50', '50.00'],
  ['-12.5', '-12.50'],
  ['+.5', '0.50'],
  ['-0', '0.00'],
  ['+0', '0.00'],
  ['-0.005', '-0.01'],
  ['-0.004', '0.00']
];

for (const [input, amount] of adjustments) {
  test(`adjustment ${input} -> ${amount}`, () => {
    assert.deepEqual(parseCalculation(input), { expression: input, amount, type: 'adjustment' });
  });
}

const rejected = [
  '5', '12.5', '5.', '5.+1', '1e5+1', '+ 50', '--5', '5--3', '5-', '(1+2)', '10x2', '5150X1', '10×2',
  '10/0', '10/0+2', '1,000+1', '٣+٢', '10 + 20 = 30', 'please calculate 10+20', '-10/0', '-5+', '- 5+3', '-+5*2', '+5*2', '','   ',
  '1+'.repeat(100) + '1'
];

for (const input of rejected) {
  test(`rejects ${JSON.stringify(input.length > 30 ? `${input.slice(0, 12)}… (${input.length} chars)` : input)}`, () => {
    assert.equal(parseCalculation(input), null);
  });
}

test('rejects non-string bodies', () => {
  for (const input of [undefined, null, 42, {}, []]) assert.equal(parseCalculation(input), null);
});
