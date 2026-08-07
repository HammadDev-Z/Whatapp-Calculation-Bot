const { formatCompactMoney, formatExpression } = require('../src/utils/formatter');

describe('formatter', () => {
  test('formats whole values with one decimal', () => {
    expect(formatCompactMoney('25')).toBe('25.0');
  });

  test('keeps two decimals when cents exist', () => {
    expect(formatCompactMoney('251.60')).toBe('251.60');
  });

  test('formats multiplication symbol for WhatsApp replies', () => {
    expect(formatExpression('5*5')).toBe('5×5');
  });
});
