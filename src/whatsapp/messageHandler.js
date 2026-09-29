const Decimal = require('decimal.js');
const { parseCalculation } = require('../services/calculatorService');
const { formatAmount } = require('../utils/formatter');
const { randomDelayMs, sleep: defaultSleep } = require('../utils/delay');
const defaultLogger = require('../utils/logger');

const REPLY_HEADER = 'MUSHFIK STORE';
const REPLY_SUBHEADER = '🤖 Start To Work';
const ALL_CLEAR_LINE = '✅ Thanks! All clear.';
const NO_BALANCES_TEXT = '📊 No group calculations have been recorded yet.';

const REPLY_DELAY_MIN_SECONDS = 3;
const REPLY_DELAY_MAX_SECONDS = 6;

const CALCULATE_COMMAND_PATTERN = /^\/calculate\s*$/i;

function wid(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value._serialized === 'string') return value._serialized;
  if (value.user && value.server) return `${value.user}@${value.server}`;
  return '';
}

function serializeMessageId(id) {
  if (!id) return '';
  if (typeof id === 'string') return id;
  if (typeof id._serialized === 'string' && id._serialized) return id._serialized;
  if (typeof id.id === 'string' && id.id) {
    return [id.fromMe ? '1' : '0', wid(id.remote), id.id, wid(id.participant)].join('_');
  }
  return '';
}

// Best-effort; never throws. getChat() is known to throw on some WhatsApp Web builds.
async function resolveGroupName(message) {
  if (typeof message.getChat !== 'function') return null;
  try {
    const chat = await message.getChat();
    const candidate = chat.name || chat.formattedTitle || chat.subject || chat.groupMetadata?.subject;
    if (typeof candidate !== 'string') return null;
    return candidate.trim() || null;
  } catch {
    return null;
  }
}

// Only consulted when the body is not a calculation.
function parseCommand(body) {
  if (typeof body !== 'string') return null;
  if (CALCULATE_COMMAND_PATTERN.test(body.trim())) return { name: 'calculate' };
  return null;
}

// "Cur Total" is this message's amount; "All Total" is the group's new running balance.
function buildCalculationReply(calculation, currentTotal) {
  const expressionLine = calculation.type === 'adjustment'
    ? formatAmount(calculation.amount)
    : `① ${calculation.expression}=${formatAmount(calculation.amount)}`;

  const lines = [
    REPLY_HEADER,
    '',
    REPLY_SUBHEADER,
    expressionLine,
    `Cur Total: ${formatAmount(calculation.amount)}`,
    '',
    `All Total:${formatAmount(currentTotal)}`
  ];
  if (new Decimal(currentTotal).isZero()) lines.push('', ALL_CLEAR_LINE);
  return lines.join('\n');
}

function buildCalculateReport(balances) {
  if (balances.length === 0) return NO_BALANCES_TEXT;

  const grandTotal = balances.reduce((sum, row) => sum.plus(row.current_total), new Decimal(0));
  return [
    '📊 GROUP CALCULATION STATUS',
    '',
    ...balances.map((row) => `${row.group_name || row.group_id}: ${formatAmount(row.current_total)}`),
    '',
    `Grand Total: ${formatAmount(grandTotal)}`
  ].join('\n');
}

function createMessageHandler({
  calculationRepository,
  calculateAccessRepository,
  reportGroupId = '',
  logger = defaultLogger,
  sleep = defaultSleep,
  random = Math.random
}) {
  const inFlight = new Set();
  const warnedGroups = new Set();

  async function replyAfterDelay(message, text) {
    await sleep(randomDelayMs(REPLY_DELAY_MIN_SECONDS, REPLY_DELAY_MAX_SECONDS, random));
    await message.reply(text);
  }

  async function handleCalculation(message, groupId, messageId, calculation) {
    if (!messageId || inFlight.has(messageId)) return;
    inFlight.add(messageId);
    try {
      // Stored raw (may be an @lid id) — attribution only, never used for access.
      const sender = message.author || message.from;

      const groupName = await resolveGroupName(message);
      if (!groupName && !warnedGroups.has(groupId)) {
        warnedGroups.add(groupId);
        logger.warn('Could not auto-detect group name; /calculate will show the group id', { groupId });
      }

      const result = await calculationRepository.record({
        groupId,
        messageId,
        sender,
        expression: calculation.expression,
        amount: calculation.amount,
        type: calculation.type,
        groupName
      });
      if (result.duplicate) return;

      await replyAfterDelay(message, buildCalculationReply(calculation, result.currentTotal));
    } finally {
      inFlight.delete(messageId);
    }
  }

  async function handleCalculate(message, groupId) {
    const allowed = (reportGroupId && groupId === reportGroupId)
      || await calculateAccessRepository.isAllowed(groupId);
    if (!allowed) return;

    const balances = await calculationRepository.listBalances();
    await replyAfterDelay(message, buildCalculateReport(balances));
  }

  return async function onMessage(message) {
    if (!message || message.fromMe) return;
    const groupId = String(message.from || '');
    if (!groupId.endsWith('@g.us')) return;

    const messageId = serializeMessageId(message.id);
    try {
      // Calculations win: command parsing is skipped entirely for them.
      const calculation = parseCalculation(message.body);
      if (calculation) {
        await handleCalculation(message, groupId, messageId, calculation);
        return;
      }

      const command = parseCommand(message.body);
      if (!command) return;
      logger.info('WhatsApp command received', { command: command.name, groupId, messageId });
      if (command.name === 'calculate') await handleCalculate(message, groupId);
    } catch (error) {
      // Deliberately silent in the group: failures are only logged.
      logger.error('Message processing failed', {
        groupId,
        messageId,
        error: error.message || String(error),
        stack: error.stack
      });
    }
  };
}

module.exports = {
  createMessageHandler,
  parseCommand,
  resolveGroupName,
  serializeMessageId
};
