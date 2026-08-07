const { isAnyAuthorized, isAuthorized, normalizeNumber } = require('../src/services/authorizationService');

describe('authorizationService', () => {
  const authorizedNumbers = ['923001234567', '+92 333 1234567'];

  test('normalizes phone numbers', () => {
    expect(normalizeNumber('+92 300-1234567@c.us')).toBe('923001234567');
  });

  test('accepts authorized numbers', () => {
    expect(isAuthorized('923001234567', authorizedNumbers)).toBe(true);
  });

  test('rejects unauthorized numbers', () => {
    expect(isAuthorized('923009999999', authorizedNumbers)).toBe(false);
  });

  test('accepts any matching sender identity candidate', () => {
    expect(isAnyAuthorized(['256577252638929', '923001234567'], authorizedNumbers)).toBe(true);
  });
});
