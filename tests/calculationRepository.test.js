const { test } = require('node:test');
const assert = require('node:assert/strict');
const CalculationRepository = require('../src/services/calculationRepository');
const CalculateAccessRepository = require('../src/services/calculateAccessRepository');

// Fake pool whose client answers each query from `respond(sql, params)` and records
// the statements, so tests can assert the exact transaction sequence.
function createFakePool(respond = () => ({ rows: [] })) {
  const statements = [];
  let released = 0;
  const run = async (sql, params) => {
    const compact = sql.replace(/\s+/g, ' ').trim();
    statements.push({ sql: compact, params });
    return respond(compact, params);
  };
  return {
    statements,
    get released() { return released; },
    query: run,
    async connect() {
      return { query: run, release() { released += 1; } };
    }
  };
}

const details = {
  groupId: 'g@g.us',
  messageId: 'msg-1',
  sender: '256577252638929@lid',
  expression: '10+20',
  amount: '30.00',
  type: 'expression',
  groupName: 'Karachi Buyers'
};

test('record upserts the balance, adds the amount and appends a ledger row in one transaction', async () => {
  const pool = createFakePool((sql) => {
    if (sql.startsWith('INSERT INTO calculation_balances')) return { rows: [{ current_total: '5.00' }] };
    if (sql.startsWith('UPDATE calculation_balances')) return { rows: [{ current_total: '35.00' }] };
    return { rows: [] };
  });

  const result = await new CalculationRepository(pool).record(details);

  assert.deepEqual(result, { duplicate: false, currentTotal: '35.00' });
  assert.deepEqual(pool.statements.map(({ sql }) => sql.split(' ').slice(0, 2).join(' ')), [
    'BEGIN',
    'SELECT 1',
    'INSERT INTO',
    'UPDATE calculation_balances',
    'INSERT INTO',
    'COMMIT'
  ]);
  assert.deepEqual(pool.statements[2].params, ['g@g.us', 'Karachi Buyers']);
  assert.deepEqual(pool.statements[3].params, ['g@g.us', '30.00']);
  assert.deepEqual(pool.statements[4].params, [
    'g@g.us', 'msg-1', '256577252638929@lid', '10+20', 'expression', '30.00', '5.00', '35.00'
  ]);
  assert.equal(pool.released, 1);
});

test('record passes a missing group name as NULL so it never overwrites a stored name', async () => {
  const pool = createFakePool((sql) => (
    sql.startsWith('INSERT INTO calculation_balances') || sql.startsWith('UPDATE')
      ? { rows: [{ current_total: '0.00' }] }
      : { rows: [] }
  ));

  await new CalculationRepository(pool).record({ ...details, groupName: null });

  assert.deepEqual(pool.statements[2].params, ['g@g.us', null]);
  assert.match(pool.statements[2].sql, /COALESCE\(EXCLUDED\.group_name, calculation_balances\.group_name\)/);
});

test('record rolls back and reports a duplicate message id', async () => {
  const pool = createFakePool((sql) => (sql.startsWith('SELECT 1') ? { rows: [{ '?column?': 1 }] } : { rows: [] }));

  const result = await new CalculationRepository(pool).record(details);

  assert.deepEqual(result, { duplicate: true });
  assert.deepEqual(pool.statements.map(({ sql }) => sql.split(' ')[0]), ['BEGIN', 'SELECT', 'ROLLBACK']);
  assert.equal(pool.released, 1);
});

test('record rolls back and rethrows on a database error', async () => {
  const pool = createFakePool((sql) => {
    if (sql.startsWith('UPDATE')) throw new Error('numeric field overflow');
    if (sql.startsWith('INSERT INTO calculation_balances')) return { rows: [{ current_total: '0.00' }] };
    return { rows: [] };
  });

  await assert.rejects(new CalculationRepository(pool).record(details), /numeric field overflow/);
  assert.equal(pool.statements.at(-1).sql, 'ROLLBACK');
  assert.equal(pool.released, 1);
});

test('listBalances returns only active groups ordered by name', async () => {
  const rows = [{ group_id: 'g@g.us', current_total: '1.00', group_name: 'A' }];
  const pool = createFakePool(() => ({ rows }));

  assert.deepEqual(await new CalculationRepository(pool).listBalances(), rows);
  assert.match(pool.statements[0].sql, /WHERE active = TRUE ORDER BY COALESCE\(group_name, group_id\)/);
});

test('isAllowed requires an active calculate_access_groups row', async () => {
  const allowed = (rows) => new CalculateAccessRepository(createFakePool(() => ({ rows }))).isAllowed('g@g.us');

  assert.equal(await allowed([{ active: true }]), true);
  assert.equal(await allowed([{ active: false }]), false);
  assert.equal(await allowed([]), false);
});
