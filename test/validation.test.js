'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../library');

const root = path.join(__dirname, '..');

test('clean trims, removes control characters, and enforces maximum length', () => {
  assert.equal(plugin._test.clean('  hello  ', 10), 'hello');
  assert.equal(plugin._test.clean('ab\ncd\t ef', 20), 'ab cd  ef');
  assert.equal(plugin._test.clean('abcdefgh', 4), 'abcd');
  assert.equal(plugin._test.clean(null, 10), '');
});

test('validEmail accepts ordinary email addresses', () => {
  assert.equal(plugin._test.validEmail('person@example.com'), true);
  assert.equal(plugin._test.validEmail('first.last+tag@example.co.il'), true);
});

test('validEmail rejects malformed email addresses', () => {
  for (const value of ['', 'not-an-email', 'x@', '@example.com', 'x y@example.com']) {
    assert.equal(plugin._test.validEmail(value), false, value);
  }
});

test('manifest registers NodeBB 4.x application and API route hooks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  const hooks = manifest.hooks.map(entry => entry.hook);
  assert.ok(hooks.includes('static:app.load'));
  assert.ok(hooks.includes('static:api.routes'));
  assert.ok(hooks.includes('filter:admin.header.build'));
  assert.equal(manifest.library, './library.js');
  assert.ok(manifest.scss.includes('public/lib/inbox.scss'));
});

test('email templates referenced by the API exist', () => {
  assert.ok(fs.existsSync(path.join(root, 'templates/emails/contact-inbox-notification.tpl')));
  assert.ok(fs.existsSync(path.join(root, 'templates/emails/contact-inbox-reply.tpl')));
});

test('client calls the NodeBB v3 plugin API and uses the PUT update verb', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  assert.ok(client.includes('/api/v3/plugins/contact-inbox'));
  assert.ok(client.includes("method: 'PUT'"));
  assert.ok(client.includes("method: 'POST'"));
});

test('API routes enforce CSRF on writes and use standard NodeBB response formatting', () => {
  const server = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
  assert.ok(server.includes('middleware.applyCSRF'));
  assert.ok(server.includes('apiHelpers.formatApiResponse'));
  assert.ok(server.includes('groups.isMember(uid, groupName)'));
  assert.ok(server.includes('messaging.hasPrivateChat'));
  assert.ok(server.includes("'/contact-inbox/submissions/:id/chat'"));
});

test('front-end inbox uses LTR source values so NodeBB RTL processing outputs RTL', () => {
  const server = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  const template = fs.readFileSync(path.join(root, 'templates/contact-inbox.tpl'), 'utf8');
  const scss = fs.readFileSync(path.join(root, 'public/lib/inbox.scss'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/lib/inbox.css'), 'utf8');

  assert.ok(server.includes("res.render('contact-inbox'"));
  assert.ok(server.includes("setupPageRoute(router, '/plugins/contact-inbox', [staffOnly], forumPage)"));
  assert.ok(manifest.scripts.includes('public/lib/inbox.js'));
  assert.ok(template.includes('dir="rtl"'));
  assert.match(scss, /\.contact-inbox-page\{direction:ltr;/);
  assert.match(scss, /\.contact-inbox-page\{[^}]*text-align:left;/);
  assert.match(scss, /\.ci-row\{[^}]*text-align:left;/);
  assert.doesNotMatch(scss, /direction:rtl|text-align:right/);
  assert.equal(css, scss);
  assert.ok(scss.includes('grid-template-columns:minmax(0,360px) minmax(0,1fr)'));
  assert.ok(scss.includes('@media(max-width:760px)'));
});

test('inbox separates active submissions from resolved history without read-state transitions', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
  assert.ok(client.includes("routePath.endsWith('/history') ? 'history' : 'active'"));
  assert.ok(client.includes("view === 'history'"));
  assert.ok(client.includes("request('/unread')"));
  assert.ok(server.includes("id: 'contact-inbox-nav'"));
  assert.ok(server.includes('  addNavigation,'));
  assert.ok(server.includes("view === 'history' ? item.status === 'resolved' : item.status !== 'resolved'"));
  assert.ok(server.includes("item.status !== 'resolved').length"));
  assert.ok(server.includes("'/contact-inbox/history'"));
  assert.ok(!server.includes('item.readAt = Date.now()'));
});

test('inbox uses in-forum modal dialogs and disables unavailable actions', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'templates/contact-inbox.tpl'), 'utf8');
  assert.ok(client.includes("className = 'modal fade ci-modal'"));
  assert.ok(client.includes("chat.disabled = !item.uid || !item.username"));
  assert.ok(client.includes("email.disabled = !settings || !settings.emailReplies || !settings.smtpConfigured"));
  assert.ok(template.includes('ci-history-button'));
  assert.ok(template.includes('ci-settings-button'));
  assert.ok(template.includes('ci-history-clear'));
});


test('write requests use NodeBB config CSRF token and modal closing supports Bootstrap versions', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  assert.ok(client.includes('window.config && window.config.csrf_token'));
  assert.ok(client.includes("fetch(rel + '/api/config'"));
  assert.ok(client.includes("opts.headers['x-csrf-token'] = await getCsrfToken()"));
  assert.ok(client.includes('function closeModal(wrap)'));
  assert.ok(client.includes('window.bootstrap.Modal.getInstance(wrap)'));
  assert.ok(client.includes("$(wrap).modal('hide')"));
});

