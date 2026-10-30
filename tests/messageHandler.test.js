const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createMessageHandler,
  parseCommand,
  resolveGroupName,
  resolveSender,
  serializeMessageId
} = require('../src/whatsapp/messageHandler');

const REPORT_GROUP = 'report@g.us';

function createMessage(overrides = {}) {
  const replies = [];
  const message = {
    from: 'g@g.us',
    author: '256577252638929@lid',
    fromMe: false,
    body: '10+20',
    id: { _serialized: 'msg-1' },
    getChat: async () => ({ name: 'Karachi Buyers' }),
    reply: async (text) => { replies.push(text); },
    ...overrides
  };
  return { message, replies };
}

// Stand-in for AccessSettings: `senderAllowed` may be a boolean or a function of the identifiers.
function createAccessSettings({ senderAllowed = true, labels = {} } = {}) {
  const calls = { checked: [], ignored: [], groups: [] };
  return {
    calls,
    async isSenderAllowed(identifiers) {
      calls.checked.push(identifiers);
      return typeof senderAllowed === 'function' ? senderAllowed(identifiers) : senderAllowed;
    },
    async getGroupLabel(groupId) {
      return labels[groupId] || null;
    },
    async noteIgnoredSender(details) {
      calls.ignored.push(details);
    },
    async noteGroup(groupId, name) {
      calls.groups.push([groupId, name]);
    }
  };
}

function createHandler({ record, balances = [], allowed = false, senderAllowed = true, labels } = {}) {
  const calls = { record: [], logs: [] };
  const access = createAccessSettings({ senderAllowed, labels });
  calls.access = access.calls;
  const handler = createMessageHandler({
    calculationRepository: {
      async record(args) {
        calls.record.push(args);
        return record ? record(args) : { duplicate: false, currentTotal: '30.00' };
      },
      async listBalances() {
        return balances;
      }
    },
    calculateAccessRepository: {
      async isAllowed() {
        return allowed;
      }
    },
    accessSettings: access,
    reportGroupId: REPORT_GROUP,
    logger: {
      info: (...args) => calls.logs.push(['info', ...args]),
      warn: (...args) => calls.logs.push(['warn', ...args]),
      error: (...args) => calls.logs.push(['error', ...args])
    }
  });
  return { handler, calls };
}

test('records an expression with the auto-detected group name and replies with the receipt', async () => {
  const { handler, calls } = createHandler();
  const { message, replies } = createMessage();

  await handler(message);

  assert.deepEqual(calls.record, [{
    groupId: 'g@g.us',
    messageId: 'msg-1',
    sender: '256577252638929@lid',
    expression: '10+20',
    amount: '30.00',
    type: 'expression',
    groupName: 'Karachi Buyers'
  }]);
  assert.deepEqual(replies, [
    'MUSHFIK STORE\n\n🤖 Start To Work\n① 10+20=30.0\nCur Total: 30.0\n\nAll Total:30.0'
  ]);
});

test('an adjustment that clears the balance shows only the amount and the all-clear line', async () => {
  const { handler } = createHandler({ record: () => ({ duplicate: false, currentTotal: '0.00' }) });
  const { message, replies } = createMessage({ body: '-30' });

  await handler(message);

  assert.deepEqual(replies, [
    'MUSHFIK STORE\n\n🤖 Start To Work\n-30.0\nCur Total: -30.0\n\nAll Total:0.0\n\n✅ Thanks! All clear.'
  ]);
});

test('keeps whitespace typed inside the expression in the reply', async () => {
  const { handler } = createHandler({ record: () => ({ duplicate: false, currentTotal: '100.00' }) });
  const { message, replies } = createMessage({ body: '  10 + 20  ' });

  await handler(message);

  assert.equal(replies[0].split('\n')[3], '① 10 + 20=30.0');
});

test('falls back to message.from as sender when there is no author', async () => {
  const { handler, calls } = createHandler();
  const { message } = createMessage({ author: undefined });

  await handler(message);

  assert.equal(calls.record[0].sender, 'g@g.us');
});

