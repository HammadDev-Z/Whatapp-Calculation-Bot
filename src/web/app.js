const crypto = require('crypto');
const express = require('express');
const { parseNumberInput } = require('../utils/phone');
const { hashPassword, verifyPassword } = require('../utils/password');
const views = require('./views');

const SESSION_COOKIE = 'sid';
const LOGIN_CSRF_COOKIE = 'login_csrf';

const MAX_LABEL_LENGTH = 40;
const MIN_PASSWORD_LENGTH = 8;
const GROUP_ID_PATTERN = /^[\w.-]+@g\.us$/;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

// Verifying against this when the username is unknown keeps the response time the same.
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function setCookie(req, res, name, value, maxAgeMs) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

const clearCookie = (req, res, name) => setCookie(req, res, name, '', 0);

// A label ends up inside a WhatsApp message, so it must be a single short line.
function parseLabel(value) {
  const label = String(value ?? '').trim();
  if (label.length > MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) return { error: true };
  return { label };
}

function createLoginLimiter(now) {
  const failures = new Map();
  const current = (ip) => {
    const entry = failures.get(ip);
    if (!entry || entry.resetAt <= now()) return null;
    return entry;
  };
  return {
    blocked: (ip) => (current(ip)?.count || 0) >= LOGIN_MAX_FAILURES,
    fail(ip) {
      const entry = current(ip) || { count: 0, resetAt: now() + LOGIN_WINDOW_MS };
      entry.count += 1;
      failures.set(ip, entry);
    },
    clear: (ip) => failures.delete(ip)
  };
}