test('inbox uses native NodeBB toast alerts and dedicated history/settings routes', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'templates/contact-inbox.tpl'), 'utf8');
  assert.ok(client.includes("amdRequire(['alerts']"));
  assert.ok(client.includes("window.location.assign(page + '/settings')"));
  assert.ok(client.includes("window.location.assign(page + (view === 'active' ? '/history' : ''))"));
  assert.ok(server.includes("setupPageRoute(router, '/plugins/contact-inbox/history'"));
  assert.ok(server.includes("setupPageRoute(router, '/plugins/contact-inbox/settings'"));
  assert.ok(template.includes('id="ci-settings-page"'));
  assert.ok(template.includes('id="ci-back-button"'));
});


test('manual deletion uses the explicit POST endpoint and confirms success', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
  assert.ok(client.includes("request('/submissions/' + encodeURIComponent(id) + '/delete', { method: 'POST', body: '{}' })"));
  assert.ok(server.includes("setupApiRoute(router, 'post', '/contact-inbox/submissions/:id/delete'"));
  assert.ok(client.includes('הפנייה נמחקה בהצלחה.'));
});

test('history clearing has an explicit POST endpoint', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
  assert.ok(client.includes("'/history/clear'"));
  assert.ok(server.includes("'/contact-inbox/history/clear'"));
});

test('forum navigation uses NodeBB native navigation hook and floating alerts module', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.ok(manifest.hooks.some(hook => hook.hook === 'filter:navigation.available' && hook.method === 'addNavigation'));
  assert.ok(server.includes("iconClass: 'fa-envelope-o'"));
  assert.ok(server.includes("id: 'contact-inbox-nav'"));
  assert.ok(client.includes("amdRequire(['alerts']"));
  assert.ok(client.includes("alerts.success(message, 5000)"));
  assert.ok(client.includes('function refreshNavigationIcon()'));
  assert.ok(client.includes("link.closest('li')"));
  assert.ok(client.includes("#logged-in-menu > li.chats, #chat_dropdown"));
  assert.ok(client.includes("link.id = 'contact-inbox-nav'"));
  assert.ok(client.includes("fa fa-envelope-o"));
  assert.ok(client.includes("chatItem.parentNode.insertBefore(navItem, chatItem)"));
});

test('successful status and retention actions display native success notifications', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  assert.ok(client.includes('הפנייה סומנה כטופלה והועברה להיסטוריה.'));
  assert.ok(client.includes('מדיניות שמירת ההיסטוריה נשמרה.'));
});


test('NodeBB native alerts are loaded through app.require and shown with alerts API', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  assert.ok(client.includes("amdRequire(['alerts']"));
  assert.ok(client.includes("alerts.error(message, 10000)"));
});

test('plugin ensures its navigation item is enabled in the live NodeBB menu', () => {
  const server = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
  assert.ok(server.includes("require.main.require('./src/navigation/admin')"));
  assert.ok(server.includes("navigationAdmin.save(navigationItems)"));
  assert.ok(server.includes("id: 'contact-inbox-nav'"));
});

test('manual deletion verifies that both the database record and sorted-set index are removed', () => {
  const server = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  assert.ok(server.includes('db.getObject(key(item.id))'));
  assert.ok(server.includes('db.isSortedSetMember(PREFIX + \'submissions\', item.id)'));
  assert.ok(server.includes('deleted: true, id: item.id'));
  assert.ok(client.includes('result.deleted !== true'));
  assert.ok(server.includes("'/contact-inbox/submissions/:id/delete'"));
});


test('history entries can be returned to the active inbox', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  assert.ok(client.includes('סמן כלא טופל'));
  assert.ok(client.includes("JSON.stringify({ status: 'new' })"));
});

test('staff notifications use the account email plus optional additional addresses', () => {
  const server = fs.readFileSync(path.join(root, 'library.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  assert.ok(server.includes("user.getUserField(Number(uid), 'email')"));
  assert.ok(server.includes('prefs.extraEmails'));
  assert.ok(server.includes("'/contact-inbox/groups'"));
  assert.ok(client.includes("request('/groups')"));
  assert.ok(client.includes('ci-groups-list'));
  assert.ok(client.includes('הוספת כתובת דוא״ל נוספת'));
  assert.ok(!client.includes('התראות דוא״ל לצוות'));
  assert.ok(!client.includes('כתובת לקבלת התראות'));
});

test('NodeBB native alerts module is loaded with the AMD require API', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  assert.ok(client.includes("amdRequire(['alerts']"));
});


test('navigation badge falls back to active submission count and remains visible', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  const scss = fs.readFileSync(path.join(root, 'public/lib/inbox.scss'), 'utf8');
  assert.ok(client.includes("request('/submissions?view=active')"));
  assert.ok(client.includes("badge.style.display = count === 0 ? 'none' : 'inline-block'"));
  assert.ok(scss.includes('.ci-nav-badge:not([hidden]){display:inline-block!important}'));
});

test('retention policy is edited in regular admin settings, not history tools', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'templates/contact-inbox.tpl'), 'utf8');
  assert.ok(client.includes('const retentionInput = el(\'input\', \'form-control\')'));
  assert.ok(client.includes('retentionDays: Number(f.retentionInput.value) || 0'));
  assert.ok(!template.includes('id="ci-retention-admin"'));
  assert.ok(!client.includes("getElementById('ci-retention-save')"));
});

test('deletion uses a direct confirmation and reports both success and failure', () => {
  const client = fs.readFileSync(path.join(root, 'public/lib/inbox.js'), 'utf8');
  assert.ok(client.includes("window.confirm('למחוק לצמיתות את הפנייה ואת כל התשובות שלה?')"));
  assert.ok(client.includes("method: 'POST', body: '{}'"));
  assert.ok(client.includes("await notify(err.message || 'מחיקת הפנייה נכשלה.', 'danger')"));
});
