const { test } = require('node:test');
const assert = require('node:assert/strict');
const AccessSettings = require('../src/services/accessSettings');

function createRepository({ numbers = ['923001234567'], labels = [{ group_id: 'g@g.us', label: ' Hammad ' }] } = {}) {
  const repository = {
    loads: 0,
    failing: false,
    groups: [],
    ignored: [],
    async listActiveNumbers() {
      repository.loads += 1;
      if (repository.failing) throw new Error('db down');
      return numbers;
    },
    async listGroupLabels() {
      if (repository.failing) throw new Error('db down');
      return labels;
    },
    async upsertGroup(groupId, name) { repository.groups.push([groupId, name]); },
    async recordIgnoredSender(details) { repository.ignored.push(details); }
  };
  return repository;
}

function createSettings(repository, overrides = {}) {
  const clock = { time: 1000 };
  const warnings = [];
  const settings = new AccessSettings(repository, {
    ttlMs: 5000,
    now: () => clock.time,
    logger: { warn: (...args) => warnings.push(args) },
    ...overrides
  });
  return { settings, clock, warnings };
}

test('allows a sender when any identifier is an active number', async () => {
  const { settings } = createSettings(createRepository());

  assert.equal(await settings.isSenderAllowed(['256577252638929', '923001234567']), true);
  assert.equal(await settings.isSenderAllowed(['256577252638929']), false);
  assert.equal(await settings.isSenderAllowed([]), false);
});

test('returns the trimmed group label, or null when the group has none', async () => {
  const { settings } = createSettings(createRepository());

  assert.equal(await settings.getGroupLabel('g@g.us'), 'Hammad');
  assert.equal(await settings.getGroupLabel('other@g.us'), null);
});

test('reads the database once per TTL window, even for concurrent messages', async () => {
  const repository = createRepository();
  const { settings, clock } = createSettings(repository);

  await Promise.all([settings.isSenderAllowed(['1']), settings.getGroupLabel('g@g.us'), settings.isSenderAllowed(['2'])]);
  assert.equal(repository.loads, 1);

  clock.time += 4999;
  await settings.isSenderAllowed(['1']);
  assert.equal(repository.loads, 1);

  clock.time += 2;
  await settings.isSenderAllowed(['1']);
  assert.equal(repository.loads, 2);
});

test('picks up website changes after the TTL', async () => {
  const numbers = [];
  const { settings, clock } = createSettings(createRepository({ numbers }));

  assert.equal(await settings.isSenderAllowed(['923001234567']), false);
  numbers.push('923001234567');
  clock.time += 6000;
  assert.equal(await settings.isSenderAllowed(['923001234567']), true);
});

test('keeps serving the last good copy when a refresh fails', async () => {
  const repository = createRepository();
  const { settings, clock, warnings } = createSettings(repository);
  await settings.isSenderAllowed(['923001234567']);

  repository.failing = true;
  clock.time += 6000;

  assert.equal(await settings.isSenderAllowed(['923001234567']), true);
  assert.equal(warnings.length, 1);
});

test('fails when the very first load fails, so the message is dropped', async () => {
  const repository = createRepository();
  repository.failing = true;
  const { settings } = createSettings(repository);

  await assert.rejects(settings.isSenderAllowed(['923001234567']), /db down/);
  repository.failing = false;
  assert.equal(await settings.isSenderAllowed(['923001234567']), true);
});

test('registers a group only once per process', async () => {
  const repository = createRepository();
  const { settings } = createSettings(repository);

  await settings.noteGroup('g@g.us', 'Karachi Buyers');
  await settings.noteGroup('g@g.us', 'Karachi Buyers');

  assert.deepEqual(repository.groups, [['g@g.us', 'Karachi Buyers']]);
});

test('records an ignored sender with the resolved phone number, throttled per sender', async () => {
  const repository = createRepository();
  const { settings, clock } = createSettings(repository);
  const details = {
    senderId: '256577252638929@lid',
    identifiers: ['256577252638929', '923001234567'],
    pushName: 'Ali',
    groupId: 'g@g.us'
  };

  await settings.noteIgnoredSender(details);
  await settings.noteIgnoredSender(details);
  assert.deepEqual(repository.ignored, [{
    senderId: '256577252638929@lid', number: '923001234567', pushName: 'Ali', groupId: 'g@g.us'
  }]);

  clock.time += 11 * 60 * 1000;
  await settings.noteIgnoredSender(details);
  assert.equal(repository.ignored.length, 2);
});

test('falls back to the raw id digits when no phone number could be resolved', async () => {
  const repository = createRepository();
  const { settings } = createSettings(repository);

  await settings.noteIgnoredSender({
    senderId: '256577252638929@lid', identifiers: ['256577252638929'], pushName: null, groupId: 'g@g.us'
  });

  assert.equal(repository.ignored[0].number, '256577252638929');
});
