'use strict';

const crypto = require('crypto');

const ID = 'contact-inbox';
const PREFIX = 'plugin:contact-inbox:';
const DEFAULTS = Object.freeze({
  allowedGroups: ['administrators'],
  retentionDays: 0,
  maxPerHour: 5,
  notifySubmitter: false,
  submitterNotificationDelayMinutes: 5,
  notifyStaffInApp: false,
});
let db, user, groups, meta, routeHelpers, apiHelpers, emailer, retentionTimer, pendingNotificationTimer, notifications, processingNotifications = false;

const clean = (value, max) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const id = () => crypto.randomBytes(16).toString('hex');
const key = submissionId => PREFIX + 'submission:' + submissionId;
function mailConfigured() {
  // NodeBB's emailer supplies a default From address when email:from is empty.
  // Reuse the same enabled transport used for registration and password-reset emails.
  return Number(meta.config['email:smtpTransport:enabled']) === 1 && !!emailer && typeof emailer.sendToEmail === 'function';
}

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
    notifySubmitter: saved.notifySubmitter === true,
    submitterNotificationDelayMinutes: Math.max(1, Math.min(10080, Number(saved.submitterNotificationDelayMinutes) || 5)),
    notifyStaffInApp: saved.notifyStaffInApp === true,
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

// Public submissions must work for guests, whose CSRF token may not be
// available on custom pages. Authenticated users retain NodeBB CSRF checks;
// guest requests are restricted to the configured forum origin.
function publicSubmitProtection(middleware) {
  return function (req, res, next) {
    // Logged-in users must pass NodeBB's normal CSRF validation.
    if (Number(req.uid) > 0) return middleware.applyCSRF(req, res, next);

    const parseOrigin = value => {
      try {
        return new URL(String(value || '')).origin;
      } catch (err) {
        return '';
      }
    };

    // Prefer NodeBB's canonical URL. Some NodeBB runtime configurations do
    // not expose config.url through meta.config, so fall back to the actual
    // request host/protocol rather than rejecting every guest submission.
    const configuredOrigin = parseOrigin(meta && meta.config && meta.config.url);
    const requestHost = typeof req.get === 'function' ? req.get('host') : req.headers.host;
    const requestProtocol = req.protocol || (req.secure ? 'https' : 'http');
    const expectedOrigin = configuredOrigin || parseOrigin(requestProtocol + '://' + requestHost);

    const requestOrigin = parseOrigin(req.headers.origin) || parseOrigin(req.headers.referer);
    if (!expectedOrigin) {
      return send(res, 403, { error: 'לא ניתן לאמת את כתובת הפורום בבקשה זו.' });
    }
    if (!requestOrigin || requestOrigin !== expectedOrigin) {
      return send(res, 403, { error: 'שליחת פנייה מותרת רק מתוך אתר הפורום.' });
    }
    return next();
  };
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
    if (cutoff && item.status === 'resolved' && (item.updatedAt || item.createdAt) < cutoff) {
      await db.delete(key(item.id));
      await db.sortedSetRemove(PREFIX + 'submissions', item.id);
    } else {
      kept.push(item);
    }
  }
  return kept;
}

async function countUnread(uid) {
  const items = (await all()).filter(item => item.status !== 'resolved');
  if (!Number(uid) || Number(uid) < 1 || !items.length) return items.length;
  const ids = items.map(item => item.id);
  const readByUser = await db.isSortedSetMembers(PREFIX + 'staff:' + Number(uid) + ':read', ids);
  return readByUser.filter(isRead => !isRead).length;
}

async function notifyStaff(submission) {
  const cfg = await config();
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
      if (!prefs.notify) continue;
      const accountEmail = await user.getUserField(Number(uid), 'email');
      const recipients = [...new Set([accountEmail, ...(Array.isArray(prefs.extraEmails) ? prefs.extraEmails : [])].map(value => clean(value, 254).toLowerCase()).filter(validEmail))];
      for (const recipient of recipients) {
        await emailer.sendToEmail('contact-inbox-notification', recipient, null, {
          subject: submission.subject,
          name: submission.name,
          message: submission.message,
          inboxUrl: (meta.config.url || '').replace(/\/$/, '') + '/plugins/contact-inbox',
        });
      }
    }
  } catch (err) {
    console.error('[contact-inbox] staff notification failed:', err.message);
  }
}

