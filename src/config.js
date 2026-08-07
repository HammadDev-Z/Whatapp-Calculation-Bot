require('dotenv').config();

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const historyDefaultLimit = parsePositiveInt(process.env.HISTORY_DEFAULT_LIMIT, 10);
const historyMaxLimit = parsePositiveInt(process.env.HISTORY_MAX_LIMIT, 50);

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  authorizedNumbers: (process.env.AUTHORIZED_NUMBERS || '')
    .split(',')
    .map((number) => number.replace(/\D/g, ''))
    .filter(Boolean),
  historyDefaultLimit,
  historyMaxLimit: Math.max(historyDefaultLimit, historyMaxLimit),
  whatsappSessionPath: process.env.WHATSAPP_SESSION_PATH || '.whatsapp-session',
  chromeExecutablePath: process.env.CHROME_EXECUTABLE_PATH || '',
  logLevel: process.env.LOG_LEVEL || 'info'
};
