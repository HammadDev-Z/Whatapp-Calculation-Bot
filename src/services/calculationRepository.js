class CalculationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  // Adds `amount` to the group's running balance and appends a ledger row, in one
  // transaction. The balance upsert locks the group's row, so concurrent messages
  // for the same group serialize. Returns { duplicate: true } for a replayed message.
  async record({ groupId, messageId, sender, expression, amount, type, groupName }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT 1 FROM calculation_transactions WHERE message_id=$1',
        [messageId]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return { duplicate: true };
      }

      // A null auto-detected name never overwrites a name that is already stored.
      const before = await client.query(
        `INSERT INTO calculation_balances(group_id, current_total, group_name) VALUES($1, 0, $2)
         ON CONFLICT(group_id) DO UPDATE SET updated_at=NOW(),
           group_name=COALESCE(EXCLUDED.group_name, calculation_balances.group_name)
         RETURNING current_total`,
        [groupId, groupName || null]
      );

      const after = await client.query(
        `UPDATE calculation_balances SET current_total=current_total+$2::numeric, updated_at=NOW()
         WHERE group_id=$1 RETURNING current_total`,
        [groupId, amount]
      );

      await client.query(
        `INSERT INTO calculation_transactions
           (group_id, message_id, sender, expression, calculation_type, amount, balance_before, balance_after)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          groupId,
          messageId,
          sender,
          expression,
          type,
          amount,
          before.rows[0].current_total,
          after.rows[0].current_total
        ]
      );

      await client.query('COMMIT');
      return { duplicate: false, currentTotal: after.rows[0].current_total };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Balances shown by /calculate. `active` defaults to TRUE; flip it in SQL to hide a group.
  async listBalances() {
    const result = await this.pool.query(
      `SELECT group_id, current_total, group_name
       FROM calculation_balances
       WHERE active = TRUE
       ORDER BY COALESCE(group_name, group_id)`
    );
    return result.rows;
  }
}

module.exports = CalculationRepository;