async function notifyStaffInApp(submission, cfg) {
  try {
    const staffUids = new Set();
    for (const groupName of cfg.allowedGroups) {
      if (!groups || typeof groups.getMembers !== 'function') continue;
      const members = await groups.getMembers(groupName, 0, -1);
      members.forEach(uid => {
        const numericUid = Number(uid);
        if (Number.isInteger(numericUid) && numericUid > 0) staffUids.add(numericUid);
      });
    }
    const optedInUids = [];
    for (const uid of staffUids) {
      const prefs = await db.getObject(PREFIX + 'staff:' + uid) || {};
      // Preserve the previous administrator-wide setting for existing staff
      // until each person explicitly saves their own preference.
      const enabled = typeof prefs.notifyInForum === 'boolean'
        ? prefs.notifyInForum
        : cfg.notifyStaffInApp;
      if (enabled) optedInUids.push(uid);
    }
    if (!optedInUids.length) return;
    const nid = 'contact-inbox:new:' + submission.id;
    let notification = await notifications.get(nid);
    if (!notification) {
      notification = await notifications.create({
        nid,
        type: 'contact-inbox-new',
        bodyShort: 'התקבלה פנייה חדשה בתיבת הפניות.',
        from: 0,
        path: '/plugins/contact-inbox',
      });
    }
    if (notification) await notifications.push(notification, optedInUids);
  } catch (err) {
    console.error('[contact-inbox] staff in-app notification failed:', err.message);
  }
}

async function scheduleSubmitterNotification(submission, cfg) {
  if (!submission.uid || !cfg.notifySubmitter) return;
  const delayMinutes = Math.max(1, Math.min(10080, Number(cfg.submitterNotificationDelayMinutes) || 5));
  const dueAt = Date.now() + delayMinutes * 60000;
  const job = {
    id: submission.id,
    uid: Number(submission.uid),
    dueAt,
  };
  await db.setObject(PREFIX + 'pending-notification:' + submission.id, job);
  await db.sortedSetAdd(PREFIX + 'pending-notifications', dueAt, submission.id);
}

async function processPendingNotifications() {
  if (processingNotifications) return;
  processingNotifications = true;
  try {
    const dueIds = await db.getSortedSetRangeByScore(PREFIX + 'pending-notifications', 0, 49, '-inf', Date.now());
    for (const submissionId of dueIds) {
      const jobKey = PREFIX + 'pending-notification:' + submissionId;
      try {
        const job = await db.getObject(jobKey);
        if (!job || !Number(job.uid)) {
          await db.sortedSetRemove(PREFIX + 'pending-notifications', submissionId);
          await db.delete(jobKey);
          continue;
        }
        const nid = 'contact-inbox:received:' + submissionId;
        let notification = await notifications.get(nid);
        if (!notification) {
          notification = await notifications.create({
            nid,
            type: 'contact-inbox-received',
            bodyShort: 'פנייתך התקבלה. היא תיענה בהקדם.',
            from: 0,
            path: '/plugins/contact-inbox',
          });
        }
        if (notification) {
          const uid = Number(job.uid);
          const [alreadyUnread, alreadyRead] = await Promise.all([
            db.isSortedSetMember('uid:' + uid + ':notifications:unread', nid),
            db.isSortedSetMember('uid:' + uid + ':notifications:read', nid),
          ]);
          if (!alreadyUnread && !alreadyRead) await notifications.push(notification, [uid]);
        }
        await db.sortedSetRemove(PREFIX + 'pending-notifications', submissionId);
        await db.delete(jobKey);
      } catch (err) {
        // Keep the persistent job so the next scheduler tick can retry it.
        console.error('[contact-inbox] submitter notification failed:', submissionId, err.message);
      }
    }
  } finally {
    processingNotifications = false;
  }
}

