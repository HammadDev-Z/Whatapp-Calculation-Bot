const fs = require('fs');
const path = require('path');
const pool = require('./pool');
const logger = require('../utils/logger');

async function runMigrations() {
  const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  logger.info('Database schema migrated successfully');
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch(async (error) => {
      logger.error('Migration failed', { error: error.message });
      await pool.end();
      process.exit(1);
    });
}

module.exports = runMigrations;
