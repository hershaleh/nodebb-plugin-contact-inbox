'use strict';

const crypto = require('crypto');

const ID = 'contact-inbox';
const PREFIX = 'plugin:contact-inbox:';
const DEFAULTS = Object.freeze({
  allowedGroups: ['administrators'],
  retentionDays: 0,
  maxPerHour: 5,
  emailNotifications: false,
  emailReplies: false,
});
let db, user, groups, meta, routeHelpers, apiHelpers, emailer, retentionTimer;

const clean = (value, max) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const id = () => crypto.randomBytes(16).toString('hex');
const key = submissionId => PREFIX + 'submission:' + submissionId;
const send = (res, status, data) => {
  if (apiHelpers && typeof apiHelpers.formatApiResponse === 'function') {
    if (status >= 400) return apiHelpers.formatApiResponse(status, res, new Error(data.error || '[[error:invalid-data]]'));
    return apiHelpers.formatApiResponse(status, res, data);
  }
  return res.status(status).json(data);
};

async function config() {
  const saved = await meta.settings.get(ID) || {};
  return {
    ...DEFAULTS,
    ...saved,
    allowedGroups: Array.isArray(saved.allowedGroups) && saved.allowedGroups.length ? saved.allowedGroups : ['administrators'],
    retentionDays: Math.max(0, Math.min(3650, Number(saved.retentionDays) || 0)),
    maxPerHour: Math.max(1, Math.min(30, Number(saved.maxPerHour) || 5)),
  };
}

async function hasAccess(uid) {
  if (!uid || uid < 1) return false;
  const cfg = await config();
  if (cfg.allowedGroups.includes('administrators') && await user.isAdministrator(uid)) return true;
  if (cfg.allowedGroups.includes('Global Moderators') && await user.isGlobalModerator(uid)) return true;
  for (const groupName of cfg.allowedGroups) {
    if (groupName === 'administrators' || groupName === 'Global Moderators') continue;
    if (groups && typeof groups.isMember === 'function' && await groups.isMember(uid, groupName)) return true;
  }
  return false;
}

async function staffOnly(req, res, next) {
  try {
    if (!(await hasAccess(req.uid))) return send(res, 403, { error: 'אין הרשאה לתיבת הפניות' });
    return next();
  } catch (err) { return next(err); }
}

async function get(idValue) {
  if (!/^[a-f0-9]{32}$/.test(String(idValue))) return null;
  return db.getObject(key(idValue));
}

async function all() {
  const ids = await db.getSortedSetRevRange(PREFIX + 'submissions', 0, -1);
  if (!ids.length) return [];
  const values = await Promise.all(ids.map(get));
  const cfg = await config();
  const cutoff = cfg.retentionDays ? Date.now() - cfg.retentionDays * 86400000 : 0;
  const kept = [];
  for (const item of values) {
    if (!item || item.deletedAt) continue;
    if (cutoff && item.createdAt < cutoff) {
      await db.delete(key(item.id));
      await db.sortedSetRemove(PREFIX + 'submissions', item.id);
    } else {
      kept.push(item);
    }
  }
  return kept;
}

async function countUnread() {
  return (await all()).filter(item => !item.readAt).length;
}

async function notifyStaff(submission) {
  const cfg = await config();
  if (!cfg.emailNotifications) return;
  try {
    const staffUids = new Set();
    for (const groupName of cfg.allowedGroups) {
      let members = [];
      if (groupName === 'administrators' && groups.getMembers) members = await groups.getMembers(groupName, 0, -1);
      else if (groupName === 'Global Moderators' && groups.getMembers) members = await groups.getMembers(groupName, 0, -1);
      else if (groups.getMembers) members = await groups.getMembers(groupName, 0, -1);
      members.forEach(uid => staffUids.add(String(uid)));
    }
    for (const uid of staffUids) {
      const prefs = await db.getObject(PREFIX + 'staff:' + uid) || {};
      if (!prefs.notify || !validEmail(prefs.email || '')) continue;
      await emailer.sendToEmail('contact-inbox-notification', prefs.email, null, {
        subject: submission.subject,
        name: submission.name,
        message: submission.message,
        inboxUrl: (meta.config.url || '').replace(/\/$/, '') + '/plugins/contact-inbox',
      });
    }
  } catch (err) {
    console.error('[contact-inbox] staff notification failed:', err.message);
  }
}