async function addNotificationType(data) {
  data = data || {};
  data.types = Array.isArray(data.types) ? data.types : [];
  if (!data.types.includes('contact-inbox-received')) data.types.push('contact-inbox-received');
  if (!data.types.includes('contact-inbox-new')) data.types.push('contact-inbox-new');
  return data;
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
    void notifyStaffInApp(item, cfg);
    try {
      await scheduleSubmitterNotification(item, cfg);
    } catch (err) {
      console.error('[contact-inbox] could not schedule submitter notification:', err.message);
    }
    return send(res, 201, { success: true, id: item.id, message: 'הפנייה התקבלה בהצלחה.' });
  } catch (err) {
    console.error('[contact-inbox] submit failed:', err);
    return send(res, 500, { error: 'לא ניתן לשמור את הפנייה כרגע.' });
  }
}

async function list(req, res) {
  const items = await all();
  const q = clean(req.query.q, 120).toLocaleLowerCase();
  const view = clean(req.query.view, 20) || 'active';
  const status = clean(req.query.status, 30);
  const activeItems = items.filter(item => view === 'history' ? item.status === 'resolved' : item.status !== 'resolved');
  const readIds = Number(req.uid) > 0 && activeItems.length ? await db.isSortedSetMembers(PREFIX + 'staff:' + Number(req.uid) + ':read', activeItems.map(item => item.id)) : activeItems.map(() => false);
  const readState = new Map(activeItems.map((item, index) => [item.id, !!readIds[index]]));
  const submissions = activeItems.filter(item => {
    const text = [item.name, item.email, item.username, item.subject, item.message].join(' ').toLocaleLowerCase();
    return (status !== 'unread' || !readState.get(item.id)) && (!q || text.includes(q));
  });
  const submissionsWithReadState = submissions.map(item => ({ ...item, readByMe: !!readState.get(item.id) }));
  return send(res, 200, {
    submissions: submissionsWithReadState,
    newCount: await countUnread(req.uid),
    historyCount: items.filter(item => item.status === 'resolved').length,
  });
}

async function detail(req, res) {
  const item = await get(req.params.id);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה' });
  // Read state is private to the current staff member and does not change workflow status.
  const readByMe = Number(req.uid) > 0
    ? await db.isSortedSetMember(PREFIX + 'staff:' + Number(req.uid) + ':read', item.id)
    : false;
  return send(res, 200, { submission: { ...item, readByMe: !!readByMe } });
}

async function update(req, res) {
  const item = await get(req.params.id);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה' });
  const status = clean(req.body?.status, 30);
  if (!['new', 'in_progress', 'resolved'].includes(status)) return send(res, 400, { error: 'סטטוס לא תקין' });
  item.status = status;
  item.updatedAt = Date.now();
  await db.setObject(key(item.id), item);
  if (status !== 'resolved' && Number(req.uid) > 0) await db.sortedSetRemove(PREFIX + 'staff:' + Number(req.uid) + ':read', item.id);
  return send(res, 200, { success: true, submission: item });
}

async function clearHistory(req, res) {
  const items = (await all()).filter(item => item.status === 'resolved');
  for (const item of items) {
    await db.delete(key(item.id));
    await db.sortedSetRemove(PREFIX + 'submissions', item.id);
  }
  return send(res, 200, { success: true, deleted: items.length });
}


async function remove(req, res) {
  const submissionId = String(req.params.id || '');
  const item = await get(submissionId);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה או שכבר נמחקה' });

  // Remove both the record and its index entry, then verify both writes.
  // Returning success before verifying caused the UI to report a deletion
  // even if the record remained visible in the inbox.
  await db.delete(key(item.id));
  await db.sortedSetRemove(PREFIX + 'submissions', item.id);
  const [remainingRecord, indexStillContains] = await Promise.all([
    db.getObject(key(item.id)),
    db.isSortedSetMember(PREFIX + 'submissions', item.id),
  ]);
  const recordStillExists = !!remainingRecord;
  if (recordStillExists || indexStillContains) {
    console.error('[contact-inbox] deletion verification failed for submission:', item.id, {
      recordStillExists, indexStillContains,
    });
    throw new Error('המחיקה לא הושלמה במסד הנתונים. הפנייה לא סומנה כנמחקת.');
  }
  console.info('[contact-inbox] submission permanently deleted:', item.id);
  return send(res, 200, { success: true, deleted: true, id: item.id });
}

