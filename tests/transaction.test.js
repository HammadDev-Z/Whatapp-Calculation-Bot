const Decimal = require('decimal.js');
const {
  getHistory,
  getGroupSummary,
  isDuplicateMessage,
  recordTransaction,
  resetGroup,
  undoLatest
} = require('../src/services/transactionService');

function createMockPool() {
  const state = {
    groups: [],
    transactions: [],
    nextGroupId: 1,
    nextTransactionId: 1
  };

  const client = {
    async query(sql, params = []) {
      return queryState(state, sql, params);
    },
    release() {}
  };

  return {
    state,
    async query(sql, params = []) {
      return queryState(state, sql, params);
    },
    async connect() {
      return client;
    }
  };
}

function clone(row) {
  return row ? { ...row } : row;
}

function queryState(state, sql, params) {
  const compact = sql.replace(/\s+/g, ' ').trim();
  if (compact === 'BEGIN' || compact === 'COMMIT' || compact === 'ROLLBACK') return { rows: [] };

  if (compact.startsWith('SELECT * FROM groups WHERE whatsapp_group_id')) {
    return { rows: state.groups.filter((group) => group.whatsapp_group_id === params[0]).map(clone) };
  }

  if (compact.startsWith('UPDATE groups SET whatsapp_group_name')) {
    const group = state.groups.find((item) => item.whatsapp_group_id === params[1]);
    if (group) group.whatsapp_group_name = params[0];
    return { rows: [] };
  }

  if (compact.startsWith('INSERT INTO groups')) {
    const group = {
      id: state.nextGroupId++,
      whatsapp_group_id: params[0],
      whatsapp_group_name: params[1],
      display_name: params[1],
      current_total: '0.00'
    };
    state.groups.push(group);
    return { rows: [clone(group)] };
  }

  if (compact.startsWith('SELECT * FROM groups WHERE id')) {
    return { rows: state.groups.filter((group) => group.id === params[0]).map(clone) };
  }

  if (compact.startsWith('SELECT 1 FROM transactions WHERE message_id')) {
    return { rows: state.transactions.some((transaction) => transaction.message_id === params[0]) ? [{ '?column?': 1 }] : [] };
  }

  if (compact.startsWith('INSERT INTO transactions')) {
    const transaction = {
      id: state.nextTransactionId++,
      group_id: params[0],
      sender_number: params[1],
      message_id: params[2],
      expression: params[3],
      transaction_type: compact.includes("'undo'") ? 'undo' : params[4],
      amount: compact.includes("'undo'") ? params[4] : params[5],
      balance_before: compact.includes("'undo'") ? params[5] : params[6],
      balance_after: compact.includes("'undo'") ? params[6] : params[7],
      undone_transaction_id: compact.includes("'undo'") ? params[7] : params[8],
      created_at: new Date(state.nextTransactionId).toISOString()
    };
    state.transactions.push(transaction);
    return { rows: [clone(transaction)] };
  }

  if (compact.startsWith('UPDATE groups SET current_total')) {
    const group = state.groups.find((item) => item.id === params[1]);
    group.current_total = params[0];
    return { rows: [clone(group)] };
  }

  if (compact.startsWith('SELECT g.*, COUNT')) {
    const group = state.groups.find((item) => item.whatsapp_group_id === params[0]);
    if (!group) return { rows: [] };
    return {
      rows: [{
        ...clone(group),
        transaction_count: state.transactions.filter((transaction) => transaction.group_id === group.id).length
      }]
    };
  }

  if (compact.startsWith('SELECT t.* FROM transactions t JOIN groups')) {
    const group = state.groups.find((item) => item.whatsapp_group_id === params[0]);
    if (!group) return { rows: [] };
    return {
      rows: state.transactions
        .filter((transaction) => transaction.group_id === group.id)
        .slice(-params[1])
        .reverse()
        .map(clone)
    };
  }

  if (compact.startsWith('SELECT * FROM transactions WHERE group_id')) {
    const undoneIds = new Set(state.transactions.map((transaction) => transaction.undone_transaction_id).filter(Boolean));
    const latest = [...state.transactions]
      .filter((transaction) => transaction.group_id === params[0])
      .filter((transaction) => ['calculation', 'adjustment', 'reset'].includes(transaction.transaction_type))
      .filter((transaction) => !undoneIds.has(transaction.id))
      .pop();
    return { rows: latest ? [clone(latest)] : [] };
  }

  throw new Error(`Unhandled SQL in test mock: ${compact}`);
}

async function addTransaction(pool, groupId, messageId, amount) {
  return recordTransaction(pool, {
    whatsappGroupId: groupId,
    whatsappGroupName: groupId,
    senderNumber: '923001234567',
    messageId,
    expression: String(amount),
    transactionType: 'adjustment',
    amount: new Decimal(amount)
  });
}

describe('transactionService', () => {
  test('keeps group totals independent', async () => {
    const pool = createMockPool();
    await addTransaction(pool, 'group-a', 'msg-1', '500');
    await addTransaction(pool, 'group-b', 'msg-2', '5000');
    await addTransaction(pool, 'group-a', 'msg-3', '-400');

    expect((await getGroupSummary(pool, 'group-a')).current_total).toBe('100.00');
    expect((await getGroupSummary(pool, 'group-b')).current_total).toBe('5000.00');
  });

  test('detects duplicate messages', async () => {
    const pool = createMockPool();
    await addTransaction(pool, 'group-a', 'msg-1', '500');

    expect(await isDuplicateMessage(pool, 'msg-1')).toBe(true);
    const duplicate = await addTransaction(pool, 'group-a', 'msg-1', '500');
    expect(duplicate.duplicate).toBe(true);
  });

  test('returns history', async () => {
    const pool = createMockPool();
    await addTransaction(pool, 'group-a', 'msg-1', '500');
    await addTransaction(pool, 'group-a', 'msg-2', '-400');

    const history = await getHistory(pool, 'group-a', 10);
    expect(history).toHaveLength(2);
    expect(history[0].amount).toBe('500.00');
  });

  test('resets balance with audit transaction', async () => {
    const pool = createMockPool();
    await addTransaction(pool, 'group-a', 'msg-1', '500');
    await resetGroup(pool, {
      whatsappGroupId: 'group-a',
      whatsappGroupName: 'group-a',
      senderNumber: '923001234567',
      messageId: 'msg-reset'
    });

    expect((await getGroupSummary(pool, 'group-a')).current_total).toBe('0.00');
    expect(pool.state.transactions.at(-1).transaction_type).toBe('reset');
  });

  test('undo reverses latest valid transaction', async () => {
    const pool = createMockPool();
    await addTransaction(pool, 'group-a', 'msg-1', '500');
    await addTransaction(pool, 'group-a', 'msg-2', '-100');
    const result = await undoLatest(pool, {
      whatsappGroupId: 'group-a',
      whatsappGroupName: 'group-a',
      senderNumber: '923001234567',
      messageId: 'msg-undo'
    });

    expect(result.transaction.transaction_type).toBe('undo');
    expect((await getGroupSummary(pool, 'group-a')).current_total).toBe('500.00');
  });
});