async function submit(req, res) {
  try {
    const body = req.body || {};
    const ip = clean(req.ip || req.socket?.remoteAddress || 'unknown', 100);
    const rateKey = PREFIX + 'rate:' + crypto.createHash('sha256').update(ip).digest('hex');
    const cfg = await config();
    const count = Number(await db.incrObjectField(rateKey, 'count'));
    if (count === 1) await db.expire(rateKey, 3600);
    if (count > cfg.maxPerHour) return send(res, 429, { error: 'נשלחו יותר מדי פניות. נסו שוב מאוחר יותר.' });

    const name = clean(body.name, 120);
    const email = clean(body.email, 254).toLowerCase();
    const subject = clean(body.subject, 180);
    const message = clean(body.message, 10000);
    if (name.length < 2 || !validEmail(email) || subject.length < 2 || message.length < 5) {
      return send(res, 400, { error: 'יש למלא שם, כתובת דוא״ל תקינה, נושא ותוכן פנייה.' });
    }
    // Associate a submission only with the authenticated sender; never trust a
    // public username field to create a chat shortcut to somebody else's account.
    const uid = Number(req.uid) > 0 ? Number(req.uid) : 0;
    const sender = uid ? await user.getUserFields(uid, ['username', 'userslug']) : {};
    const username = sender.username || '';
    const userslug = sender.userslug || '';
    const item = {
      id: id(), name, email, subject, message, username, uid, userslug,
      createdAt: Date.now(), readAt: 0, readBy: 0,
      status: 'new', replies: [], deletedAt: 0,
    };
    await db.setObject(key(item.id), item);
    await db.sortedSetAdd(PREFIX + 'submissions', item.createdAt, item.id);
    void notifyStaff(item);
    return send(res, 201, { success: true, id: item.id, message: 'הפנייה התקבלה בהצלחה.' });
  } catch (err) {
    console.error('[contact-inbox] submit failed:', err);
    return send(res, 500, { error: 'לא ניתן לשמור את הפנייה כרגע.' });
  }
}

async function list(req, res) {
  const items = await all();
  const q = clean(req.query.q, 120).toLocaleLowerCase();
  const status = clean(req.query.status, 30);
  const submissions = items.filter(item => {
    const text = [item.name, item.email, item.username, item.subject, item.message].join(' ').toLocaleLowerCase();
    return (!q || text.includes(q)) && (!status || status === 'all' || item.status === status);
  });
  return send(res, 200, { submissions, unreadCount: items.filter(item => !item.readAt).length });
}

async function detail(req, res) {
  const item = await get(req.params.id);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה' });
  if (!item.readAt) {
    item.readAt = Date.now();
    item.readBy = Number(req.uid);
    await db.setObject(key(item.id), item);
  }
  return send(res, 200, { submission: item });
}

async function update(req, res) {
  const item = await get(req.params.id);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה' });
  const status = clean(req.body?.status, 30);
  if (!['new', 'in_progress', 'resolved'].includes(status)) return send(res, 400, { error: 'סטטוס לא תקין' });
  item.status = status;
  item.updatedAt = Date.now();
  await db.setObject(key(item.id), item);
  return send(res, 200, { success: true, submission: item });
}

async function remove(req, res) {
  const item = await get(req.params.id);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה' });
  // A manual delete is permanent: remove the submission and its reply history.
  await db.delete(key(item.id));
  await db.sortedSetRemove(PREFIX + 'submissions', item.id);
  return send(res, 200, { success: true });
}

async function reply(req, res) {
  const item = await get(req.params.id);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה' });
  const message = clean(req.body?.message, 10000);
  if (!message) return send(res, 400, { error: 'יש להזין תוכן לתשובה' });
  const cfg = await config();
  const sendEmail = req.body?.sendEmail === true;
  if (sendEmail) {
    if (!cfg.emailReplies || !meta.config['email:smtpTransport:enabled']) {
      return send(res, 409, { error: 'יש להפעיל תחילה שליחת תשובות ולהגדיר SMTP בהגדרות הדוא״ל של NodeBB.' });
    }
    try {
      await emailer.sendToEmail('contact-inbox-reply', item.email, null, {
        subject: item.subject,
        name: item.name,
        message,
        siteTitle: meta.config.title || 'NodeBB',
      });
    } catch (err) {
      console.error('[contact-inbox] email reply failed:', err);
      return send(res, 502, { error: 'שליחת הדוא״ל נכשלה. התשובה לא נשמרה.' });
    }
  }
  const entry = { id: id(), message, staffUid: Number(req.uid), createdAt: Date.now(), channel: sendEmail ? 'email' : 'internal' };
  item.replies = Array.isArray(item.replies) ? item.replies : [];
  item.replies.push(entry);
  item.updatedAt = Date.now();
  await db.setObject(key(item.id), item);
  return send(res, 200, { success: true, reply: entry });
}

async function unread(req, res) {
  return send(res, 200, { count: await countUnread() });
}

