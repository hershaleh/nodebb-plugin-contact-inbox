'use strict';

const crypto = require('crypto');

const PLUGIN = 'contact-inbox';
const SUBMISSIONS = 'contact-inbox:submissions';
const RATE = 'contact-inbox:rate:';
const DEFAULTS = {
  allowedGroups: ['administrators'],
  emailNotifications: false,
  emailReplies: false,
  forumEmailConfigured: false,
  retentionDays: 0,
  maxPerHour: 5,
};

let db;
let user;
let meta;
let groups;
let middleware;
let plugins;
let translator;
let routeReady = false;

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function json(res, status, payload) {
  res.status(status).json(payload);
}

async function settings() {
  const stored = await meta.settings.get(PLUGIN) || {};
  return Object.assign({}, DEFAULTS, stored, {
    allowedGroups: Array.isArray(stored.allowedGroups) && stored.allowedGroups.length
      ? stored.allowedGroups : DEFAULTS.allowedGroups,
  });
}

async function canAccess(uid) {
  if (!uid) return false;
  const cfg = await settings();
  for (const group of cfg.allowedGroups) {
    if (await user.isInGroup(uid, group)) return true;
  }
  return false;
}

async function requireAccess(req, res, next) {
  try {
    if (!req.uid || !(await canAccess(req.uid))) {
      return json(res, 403, { error: 'אין הרשאה לצפות בתיבת הפניות' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

async function makeId() {
  return crypto.randomBytes(16).toString('hex');
}

async function saveSubmission(data) {
  const id = await makeId();
  const record = {
    id,
    name: data.name,
    email: data.email,
    username: data.username || '',
    uid: data.uid || 0,
    subject: data.subject,
    message: data.message,
    createdAt: Date.now(),
    readAt: 0,
    status: 'new',
    replies: [],
    deletedAt: 0,
  };
  await db.setObject(SUBMISSIONS + ':' + id, record);
  await db.sortedSetAdd(SUBMISSIONS, record.createdAt, id);
  return record;
}

async function getSubmission(id) {
  return db.getObject(SUBMISSIONS + ':' + id);
}

async function listSubmissions() {
  const ids = await db.getSortedSetRevRange(SUBMISSIONS, 0, -1);
  if (!ids || !ids.length) return [];
  const records = await Promise.all(ids.map(getSubmission));
  return records.filter(item => item && !item.deletedAt);
}

async function enforceRateLimit(req) {
  const cfg = await settings();
  const ip = clean((req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'), 80);
  const key = RATE + crypto.createHash('sha256').update(ip).digest('hex');
  const count = Number(await db.get(key)) || 0;
  if (count >= Number(cfg.maxPerHour || DEFAULTS.maxPerHour)) return false;
  await db.set(key, count + 1);
  await db.expire(key, 3600);
  return true;
}

async function submit(req, res) {
  try {
    if (!(await enforceRateLimit(req))) {
      return json(res, 429, { error: 'נשלחו יותר מדי פניות. נסו שוב מאוחר יותר.' });
    }
    const body = req.body || {};
    const name = clean(body.name, 120);
    const email = clean(body.email, 254).toLowerCase();
    const subject = clean(body.subject, 180);
    const message = clean(body.message, 10000);
    const username = clean(body.username, 80).replace(/^@/, '');
    if (name.length < 2 || !validEmail(email) || subject.length < 2 || message.length < 5) {
      return json(res, 400, { error: 'יש למלא שם, כתובת דוא״ל תקינה, נושא ותוכן פנייה.' });
    }
    let uid = 0;
    if (username) {
      const found = await user.getUserByUsername(username);
      if (found) uid = Number(found);
    }
    const record = await saveSubmission({ name, email, username, uid, subject, message });
    return json(res, 201, { success: true, id: record.id, message: 'הפנייה התקבלה בהצלחה.' });
  } catch (err) {
    console.error('[contact-inbox] submit failed:', err);
    return json(res, 500, { error: 'לא ניתן לשמור את הפנייה כרגע.' });
  }
}

async function list(req, res) {
  try {
    const items = await listSubmissions();
    const query = clean(req.query.q, 120).toLowerCase();
    const status = clean(req.query.status, 30);
    const filtered = items.filter(item => {
      const haystack = [item.name, item.email, item.username, item.subject, item.message].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (!status || status === 'all' || item.status === status);
    });
    return json(res, 200, { submissions: filtered });
  } catch (err) {
    return res.status(500).json({ error: 'שגיאה בטעינת הפניות' });
  }
}

async function detail(req, res) {
  try {
    const item = await getSubmission(clean(req.params.id, 64));
    if (!item || item.deletedAt) return json(res, 404, { error: 'הפנייה לא נמצאה' });
    if (!item.readAt) {
      item.readAt = Date.now();
      await db.setObject(SUBMISSIONS + ':' + item.id, item);
    }
    return json(res, 200, { submission: item });
  } catch (err) {
    return json(res, 500, { error: 'שגיאה בטעינת הפנייה' });
  }
}

async function update(req, res) {
  try {
    const item = await getSubmission(clean(req.params.id, 64));
    if (!item || item.deletedAt) return json(res, 404, { error: 'הפנייה לא נמצאה' });
    const status = clean((req.body || {}).status, 30);
    if (!['new', 'in_progress', 'resolved'].includes(status)) {
      return json(res, 400, { error: 'סטטוס לא תקין' });
    }
    item.status = status;
    item.updatedAt = Date.now();
    await db.setObject(SUBMISSIONS + ':' + item.id, item);
    return json(res, 200, { success: true, submission: item });
  } catch (err) {
    return json(res, 500, { error: 'לא ניתן לעדכן את הפנייה' });
  }
}

async function remove(req, res) {
  try {
    const item = await getSubmission(clean(req.params.id, 64));
    if (!item || item.deletedAt) return json(res, 404, { error: 'הפנייה לא נמצאה' });
    item.deletedAt = Date.now();
    await db.setObject(SUBMISSIONS + ':' + item.id, item);
    await db.sortedSetRemove(SUBMISSIONS, item.id);
    return json(res, 200, { success: true });
  } catch (err) {
    return json(res, 500, { error: 'לא ניתן למחוק את הפנייה' });
  }
}

async function addReply(req, res) {
  try {
    const item = await getSubmission(clean(req.params.id, 64));
    if (!item || item.deletedAt) return json(res, 404, { error: 'הפנייה לא נמצאה' });
    const text = clean((req.body || {}).message, 10000);
    if (text.length < 1) return json(res, 400, { error: 'יש להזין תוכן לתשובה' });
    const cfg = await settings();
    const sendEmail = Boolean((req.body || {}).sendEmail);
    if (sendEmail && (!cfg.emailReplies || !cfg.forumEmailConfigured)) {
      return json(res, 409, { error: 'שליחת תשובות בדוא״ל אינה מוגדרת עדיין' });
    }
    const reply = {
      id: await makeId(),
      message: text,
      staffUid: req.uid,
      createdAt: Date.now(),
      channel: 'internal',
    };
    item.replies = Array.isArray(item.replies) ? item.replies : [];
    item.replies.push(reply);
    item.updatedAt = Date.now();
    await db.setObject(SUBMISSIONS + ':' + item.id, item);
    return json(res, 200, {
      success: true,
      reply,
      note: sendEmail ? 'נשמרה התשובה. חיבור שליחת הדוא״ל יושלם לאחר הגדרת mailer.' : 'התשובה נשמרה בהיסטוריה.',
    });
  } catch (err) {
    return json(res, 500, { error: 'לא ניתן לשמור את התשובה' });
  }
}

async function unreadCount() {
  const items = await listSubmissions();
  return items.filter(item => !item.readAt).length;
}

async function adminPage(req, res) {
  res.render('admin/plugins/contact-inbox', {});
}

async function addRoutes(params) {
  if (routeReady || !params || !params.router) return params;
  const router = params.router;
  const csrf = middleware && middleware.applyCSRF ? middleware.applyCSRF : (req, res, next) => next();
  router.post('/api/plugins/contact-inbox/submissions', csrf, submit);
  router.get('/api/plugins/contact-inbox/submissions', requireAccess, list);
  router.get('/api/plugins/contact-inbox/submissions/:id', requireAccess, detail);
  router.patch('/api/plugins/contact-inbox/submissions/:id', requireAccess, csrf, update);
  router.delete('/api/plugins/contact-inbox/submissions/:id', requireAccess, csrf, remove);
  router.post('/api/plugins/contact-inbox/submissions/:id/replies', requireAccess, csrf, addReply);
  router.get('/admin/plugins/contact-inbox', requireAccess, adminPage);
  routeReady = true;
  return params;
}

function addAdminNavigation(header) {
  if (!header || !Array.isArray(header.plugins)) return header;
  header.plugins.push({
    route: '/plugins/contact-inbox',
    icon: 'fa-envelope',
    name: 'Contact Inbox',
  });
  return header;
}

function addNavigation(data) {
  if (!data || !Array.isArray(data.navigation)) return data;
  data.navigation.push({
    route: '/plugins/contact-inbox',
    name: 'תיבת פניות',
    icon: 'fa-envelope',
    order: 90,
  });
  return data;
}

async function init(params) {
  db = require.main.require('./src/database');
  user = require.main.require('./src/user');
  meta = require.main.require('./src/meta');
  groups = require.main.require('./src/groups');
  middleware = require.main.require('./src/middleware');
  plugins = require.main.require('./src/plugins');
  translator = require.main.require('./public/src/modules/translator');
  routeReady = false;
  return params;
}

module.exports = {
  init,
  addRoutes,
  addAdminNavigation,
  addNavigation,
  _test: { clean, validEmail },
};
