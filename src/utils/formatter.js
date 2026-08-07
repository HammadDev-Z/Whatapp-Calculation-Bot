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

module.exports = {
  formatMoney,
  formatCompactMoney,
  formatExpression
};
