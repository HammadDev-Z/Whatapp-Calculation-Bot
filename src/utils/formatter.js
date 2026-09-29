const Decimal = require('decimal.js');

// Whole amounts show one decimal zero (30.00 -> 30.0), anything else keeps two (12.50, 0.05).
// Negative zero is normalized so -0.00 renders as 0.0.
function formatAmount(value) {
  const rounded = new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const fixed = (rounded.isZero() ? rounded.abs() : rounded).toFixed(2);
  return fixed.endsWith('00') ? `${fixed.slice(0, -2)}0` : fixed;
}

module.exports = {
  formatAmount
};