async function saveStaffPrefs(req, res) {
  const email = clean(req.body?.email, 254).toLowerCase();
  const notify = req.body?.notify === true;
  if (notify && !validEmail(email)) return send(res, 400, { error: 'כתובת דוא״ל לא תקינה' });
  await db.setObject(PREFIX + 'staff:' + req.uid, { email, notify });
  return send(res, 200, { success: true });
}

async function getStaffPrefs(req, res) {
  const prefs = await db.getObject(PREFIX + 'staff:' + req.uid) || { email: '', notify: false };
  return send(res, 200, { preferences: prefs });
}

async function saveSettings(req, res) {
  if (!(await user.isAdministrator(req.uid))) return send(res, 403, { error: 'רק מנהל ראשי יכול לשנות הגדרות' });
  const body = req.body || {};
  const allowedGroups = Array.isArray(body.allowedGroups)
    ? [...new Set(body.allowedGroups.map(v => clean(v, 80)).filter(Boolean))].slice(0, 30)
    : ['administrators'];
  if (!allowedGroups.includes('administrators')) allowedGroups.unshift('administrators');
  const retentionDays = Math.max(0, Math.min(3650, Number(body.retentionDays) || 0));
  const maxPerHour = Math.max(1, Math.min(30, Number(body.maxPerHour) || 5));
  await meta.settings.set(ID, {
    allowedGroups,
    retentionDays,
    maxPerHour,
    emailNotifications: body.emailNotifications === true,
    emailReplies: body.emailReplies === true && !!meta.config['email:smtpTransport:enabled'],
  });
  return send(res, 200, { success: true });
}

async function getSettings(req, res) {
  if (!(await user.isAdministrator(req.uid))) return send(res, 403, { error: 'רק מנהל ראשי יכול לצפות בהגדרות' });
  return send(res, 200, { settings: await config(), smtpConfigured: !!meta.config['email:smtpTransport:enabled'] });
}

async function adminPage(req, res) {
  res.render('admin/plugins/contact-inbox', { title: 'תיבת פניות' });
}

async function init({ router }) {
  db = require.main.require('./src/database');
  user = require.main.require('./src/user');
  groups = require.main.require('./src/groups');
  meta = require.main.require('./src/meta');
  emailer = require.main.require('./src/emailer');
  routeHelpers = require.main.require('./src/routes/helpers');
  if (retentionTimer) clearInterval(retentionTimer);
  const runRetention = () => all().catch(err => console.error('[contact-inbox] retention cleanup failed:', err.message));
  void runRetention();
  retentionTimer = setInterval(runRetention, 60 * 60 * 1000);
  if (typeof retentionTimer.unref === 'function') retentionTimer.unref();
  routeHelpers.setupAdminPageRoute(router, '/admin/plugins/contact-inbox', [staffOnly], adminPage);
  routeHelpers.setupPageRoute(router, '/plugins/contact-inbox', [staffOnly], adminPage);
}

async function addRoutes({ router, middleware, helpers }) {
  apiHelpers = helpers;
  routeHelpers = routeHelpers || require.main.require('./src/routes/helpers');
  const publicMw = [middleware.applyCSRF];
  const staffMw = [staffOnly];
  const staffWriteMw = [staffOnly, middleware.applyCSRF];
  const adminMw = [staffOnly];
  routeHelpers.setupApiRoute(router, 'post', '/contact-inbox/submissions', publicMw, submit);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/submissions', staffMw, list);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/submissions/:id', staffMw, detail);
  routeHelpers.setupApiRoute(router, 'put', '/contact-inbox/submissions/:id', staffWriteMw, update);
  routeHelpers.setupApiRoute(router, 'delete', '/contact-inbox/submissions/:id', staffWriteMw, remove);
  routeHelpers.setupApiRoute(router, 'post', '/contact-inbox/submissions/:id/replies', staffWriteMw, reply);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/unread', staffMw, unread);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/preferences', staffMw, getStaffPrefs);
  routeHelpers.setupApiRoute(router, 'put', '/contact-inbox/preferences', staffWriteMw, saveStaffPrefs);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/settings', adminMw, getSettings);
  routeHelpers.setupApiRoute(router, 'put', '/contact-inbox/settings', [staffOnly, middleware.applyCSRF], saveSettings);
}

async function addAdminNavigation(header) {
  if (header && Array.isArray(header.plugins)) {
    header.plugins.push({ route: '/plugins/contact-inbox', icon: 'fa-envelope', name: 'תיבת פניות' });
  }
  return header;
}

module.exports = {
  init,
  addRoutes,
  addAdminNavigation,
  _test: { clean, validEmail },
};
