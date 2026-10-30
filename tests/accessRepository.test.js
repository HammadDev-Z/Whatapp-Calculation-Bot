const { test } = require('node:test');
const assert = require('node:assert/strict');
const AccessRepository = require('../src/services/accessRepository');
const AdminRepository = require('../src/services/adminRepository');
const { normalizeNumber, parseNumberInput } = require('../src/utils/phone');

function createFakePool(respond = () => ({ rows: [], rowCount: 0 })) {
  const statements = [];
  return {
    statements,
    async query(sql, params) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      statements.push({ sql: compact, params });
      return respond(compact, params);
    }
  };
}

test('addNumber upserts as active and removes the number from the ignored list', async () => {
  const pool = createFakePool();

  await new AccessRepository(pool).addNumber('923001234567', 'Ali');

  assert.match(pool.statements[0].sql, /^INSERT INTO allowed_numbers/);
  assert.match(pool.statements[0].sql, /ON CONFLICT\(number\) DO UPDATE SET active=TRUE/);
  assert.deepEqual(pool.statements[0].params, ['923001234567', 'Ali']);
  assert.match(pool.statements[1].sql, /^DELETE FROM ignored_senders WHERE number=\$1/);
  assert.deepEqual(pool.statements[1].params, ['923001234567']);
});

test('addNumber stores an empty label as null', async () => {
  const pool = createFakePool();

  await new AccessRepository(pool).addNumber('923001234567', '');

  assert.deepEqual(pool.statements[0].params, ['923001234567', null]);
});

test('setNumberActive reports whether the number exists', async () => {
  const found = createFakePool(() => ({ rowCount: 1 }));
  const missing = createFakePool(() => ({ rowCount: 0 }));

  assert.equal(await new AccessRepository(found).setNumberActive('923001234567', false), true);
  assert.deepEqual(found.statements[0].params, ['923001234567', false]);
  assert.equal(await new AccessRepository(missing).setNumberActive('923001234567', true), false);
});

test('listActiveNumbers returns only the digit strings', async () => {
  const pool = createFakePool(() => ({ rows: [{ number: '1' }, { number: '2' }] }));

  assert.deepEqual(await new AccessRepository(pool).listActiveNumbers(), ['1', '2']);
  assert.match(pool.statements[0].sql, /WHERE active = TRUE/);
});

test('setGroupLabel upserts, and an empty label clears it', async () => {
  const pool = createFakePool();
  const repository = new AccessRepository(pool);

  await repository.setGroupLabel('g@g.us', 'Hammad');
  await repository.setGroupLabel('g@g.us', '');

  assert.match(pool.statements[0].sql, /^INSERT INTO bot_groups\(group_id, label\)/);
  assert.deepEqual(pool.statements[0].params, ['g@g.us', 'Hammad']);
  assert.deepEqual(pool.statements[1].params, ['g@g.us', null]);
});

test('listGroups covers groups from both bot_groups and calculation_balances', async () => {
  const pool = createFakePool();

  await new AccessRepository(pool).listGroups();

  assert.match(pool.statements[0].sql, /SELECT group_id FROM bot_groups UNION SELECT group_id FROM calculation_balances/);
});

test('listIgnoredSenders hides senders whose number is now active', async () => {
  const pool = createFakePool();

  await new AccessRepository(pool).listIgnoredSenders(10);

  assert.match(pool.statements[0].sql, /s\.number NOT IN \(SELECT number FROM allowed_numbers WHERE active = TRUE\)/);
  assert.deepEqual(pool.statements[0].params, [10]);
});

test('sessions store only a hash of the token', async () => {
  const pool = createFakePool();
  const repository = new AdminRepository(pool);

  const session = await repository.createSession(7);

  const [stored] = pool.statements[0].params;
  assert.notEqual(stored, session.token);
  assert.match(stored, /^[0-9a-f]{64}$/);
  assert.equal(pool.statements[0].params[1], 7);
  assert.equal(pool.statements[0].params[2], session.csrfToken);
});

test('findSession returns null without a token and maps the row otherwise', async () => {
  const pool = createFakePool(() => ({ rows: [{ admin_id: 3, csrf_token: 'c', username: 'admin' }] }));
  const repository = new AdminRepository(pool);

  assert.equal(await repository.findSession(''), null);
  assert.equal(pool.statements.length, 0);
  assert.deepEqual(await repository.findSession('abc'), { adminId: 3, csrfToken: 'c', username: 'admin' });
});

test('normalizeNumber and parseNumberInput keep digits only', () => {
  assert.equal(normalizeNumber('+92 300-1234567'), '923001234567');
  assert.equal(normalizeNumber('00923001234567'), '923001234567');
  assert.equal(normalizeNumber('256577252638929@lid'), '256577252638929');
  assert.equal(normalizeNumber(undefined), '');
  assert.equal(parseNumberInput('+92 300 1234567'), '923001234567');
  assert.equal(parseNumberInput('12345'), null);
  assert.equal(parseNumberInput('abc'), null);
  assert.equal(parseNumberInput('1'.repeat(21)), null);
});
