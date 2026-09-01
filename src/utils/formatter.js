const Decimal = require('decimal.js');

function formatMoney(value) {
  return new Decimal(value || 0).toFixed(2);
}

function formatCompactMoney(value) {
  const fixed = formatMoney(value);
  return fixed.replace(/\.00$/, '.0');
}

function formatExpression(expression) {
  return expression.replace(/\*/g, '×').replace(/\//g, '÷');
}

// Plain number for the new calculation reply: 2dp max, trailing zeros stripped
// (e.g. 0, 6, 0.8, -199) — never floating-point artifacts.
function formatPlainNumber(value) {
  return new Decimal(value || 0).toDecimalPlaces(2).toString();
}

// Display-only rewrite of a validated expression: spaced operators with the
// visual symbols +  −  ×  ÷ . A leading unary +/- stays attached to its number.
function formatCalculationExpression(expression) {
  const symbols = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  return String(expression || '')
    .replace(/\s+/g, '')
    .replace(/[+\-*/]/g, (operator, offset) => (offset === 0 ? symbols[operator] : ` ${symbols[operator]} `))
    .trim();
}

module.exports = {
  formatMoney,
  formatCompactMoney,
  formatExpression,
  formatPlainNumber,
  formatCalculationExpression
};
