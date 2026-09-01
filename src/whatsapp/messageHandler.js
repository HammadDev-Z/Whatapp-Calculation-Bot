const config = require('../config');
const { isAnyAuthorized, isAuthorized, normalizeNumber } = require('../services/authorizationService');
const { calculate, looksLikeCalculation } = require('../services/calculatorService');
const { setDisplayName } = require('../services/groupService');
const {
  getGroupSummary,
  getHistory,
  isDuplicateMessage,
  recordTransaction,
  resetGroup,
  undoLatest
} = require('../services/transactionService');
const {
  formatCompactMoney,
  formatExpression,
  formatMoney,
  formatPlainNumber,
  formatCalculationExpression
} = require('../utils/formatter');
const logger = require('../utils/logger');

const resetRequests = new Map();

function getMessageId(message) {
  if (typeof message.id === 'string') return message.id;
  return message.id?._serialized || message.id?.id || `${message.from}:${message.timestamp}:${message.body}`;
}

function getRawSenderId(message) {
  return String(message.author || message.from || '');
}

function getSenderNumberFromRaw(message) {
  const raw = getRawSenderId(message);
  return normalizeNumber(String(raw).split('@')[0]);
}

async function getSenderIdentity(message) {
  const rawSenderId = getRawSenderId(message);
  const rawNumber = getSenderNumberFromRaw(message);
  const values = [rawSenderId, rawNumber];

  try {
    const contact = await message.getContact();
    values.push(contact.number, contact.id?._serialized, contact.id?.user);
  } catch {
    logger.warn('Unable to resolve sender contact, using raw sender id', {
      senderId: rawSenderId
    });
  }

  const normalizedValues = [...new Set(values.map(normalizeNumber).filter(Boolean))];
  return {
    rawSenderId,
    number: normalizedValues[0] || rawNumber,
    values: normalizedValues
  };
}

async function getSenderNumber(message) {
  return (await getSenderIdentity(message)).number;
}

function getChatId(chat) {
  if (typeof chat.id === 'string') return chat.id;
  return chat.id?._serialized || chat.id?.user || '';
}

async function getGroupContext(message) {
  if (!String(message.from || '').endsWith('@g.us')) return null;

  const fallback = {
    id: message.from,
    name: message.from,
    isGroup: true
  };

  try {
    const chat = await message.getChat();
    return {
      id: getChatId(chat) || message.from,
      name: chat.name || message.from,
      isGroup: Boolean(chat.isGroup)
    };
  } catch (error) {
    logger.warn('Falling back to message.from for group context', {
      error: error.message || String(error),
      groupId: message.from
    });
    return fallback;
  }
}

function getGroupDisplayName(group) {
  return group.display_name || group.whatsapp_group_name || 'GROUP';
}

function getHeader(group) {
  return `🎉${getGroupDisplayName(group)}🎉`;
}

function invalidCalculationText() {
  return [
    'Invalid calculation.',
    '',
    'Examples:',
    '5*50.32',
    '+500',
    '-400',
    '100/4'
  ].join('\n');
}

function clampHistoryLimit(text) {
  const [, limitText] = text.split(/\s+/);
  const requested = Number.parseInt(limitText, 10);
  if (!Number.isInteger(requested) || requested <= 0) return config.historyDefaultLimit;
  return Math.min(requested, config.historyMaxLimit);
}

function resetKey(groupId, senderNumber) {
  return `${groupId}:${senderNumber}`;
}

async function handleTotal(pool, chat) {
  const summary = await getGroupSummary(pool, getChatId(chat));
  const displayName = getGroupDisplayName(summary || { whatsapp_group_name: chat.name });
  const total = summary ? summary.current_total : 0;
  const count = summary ? summary.transaction_count : 0;
  return [
    getHeader({ display_name: displayName }),
    `Cur Total: ${formatCompactMoney(total)}`,
    `Transactions: ${count}`
  ].join('\n');
}

async function handleHistory(pool, chat, text) {
  const limit = clampHistoryLimit(text);
  const summary = await getGroupSummary(pool, getChatId(chat));
  const history = await getHistory(pool, getChatId(chat), limit);
  const displayName = getGroupDisplayName(summary || { whatsapp_group_name: chat.name });
  const lines = [`${getHeader({ display_name: displayName })} - HISTORY`];

  if (history.length === 0) {
    lines.push('No transactions yet.');
  } else {
    history.forEach((transaction, index) => {
      const sign = Number(transaction.amount) >= 0 ? '+' : '';
      lines.push(`${index + 1}. ${formatExpression(transaction.expression)} = ${sign}${formatCompactMoney(transaction.amount)}`);
    });
  }

  lines.push(`TOTAL:${formatCompactMoney(summary ? summary.current_total : 0)}`);
  return lines.join('\n');
}

