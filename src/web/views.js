// Server-rendered pages. No client-side JavaScript: every action is a plain form post.

const { formatAmount } = require('../utils/formatter');

const MESSAGES = {
  ok: {
    'number-added': 'Number added and active.',
    'number-on': 'Number activated.',
    'number-off': 'Number deactivated.',
    'label-saved': 'Group saved.',
    'group-removed': 'Group removed. It uses the default header again.',
    'password-changed': 'Password changed. Other devices were signed out.'
  },
  error: {
    'bad-number': 'That is not a valid phone number. Use digits with the country code, e.g. 923001234567.',
    'bad-group': 'That is not a valid group id. It looks like 120363012345678901@g.us.',
    'bad-label': 'The name must be 40 characters or fewer and on one line.',
    'label-required': 'Enter a name for the group.',
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

const FAVICON = 'data:image/svg+xml,'
  + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3a0"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#g)"/><path d="M9 16h14M16 9v14" stroke="#06231b" stroke-width="3" stroke-linecap="round"/></svg>');

// Each use needs its own gradient id: a gradient inside a display:none copy does not render for
// the other copies that reference the same id.
const logo = (id) => `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3a0"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg-${id})"/><path d="M9 16h14M16 9v14" stroke="#06231b" stroke-width="3" stroke-linecap="round"/></svg>`;

const ICONS = {
  groups: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20"/><circle cx="11" cy="8" r="3.5"/><path d="M19 20v-1.2a3 3 0 0 0-2.2-2.9M16 4.6a3.5 3.5 0 0 1 0 6.8"/></svg>',
  numbers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z"/></svg>',
  account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10.5" width="16" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 15v2"/></svg>',
  signout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3M16 16l4-4-4-4M20 12H9"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/></svg>'
};

const STYLE = `
:root{
  color-scheme:dark;
  --bg:#0a0e16;--card:#111826;--card-2:#161f31;--line:#232e45;--line-soft:#1b2538;
  --text:#e9eef7;--muted:#8d99b0;--accent:#22d3a0;--accent-2:#3b82f6;--on-accent:#04201a;
  --ok:#34d399;--ok-bg:rgba(52,211,153,.12);--bad:#ff7a88;--bad-bg:rgba(255,122,136,.12);
  --glow-a:rgba(34,211,160,.14);--glow-b:rgba(59,130,246,.13);--shadow:0 10px 30px rgba(0,0,0,.35);
  --radius:16px
}
@media (prefers-color-scheme:light){:root{
  color-scheme:light;
  --bg:#f3f6fb;--card:#fff;--card-2:#f7f9fd;--line:#dfe5ef;--line-soft:#e9edf5;
  --text:#0e1726;--muted:#5a6680;--accent:#0fa57a;--accent-2:#2563eb;--on-accent:#fff;
  --ok:#0b7d57;--ok-bg:rgba(15,165,122,.1);--bad:#c8283d;--bad-bg:rgba(200,40,61,.09);
  --glow-a:rgba(15,165,122,.12);--glow-b:rgba(37,99,235,.1);--shadow:0 10px 30px rgba(20,30,60,.08)}}
*{box-sizing:border-box;margin:0}
html{-webkit-text-size-adjust:100%}
body{min-height:100vh;background:var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:radial-gradient(60rem 32rem at -5% -10%,var(--glow-a),transparent 60%),radial-gradient(48rem 30rem at 105% 0%,var(--glow-b),transparent 55%)}
a{color:inherit}
svg{display:block}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}

/* ---- shell ---- */
.app{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:6px;padding:22px 16px;border-right:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.02),transparent)}
.brand{display:flex;align-items:center;gap:12px;padding:4px 10px 22px;font-weight:700;font-size:17px;letter-spacing:.2px;text-decoration:none}
.brand svg{width:34px;height:34px;flex:none}
.brand small{display:block;font-weight:500;font-size:12px;color:var(--muted);letter-spacing:0}
.nav{display:flex;flex-direction:column;gap:4px}
.nav a{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:12px;color:var(--muted);text-decoration:none;font-weight:600;transition:background .15s,color .15s}
.nav a svg{width:20px;height:20px;flex:none}
.nav a:hover{background:var(--card-2);color:var(--text)}
.nav a.on{background:linear-gradient(135deg,var(--glow-a),var(--glow-b));color:var(--text);box-shadow:inset 0 0 0 1px var(--line)}
.nav a.on svg{color:var(--accent)}
.side-foot{margin-top:auto;padding-top:14px;border-top:1px solid var(--line-soft)}
.who{display:flex;align-items:center;gap:10px;padding:6px 10px 12px;color:var(--muted);font-size:13px}
.avatar{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:800;font-size:13px;text-transform:uppercase}
.who b{display:block;color:var(--text);font-size:14px}
.content{min-width:0}
.mobilebar{display:none}
.tabbar{display:none}
main{max-width:880px;margin:0 auto;padding:36px 28px 72px}

/* ---- page parts ---- */
.page-head{margin-bottom:22px}
h1{font-size:28px;line-height:1.2;letter-spacing:-.4px}
.lead{margin-top:6px;color:var(--muted);max-width:60ch}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.chip{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:13px;color:var(--muted)}
.chip b{color:var(--text)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:20px;margin-bottom:18px;box-shadow:var(--shadow)}
.card>h2{font-size:16px;margin-bottom:4px}
.card>.sub{color:var(--muted);font-size:13.5px;margin-bottom:16px}
.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px;counter-reset:s}
.step{position:relative;padding:14px 14px 14px 48px;border-radius:12px;background:var(--card-2);border:1px solid var(--line-soft);font-size:13.5px;color:var(--muted);counter-increment:s}
.step::before{content:counter(s);position:absolute;left:14px;top:13px;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:12px;color:var(--on-accent);background:linear-gradient(135deg,var(--accent),var(--accent-2))}
.step b{color:var(--text)}
kbd,code{font:12.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
kbd{padding:1px 7px;border-radius:6px;background:var(--card);border:1px solid var(--line);color:var(--text)}
code{word-break:break-all}
.muted{color:var(--muted)}

/* ---- flash ---- */
.flash{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:12px;margin-bottom:18px;font-weight:500;animation:pop .25s ease-out}
.flash svg{width:20px;height:20px;flex:none;margin-top:1px}
.flash.ok{background:var(--ok-bg);color:var(--ok)}
.flash.error{background:var(--bad-bg);color:var(--bad)}
@keyframes pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}

/* ---- forms ---- */
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;align-items:end}
.field label{display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin-bottom:6px;letter-spacing:.02em}
input[type=text],input[type=password]{width:100%;height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--card-2);color:var(--text);font:inherit;transition:border-color .15s,box-shadow .15s}
input::placeholder{color:var(--muted);opacity:.7}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--glow-a)}
button{font:inherit;font-weight:600;cursor:pointer;height:44px;padding:0 18px;border-radius:12px;border:1px solid var(--line);background:var(--card-2);color:var(--text);transition:transform .08s,filter .15s,background .15s}
button:hover{filter:brightness(1.12)}
button:active{transform:translateY(1px)}
button.primary{border:0;color:var(--on-accent);background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:0 6px 18px var(--glow-a)}
button.ghost{background:transparent}
button.danger{color:var(--bad);background:var(--bad-bg);border-color:transparent}
button.sm{height:38px;padding:0 14px;font-size:14px}
button.block{width:100%}
button{display:inline-flex;align-items:center;justify-content:center;gap:8px}
button svg{width:18px;height:18px;flex:none}

/* ---- list items (groups, numbers) ---- */
.list{display:flex;flex-direction:column;gap:10px}
.item{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border-radius:14px;background:var(--card-2);border:1px solid var(--line-soft)}
.item-main{min-width:0;flex:1}
.item-title{font-weight:700;overflow-wrap:anywhere}
.item-sub{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}
.item-form{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.item-form input{width:200px;height:40px}
.item-actions{display:flex;gap:8px;align-items:center}
.receipt{display:inline-block;margin-top:8px;padding:3px 10px;border-radius:8px;background:var(--card);border:1px dashed var(--line);font:600 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.06em;color:var(--accent)}
.empty{display:grid;justify-items:center;text-align:center;gap:6px;padding:30px 12px;color:var(--muted)}
.empty svg{width:38px;height:38px;color:var(--line);margin-bottom:4px}
.empty b{color:var(--text);font-size:16px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.on{background:var(--ok-bg);color:var(--ok)}
.pill.off{background:var(--bad-bg);color:var(--bad)}
.switch{position:relative;width:52px;height:30px;padding:0;border-radius:999px;border:1px solid var(--line);background:var(--card);flex:none}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:var(--muted);transition:transform .18s,background .18s}
.switch.on{background:var(--ok-bg);border-color:transparent}
.switch.on::after{transform:translateX(22px);background:var(--ok)}
.num{font:600 15px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em}

/* ---- login ---- */
.login-wrap{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.login{width:100%;max-width:400px}
.login .logo{display:flex;flex-direction:column;align-items:center;gap:12px;margin-bottom:22px;text-align:center}
.login .logo svg{width:56px;height:56px;filter:drop-shadow(0 8px 24px var(--glow-a))}
.login .logo h1{font-size:24px}
.login .card{padding:26px}
.login .field{margin-bottom:14px}

/* ---- tablet / phone ---- */
@media (max-width:900px){
  .app{display:block}
  .side{display:none}
  .mobilebar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
  .mobilebar .brand{padding:0;font-size:16px}
  .mobilebar .brand svg{width:30px;height:30px}
  .mobilebar form{margin:0}
  .mobilebar button{height:38px;padding:0 12px;display:inline-flex;align-items:center;gap:8px;font-size:14px}
  .mobilebar button svg{width:18px;height:18px}
  .tabbar{position:fixed;left:0;right:0;bottom:0;z-index:20;display:grid;grid-template-columns:repeat(3,1fr);padding:6px 10px calc(6px + env(safe-area-inset-bottom));background:color-mix(in srgb,var(--card) 92%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line)}
  .tabbar a{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:12px;color:var(--muted);text-decoration:none;font-size:12px;font-weight:600}
  .tabbar a svg{width:22px;height:22px}
  .tabbar a.on{color:var(--accent)}
  main{padding:22px 16px calc(96px + env(safe-area-inset-bottom))}
  h1{font-size:24px}
}
@media (max-width:640px){
  .steps{grid-template-columns:1fr}
  .card{padding:16px;border-radius:14px}
  .item{flex-direction:column;align-items:stretch;gap:12px}
  .item-form{flex-wrap:nowrap}
  .item-form input{flex:1;width:auto;min-width:0}
  .item-actions{justify-content:space-between}
  .item.inline{flex-direction:row;align-items:center;gap:10px}
  .item-actions.stack{flex-direction:column;align-items:stretch}
  .item-actions.stack form{width:100%}
  .item-actions.stack .item-form input{flex:1}
  .item-actions.stack button.danger{width:100%}
  .form-grid{grid-template-columns:1fr}
  input[type=text],input[type=password]{font-size:16px}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0a0e16">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="${FAVICON}">
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
  if (ok) return `<div class="flash ok" role="status">${ICONS.check}<span>${escapeHtml(ok)}</span></div>`;
  if (error) return `<div class="flash error" role="alert">${ICONS.alert}<span>${escapeHtml(error)}</span></div>`;
  return '';
}

function csrfField(csrfToken) {
  return `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">`;
}

const NAV = [
  { key: 'groups', href: '/groups', label: 'Groups', icon: ICONS.groups },
  { key: 'numbers', href: '/numbers', label: 'Numbers', icon: ICONS.numbers },
  { key: 'account', href: '/account', label: 'Account', icon: ICONS.account }
];

function layout({ title, active, session, query, content }) {
  const links = (extraClass = '') => NAV.map((item) =>
    `<a href="${item.href}"${active === item.key ? ' class="on" aria-current="page"' : ''}>${item.icon}<span>${item.label}</span></a>`
  ).join('');
  const signOut = (className) => `<form method="post" action="/logout">${csrfField(session.csrfToken)}<button class="${className}" type="submit">${ICONS.signout}<span>Sign out</span></button></form>`;

  return page(`${title} · Calculator Bot`, `
<div class="app">
  <aside class="side">
    <a class="brand" href="/groups">${logo('side')}<span>Calculator Bot<small>Admin</small></span></a>
    <nav class="nav" aria-label="Main">${links()}</nav>
    <div class="side-foot">
      <div class="who"><span class="avatar">${escapeHtml(session.username.slice(0, 1))}</span><span><b>${escapeHtml(session.username)}</b>Signed in</span></div>
      ${signOut('ghost block')}
    </div>
  </aside>
  <div class="content">
    <header class="mobilebar">
      <a class="brand" href="/groups">${logo('bar')}<span>Calculator Bot</span></a>
      ${signOut('ghost')}
    </header>
    <main>
      ${flash(query)}
      ${content}
    </main>
  </div>
  <nav class="tabbar" aria-label="Main">${links()}</nav>
</div>`);
}

function loginPage({ csrfToken, error }) {
  return page('Sign in · Calculator Bot', `
<div class="login-wrap">
  <div class="login">
    <div class="logo">${logo('login')}<div><h1>Calculator Bot</h1><p class="lead" style="margin-top:2px">Sign in to manage groups and numbers.</p></div></div>
    <div class="card">
      ${error ? `<div class="flash error" role="alert">${ICONS.alert}<span>${escapeHtml(error)}</span></div>` : ''}
      <form method="post" action="/login">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
        <div class="field"><label for="username">Username</label>
          <input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus required></div>
        <div class="field"><label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="primary block" type="submit">Sign in</button>
      </form>
    </div>
  </div>
</div>`);
}

function receiptPreview(label) {
  return `<span class="receipt">MUSHFIK X ${escapeHtml(label.toUpperCase())}</span>`;
}

function groupsPage({ session, query, groups }) {
  const items = groups.map((group) => `
    <div class="item">
      <div class="item-main">
        <div class="item-title">${escapeHtml(group.label)}</div>
        <code class="item-sub">${escapeHtml(group.group_id)}</code>
        ${receiptPreview(group.label)}
        ${group.current_total === null || group.current_total === undefined ? '' : `<span class="item-sub">Balance <b>${escapeHtml(formatAmount(group.current_total))}</b></span>`}
      </div>
      <div class="item-actions stack">
        <form method="post" action="/groups/label" class="item-form">
          ${csrfField(session.csrfToken)}
          <input type="hidden" name="group_id" value="${escapeHtml(group.group_id)}">
          <input type="text" name="label" value="${escapeHtml(group.label)}" maxlength="40" required aria-label="Name for ${escapeHtml(group.label)}">
          <button class="sm" type="submit">Save</button>
        </form>
        <form method="post" action="/groups/remove">
          ${csrfField(session.csrfToken)}
          <input type="hidden" name="group_id" value="${escapeHtml(group.group_id)}">
          <button class="sm danger" type="submit" aria-label="Remove ${escapeHtml(group.label)}">Remove</button>
        </form>
      </div>
    </div>`).join('');

  return layout({
    title: 'Groups',
    active: 'groups',
    session,
    query,
    content: `
<div class="page-head">
  <h1>Groups</h1>
  <p class="lead">Add a group by its id and give it a name. That group's receipts then start with <b>MUSHFIK X NAME</b>. Groups you have not added keep the default <b>MUSHFIK STORE</b> header.</p>
  <div class="chips"><span class="chip"><b>${groups.length}</b> ${groups.length === 1 ? 'group' : 'groups'}</span></div>
</div>

<div class="card">
  <h2>Add a group</h2>
  <p class="sub">Don't know the group id? Get it from WhatsApp:</p>
  <div class="steps">
    <div class="step">Add the bot to the group, and make sure your number is <b>active</b> on the Numbers page.</div>
    <div class="step">Send <kbd>/groupid</kbd> in that group. The bot replies with the id.</div>
    <div class="step">Copy the id it sends, paste it below, and choose a name.</div>
  </div>
  <form method="post" action="/groups/label" style="margin-top:18px">
    ${csrfField(session.csrfToken)}
    <div class="form-grid">
      <div class="field"><label for="new-group-id">Group id</label>
        <input id="new-group-id" type="text" name="group_id" placeholder="120363012345678901@g.us" autocapitalize="none" autocomplete="off" spellcheck="false" required></div>
      <div class="field"><label for="new-group-label">Name in receipts</label>
        <input id="new-group-label" type="text" name="label" maxlength="40" placeholder="e.g. Hammad" required></div>
      <div class="field"><button class="primary block" type="submit">Add group</button></div>
    </div>
  </form>
</div>

<div class="card">
  <h2>Your groups</h2>
  <p class="sub" style="margin-bottom:14px">Rename a group or remove it. Changes reach the bot within a few seconds.</p>
  ${groups.length ? `<div class="list">${items}</div>` : `<div class="empty">${ICONS.groups}<b>No groups yet</b><span>Add your first group above using its id.</span></div>`}
</div>`
  });
}

function numbersPage({ session, query, numbers }) {
  const activeCount = numbers.filter((row) => row.active).length;
  const items = numbers.map((row) => `
    <div class="item inline">
      <div class="item-main">
        <div class="item-title num">${escapeHtml(row.number)}</div>
        ${row.label ? `<span class="item-sub">${escapeHtml(row.label)}</span>` : ''}
      </div>
      <div class="item-actions">
        <span class="pill ${row.active ? 'on' : 'off'}">${row.active ? 'Active' : 'Disabled'}</span>
        <form method="post" action="/numbers/toggle">
          ${csrfField(session.csrfToken)}
          <input type="hidden" name="number" value="${escapeHtml(row.number)}">
          <input type="hidden" name="active" value="${row.active ? '0' : '1'}">
          <button class="switch ${row.active ? 'on' : ''}" type="submit" role="switch" aria-checked="${row.active ? 'true' : 'false'}"><span class="sr">${row.active ? 'Deactivate' : 'Activate'} ${escapeHtml(row.number)}</span></button>
        </form>
      </div>
    </div>`).join('');

  return layout({
    title: 'Numbers',
    active: 'numbers',
    session,
    query,
    content: `
<div class="page-head">
  <h1>Numbers</h1>
  <p class="lead">The bot only answers numbers that are added here and <b>active</b>. Messages from anyone else are ignored. Changes apply within a few seconds.</p>
  <div class="chips">
    <span class="chip"><b>${activeCount}</b> active</span>
    <span class="chip"><b>${numbers.length - activeCount}</b> disabled</span>
  </div>
</div>

<div class="card">
  <h2>Add a number</h2>
  <p class="sub">Digits with the country code, no plus or spaces needed.</p>
  <form method="post" action="/numbers/add">
    ${csrfField(session.csrfToken)}
    <div class="form-grid">
      <div class="field"><label for="new-number">Phone number</label>
        <input id="new-number" type="text" name="number" inputmode="tel" placeholder="923001234567" autocomplete="off" required></div>
      <div class="field"><label for="new-label">Name (optional)</label>
        <input id="new-label" type="text" name="label" maxlength="40" placeholder="e.g. Ali"></div>
      <div class="field"><button class="primary block" type="submit">Add number</button></div>
    </div>
  </form>
</div>

<div class="card">
  <h2>Allowed numbers</h2>
  <p class="sub" style="margin-bottom:14px">Flip the switch to activate or deactivate a number.</p>
  ${numbers.length ? `<div class="list">${items}</div>` : `<div class="empty">${ICONS.numbers}<b>No numbers yet</b><span>The bot is not answering anyone. Add a number above.</span></div>`}
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
<div class="page-head">
  <h1>Account</h1>
  <p class="lead">Signed in as <b>${escapeHtml(session.username)}</b>.</p>
</div>

<div class="card" style="max-width:520px">
  <h2>Change password</h2>
  <p class="sub">Other devices are signed out when you change it.</p>
  <form method="post" action="/account/password">
    ${csrfField(session.csrfToken)}
    <div class="field" style="margin-bottom:14px"><label for="current">Current password</label>
      <input id="current" type="password" name="current" autocomplete="current-password" required></div>
    <div class="field" style="margin-bottom:14px"><label for="next">New password (8+ characters)</label>
      <input id="next" type="password" name="next" autocomplete="new-password" minlength="8" required></div>
    <div class="field" style="margin-bottom:18px"><label for="confirm">Repeat new password</label>
      <input id="confirm" type="password" name="confirm" autocomplete="new-password" minlength="8" required></div>
    <button class="primary" type="submit">Change password</button>
  </form>
</div>`
  });
}

function notFoundPage() {
  return page('Not found · Calculator Bot', `
<div class="login-wrap"><div class="login"><div class="logo">${logo('nf')}<div><h1>Page not found</h1><p class="lead" style="margin-top:2px"><a href="/">Go to the dashboard</a></p></div></div></div></div>`);
}

module.exports = {
  accountPage,
  escapeHtml,
  groupsPage,
  loginPage,
  notFoundPage,
  numbersPage
};
