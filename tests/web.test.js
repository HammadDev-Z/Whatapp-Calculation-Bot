const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createWebApp } = require('../src/web/app');
const { hashPassword, verifyPassword } = require('../src/utils/password');

const PASSWORD = 'correct horse';

// In-memory stand-ins for the two repositories, with the same method names.
function createRepositories() {
  const state = {
    admins: [{ id: 1, username: 'admin', password_hash: hashPassword(PASSWORD) }],
    sessions: new Map(),
    numbers: [],
    groups: [
      { group_id: 'g1@g.us', detected_name: 'Karachi <b>Buyers</b>', label: null, current_total: '12.50' },
      { group_id: 'g2@g.us', detected_name: 'Lahore', label: 'Hammad', current_total: null }
    ],
    ignored: [
      { sender_id: '256@lid', number: '923009999999', push_name: 'Bilal', message_count: 3, last_seen_at: new Date('2026-10-30T10:00:00Z'), group_name: 'Lahore' }
    ],
    calls: []
  };

  const adminRepository = {
    async findByUsername(username) {
      return state.admins.find((a) => a.username.toLowerCase() === username.toLowerCase()) || null;
    },
    async findById(id) { return state.admins.find((a) => a.id === id) || null; },
    async createSession(adminId) {
      const token = crypto.randomBytes(8).toString('hex');
      const csrfToken = crypto.randomBytes(8).toString('hex');
      state.sessions.set(token, { adminId, csrfToken });
      return { token, csrfToken, maxAgeMs: 1000 };
    },
    async findSession(token) {
      const session = state.sessions.get(token);
      if (!session) return null;
      return { ...session, username: state.admins.find((a) => a.id === session.adminId).username };
    },
    async deleteSession(token) { state.sessions.delete(token); },
    async deleteOtherSessions(adminId, keep) {
      for (const token of [...state.sessions.keys()]) if (token !== keep) state.sessions.delete(token);
    },
    async updatePassword(id, hash) {
      state.admins.find((a) => a.id === id).password_hash = hash;
      state.calls.push(['updatePassword', id]);
    }
  };

  const accessRepository = {
    async listGroups() { return state.groups; },
    async setGroupLabel(groupId, label) { state.calls.push(['setGroupLabel', groupId, label]); },
    async listNumbers() { return state.numbers; },
    async listIgnoredSenders() { return state.ignored; },
    async addNumber(number, label) {
      state.calls.push(['addNumber', number, label]);
      state.numbers.push({ number, label, active: true, created_at: new Date() });
    },
    async setNumberActive(number, active) {
      state.calls.push(['setNumberActive', number, active]);
      const row = state.numbers.find((n) => n.number === number);
      if (row) row.active = active;
      return Boolean(row);
    }
  };

  return { state, adminRepository, accessRepository };
}

async function start() {
  const repos = createRepositories();
  const app = createWebApp({
    adminRepository: repos.adminRepository,
    accessRepository: repos.accessRepository,
    logger: { error() {}, warn() {}, info() {} }
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ...repos, base, close: () => new Promise((resolve) => server.close(resolve)) };
}

// Minimal cookie-keeping client. Redirects are returned, not followed.
function client(base) {
  const jar = new Map();
  const remember = (response) => {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = decodeURIComponent(pair.slice(index + 1));
      if (/Max-Age=0/i.test(header)) jar.delete(name); else jar.set(name, value);
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  const request = async (path, options = {}) => {
    const response = await fetch(base + path, {
      redirect: 'manual',
      ...options,
      headers: { cookie: cookieHeader(), ...(options.headers || {}) }
    });
    remember(response);
    return response;
  };
  return {
    jar,
    get: (path) => request(path),
    post: (path, fields) => request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    })
  };
}

const csrfIn = (html) => /name="_csrf" value="([0-9a-f]+)"/.exec(html)[1];

async function signIn(server, password = PASSWORD) {
  const browser = client(server.base);
  const form = await (await browser.get('/login')).text();
  const response = await browser.post('/login', { _csrf: csrfIn(form), username: 'admin', password });
  return { browser, response };
}

async function csrfOf(browser, path = '/groups') {
  return csrfIn(await (await browser.get(path)).text());
}

test('pages redirect to the sign-in form when signed out', async (t) => {
  const server = await start();
  t.after(server.close);

  for (const path of ['/', '/groups', '/numbers', '/account']) {
    const response = await client(server.base).get(path);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  }
});