test('still records with a null group name when getChat() throws, and warns once per group', async () => {
  const { handler, calls } = createHandler();
  const getChat = async () => { throw new Error('r'); };

  await handler(createMessage({ getChat, id: { _serialized: 'a' } }).message);
  await handler(createMessage({ getChat, id: { _serialized: 'b' } }).message);

  assert.equal(calls.record.length, 2);
  assert.equal(calls.record[0].groupName, null);
  assert.equal(calls.logs.filter(([level]) => level === 'warn').length, 1);
});

test('looks up the group name once per group and reuses it', async () => {
  const { handler, calls } = createHandler();
  let lookups = 0;
  const getChat = async () => { lookups += 1; return { name: 'Karachi Buyers' }; };

  await handler(createMessage({ getChat, id: { _serialized: 'a' } }).message);
  await handler(createMessage({ getChat, id: { _serialized: 'b' } }).message);

  assert.equal(lookups, 1);
  assert.equal(calls.record[1].groupName, 'Karachi Buyers');
});

test('retries the group name lookup after a failure', async () => {
  const { handler, calls } = createHandler();
  let lookups = 0;
  const getChat = async () => {
    lookups += 1;
    if (lookups === 1) throw new Error('r');
    return { name: 'Karachi Buyers' };
  };

  await handler(createMessage({ getChat, id: { _serialized: 'a' } }).message);
  await handler(createMessage({ getChat, id: { _serialized: 'b' } }).message);

  assert.equal(calls.record[0].groupName, null);
  assert.equal(calls.record[1].groupName, 'Karachi Buyers');
});

test('a duplicate message gets no reply', async () => {
  const { handler, calls } = createHandler({ record: () => ({ duplicate: true }) });
  const { message, replies } = createMessage();

  await handler(message);

  assert.deepEqual(replies, []);
});

test('ignores the same message id while it is still being processed', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { handler, calls } = createHandler({
    record: async () => {
      await gate;
      return { duplicate: false, currentTotal: '30.00' };
    }
  });

  const first = handler(createMessage().message);
  await handler(createMessage().message);
  release();
  await first;

  assert.equal(calls.record.length, 1);
});

test('ignores direct chats, own messages and missing messages', async () => {
  const { handler, calls } = createHandler();
  const direct = createMessage({ from: '923001234567@c.us' });
  const own = createMessage({ fromMe: true });

  await handler(direct.message);
  await handler(own.message);
  await handler(undefined);

  assert.equal(calls.record.length, 0);
  assert.deepEqual([...direct.replies, ...own.replies], []);
});

test('ignores mixed chat and messages without a usable id', async () => {
  const { handler, calls } = createHandler();

  await handler(createMessage({ body: 'Bas 628 done kr do' }).message);
  await handler(createMessage({ id: undefined }).message);

  assert.equal(calls.record.length, 0);
});

test('a failing record is logged and the group gets no reply', async () => {
  const { handler, calls } = createHandler({ record: () => { throw new Error('numeric field overflow'); } });
  const { message, replies } = createMessage();

  await handler(message);

  assert.deepEqual(replies, []);
  const errors = calls.logs.filter(([level]) => level === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1], 'Message processing failed');
  assert.equal(errors[0][2].groupId, 'g@g.us');
  assert.equal(errors[0][2].messageId, 'msg-1');
});

test('/calculate from the report group lists balances and a grand total', async () => {
  const { handler, calls } = createHandler({
    balances: [
      { group_id: 'khan@g.us', group_name: 'khan group', current_total: '500.00' },
      { group_id: 'jerry@g.us', group_name: 'jerry group', current_total: '-900.00' }
    ]
  });
  const { message, replies } = createMessage({ from: REPORT_GROUP, body: '/calculate' });

  await handler(message);

  assert.deepEqual(replies, [
    '📊 GROUP CALCULATION STATUS\n\nkhan group: 500.0\njerry group: -900.0\n\nGrand Total: -400.0'
  ]);
});

