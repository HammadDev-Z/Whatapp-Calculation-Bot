// Server-rendered pages. No client-side JavaScript: every action is a plain form post.

const { formatAmount } = require('../utils/formatter');

const MESSAGES = {
  ok: {
    'number-added': 'Number added and active.',
    'number-on': 'Number activated.',
    'number-off': 'Number deactivated.',
    'label-saved': 'Group name saved.',
    'label-cleared': 'Group name cleared. The default header is used again.',
    'password-changed': 'Password changed. Other devices were signed out.'
  },
  error: {
    'bad-number': 'That is not a valid phone number. Use digits with the country code, e.g. 923001234567.',
    'bad-group': 'That is not a valid group id. It looks like 1203630xxxxxxxx@g.us.',
    'bad-label': 'The name must be 40 characters or fewer and on one line.',
    'wrong-password': 'The current password is wrong.',
    'short-password': 'The new password must be at least 8 characters.',
    'mismatch': 'The new passwords do not match.',
    'same-password': 'The new password must be different from the current one.',
    'bad-request': 'Something was wrong with that request. Please try again.'
  }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root{--bg:#f5f6f8;--card:#fff;--text:#1c2330;--muted:#667085;--line:#e3e6eb;--accent:#128c4a;--accent-text:#fff;--danger:#b42318;--danger-bg:#fdecea;--ok-bg:#e8f6ee;--ok:#0b6b38}
@media (prefers-color-scheme:dark){:root{--bg:#10141b;--card:#181e28;--text:#e8ebf0;--muted:#9aa4b2;--line:#2a3240;--accent:#2fb36d;--accent-text:#08140d;--danger:#ff8a7e;--danger-bg:#3a1b18;--ok-bg:#12281c;--ok:#74d9a0}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header.top{background:var(--card);border-bottom:1px solid var(--line)}
header.top .in{max-width:960px;margin:0 auto;padding:0 16px;display:flex;align-items:center;gap:20px;min-height:56px;flex-wrap:wrap}
header.top .brand{font-weight:700;margin-right:auto}
header.top a{color:var(--muted);text-decoration:none;padding:6px 0;border-bottom:2px solid transparent}
header.top a.on{color:var(--text);border-color:var(--accent)}
header.top form{margin:0}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}
p.lead{color:var(--muted);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:20px}
.card h2{font-size:16px;margin:0 0 12px}
.wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
code{font:13px ui-monospace,Menlo,Consolas,monospace;word-break:break-all}
.muted{color:var(--muted)}
.small{font-size:13px}
input[type=text],input[type=password]{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}
.row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.row>div{flex:1 1 200px}
.row>div.fit{flex:0 0 auto}
button{font:inherit;padding:9px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text);font-weight:600}
button.danger{color:var(--danger)}
button.sm{padding:5px 10px;font-size:13px}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
.pill.on{background:var(--ok-bg);color:var(--ok)}
.pill.off{background:var(--danger-bg);color:var(--danger)}
.flash{padding:10px 14px;border-radius:8px;margin-bottom:16px}
.flash.ok{background:var(--ok-bg);color:var(--ok)}
.flash.error{background:var(--danger-bg);color:var(--danger)}
.login{max-width:380px;margin:12vh auto 0;padding:0 16px}
.login .card{padding:24px}
.login .field{margin-bottom:14px}
.empty{color:var(--muted);padding:8px 0}
.preview{font-size:13px;color:var(--muted)}
.preview b{color:var(--text);letter-spacing:.02em}
`;

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function flash(query = {}) {
  const ok = MESSAGES.ok[query.ok];
  const error = MESSAGES.error[query.err];
  if (ok) return `<div class="flash ok" role="status">${escapeHtml(ok)}</div>`;
  if (error) return `<div class="flash error" role="alert">${escapeHtml(error)}</div>`;
  return '';
}

function csrfField(csrfToken) {
  return `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">`;
}

function layout({ title, active, session, query, content }) {
  const link = (href, label, key) =>
    `<a href="${href}"${active === key ? ' class="on"' : ''}>${label}</a>`;
  return page(`${title} · Calculator Bot`, `
<header class="top"><div class="in">
  <span class="brand">Calculator Bot</span>
  ${link('/groups', 'Groups', 'groups')}
  ${link('/numbers', 'Numbers', 'numbers')}
  ${link('/account', 'Account', 'account')}
  <form method="post" action="/logout">${csrfField(session.csrfToken)}<button class="sm" type="submit">Sign out (${escapeHtml(session.username)})</button></form>
</div></header>
<main>
${flash(query)}
${content}
</main>`);
}

function loginPage({ csrfToken, error }) {
  return page('Sign in · Calculator Bot', `
<div class="login">
  <div class="card">
    <h1>Calculator Bot</h1>
    <p class="lead">Sign in to manage groups and numbers.</p>
    ${error ? `<div class="flash error" role="alert">${escapeHtml(error)}</div>` : ''}
    <form method="post" action="/login">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
      <div class="field"><label for="username">Username</label>
        <input id="username" name="username" type="text" autocomplete="username" autofocus required></div>
      <div class="field"><label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="primary" type="submit" style="width:100%">Sign in</button>
    </form>
  </div>
</div>`);
}

function headerPreview(label) {
  const text = label ? `MUSHFIK X ${label.toUpperCase()}` : 'MUSHFIK STORE';
  return `<span class="preview">Header: <b>${escapeHtml(text)}</b></span>`;
}

function groupsPage({ session, query, groups }) {
  const rows = groups.map((group) => `
    <tr>
      <td>
        <strong>${escapeHtml(group.detected_name || 'Unnamed group')}</strong><br>
        <code class="muted small">${escapeHtml(group.group_id)}</code>
      </td>
      <td>
        <form method="post" action="/groups/label" class="row">
          ${csrfField(session.csrfToken)}
          <input type="hidden" name="group_id" value="${escapeHtml(group.group_id)}">
          <div><input type="text" name="label" value="${escapeHtml(group.label || '')}" maxlength="40"
            placeholder="e.g. Hammad" aria-label="Name for ${escapeHtml(group.detected_name || group.group_id)}"></div>
          <div class="fit"><button class="primary sm" type="submit">Save</button></div>
        </form>
        ${headerPreview(group.label)}
      </td>
      <td class="muted">${group.current_total === null || group.current_total === undefined ? '-' : escapeHtml(formatAmount(group.current_total))}</td>
    </tr>`).join('');

  return layout({
    title: 'Groups',
    active: 'groups',
    session,
    query,
    content: `
<h1>Groups</h1>
<p class="lead">The name saved for a group is used in that group's receipts as <b>MUSHFIK X NAME</b>. Groups with no name keep the default <b>MUSHFIK STORE</b> header.</p>
<div class="card">
  <div class="wrap">
  ${groups.length ? `<table>
    <thead><tr><th>Group</th><th>Name in receipts</th><th>Balance</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>` : '<div class="empty">No groups yet. A group appears here after someone sends a calculation in it. You can also add one below by its group id.</div>'}
  </div>
</div>
<div class="card">
  <h2>Add a group by id</h2>
  <form method="post" action="/groups/label" class="row">
    ${csrfField(session.csrfToken)}
    <div><label for="new-group-id">Group id</label>
      <input id="new-group-id" type="text" name="group_id" placeholder="1203630xxxxxxxx@g.us" required></div>
    <div><label for="new-group-label">Name</label>
      <input id="new-group-label" type="text" name="label" maxlength="40" placeholder="e.g. Hammad"></div>
    <div class="fit"><button class="primary" type="submit">Save</button></div>
  </form>
</div>`
  });
}

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function numbersPage({ session, query, numbers, ignored }) {
  const numberRows = numbers.map((row) => `
    <tr>
      <td><code>${escapeHtml(row.number)}</code></td>
      <td>${escapeHtml(row.label || '')}</td>
      <td><span class="pill ${row.active ? 'on' : 'off'}">${row.active ? 'Active' : 'Disabled'}</span></td>
      <td>
        <form method="post" action="/numbers/toggle">
          ${csrfField(session.csrfToken)}
          <input type="hidden" name="number" value="${escapeHtml(row.number)}">
          <input type="hidden" name="active" value="${row.active ? '0' : '1'}">
          <button class="sm ${row.active ? 'danger' : ''}" type="submit">${row.active ? 'Deactivate' : 'Activate'}</button>
        </form>
      </td>
    </tr>`).join('');

  const ignoredRows = ignored.map((row) => `
    <tr>
      <td><code>${escapeHtml(row.number)}</code>${row.push_name ? `<br><span class="muted small">${escapeHtml(row.push_name)}</span>` : ''}</td>
      <td>${escapeHtml(row.group_name || '')}</td>
      <td class="muted small">${escapeHtml(row.message_count)} · ${escapeHtml(formatTime(row.last_seen_at))}</td>
      <td>
        <form method="post" action="/numbers/add">
          ${csrfField(session.csrfToken)}
          <input type="hidden" name="number" value="${escapeHtml(row.number)}">
          <input type="hidden" name="label" value="${escapeHtml(row.push_name || '')}">
          <button class="primary sm" type="submit">Add</button>
        </form>
      </td>
    </tr>`).join('');

  return layout({
    title: 'Numbers',
    active: 'numbers',
    session,
    query,
    content: `
<h1>Numbers</h1>
<p class="lead">The bot only answers numbers that are added here and <b>active</b>. Messages from anyone else are ignored. Changes apply within a few seconds.</p>
<div class="card">
  <h2>Add a number</h2>
  <form method="post" action="/numbers/add" class="row">
    ${csrfField(session.csrfToken)}
    <div><label for="new-number">Phone number (with country code)</label>
      <input id="new-number" type="text" name="number" inputmode="tel" placeholder="923001234567" required></div>
    <div><label for="new-label">Name (optional)</label>
      <input id="new-label" type="text" name="label" maxlength="40" placeholder="e.g. Ali"></div>
    <div class="fit"><button class="primary" type="submit">Add</button></div>
  </form>
</div>
<div class="card">
  <h2>Allowed numbers</h2>
  <div class="wrap">
  ${numbers.length ? `<table>
    <thead><tr><th>Number</th><th>Name</th><th>Status</th><th></th></tr></thead>
    <tbody>${numberRows}</tbody>
  </table>` : '<div class="empty">No numbers yet, so the bot is not answering anyone. Add one above, or pick from the list below.</div>'}
  </div>
</div>
<div class="card">
  <h2>Recently ignored</h2>
  <p class="muted small" style="margin-top:-6px">People who sent a calculation or /calculate but are not allowed. Press Add to allow them. If a number shown here looks wrong (a long id instead of a phone number), WhatsApp is hiding their real number; adding it still works.</p>
  <div class="wrap">
  ${ignored.length ? `<table>
    <thead><tr><th>Sender</th><th>Group</th><th>Messages · last seen</th><th></th></tr></thead>
    <tbody>${ignoredRows}</tbody>
  </table>` : '<div class="empty">Nobody has been ignored recently.</div>'}
  </div>
</div>`
  });
}

function accountPage({ session, query }) {
  return layout({
    title: 'Account',
    active: 'account',
    session,
    query,
    content: `
<h1>Account</h1>
<p class="lead">Signed in as <b>${escapeHtml(session.username)}</b>.</p>
<div class="card" style="max-width:480px">
  <h2>Change password</h2>
  <form method="post" action="/account/password">
    ${csrfField(session.csrfToken)}
    <div style="margin-bottom:12px"><label for="current">Current password</label>
      <input id="current" type="password" name="current" autocomplete="current-password" required></div>
    <div style="margin-bottom:12px"><label for="next">New password (8+ characters)</label>
      <input id="next" type="password" name="next" autocomplete="new-password" minlength="8" required></div>
    <div style="margin-bottom:16px"><label for="confirm">Repeat new password</label>
      <input id="confirm" type="password" name="confirm" autocomplete="new-password" minlength="8" required></div>
    <button class="primary" type="submit">Change password</button>
  </form>
</div>`
  });
}

function notFoundPage() {
  return page('Not found · Calculator Bot', '<div class="login"><div class="card"><h1>Not found</h1><p class="lead"><a href="/">Go to the dashboard</a></p></div></div>');
}

module.exports = {
  accountPage,
  escapeHtml,
  groupsPage,
  loginPage,
  notFoundPage,
  numbersPage
};
