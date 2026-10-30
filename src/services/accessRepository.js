// Numbers and group names managed from the website and read by the bot.
class AccessRepository {
  constructor(pool) {
    this.pool = pool;
  }

  // --- numbers -----------------------------------------------------------------------------

  async listNumbers() {
    const result = await this.pool.query(
      'SELECT number, label, active, created_at FROM allowed_numbers ORDER BY created_at DESC, number'
    );
    return result.rows;
  }

  async listActiveNumbers() {
    const result = await this.pool.query('SELECT number FROM allowed_numbers WHERE active = TRUE');
    return result.rows.map((row) => row.number);
  }

  // Adding an existing number re-activates it and updates its label.
  async addNumber(number, label) {
    await this.pool.query(
      `INSERT INTO allowed_numbers(number, label) VALUES($1, $2)
       ON CONFLICT(number) DO UPDATE SET active=TRUE, updated_at=NOW(),
         label=COALESCE(EXCLUDED.label, allowed_numbers.label)`,
      [number, label || null]
    );
  }

  async setNumberActive(number, active) {
    const result = await this.pool.query(
      'UPDATE allowed_numbers SET active=$2, updated_at=NOW() WHERE number=$1',
      [number, Boolean(active)]
    );
    return result.rowCount > 0;
  }

  // --- groups ------------------------------------------------------------------------------

  // Only groups that were added on the website (they have a name); nothing is listed until then.
  async listGroups() {
    const result = await this.pool.query(
      `SELECT g.group_id, g.label, b.group_name AS detected_name, b.current_total
       FROM bot_groups g LEFT JOIN calculation_balances b ON b.group_id = g.group_id
       WHERE g.label IS NOT NULL AND g.label <> ''
       ORDER BY LOWER(g.label), g.group_id`
    );
    return result.rows;
  }

  async listGroupLabels() {
    const result = await this.pool.query(
      "SELECT group_id, label FROM bot_groups WHERE label IS NOT NULL AND label <> ''"
    );
    return result.rows;
  }

  // Adds the group, or renames it when it is already added.
  async setGroupLabel(groupId, label) {
    await this.pool.query(
      `INSERT INTO bot_groups(group_id, label) VALUES($1, $2)
       ON CONFLICT(group_id) DO UPDATE SET label=EXCLUDED.label, updated_at=NOW()`,
      [groupId, label]
    );
  }

  // The group disappears from the website and its receipts go back to the default header.
  async removeGroup(groupId) {
    const result = await this.pool.query('DELETE FROM bot_groups WHERE group_id=$1', [groupId]);
    return result.rowCount > 0;
  }
}

module.exports = AccessRepository;
