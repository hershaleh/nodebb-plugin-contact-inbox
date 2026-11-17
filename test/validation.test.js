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
