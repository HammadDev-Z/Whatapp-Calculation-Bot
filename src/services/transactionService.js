const Decimal = require('decimal.js');
const { getOrCreateGroup, lockGroup } = require('./groupService');

async function isDuplicateMessage(pool, messageId) {
  const result = await pool.query('SELECT 1 FROM transactions WHERE message_id = $1 LIMIT 1', [messageId]);
  return Boolean(result.rows[0]);
}

async function recordTransaction(pool, details) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const group = await getOrCreateGroup(client, details.whatsappGroupId, details.whatsappGroupName);
    const lockedGroup = await lockGroup(client, group.id);
    const duplicate = await client.query('SELECT 1 FROM transactions WHERE message_id = $1 LIMIT 1', [details.messageId]);
    if (duplicate.rows[0]) {
      await client.query('ROLLBACK');
      return { duplicate: true };
    }

    const balanceBefore = new Decimal(lockedGroup.current_total);
    const amount = new Decimal(details.amount);
    const balanceAfter = balanceBefore.plus(amount);

    const transaction = await client.query(
      `INSERT INTO transactions
       (group_id, sender_number, message_id, expression, transaction_type, amount, balance_before, balance_after, undone_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        lockedGroup.id,
        details.senderNumber,
        details.messageId,
        details.expression,
        details.transactionType,
        amount.toFixed(2),
        balanceBefore.toFixed(2),
        balanceAfter.toFixed(2),
        details.undoneTransactionId || null
      ]
    );

    const updatedGroup = await client.query(
      'UPDATE groups SET current_total = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [balanceAfter.toFixed(2), lockedGroup.id]
    );

    await client.query('COMMIT');
    return {
      duplicate: false,
      group: updatedGroup.rows[0],
      transaction: transaction.rows[0],
      balanceBefore,
      balanceAfter
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return { duplicate: true };
    throw error;
  } finally {
    client.release();
  }
}

async function getGroupSummary(pool, whatsappGroupId) {
  const result = await pool.query(
    `SELECT g.*, COUNT(t.id)::int AS transaction_count
     FROM groups g
     LEFT JOIN transactions t ON t.group_id = g.id
     WHERE g.whatsapp_group_id = $1
     GROUP BY g.id`,
    [whatsappGroupId]
  );
  return result.rows[0] || null;
}

async function getHistory(pool, whatsappGroupId, limit) {
  const result = await pool.query(
    `SELECT t.*
     FROM transactions t
     JOIN groups g ON g.id = t.group_id
     WHERE g.whatsapp_group_id = $1
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $2`,
    [whatsappGroupId, limit]
  );
  return result.rows.reverse();
}

async function resetGroup(pool, details) {
  const summary = await getGroupSummary(pool, details.whatsappGroupId);
  const currentTotal = summary ? new Decimal(summary.current_total) : new Decimal(0);
  return recordTransaction(pool, {
    ...details,
    expression: 'reset confirm',
    transactionType: 'reset',
    amount: currentTotal.negated()
  });
}

async function undoLatest(pool, details) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const group = await getOrCreateGroup(client, details.whatsappGroupId, details.whatsappGroupName);
    const lockedGroup = await lockGroup(client, group.id);
    const duplicate = await client.query('SELECT 1 FROM transactions WHERE message_id = $1 LIMIT 1', [details.messageId]);
    if (duplicate.rows[0]) {
      await client.query('ROLLBACK');
      return { duplicate: true };
    }

    const latest = await client.query(
      `SELECT *
       FROM transactions
       WHERE group_id = $1 AND transaction_type IN ('calculation', 'adjustment', 'reset')
       AND id NOT IN (SELECT undone_transaction_id FROM transactions WHERE undone_transaction_id IS NOT NULL)
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [lockedGroup.id]
    );

    if (!latest.rows[0]) {
      await client.query('ROLLBACK');
      return { noTransaction: true };
    }

    const target = latest.rows[0];
    const balanceBefore = new Decimal(lockedGroup.current_total);
    const amount = new Decimal(target.amount).negated();
    const balanceAfter = balanceBefore.plus(amount);

    const transaction = await client.query(
      `INSERT INTO transactions
       (group_id, sender_number, message_id, expression, transaction_type, amount, balance_before, balance_after, undone_transaction_id)
       VALUES ($1, $2, $3, $4, 'undo', $5, $6, $7, $8)
       RETURNING *`,
      [
        lockedGroup.id,
        details.senderNumber,
        details.messageId,
        `undo ${target.id}`,
        amount.toFixed(2),
        balanceBefore.toFixed(2),
        balanceAfter.toFixed(2),
        target.id
      ]
    );

    const updatedGroup = await client.query(
      'UPDATE groups SET current_total = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [balanceAfter.toFixed(2), lockedGroup.id]
    );

    await client.query('COMMIT');
    return { group: updatedGroup.rows[0], transaction: transaction.rows[0], target };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return { duplicate: true };
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  isDuplicateMessage,
  recordTransaction,
  getGroupSummary,
  getHistory,
  resetGroup,
  undoLatest
};
