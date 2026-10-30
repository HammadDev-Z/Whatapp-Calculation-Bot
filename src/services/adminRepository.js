const crypto = require('crypto');

const SESSION_DAYS = 7;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Website admin accounts and login sessions. Only a hash of the session token is stored.
class AdminRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async countAdmins() {
    const result = await this.pool.query('SELECT COUNT(*)::int AS count FROM admin_users');
    return result.rows[0].count;
  }

  async createAdmin(username, passwordHash) {
    const result = await this.pool.query(
      'INSERT INTO admin_users(username, password_hash) VALUES($1, $2) RETURNING id, username',
      [username, passwordHash]
    );
    return result.rows[0];
  }

  async findByUsername(username) {
    const result = await this.pool.query(
      'SELECT id, username, password_hash FROM admin_users WHERE LOWER(username)=LOWER($1)',
      [username]
    );
    return result.rows[0] || null;
  }

  async findById(id) {
    const result = await this.pool.query(
      'SELECT id, username, password_hash FROM admin_users WHERE id=$1',
      [id]
    );
    return result.rows[0] || null;
  }

  async updatePassword(id, passwordHash) {
    await this.pool.query(
      'UPDATE admin_users SET password_hash=$2, updated_at=NOW() WHERE id=$1',
      [id, passwordHash]
    );
  }

  // Returns { token, csrfToken, maxAgeMs }; the raw token only ever lives in the browser cookie.
  async createSession(adminId) {
    const token = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const maxAgeMs = SESSION_DAYS * 24 * 60 * 60 * 1000;
    await this.pool.query(
      `INSERT INTO admin_sessions(token_hash, admin_id, csrf_token, expires_at)
       VALUES($1, $2, $3, $4)`,
      [sha256(token), adminId, csrfToken, new Date(Date.now() + maxAgeMs)]
    );
    return { token, csrfToken, maxAgeMs };
  }

  async findSession(token) {
    if (!token) return null;
    const result = await this.pool.query(
      `SELECT s.admin_id, s.csrf_token, a.username
       FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_id
       WHERE s.token_hash=$1 AND s.expires_at > NOW()`,
      [sha256(token)]
    );
    const row = result.rows[0];
    return row ? { adminId: row.admin_id, csrfToken: row.csrf_token, username: row.username } : null;
  }

  async deleteSession(token) {
    if (!token) return;
    await this.pool.query('DELETE FROM admin_sessions WHERE token_hash=$1', [sha256(token)]);
  }

  // Used after a password change: every other login is signed out.
  async deleteOtherSessions(adminId, keepToken) {
    await this.pool.query(
      'DELETE FROM admin_sessions WHERE admin_id=$1 AND token_hash <> $2',
      [adminId, sha256(keepToken || '')]
    );
  }

  async deleteExpiredSessions() {
    await this.pool.query('DELETE FROM admin_sessions WHERE expires_at <= NOW()');
  }
}

module.exports = AdminRepository;
