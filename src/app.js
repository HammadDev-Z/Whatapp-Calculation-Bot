const config = require('./config');
const pool = require('./database/pool');
const AccessRepository = require('./services/accessRepository');
const AccessSettings = require('./services/accessSettings');
const CalculateAccessRepository = require('./services/calculateAccessRepository');
const CalculationRepository = require('./services/calculationRepository');
const createWhatsAppClient = require('./whatsapp/client');
const { createMessageHandler } = require('./whatsapp/messageHandler');
const logger = require('./utils/logger');

async function main() {
  const client = createWhatsAppClient();
  client.on('message', createMessageHandler({
    calculationRepository: new CalculationRepository(pool),
    calculateAccessRepository: new CalculateAccessRepository(pool),
    accessSettings: new AccessSettings(new AccessRepository(pool), { logger }),
    reportGroupId: config.calculationReportGroupId
  }));
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