test('POST routes cannot be reached signed out', async (t) => {
  const server = await start();
  t.after(server.close);

  const response = await client(server.base).post('/numbers/add', { number: '923001234567' });

  assert.equal(response.headers.get('location'), '/login');
  assert.deepEqual(server.state.calls, []);
});

test('signing in with the right password sets a hardened session cookie', async (t) => {
  const server = await start();
  t.after(server.close);

  const { browser, response } = await signIn(server);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/groups');
  const cookie = response.headers.getSetCookie().find((header) => header.startsWith('sid='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal((await browser.get('/groups')).status, 200);
});

test('a wrong password or unknown user is rejected with the same message', async (t) => {
  const server = await start();
  t.after(server.close);

  const wrongPassword = await signIn(server, 'nope');
  const browser = client(server.base);
  const form = await (await browser.get('/login')).text();
  const unknownUser = await browser.post('/login', { _csrf: csrfIn(form), username: 'ghost', password: 'x' });

  for (const response of [wrongPassword.response, unknownUser]) {
    assert.equal(response.status, 401);
    assert.match(await response.text(), /Wrong username or password\./);
    assert.equal(response.headers.getSetCookie().some((header) => header.startsWith('sid=')), false);
  }
});

test('the sign-in form needs its own token', async (t) => {
  const server = await start();
  t.after(server.close);
  const browser = client(server.base);
  await browser.get('/login');

  const response = await browser.post('/login', { _csrf: 'forged', username: 'admin', password: PASSWORD });

  assert.equal(response.status, 400);
});

test('too many failed sign-ins are blocked, even with the right password', async (t) => {
  const server = await start();
  t.after(server.close);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await signIn(server, 'wrong')).response.status, 401);
  }
  const { response } = await signIn(server);

  assert.equal(response.status, 429);
});

test('state-changing requests without the form token are refused', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);

  const response = await browser.post('/numbers/add', { number: '923001234567', _csrf: 'forged' });

  assert.equal(response.status, 403);
  assert.deepEqual(server.state.calls, []);
});

test('the groups page lists groups, escapes names and previews the header', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);

  const html = await (await browser.get('/groups')).text();

  assert.match(html, /Karachi &lt;b&gt;Buyers&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Buyers<\/b>/);
  assert.match(html, /g1@g\.us/);
  assert.match(html, /Header: <b>MUSHFIK STORE<\/b>/);
  assert.match(html, /Header: <b>MUSHFIK X HAMMAD<\/b>/);
});

test('saving a group name stores it trimmed, and an empty name clears it', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);
  const _csrf = await csrfOf(browser);

  const saved = await browser.post('/groups/label', { _csrf, group_id: 'g1@g.us', label: '  Ali Khan ' });
  const cleared = await browser.post('/groups/label', { _csrf, group_id: 'g2@g.us', label: '' });

  assert.equal(saved.headers.get('location'), '/groups?ok=label-saved');
  assert.equal(cleared.headers.get('location'), '/groups?ok=label-cleared');
  assert.deepEqual(server.state.calls, [
    ['setGroupLabel', 'g1@g.us', 'Ali Khan'],
    ['setGroupLabel', 'g2@g.us', '']
  ]);
});

test('group ids and names are validated', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);
  const _csrf = await csrfOf(browser);

  const badId = await browser.post('/groups/label', { _csrf, group_id: '923001234567@c.us', label: 'x' });
  const multiline = await browser.post('/groups/label', { _csrf, group_id: 'g1@g.us', label: 'one\ntwo' });
  const tooLong = await browser.post('/groups/label', { _csrf, group_id: 'g1@g.us', label: 'x'.repeat(41) });

  assert.equal(badId.headers.get('location'), '/groups?err=bad-group');
  assert.equal(multiline.headers.get('location'), '/groups?err=bad-label');
  assert.equal(tooLong.headers.get('location'), '/groups?err=bad-label');
  assert.deepEqual(server.state.calls, []);
});

