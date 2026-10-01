const Decimal = require('decimal.js');

// decimal.js defaults (20 significant digits, ROUND_HALF_UP), pinned on a private clone
// so a global Decimal.set() elsewhere can never change calculation results.
const D = Decimal.clone({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const MAX_LENGTH = 200;

// `\d` is ASCII 0-9 only. No trailing dot, exponents or thousands separators.
const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
// `x`, `X` and `×` are deliberately NOT operators — they belong to an inventory
// shorthand (`830x5`). Only `*` multiplies; `/` and `÷` both divide.
const OPERATOR = String.raw`[+*/\-÷]`;

const ADJUSTMENT_PATTERN = new RegExp(`^([+-])(${NUMBER})$`);
// An expression may start with a single `-` glued to the first number (`-32*4`); that sign
// negates only the first number. A leading `+` is not accepted.
const EXPRESSION_PATTERN = new RegExp(`^-?${NUMBER}(?:\\s*${OPERATOR}\\s*${NUMBER})+$`);
const TOKEN_PATTERN = new RegExp(`${NUMBER}|${OPERATOR}`, 'g');

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '÷': 2 };

// Final rounding only: 2dp, ties away from zero, and never a negative zero.
function toFixedAmount(value) {
  const rounded = value.toDecimalPlaces(2, D.ROUND_HALF_UP);
  return (rounded.isZero() ? rounded.abs() : rounded).toFixed(2);
}

// Returns null on division by zero so the whole parse is rejected.
function applyOperator(operator, left, right) {
  switch (operator) {
    case '+': return left.plus(right);
    case '-': return left.minus(right);
    case '*': return left.times(right);
    default: return right.isZero() ? null : left.dividedBy(right);
  }
}

// Shunting-yard over two stacks, left-associative (pop while top precedence >= incoming).
// Intermediate results keep full 20-digit precision.
function evaluate(text) {
  const negateFirst = text.startsWith('-');
  const values = [];
  const operators = [];

  const applyTop = () => {
    const operator = operators.pop();
    const right = values.pop();
    const left = values.pop();
    const result = applyOperator(operator, left, right);
    if (result === null) return false;
    values.push(result);
    return true;
  };

  // A leading '-' is consumed as a sign, not as a binary operator.
  for (const token of text.slice(negateFirst ? 1 : 0).match(TOKEN_PATTERN)) {
    if (Object.hasOwn(PRECEDENCE, token)) {
      while (operators.length && PRECEDENCE[operators.at(-1)] >= PRECEDENCE[token]) {
        if (!applyTop()) return null;
      }
      operators.push(token);
    } else {
      const value = new D(token);
      values.push(negateFirst && values.length === 0 ? value.negated() : value);
    }
  }

  while (operators.length) {
    if (!applyTop()) return null;
  }
  return values[0];
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
  if (!result || !result.isFinite()) return null;

  return { expression: text, amount: toFixedAmount(result), type: 'expression' };
}

module.exports = {
  parseCalculation
};
