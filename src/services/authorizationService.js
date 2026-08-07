const config = require('../config');

function normalizeNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function isAuthorized(senderNumber, authorizedNumbers = config.authorizedNumbers) {
  const normalized = normalizeNumber(senderNumber);
  return authorizedNumbers.map(normalizeNumber).includes(normalized);
}

function isAnyAuthorized(senderValues, authorizedNumbers = config.authorizedNumbers) {
  const authorizedSet = new Set(authorizedNumbers.map(normalizeNumber).filter(Boolean));
  return senderValues
    .map(normalizeNumber)
    .filter(Boolean)
    .some((senderValue) => authorizedSet.has(senderValue));
}

module.exports = {
  normalizeNumber,
  isAuthorized,
  isAnyAuthorized
};
