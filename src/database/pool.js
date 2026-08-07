const { Pool } = require('pg');
const config = require('../config');

if (!config.databaseUrl && process.env.NODE_ENV !== 'test') {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: config.databaseUrl
});

module.exports = pool;
