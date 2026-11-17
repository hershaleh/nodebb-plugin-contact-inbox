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
  assert.ok(client.includes("view = 'active'"));
  assert.ok(client.includes("view === 'history'"));
  assert.ok(client.includes("request('/unread')"));
  assert.ok(client.includes("li.className = 'contact-inbox-nav'"));
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
