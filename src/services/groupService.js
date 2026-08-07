async function getOrCreateGroup(client, whatsappGroupId, whatsappGroupName) {
  const existing = await client.query(
    'SELECT * FROM groups WHERE whatsapp_group_id = $1',
    [whatsappGroupId]
  );

  if (existing.rows[0]) {
    await client.query(
      'UPDATE groups SET whatsapp_group_name = $1, updated_at = NOW() WHERE whatsapp_group_id = $2',
      [whatsappGroupName, whatsappGroupId]
    );
    return existing.rows[0];
  }

  const created = await client.query(
    `INSERT INTO groups (whatsapp_group_id, whatsapp_group_name, display_name)
     VALUES ($1, $2, $2)
     RETURNING *`,
    [whatsappGroupId, whatsappGroupName]
  );
  return created.rows[0];
}

async function lockGroup(client, groupId) {
  const result = await client.query('SELECT * FROM groups WHERE id = $1 FOR UPDATE', [groupId]);
  return result.rows[0];
}

async function setDisplayName(pool, whatsappGroupId, whatsappGroupName, displayName) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const group = await getOrCreateGroup(client, whatsappGroupId, whatsappGroupName);
    const updated = await client.query(
      'UPDATE groups SET display_name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [displayName, group.id]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getOrCreateGroup,
  lockGroup,
  setDisplayName
};
