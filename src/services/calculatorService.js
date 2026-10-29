const Decimal = require('decimal.js');

// decimal.js defaults (20 significant digits, ROUND_HALF_UP), pinned on a private clone
// so a global Decimal.set() elsewhere can never change calculation results.
const D = Decimal.clone({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const MAX_LENGTH = 200;

// `\d` is ASCII 0-9 only. No trailing dot, exponents or thousands separators.
const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
// `+`, `-` and `*` only. Division (`/`, `÷`) and `x` / `×` are deliberately unsupported,
// so such messages are ignored.
const OPERATOR = String.raw`[+*\-]`;

const ADJUSTMENT_PATTERN = new RegExp(`^([+-])(${NUMBER})$`);
// An expression may start with a single `+` or `-` glued to the first number (`-32*4`,
// `+5*2`); a `-` negates only the first number.
const EXPRESSION_PATTERN = new RegExp(`^[+-]?${NUMBER}(?:\\s*${OPERATOR}\\s*${NUMBER})+$`);
const TOKEN_PATTERN = new RegExp(`${NUMBER}|${OPERATOR}`, 'g');

// Final rounding only: 2dp, ties away from zero, and never a negative zero.
function toFixedAmount(value) {
  const rounded = value.toDecimalPlaces(2, D.ROUND_HALF_UP);
  return (rounded.isZero() ? rounded.abs() : rounded).toFixed(2);
}

// `*` binds tighter than `+` and `-`: products are folded into the current term, and each
// term is added or subtracted. Intermediate results keep full 20-digit precision.
function evaluate(text) {
  const negateFirst = text.startsWith('-');
  // A leading sign is consumed as a sign, not as a binary operator.
  const tokens = text.slice(/^[+-]/.test(text) ? 1 : 0).match(TOKEN_PATTERN);

  const first = new D(tokens[0]);
  let term = negateFirst ? first.negated() : first;
  let total = new D(0);
  let sign = 1;
  for (let i = 1; i < tokens.length; i += 2) {
    const operator = tokens[i];
    const value = new D(tokens[i + 1]);
    if (operator === '*') {
      term = term.times(value);
    } else {
      total = total.plus(sign === 1 ? term : term.negated());
      sign = operator === '+' ? 1 : -1;
      term = value;
    }
  }
  return total.plus(sign === 1 ? term : term.negated());
}

// Returns { expression, amount, type } or null when the message is not a calculation.
// `amount` is a 2dp string ("30.00"); `expression` is the trimmed text exactly as typed.
function parseCalculation(body) {
  if (typeof body !== 'string') return null;
  const text = body.trim();
  if (!text || text.length > MAX_LENGTH) return null;

  const adjustment = ADJUSTMENT_PATTERN.exec(text);
  if (adjustment) {
    const magnitude = new D(adjustment[2]);
    const amount = adjustment[1] === '-' ? magnitude.negated() : magnitude;
    return { expression: text, amount: toFixedAmount(amount), type: 'adjustment' };
  }

  if (!EXPRESSION_PATTERN.test(text)) return null;

  const result = evaluate(text);
  if (!result.isFinite()) return null;

  return { expression: text, amount: toFixedAmount(result), type: 'expression' };
}

module.exports = {
  parseCalculation
};
