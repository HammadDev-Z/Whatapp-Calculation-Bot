// Digits only, so "+92 300-1234567", "0092300..." and "92300..." compare equal. Returns '' when
// the value has no digits. Numbers must include the country code (no local leading 0).
function normalizeNumber(value) {
  return String(value ?? '').replace(/\D/g, '').replace(/^00/, '');
}

// Accepts what an admin may type into the website; null when it cannot be a phone number.
function parseNumberInput(value) {
  const digits = normalizeNumber(value);
  return digits.length >= 6 && digits.length <= 20 ? digits : null;
}

module.exports = { normalizeNumber, parseNumberInput };