test('adding a number normalises it, and rejects things that are not numbers', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);
  const _csrf = await csrfOf(browser, '/numbers');

  const added = await browser.post('/numbers/add', { _csrf, number: '+92 300-1234567', label: 'Ali' });
  const bad = await browser.post('/numbers/add', { _csrf, number: 'hello', label: '' });

  assert.equal(added.headers.get('location'), '/numbers?ok=number-added');
  assert.equal(bad.headers.get('location'), '/numbers?err=bad-number');
  assert.deepEqual(server.state.calls, [['addNumber', '923001234567', 'Ali']]);
});

test('a number can be deactivated and activated again', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);
  const _csrf = await csrfOf(browser, '/numbers');
  await browser.post('/numbers/add', { _csrf, number: '923001234567', label: '' });

  const off = await browser.post('/numbers/toggle', { _csrf, number: '923001234567', active: '0' });
  const offPage = await (await browser.get('/numbers')).text();
  const on = await browser.post('/numbers/toggle', { _csrf, number: '923001234567', active: '1' });
  const onPage = await (await browser.get('/numbers')).text();

  assert.equal(off.headers.get('location'), '/numbers?ok=number-off');
  assert.match(offPage, /class="pill off">Disabled/);
  assert.match(offPage, />Activate</);
  assert.equal(on.headers.get('location'), '/numbers?ok=number-on');
  assert.match(onPage, /class="pill on">Active/);
  assert.match(onPage, />Deactivate</);
});

test('toggling an unknown number or sending a bad value is refused', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);
  const _csrf = await csrfOf(browser, '/numbers');

  const unknown = await browser.post('/numbers/toggle', { _csrf, number: '923001234567', active: '0' });
  const badValue = await browser.post('/numbers/toggle', { _csrf, number: '923001234567', active: 'maybe' });

  assert.equal(unknown.headers.get('location'), '/numbers?err=bad-request');
  assert.equal(badValue.headers.get('location'), '/numbers?err=bad-request');
});

test('the numbers page offers ignored senders with an Add button', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);

  const html = await (await browser.get('/numbers')).text();

  assert.match(html, /923009999999/);
  assert.match(html, /Bilal/);
  assert.match(html, /name="number" value="923009999999"/);
});

test('changing the password checks the current one and signs other devices out', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);
  const other = (await signIn(server)).browser;
  const _csrf = await csrfOf(browser, '/account');

  const wrong = await browser.post('/account/password', { _csrf, current: 'nope', next: 'a-new-password', confirm: 'a-new-password' });
  const short = await browser.post('/account/password', { _csrf, current: PASSWORD, next: 'short', confirm: 'short' });
  const mismatch = await browser.post('/account/password', { _csrf, current: PASSWORD, next: 'a-new-password', confirm: 'different' });
  const same = await browser.post('/account/password', { _csrf, current: PASSWORD, next: PASSWORD, confirm: PASSWORD });
  assert.equal(wrong.headers.get('location'), '/account?err=wrong-password');
  assert.equal(short.headers.get('location'), '/account?err=short-password');
  assert.equal(mismatch.headers.get('location'), '/account?err=mismatch');
  assert.equal(same.headers.get('location'), '/account?err=same-password');
  assert.deepEqual(server.state.calls, []);

  const changed = await browser.post('/account/password', { _csrf, current: PASSWORD, next: 'a-new-password', confirm: 'a-new-password' });

  assert.equal(changed.headers.get('location'), '/account?ok=password-changed');
  assert.equal(verifyPassword('a-new-password', server.state.admins[0].password_hash), true);
  assert.equal((await browser.get('/groups')).status, 200);
  assert.equal((await other.get('/groups')).status, 302);
  assert.equal((await signIn(server, 'a-new-password')).response.status, 302);
  assert.equal((await signIn(server, PASSWORD)).response.status, 401);
});

test('signing out ends the session', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);
  const _csrf = await csrfOf(browser);

  const response = await browser.post('/logout', { _csrf });

  assert.equal(response.headers.get('location'), '/login');
  assert.equal((await browser.get('/groups')).status, 302);
});

test('responses carry security headers and are never cached', async (t) => {
  const server = await start();
  t.after(server.close);
  const { browser } = await signIn(server);

  const response = await browser.get('/groups');

  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('the health check needs no login and unknown pages are 404 once signed in', async (t) => {
  const server = await start();
  t.after(server.close);

  assert.equal(await (await client(server.base).get('/healthz')).text(), 'ok');
  const { browser } = await signIn(server);
  assert.equal((await browser.get('/nope')).status, 404);
});
