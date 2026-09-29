require('dotenv').config();

// Group allowed to run /calculate without a calculate_access_groups row. Empty = none.
const calculationReportGroupId = String(process.env.CALCULATION_REPORT_GROUP_ID || '').trim();
if (calculationReportGroupId && !calculationReportGroupId.endsWith('@g.us')) {
  throw new Error('CALCULATION_REPORT_GROUP_ID must be a group id ending in @g.us');
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  calculationReportGroupId,
  whatsappSessionPath: process.env.WHATSAPP_SESSION_PATH || '.whatsapp-session',
  chromeExecutablePath: process.env.CHROME_EXECUTABLE_PATH || '',
  logLevel: process.env.LOG_LEVEL || 'info'
};
