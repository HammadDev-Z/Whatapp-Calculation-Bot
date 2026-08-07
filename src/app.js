const pool = require('./database/pool');
const createWhatsAppClient = require('./whatsapp/client');
const { createMessageHandler } = require('./whatsapp/messageHandler');
const logger = require('./utils/logger');

async function main() {
  const client = createWhatsAppClient();
  client.on('message', createMessageHandler(pool));
  await client.initialize();
}

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection', { error: error.message });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message });
  process.exit(1);
});

main().catch((error) => {
  logger.error('Application failed to start', { error: error.message });
  process.exit(1);
});
