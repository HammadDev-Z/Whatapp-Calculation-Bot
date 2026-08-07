const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('../config');
const logger = require('../utils/logger');

function createWhatsAppClient() {
  const puppeteerOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  };

  if (config.chromeExecutablePath) {
    puppeteerOptions.executablePath = config.chromeExecutablePath;
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: config.whatsappSessionPath
    }),
    puppeteer: puppeteerOptions
  });

  client.on('qr', (qr) => {
    logger.info('WhatsApp QR code received. Scan it with your phone.');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => logger.info('WhatsApp client is ready'));
  client.on('authenticated', () => logger.info('WhatsApp authenticated'));
  client.on('auth_failure', (message) => logger.error('WhatsApp authentication failed', { message }));
  client.on('disconnected', (reason) => logger.warn('WhatsApp disconnected', { reason }));

  return client;
}

module.exports = createWhatsAppClient;
