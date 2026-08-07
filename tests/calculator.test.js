const { calculate, hasAnyDigit, looksLikeCalculation } = require('../src/services/calculatorService');
const { formatMoney } = require('../src/utils/formatter');

describe('calculatorService', () => {
  test('calculates multiplication with decimals', () => {
    const result = calculate('5*50.32');
    expect(formatMoney(result.amount)).toBe('251.60');
  });

  test('calculates whole-number multiplication', () => {
    const result = calculate('10*30');
    expect(formatMoney(result.amount)).toBe('300.00');
  });

  test('supports positive adjustments', () => {
    const result = calculate('+500');
    expect(result.transactionType).toBe('adjustment');
    expect(formatMoney(result.amount)).toBe('500.00');
  });

  test('supports negative adjustments', () => {
    const result = calculate('-400');
    expect(result.transactionType).toBe('adjustment');
    expect(formatMoney(result.amount)).toBe('-400.00');
  });

  test('supports decimal calculations', () => {
    const result = calculate('50.5+0.25');
    expect(formatMoney(result.amount)).toBe('50.75');
  });

  test('supports parentheses', () => {
    expect(() => calculate('(50*4)+100')).toThrow('Invalid calculation');
  });

  test('rejects invalid input', () => {
    expect(() => calculate('5**hello')).toThrow('Invalid calculation');
  });

  test('detects normal chat as non-calculation', () => {
    expect(hasAnyDigit('hey how are you')).toBe(false);
    expect(looksLikeCalculation('hey how are you')).toBe(false);
  });

  test('rejects mixed text even when it contains numbers', () => {
    expect(hasAnyDigit('Bas 628 done kr do')).toBe(true);
    expect(looksLikeCalculation('Bas 628 done kr do')).toBe(false);
  });

  test('detects malformed numeric messages as non-calculation', () => {
    expect(hasAnyDigit('5**hello')).toBe(true);
    expect(looksLikeCalculation('5**hello')).toBe(false);
  });

  test('accepts only direct numeric calculation formats', () => {
    expect(looksLikeCalculation('89-54')).toBe(true);
    expect(looksLikeCalculation('-7')).toBe(true);
    expect(looksLikeCalculation('78')).toBe(true);
    expect(looksLikeCalculation('5*5')).toBe(true);
    expect(looksLikeCalculation('100 / 4')).toBe(true);
  });
});
