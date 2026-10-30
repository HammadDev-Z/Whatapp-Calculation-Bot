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

test('addNumber upserts the number as active', async () => {
  const pool = createFakePool();

  await new AccessRepository(pool).addNumber('923001234567', 'Ali');

  assert.match(pool.statements[0].sql, /^INSERT INTO allowed_numbers/);
  assert.match(pool.statements[0].sql, /ON CONFLICT\(number\) DO UPDATE SET active=TRUE/);
  assert.deepEqual(pool.statements[0].params, ['923001234567', 'Ali']);
  assert.equal(pool.statements.length, 1);
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

test('setGroupLabel adds the group or renames it', async () => {
  const pool = createFakePool();

  await new AccessRepository(pool).setGroupLabel('g@g.us', 'Hammad');

  assert.match(pool.statements[0].sql, /^INSERT INTO bot_groups\(group_id, label\)/);
  assert.match(pool.statements[0].sql, /ON CONFLICT\(group_id\) DO UPDATE SET label=EXCLUDED\.label/);
  assert.deepEqual(pool.statements[0].params, ['g@g.us', 'Hammad']);
});

test('removeGroup deletes the group and reports whether it existed', async () => {
  const found = createFakePool(() => ({ rowCount: 1 }));
  const missing = createFakePool(() => ({ rowCount: 0 }));

  assert.equal(await new AccessRepository(found).removeGroup('g@g.us'), true);
  assert.match(found.statements[0].sql, /^DELETE FROM bot_groups WHERE group_id=\$1/);
  assert.deepEqual(found.statements[0].params, ['g@g.us']);
  assert.equal(await new AccessRepository(missing).removeGroup('x@g.us'), false);
});

test('listGroups returns only groups that were added with a name', async () => {
  const pool = createFakePool();

  await new AccessRepository(pool).listGroups();

  assert.match(pool.statements[0].sql, /FROM bot_groups g LEFT JOIN calculation_balances b/);
  assert.match(pool.statements[0].sql, /WHERE g\.label IS NOT NULL AND g\.label <> ''/);
  assert.doesNotMatch(pool.statements[0].sql, /UNION/);
});

test('listGroupLabels reads only named groups', async () => {
  const pool = createFakePool(() => ({ rows: [{ group_id: 'g@g.us', label: 'Hammad' }] }));

  assert.deepEqual(await new AccessRepository(pool).listGroupLabels(), [{ group_id: 'g@g.us', label: 'Hammad' }]);
  assert.match(pool.statements[0].sql, /label IS NOT NULL/);
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
