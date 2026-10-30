const Decimal = require('decimal.js');
const { parseCalculation } = require('../services/calculatorService');
const { formatAmount } = require('../utils/formatter');
const { normalizeNumber } = require('../utils/phone');
const defaultLogger = require('../utils/logger');

const DEFAULT_REPLY_HEADER = 'MUSHFIK STORE';
const HEADER_PREFIX = 'MUSHFIK X ';
const REPLY_SUBHEADER = '🤖 Start To Work';
const ALL_CLEAR_LINE = '✅ Thanks! All clear.';
const NO_BALANCES_TEXT = '📊 No group calculations have been recorded yet.';

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

const digitsOf = (value) => normalizeNumber(String(value || '').split('@')[0]);

// Every id the sender is known by, as digits: the raw author id (a phone number, or an @lid id on
// newer WhatsApp builds) plus whatever the contact lookup resolves. Best-effort; never throws.
async function resolveSender(message) {
  const senderId = String(message.author || message.from || '');
  const identifiers = new Set([digitsOf(senderId)]);
  const pushName = message._data?.notifyName || null;
  let resolved = false;

  try {
    const contact = await message.getContact();
    [contact.number, contact.id?.user, contact.id?._serialized].forEach((value) => identifiers.add(digitsOf(value)));
    resolved = true;
  } catch {
    // fall through to the lid lookup / raw id
  }
  try {
    if (message.client && typeof message.client.getContactLidAndPhone === 'function') {
      const [match] = await message.client.getContactLidAndPhone([senderId]);
      if (match) [match.pn, match.lid].forEach((value) => identifiers.add(digitsOf(value)));
    }
  } catch {
    // older WhatsApp Web builds do not expose it
  }

  identifiers.delete('');
  return { senderId, identifiers: [...identifiers], pushName, resolved };
}

// Only consulted when the body is not a calculation.
function parseCommand(body) {
  if (typeof body !== 'string') return null;
  if (CALCULATE_COMMAND_PATTERN.test(body.trim())) return { name: 'calculate' };
  return null;
}

// "Cur Total" is this message's amount; "All Total" is the group's new running balance.
function buildCalculationReply(calculation, currentTotal, groupLabel = null) {
  const expressionLine = calculation.type === 'adjustment'
    ? formatAmount(calculation.amount)
    : `① ${calculation.expression}=${formatAmount(calculation.amount)}`;

  const lines = [
    groupLabel ? `${HEADER_PREFIX}${groupLabel.toUpperCase()}` : DEFAULT_REPLY_HEADER,
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
  accessSettings,
  reportGroupId = '',
  logger = defaultLogger
}) {
  const inFlight = new Set();
  const warnedGroups = new Set();
  // Successful lookups only, so a failed getChat() is retried on the next message.
  const groupNames = new Map();
  // Successful sender lookups only, so a failed getContact() is retried on the next message.
  const senders = new Map();

  async function getGroupName(message, groupId) {
    let groupName = groupNames.get(groupId) || null;
    if (!groupName) {
      groupName = await resolveGroupName(message);
      if (groupName) groupNames.set(groupId, groupName);
    }
    if (!groupName && !warnedGroups.has(groupId)) {
      warnedGroups.add(groupId);
      logger.warn('Could not auto-detect group name; /calculate will show the group id', { groupId });
    }
    return groupName;
  }

  async function getSender(message) {
    const cacheKey = String(message.author || message.from || '');
    const cached = senders.get(cacheKey);
    if (cached) return cached;
    const sender = await resolveSender(message);
    if (sender.resolved) senders.set(cacheKey, sender);
    return sender;
  }

  // Only numbers that are added and active on the website get a response. Everyone else is
  // ignored silently, but remembered so the website can offer to add them.
  async function isSenderAllowed(message, groupId) {
    const sender = await getSender(message);
    if (await accessSettings.isSenderAllowed(sender.identifiers)) return true;

    try {
      await accessSettings.noteIgnoredSender({ ...sender, groupId });
      await accessSettings.noteGroup(groupId, await getGroupName(message, groupId));
    } catch (error) {
      logger.warn('Could not record ignored sender', { groupId, error: error.message || String(error) });
    }
    return false;
  }

  async function handleCalculation(message, groupId, messageId, calculation) {
    if (!messageId || inFlight.has(messageId)) return;
    inFlight.add(messageId);
    try {
      if (!await isSenderAllowed(message, groupId)) return;

      // Stored raw (may be an @lid id) — attribution only.
      const sender = message.author || message.from;
      const groupName = await getGroupName(message, groupId);

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

      const groupLabel = await accessSettings.getGroupLabel(groupId);
      await message.reply(buildCalculationReply(calculation, result.currentTotal, groupLabel));
    } finally {
      inFlight.delete(messageId);
    }
  }

  async function handleCalculate(message, groupId) {
    if (!await isSenderAllowed(message, groupId)) return;

    const allowed = (reportGroupId && groupId === reportGroupId)
      || await calculateAccessRepository.isAllowed(groupId);
    if (!allowed) return;

    const balances = await calculationRepository.listBalances();
    await message.reply(buildCalculateReport(balances));
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
  resolveSender,
  serializeMessageId
};