function createWebApp({ adminRepository, accessRepository, logger, now = Date.now }) {
  const app = express();
  app.disable('x-powered-by');
  // Runs behind the Caddy reverse proxy, which terminates HTTPS.
  app.set('trust proxy', 1);

  const limiter = createLoginLimiter(now);
  const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));

  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // --- login ---------------------------------------------------------------------------------

  const renderLogin = (req, res, status = 200, error = null) => {
    const csrfToken = crypto.randomBytes(24).toString('hex');
    setCookie(req, res, LOGIN_CSRF_COOKIE, csrfToken, 15 * 60 * 1000);
    res.status(status).send(views.loginPage({ csrfToken, error }));
  };

  app.get('/login', wrap(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    if (await adminRepository.findSession(cookies[SESSION_COOKIE])) return res.redirect('/groups');
    return renderLogin(req, res);
  }));

  app.post('/login', wrap(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies[LOGIN_CSRF_COOKIE] || !safeEqual(cookies[LOGIN_CSRF_COOKIE], req.body._csrf)) {
      return renderLogin(req, res, 400, 'Your sign-in form expired. Please try again.');
    }
    if (limiter.blocked(req.ip)) {
      return renderLogin(req, res, 429, 'Too many failed attempts. Try again in a few minutes.');
    }

    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const admin = username ? await adminRepository.findByUsername(username) : null;
    const valid = verifyPassword(password, admin ? admin.password_hash : DUMMY_HASH);
    if (!admin || !valid) {
      limiter.fail(req.ip);
      return renderLogin(req, res, 401, 'Wrong username or password.');
    }

    limiter.clear(req.ip);
    const session = await adminRepository.createSession(admin.id);
    setCookie(req, res, SESSION_COOKIE, session.token, session.maxAgeMs);
    clearCookie(req, res, LOGIN_CSRF_COOKIE);
    return res.redirect('/groups');
  }));

  // --- everything below needs a signed-in admin ----------------------------------------------

  app.use(wrap(async (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = await adminRepository.findSession(token);
    if (!session) return res.redirect('/login');
    req.session = session;
    req.sessionToken = token;
    return next();
  }));

  app.use((req, res, next) => {
    if (req.method === 'POST' && !safeEqual(req.session.csrfToken, req.body._csrf)) {
      return res.status(403).type('text').send('Invalid or missing form token. Go back, reload the page and try again.');
    }
    return next();
  });

  app.post('/logout', wrap(async (req, res) => {
    await adminRepository.deleteSession(req.sessionToken);
    clearCookie(req, res, SESSION_COOKIE);
    res.redirect('/login');
  }));

  app.get('/', (req, res) => res.redirect('/groups'));

  // --- groups --------------------------------------------------------------------------------

  app.get('/groups', wrap(async (req, res) => {
    const groups = await accessRepository.listGroups();
    res.send(views.groupsPage({ session: req.session, query: req.query, groups }));
  }));

  app.post('/groups/label', wrap(async (req, res) => {
    const groupId = String(req.body.group_id || '').trim();
    if (!GROUP_ID_PATTERN.test(groupId)) return res.redirect('/groups?err=bad-group');
    const { label, error } = parseLabel(req.body.label);
    if (error) return res.redirect('/groups?err=bad-label');
    if (!label) return res.redirect('/groups?err=label-required');

    await accessRepository.setGroupLabel(groupId, label);
    return res.redirect('/groups?ok=label-saved');
  }));

  app.post('/groups/remove', wrap(async (req, res) => {
    const groupId = String(req.body.group_id || '').trim();
    if (!GROUP_ID_PATTERN.test(groupId)) return res.redirect('/groups?err=bad-group');

    await accessRepository.removeGroup(groupId);
    return res.redirect('/groups?ok=group-removed');
  }));

  // --- numbers -------------------------------------------------------------------------------

  app.get('/numbers', wrap(async (req, res) => {
    const numbers = await accessRepository.listNumbers();
    res.send(views.numbersPage({ session: req.session, query: req.query, numbers }));
  }));

  app.post('/numbers/add', wrap(async (req, res) => {
    const number = parseNumberInput(req.body.number);
    if (!number) return res.redirect('/numbers?err=bad-number');
    const { label, error } = parseLabel(req.body.label);
    if (error) return res.redirect('/numbers?err=bad-label');

    await accessRepository.addNumber(number, label);
    return res.redirect('/numbers?ok=number-added');
  }));

  app.post('/numbers/toggle', wrap(async (req, res) => {
    const number = parseNumberInput(req.body.number);
    const active = req.body.active === '1';
    if (!number || !['0', '1'].includes(req.body.active)) return res.redirect('/numbers?err=bad-request');

    const found = await accessRepository.setNumberActive(number, active);
    if (!found) return res.redirect('/numbers?err=bad-request');
    return res.redirect(`/numbers?ok=${active ? 'number-on' : 'number-off'}`);
  }));

  // --- account -------------------------------------------------------------------------------

  app.get('/account', (req, res) => {
    res.send(views.accountPage({ session: req.session, query: req.query }));
  });

  app.post('/account/password', wrap(async (req, res) => {
    const admin = await adminRepository.findById(req.session.adminId);
    const current = String(req.body.current || '');
    const next = String(req.body.next || '');

    if (!admin || !verifyPassword(current, admin.password_hash)) return res.redirect('/account?err=wrong-password');
    if (next.length < MIN_PASSWORD_LENGTH) return res.redirect('/account?err=short-password');
    if (next !== String(req.body.confirm || '')) return res.redirect('/account?err=mismatch');
    if (next === current) return res.redirect('/account?err=same-password');

    await adminRepository.updatePassword(admin.id, hashPassword(next));
    await adminRepository.deleteOtherSessions(admin.id, req.sessionToken);
    return res.redirect('/account?ok=password-changed');
  }));

  app.use((req, res) => res.status(404).send(views.notFoundPage()));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    logger.error('Web request failed', { path: req.path, error: error.message || String(error) });
    res.status(500).type('text').send('Something went wrong. Please try again.');
  });

  return app;
}

module.exports = { createWebApp, MIN_PASSWORD_LENGTH };