test('/calculate labels unnamed groups by id', async () => {
  const { handler } = createHandler({
    balances: [{ group_id: 'unknown@g.us', group_name: null, current_total: '12.50' }]
  });
  const { message, replies } = createMessage({ from: REPORT_GROUP, body: '/calculate' });

  await handler(message);

  assert.match(replies[0], /unknown@g\.us: 12\.50/);
  assert.match(replies[0], /Grand Total: 12\.50/);
});

test('/calculate with no balances says nothing has been recorded', async () => {
  const { handler } = createHandler();
  const { message, replies } = createMessage({ from: REPORT_GROUP, body: '/calculate' });

  await handler(message);

  assert.deepEqual(replies, ['📊 No group calculations have been recorded yet.']);
});

test('/calculate is silent in a group without access', async () => {
  const { handler, calls } = createHandler();
  const { message, replies } = createMessage({ body: '/calculate' });

  await handler(message);

  assert.deepEqual(replies, []);
});

test('/calculate works in a group on the access list', async () => {
  const { handler } = createHandler({ allowed: true });
  const { message, replies } = createMessage({ body: '/CALCULATE' });

  await handler(message);

  assert.equal(replies.length, 1);
});

test('parseCommand recognises only /calculate', () => {
  assert.deepEqual(parseCommand('/calculate'), { name: 'calculate' });
  assert.deepEqual(parseCommand('  /CALCULATE  '), { name: 'calculate' });
  assert.equal(parseCommand('/calculate now'), null);
  assert.equal(parseCommand('/setname Khan Group'), null);
  assert.equal(parseCommand(undefined), null);
});

test('serializeMessageId handles strings, _serialized and raw id parts', () => {
  assert.equal(serializeMessageId(undefined), '');
  assert.equal(serializeMessageId('abc'), 'abc');
  assert.equal(serializeMessageId({ _serialized: 'true_g@g.us_X' }), 'true_g@g.us_X');
  assert.equal(
    serializeMessageId({
      fromMe: false,
      remote: { user: '120363', server: 'g.us' },
      id: 'ABC',
      participant: { _serialized: '256577252638929@lid' }
    }),
    '0_120363@g.us_ABC_256577252638929@lid'
  );
  assert.equal(serializeMessageId({ fromMe: true, remote: 'g@g.us', id: 'ABC' }), '1_g@g.us_ABC_');
  assert.equal(serializeMessageId({ id: '' }), '');
});

test('resolveGroupName picks the first available name and never throws', async () => {
  assert.equal(await resolveGroupName({}), null);
  assert.equal(await resolveGroupName({ getChat: async () => ({ name: '  Karachi  ' }) }), 'Karachi');
  assert.equal(await resolveGroupName({ getChat: async () => ({ formattedTitle: 'Title' }) }), 'Title');
  assert.equal(await resolveGroupName({ getChat: async () => ({ groupMetadata: { subject: 'Subj' } }) }), 'Subj');
  assert.equal(await resolveGroupName({ getChat: async () => ({ name: '   ' }) }), null);
  assert.equal(await resolveGroupName({ getChat: async () => { throw new Error('r'); } }), null);
});

test('ignores a sender who is not allowed: no record, no reply, remembered for the website', async () => {
  const { handler, calls } = createHandler({ senderAllowed: false });
  const { message, replies } = createMessage();

  await handler(message);

  assert.deepEqual(replies, []);
  assert.deepEqual(calls.record, []);
  assert.deepEqual(calls.access.ignored, [{
    senderId: '256577252638929@lid',
    identifiers: ['256577252638929'],
    pushName: null,
    resolved: false,
    groupId: 'g@g.us'
  }]);
  assert.deepEqual(calls.access.groups, [['g@g.us', 'Karachi Buyers']]);
});

test('/calculate is also ignored for a sender who is not allowed', async () => {
  const { handler, calls } = createHandler({ senderAllowed: false, balances: [{ group_id: 'a@g.us', group_name: 'A', current_total: '5.00' }] });
  const { message, replies } = createMessage({ from: REPORT_GROUP, body: '/calculate' });

  await handler(message);

  assert.deepEqual(replies, []);
  assert.equal(calls.access.ignored.length, 1);
});

