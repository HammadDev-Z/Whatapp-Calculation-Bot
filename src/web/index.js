const config = require('../config');
const pool = require('../database/pool');
const AccessRepository = require('../services/accessRepository');
const AdminRepository = require('../services/adminRepository');
const logger = require('../utils/logger');
const { hashPassword } = require('../utils/password');
const { createWebApp, MIN_PASSWORD_LENGTH } = require('./app');

// The first admin comes from ADMIN_USERNAME / ADMIN_PASSWORD. After that the password is changed
// on the website and these variables are ignored.
async function ensureAdmin(adminRepository) {
  if (await adminRepository.countAdmins() > 0) return;

  const { adminUsername, adminPassword } = config;
  if (!adminUsername || adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `No admin exists yet. Set ADMIN_USERNAME and ADMIN_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters) and start again.`
    );
  }
  await adminRepository.createAdmin(adminUsername, hashPassword(adminPassword));
  logger.info('Created the first admin account', { username: adminUsername });
}

async function main() {
  const adminRepository = new AdminRepository(pool);
  await ensureAdmin(adminRepository);

  const app = createWebApp({
    adminRepository,
    accessRepository: new AccessRepository(pool),
    logger
  });
  app.listen(config.webPort, () => logger.info('Website listening', { port: config.webPort }));

  setInterval(() => {
    adminRepository.deleteExpiredSessions().catch((error) => {
      logger.warn('Could not delete expired sessions', { error: error.message });
    });
  }, 60 * 60 * 1000).unref();
}

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection', { error: error.message });
});

main().catch((error) => {
  logger.error('Website failed to start', { error: error.message });
  process.exit(1);
});
