// Numbers, groups and ignored senders managed from the website and read by the bot.
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
    await this.pool.query('DELETE FROM ignored_senders WHERE number=$1', [number]);
  }

  async setNumberActive(number, active) {
    const result = await this.pool.query(
      'UPDATE allowed_numbers SET active=$2, updated_at=NOW() WHERE number=$1',
      [number, Boolean(active)]
    );
    return result.rowCount > 0;
  }

  // --- groups ------------------------------------------------------------------------------

  async listGroups() {
    const result = await this.pool.query(
      `SELECT ids.group_id, COALESCE(g.detected_name, b.group_name) AS detected_name,
              g.label, b.current_total
       FROM (SELECT group_id FROM bot_groups UNION SELECT group_id FROM calculation_balances) ids
       LEFT JOIN bot_groups g ON g.group_id = ids.group_id
       LEFT JOIN calculation_balances b ON b.group_id = ids.group_id
       ORDER BY COALESCE(g.label, g.detected_name, b.group_name, ids.group_id)`
    );
    return result.rows;
  }

  async listGroupLabels() {
    const result = await this.pool.query(
      "SELECT group_id, label FROM bot_groups WHERE label IS NOT NULL AND label <> ''"
    );
    return result.rows;
  }

  // A null detected name never overwrites a stored one.
  async upsertGroup(groupId, detectedName) {
    await this.pool.query(
      `INSERT INTO bot_groups(group_id, detected_name) VALUES($1, $2)
       ON CONFLICT(group_id) DO UPDATE SET updated_at=NOW(),
         detected_name=COALESCE(EXCLUDED.detected_name, bot_groups.detected_name)`,
      [groupId, detectedName || null]
    );
  }

  // Also adds the group when it is not known yet. An empty label clears it (the default
  // header is used again).
  async setGroupLabel(groupId, label) {
    await this.pool.query(
      `INSERT INTO bot_groups(group_id, label) VALUES($1, $2)
       ON CONFLICT(group_id) DO UPDATE SET label=EXCLUDED.label, updated_at=NOW()`,
      [groupId, label || null]
    );
  }

  // --- ignored senders ---------------------------------------------------------------------

  async recordIgnoredSender({ senderId, number, pushName, groupId }) {
    await this.pool.query(
      `INSERT INTO ignored_senders(sender_id, number, push_name, last_group_id) VALUES($1, $2, $3, $4)
       ON CONFLICT(sender_id) DO UPDATE SET last_seen_at=NOW(),
         message_count=ignored_senders.message_count + 1,
         number=EXCLUDED.number,
         push_name=COALESCE(EXCLUDED.push_name, ignored_senders.push_name),
         last_group_id=EXCLUDED.last_group_id`,
      [senderId, number, pushName || null, groupId || null]
    );
  }

  // Senders that are still not on the active list, newest first.
  async listIgnoredSenders(limit = 50) {
    const result = await this.pool.query(
      `SELECT s.sender_id, s.number, s.push_name, s.message_count, s.last_seen_at,
              COALESCE(g.label, g.detected_name, s.last_group_id) AS group_name
       FROM ignored_senders s LEFT JOIN bot_groups g ON g.group_id = s.last_group_id
       WHERE s.number NOT IN (SELECT number FROM allowed_numbers WHERE active = TRUE)
       ORDER BY s.last_seen_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
}

module.exports = AccessRepository;