test('plain chat never triggers a sender lookup', async () => {
  const { handler, calls } = createHandler();
  const { message, replies } = createMessage({ body: 'Bas 628 done kr do' });

  await handler(message);

  assert.deepEqual(replies, []);
  assert.deepEqual(calls.access.checked, []);
});

test('the sender is allowed when any resolved id matches, e.g. the phone behind an @lid author', async () => {
  const { handler, calls } = createHandler({ senderAllowed: (ids) => ids.includes('923001234567') });
  const getContact = async () => ({ number: '923001234567', id: { user: '923001234567', _serialized: '923001234567@c.us' } });
  const { message, replies } = createMessage({ getContact });

  await handler(message);

  assert.equal(replies.length, 1);
  assert.deepEqual(calls.access.checked[0].sort(), ['256577252638929', '923001234567']);
});

test('a resolved sender lookup is cached, a failed one is retried', async () => {
  const { handler } = createHandler();
  let lookups = 0;
  const getContact = async () => { lookups += 1; return { number: '923001234567' }; };
  await handler(createMessage({ getContact, id: { _serialized: 'a' } }).message);
  await handler(createMessage({ getContact, id: { _serialized: 'b' } }).message);
  assert.equal(lookups, 1);

  const { handler: retrying } = createHandler();
  let failures = 0;
  const failing = async () => { failures += 1; throw new Error('r'); };
  await retrying(createMessage({ getContact: failing, id: { _serialized: 'c' } }).message);
  await retrying(createMessage({ getContact: failing, id: { _serialized: 'd' } }).message);
  assert.equal(failures, 2);
});

test('the receipt header uses the saved group name, upper-cased', async () => {
  const { handler } = createHandler({ labels: { 'g@g.us': 'Hammad' } });
  const { message, replies } = createMessage();

  await handler(message);

  assert.deepEqual(replies, [
    'MUSHFIK X HAMMAD\n\n🤖 Start To Work\n① 10+20=30.0\nCur Total: 30.0\n\nAll Total:30.0'
  ]);
});

test('each group gets its own saved name', async () => {
  const { handler } = createHandler({ labels: { 'g@g.us': 'Hammad', 'h@g.us': 'Ali Khan' } });
  const first = createMessage();
  const second = createMessage({ from: 'h@g.us', id: { _serialized: 'msg-2' } });

  await handler(first.message);
  await handler(second.message);

  assert.match(first.replies[0], /^MUSHFIK X HAMMAD\n/);
  assert.match(second.replies[0], /^MUSHFIK X ALI KHAN\n/);
});

test('a group without a saved name keeps the default header', async () => {
  const { handler } = createHandler({ labels: { 'other@g.us': 'Hammad' } });
  const { message, replies } = createMessage();

  await handler(message);

  assert.match(replies[0], /^MUSHFIK STORE\n/);
});

test('resolveSender collects ids from the author, the contact and the lid lookup', async () => {
  const sender = await resolveSender({
    author: '256577252638929@lid',
    from: 'g@g.us',
    _data: { notifyName: 'Ali' },
    getContact: async () => ({ number: '923001234567', id: { user: '256577252638929', _serialized: '256577252638929@lid' } }),
    client: { getContactLidAndPhone: async () => [{ lid: '256577252638929@lid', pn: '923009999999@c.us' }] }
  });

  assert.equal(sender.senderId, '256577252638929@lid');
  assert.equal(sender.pushName, 'Ali');
  assert.equal(sender.resolved, true);
  assert.deepEqual(sender.identifiers.sort(), ['256577252638929', '923001234567', '923009999999']);
});

test('resolveSender never throws and falls back to the raw id', async () => {
  const sender = await resolveSender({ author: '923001234567@c.us', getContact: async () => { throw new Error('r'); } });

  assert.deepEqual(sender.identifiers, ['923001234567']);
  assert.equal(sender.resolved, false);
});
