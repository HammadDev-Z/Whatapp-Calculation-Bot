const Decimal = require('decimal.js');
const { all, create } = require('mathjs');

const math = create(all, {
  number: 'BigNumber',
  precision: 64
});

const VALID_EXPRESSION_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*[+\-*/]\s*(?:\d+(?:\.\d+)?|\.\d+))*$/;

function normalizeExpression(input) {
  return String(input || '').trim().replace(/,/g, '');
}

function isArithmeticExpression(expression) {
  if (!expression || expression.length > 200) return false;
  if (!VALID_EXPRESSION_PATTERN.test(expression)) return false;
  return /\d/.test(expression);
}

function hasAnyDigit(input) {
  return /\d/.test(String(input || ''));
}

function looksLikeCalculation(input) {
  const expression = normalizeExpression(input);
  return VALID_EXPRESSION_PATTERN.test(expression);
}

function calculate(input) {
  const expression = normalizeExpression(input);

  if (!isArithmeticExpression(expression)) {
    throw new Error('Invalid calculation');
  }

  let result;
  try {
    result = math.evaluate(expression);
  } catch {
    throw new Error('Invalid calculation');
  }

  if (Array.isArray(result) || typeof result === 'function') {
    throw new Error('Invalid calculation');
  }

  const decimal = new Decimal(result.toString());
  if (!decimal.isFinite()) {
    throw new Error('Invalid calculation');
  }

  return {
    expression,
    amount: decimal.toDecimalPlaces(2),
    transactionType: /^[+-]\s*\d/.test(expression) && !/[*/()]/.test(expression.slice(1))
      ? 'adjustment'
      : 'calculation'
  };
}

module.exports = {
  calculate,
  hasAnyDigit,
  isArithmeticExpression,
  looksLikeCalculation,
  normalizeExpression
};