async function reply(req, res) {
  const item = await get(req.params.id);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה' });
  const message = clean(req.body?.message, 10000);
  if (!message) return send(res, 400, { error: 'יש להזין תוכן לתשובה' });
  const sendEmail = req.body?.sendEmail === true;
  if (sendEmail) {
    if (!mailConfigured()) {
      return send(res, 409, { error: 'שליחת דוא״ל אינה זמינה כרגע. יש להגדיר ולהפעיל SMTP בהגדרות הדוא״ל של NodeBB.' });
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

async function openChat(req, res) {
  const item = await get(req.params.id);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה' });
  if (!item.uid || !item.username || item.uid === Number(req.uid)) {
    return send(res, 409, { error: 'הפנייה אינה משויכת לחשבון משתמש אחר שאפשר לפתוח איתו צ׳אט.' });
  }
  try {
    const messaging = require.main.require('./src/messaging');
    if (typeof messaging.canMessageUser === 'function') {
      const allowed = await messaging.canMessageUser(Number(req.uid), Number(item.uid));
      if (allowed === false) return send(res, 403, { error: 'הגדרות הפורום אינן מאפשרות לשלוח למשתמש זה הודעה פרטית.' });
    }
    let roomId = await messaging.hasPrivateChat(Number(req.uid), Number(item.uid));
    if (!roomId) roomId = await messaging.newRoom(Number(req.uid), { uids: [Number(item.uid)] });
    if (!roomId) throw new Error('NodeBB לא החזיר מזהה חדר צ׳אט');
    const staffSlug = await user.getUserField(req.uid, 'userslug');
    const baseUrl = String(meta.config.url || '').replace(/\/$/, '');
    return send(res, 200, { url: baseUrl + '/user/' + encodeURIComponent(staffSlug) + '/chats/' + roomId });
  } catch (err) {
    return send(res, 403, { error: 'לא ניתן לפתוח צ׳אט עם המשתמש: ' + (err.message || 'אין הרשאה') });
  }
}

async function markSubmissionRead(req, res) {
  const item = await get(req.params.id);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה' });
  const uid = Number(req.uid);
  if (!Number.isInteger(uid) || uid < 1) return send(res, 403, { error: 'אין הרשאה לסמן פנייה כנקראה' });

  await db.sortedSetAdd(PREFIX + 'staff:' + uid + ':read', Date.now(), item.id);
  try {
    const nid = 'contact-inbox:new:' + item.id;
    await notifications.markRead(nid, uid);
    if (user.notifications && typeof user.notifications.pushCount === 'function') {
      user.notifications.pushCount(uid);
    }
  } catch (err) {
    console.error('[contact-inbox] could not mark matching NodeBB notification as read:', err.message);
  }
  return send(res, 200, { success: true, readByMe: true });
}

async function markSubmissionUnread(req, res) {
  const item = await get(req.params.id);
  if (!item || item.deletedAt) return send(res, 404, { error: 'הפנייה לא נמצאה' });
  const uid = Number(req.uid);
  if (!Number.isInteger(uid) || uid < 1) return send(res, 403, { error: 'אין הרשאה לסמן פנייה כלא נקראה' });
  await db.sortedSetRemove(PREFIX + 'staff:' + uid + ':read', item.id);
  return send(res, 200, { success: true, readByMe: false });
}

async function unread(req, res) {
  return send(res, 200, { count: await countUnread(req.uid) });
}

async function saveStaffPrefs(req, res) {
  const notify = req.body?.notify === true;
  const notifyInForum = req.body?.notifyInForum === true;
  const extraEmails = Array.isArray(req.body?.extraEmails)
    ? [...new Set(req.body.extraEmails.map(value => clean(value, 254).toLowerCase()).filter(Boolean))].slice(0, 20)
    : [];
  if (extraEmails.some(email => !validEmail(email))) return send(res, 400, { error: 'אחת מכתובות הדוא״ל הנוספות אינה תקינה' });
  const current = await db.getObject(PREFIX + 'staff:' + req.uid) || {};
  await db.setObject(PREFIX + 'staff:' + req.uid, { ...current, notify, notifyInForum, extraEmails });
  return send(res, 200, { success: true });
}

async function getStaffPrefs(req, res) {
  const prefs = await db.getObject(PREFIX + 'staff:' + req.uid) || {};
  const cfg = await config();
  const notifyInForum = typeof prefs.notifyInForum === 'boolean'
    ? prefs.notifyInForum
    : cfg.notifyStaffInApp;
  return send(res, 200, { preferences: {
    notify: !!prefs.notify,
    notifyInForum,
    extraEmails: Array.isArray(prefs.extraEmails) ? prefs.extraEmails : [],
  } });
}

async function getGroups(req, res) {
  const available = await groups.getNonPrivilegeGroups('groups:createtime', 0, -1, { ephemeral: false });
  const names = [...new Set(['administrators', 'Global Moderators', ...available.map(group => group && group.name).filter(Boolean)])];
  return send(res, 200, { groups: names });
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
  const submitterNotificationDelayMinutes = Math.max(1, Math.min(10080, Number(body.submitterNotificationDelayMinutes) || 5));
  const currentConfig = await config();
  await meta.settings.set(ID, {
    allowedGroups,
    retentionDays,
    maxPerHour,
    notifySubmitter: body.notifySubmitter === true,
    submitterNotificationDelayMinutes,
    // Keep the former global value only as a migration default for staff
    // members who have not yet saved their personal forum-notification choice.
    notifyStaffInApp: currentConfig.notifyStaffInApp,
  });
  return send(res, 200, { success: true });
}

async function getSettings(req, res) {
  if (!(await user.isAdministrator(req.uid))) return send(res, 403, { error: 'רק מנהל ראשי יכול לצפות בהגדרות' });
  return send(res, 200, { settings: await config(), smtpConfigured: mailConfigured() });
}

async function getCapabilities(req, res) {
  return send(res, 200, { smtpConfigured: mailConfigured(), isAdmin: await user.isAdministrator(req.uid) });
}

async function adminPage(req, res) {
  res.render('admin/plugins/contact-inbox', { title: 'תיבת פניות' });
}

async function forumPage(req, res) {
  res.render('contact-inbox', { title: 'תיבת פניות', inboxView: 'active' });
}

async function historyPage(req, res) {
  res.render('contact-inbox', { title: 'היסטוריית פניות', inboxView: 'history' });
}

async function settingsPage(req, res) {
  res.render('contact-inbox', { title: 'הגדרות תיבת הפניות', inboxView: 'settings' });
}

async function init({ router }) {
  db = require.main.require('./src/database');
  user = require.main.require('./src/user');
  groups = require.main.require('./src/groups');
  meta = require.main.require('./src/meta');
  emailer = require.main.require('./src/emailer');
  notifications = require.main.require('./src/notifications');
  routeHelpers = require.main.require('./src/routes/helpers');

  // filter:navigation.available only exposes choices in ACP; it does not
  // activate an item in the live header. Persist the plugin link in the
  // enabled navigation list so NodeBB renders it for staff.
  const navigationAdmin = require.main.require('./src/navigation/admin');
  const navigationItems = await navigationAdmin.get();
  let inboxNavigation = navigationItems.find(item => item.route === '/plugins/contact-inbox');
  const isNewNavigationItem = !inboxNavigation;
  const allowedGroups = (await config()).allowedGroups.map(name =>
    name === 'administrators' ? 'administrators' : String(name).toLowerCase().replace(/\\s+/g, '-')
  );
  if (isNewNavigationItem) {
    inboxNavigation = { enabled: true };
    navigationItems.push(inboxNavigation);
  }
  Object.assign(inboxNavigation, {
    enabled: true,
    route: '/plugins/contact-inbox',
    id: 'contact-inbox-nav',
    title: 'תיבת פניות',
    iconClass: 'fa-envelope',
    textClass: 'd-lg-none',
    text: 'תיבת פניות',
    groups: allowedGroups,
  });
  await navigationAdmin.save(navigationItems);

  if (retentionTimer) clearInterval(retentionTimer);
  if (pendingNotificationTimer) clearInterval(pendingNotificationTimer);
  const runRetention = () => all().catch(err => console.error('[contact-inbox] retention cleanup failed:', err.message));
  void runRetention();
  retentionTimer = setInterval(runRetention, 60 * 60 * 1000);
  if (typeof retentionTimer.unref === 'function') retentionTimer.unref();
  void processPendingNotifications().catch(err => console.error('[contact-inbox] notification scheduler failed:', err.message));
  pendingNotificationTimer = setInterval(() => {
    processPendingNotifications().catch(err => console.error('[contact-inbox] notification scheduler failed:', err.message));
  }, 15000);
  if (typeof pendingNotificationTimer.unref === 'function') pendingNotificationTimer.unref();
  routeHelpers.setupAdminPageRoute(router, '/admin/plugins/contact-inbox', [staffOnly], adminPage);
  routeHelpers.setupPageRoute(router, '/plugins/contact-inbox', [staffOnly], forumPage);
  routeHelpers.setupPageRoute(router, '/plugins/contact-inbox/history', [staffOnly], historyPage);
  routeHelpers.setupPageRoute(router, '/plugins/contact-inbox/settings', [staffOnly], settingsPage);
}

async function addRoutes({ router, middleware, helpers }) {
  apiHelpers = helpers;
  routeHelpers = routeHelpers || require.main.require('./src/routes/helpers');
  const publicMw = [publicSubmitProtection(middleware)];
  const staffMw = [staffOnly];
  const staffWriteMw = [staffOnly, middleware.applyCSRF];
  const adminMw = [staffOnly];
  routeHelpers.setupApiRoute(router, 'post', '/contact-inbox/submissions', publicMw, submit);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/submissions', staffMw, list);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/submissions/:id', staffMw, detail);
  routeHelpers.setupApiRoute(router, 'post', '/contact-inbox/submissions/:id/read', staffWriteMw, markSubmissionRead);
  routeHelpers.setupApiRoute(router, 'post', '/contact-inbox/submissions/:id/unread', staffWriteMw, markSubmissionUnread);
  routeHelpers.setupApiRoute(router, 'put', '/contact-inbox/submissions/:id', staffWriteMw, update);
  routeHelpers.setupApiRoute(router, 'delete', '/contact-inbox/submissions/:id', staffWriteMw, remove);
  routeHelpers.setupApiRoute(router, 'post', '/contact-inbox/submissions/:id/delete', staffWriteMw, remove);
  routeHelpers.setupApiRoute(router, 'delete', '/contact-inbox/history', staffWriteMw, clearHistory);
  routeHelpers.setupApiRoute(router, 'post', '/contact-inbox/history/clear', staffWriteMw, clearHistory);
  routeHelpers.setupApiRoute(router, 'post', '/contact-inbox/submissions/:id/replies', staffWriteMw, reply);
  routeHelpers.setupApiRoute(router, 'post', '/contact-inbox/submissions/:id/chat', staffWriteMw, openChat);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/unread', staffMw, unread);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/groups', adminMw, getGroups);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/preferences', staffMw, getStaffPrefs);
  routeHelpers.setupApiRoute(router, 'put', '/contact-inbox/preferences', staffWriteMw, saveStaffPrefs);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/settings', adminMw, getSettings);
  routeHelpers.setupApiRoute(router, 'get', '/contact-inbox/capabilities', staffMw, getCapabilities);
  routeHelpers.setupApiRoute(router, 'put', '/contact-inbox/settings', [staffOnly, middleware.applyCSRF], saveSettings);
}

async function addNavigation(items) {
  if (!Array.isArray(items)) return items;
  const route = '/plugins/contact-inbox';
  if (!items.some(item => item && item.route === route)) {
    items.push({
      id: 'contact-inbox',
      route,
      title: 'תיבת פניות',
      enabled: true,
      iconClass: 'fa-envelope-o',
      textClass: 'd-lg-none',
      text: 'תיבת פניות',
      groups: ['administrators'],
    });
  }
  return items;
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
  addNavigation,
  addNotificationType,
  _test: { clean, validEmail },
};