async function handleSetName(pool, chat, text) {
  const displayName = text.replace(/^setname\s+/i, '').trim();
  if (!displayName || displayName.length > 80) {
    return 'Please send a valid name, for example: setname AWAN STORE';
  }
  const group = await setDisplayName(pool, getChatId(chat), chat.name, displayName);
  return `${getHeader(group)}\nStore name updated.`;
}

async function handleReset(pool, chat, message, senderNumber, text) {
  const key = resetKey(getChatId(chat), senderNumber);
  if (text === 'reset') {
    resetRequests.set(key, Date.now());
    return "Are you sure you want to reset this group's balance?\n\nSend:\nreset confirm";
  }

  const requestedAt = resetRequests.get(key);
  if (!requestedAt || Date.now() - requestedAt > 5 * 60 * 1000) {
    return 'Reset confirmation expired. Send reset first.';
  }

  resetRequests.delete(key);
  const result = await resetGroup(pool, {
    whatsappGroupId: getChatId(chat),
    whatsappGroupName: chat.name,
    senderNumber,
    messageId: getMessageId(message)
  });
  if (result.duplicate) return null;
  const displayName = getGroupDisplayName(result.group);
  return [getHeader({ display_name: displayName }), 'Balance reset to 0.0', `All Total:${formatCompactMoney(result.group.current_total)}`].join('\n');
}

async function handleUndo(pool, chat, message, senderNumber) {
  const result = await undoLatest(pool, {
    whatsappGroupId: getChatId(chat),
    whatsappGroupName: chat.name,
    senderNumber,
    messageId: getMessageId(message)
  });
  if (result.duplicate) return null;
  if (result.noTransaction) return 'Nothing to undo.';
  return [
    getHeader(result.group),
    `Undo: ${formatExpression(result.target.expression)}`,
    `Cur Total: ${formatCompactMoney(result.transaction.amount)}`,
    `All Total:${formatCompactMoney(result.group.current_total)}`
  ].join('\n');
}

async function handleCalculation(pool, chat, message, senderNumber, text) {
  const calculation = calculate(text);

  const result = await recordTransaction(pool, {
    whatsappGroupId: getChatId(chat),
    whatsappGroupName: chat.name,
    senderNumber,
    messageId: getMessageId(message),
    expression: calculation.expression,
    transactionType: calculation.transactionType,
    amount: calculation.amount
  });

  if (result.duplicate) return null;

  const resultText = formatPlainNumber(calculation.amount);
  const allTotal = formatPlainNumber(result.group.current_total);

  return [
    '💥 CALCULATION',
    '',
    `${formatCalculationExpression(calculation.expression)} = ${resultText}`,
    '',
    `💰 Total: ${resultText}`,
    `📊 Due/Advance: ${allTotal}`
  ].join('\n');
}

function createMessageHandler(pool) {
  return async function onMessage(message) {
    try {
      if (message.fromMe) return;
      const chat = await getGroupContext(message);
      if (!chat?.isGroup) return;

      const senderIdentity = await getSenderIdentity(message);
      if (!isAnyAuthorized(senderIdentity.values)) {
        logger.info('Ignoring unauthorized WhatsApp sender', {
          senderId: senderIdentity.rawSenderId,
          detectedIds: senderIdentity.values,
          groupId: getChatId(chat)
        });
        return;
      }
      const senderNumber = senderIdentity.number;

      const text = String(message.body || '').trim();
      if (!text) return;

      const lowerText = text.toLowerCase();
      const messageId = getMessageId(message);
      if (await isDuplicateMessage(pool, messageId)) return;

      let response = null;
      if (lowerText === 'total') response = await handleTotal(pool, chat);
      else if (lowerText === 'history' || lowerText.startsWith('history ')) response = await handleHistory(pool, chat, lowerText);
      else if (lowerText.startsWith('setname ')) response = await handleSetName(pool, chat, text);
      else if (lowerText === 'reset' || lowerText === 'reset confirm') response = await handleReset(pool, chat, message, senderNumber, lowerText);
      else if (lowerText === 'undo') response = await handleUndo(pool, chat, message, senderNumber);
      else if (looksLikeCalculation(text)) response = await handleCalculation(pool, chat, message, senderNumber, text);
      else return;

      if (response) await message.reply(response);
    } catch (error) {
      logger.error('Failed to process WhatsApp message', {
        error: error.message || String(error),
        stack: error.stack,
        messageId: getMessageId(message),
        from: message.from,
        author: message.author
      });
      try {
        const senderIdentity = await getSenderIdentity(message);
        if (isAuthorized(senderIdentity.number) || isAnyAuthorized(senderIdentity.values)) {
          await message.reply('Something went wrong while processing your request.');
        }
      } catch (replyError) {
        logger.error('Failed to send error reply', { error: replyError.message });
      }
    }
  };
}

module.exports = {
  createMessageHandler,
  getGroupContext,
  getMessageId,
  getSenderIdentity,
  getSenderNumber,
  getSenderNumberFromRaw
};
