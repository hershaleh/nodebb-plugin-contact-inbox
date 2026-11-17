(function () {
  'use strict';
  if (window.__contactInboxLoaded) return;
  window.__contactInboxLoaded = true;

  const relativePath = (window.config && window.config.relative_path) || '';
  const API = relativePath + '/api/v3/plugins/contact-inbox';
  const page = relativePath + '/plugins/contact-inbox';

  async function request(path, options) {
    const opts = Object.assign({ credentials: 'same-origin' }, options || {});
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = document.querySelector('meta[name="csrf-token"]');
    if (token && opts.method && opts.method !== 'GET') opts.headers['x-csrf-token'] = token.content;
    const response = await fetch(API + path, opts);
    const raw = await response.json().catch(() => ({}));
    const data = raw && raw.response && typeof raw.response === 'object' ? raw.response : raw;
    if (!response.ok) throw new Error(data.error || raw.error || (raw.status && raw.status.message) || 'הפעולה נכשלה');
    return data;
  }

  function addTopbarIcon() {
    const nav = document.querySelector('#main-nav .navbar-nav, #header .navbar-nav, .navbar .navbar-nav, [component="navbar"] .navbar-nav');
    if (!nav || document.getElementById('contact-inbox-nav')) return;
    const item = document.createElement('li');
    item.id = 'contact-inbox-nav';
    item.className = 'contact-inbox-nav';
    item.hidden = true;
    const link = document.createElement('a');
    link.href = page;
    link.title = 'תיבת פניות';
    link.setAttribute('aria-label', 'תיבת פניות');
    link.innerHTML = '<i class="fa fa-envelope" aria-hidden="true"></i><span class="ci-nav-badge" hidden aria-label="פניות שלא נקראו"></span>';
    item.appendChild(link);
    const nearby = nav.querySelector('#chat-list, #notifications, [component="chat/list"], [component="notifications"], a[href*="/chats"], a[href*="/notifications"]');
    const nearbyItem = nearby && (nearby.closest('li') || nearby);
    if (nearbyItem && nearbyItem.parentNode === nav) nav.insertBefore(item, nearbyItem.nextSibling);
    else nav.appendChild(item);
    const badge = link.querySelector('.ci-nav-badge');
    async function refresh() {
      try {
        const data = await request('/unread');
        const count = Number(data.count) || 0;
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.hidden = count < 1;
        item.hidden = false;
      } catch (err) {
        if (/403|Forbidden|הרשאה|401/.test(err.message || '')) {
          item.remove();
          return;
        }
        // Keep the icon hidden until permissions have been confirmed by the server.
        console.warn('[contact-inbox] unread count unavailable:', err.message);
      }
    }
    refresh();
    window.addEventListener('contact-inbox:refresh-unread', refresh);
    window.setInterval(refresh, 30000);
  }

  function initInbox() {
    const root = document.querySelector('.contact-inbox-page');
    if (!root) return;
    const list = document.getElementById('ci-list');
    const detail = document.getElementById('ci-detail');
    const search = document.getElementById('ci-search');
    const status = document.getElementById('ci-status');
    const unread = document.getElementById('ci-unread');
    let activeId = null;
    let rows = [];
    let unreadCount = 0;

    function el(tag, cls, value) {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (value !== undefined) node.textContent = value;
      return node;
    }
    function date(value) {
      return new Date(value).toLocaleString('he-IL');
    }
    function renderList() {
      list.replaceChildren();
      unread.textContent = 'לא נקראו: ' + unreadCount;
      if (!rows.length) {
        list.append(el('p', 'text-muted', 'לא נמצאו פניות.'));
        return;
      }
      rows.forEach(item => {
        const button = el('button', 'ci-row' + (item.id === activeId ? ' active' : ''));
        button.type = 'button';
        const top = el('div', 'ci-row-top');
        top.append(el('strong', '', item.subject), el('small', '', date(item.createdAt)));
        button.append(top, el('div', 'ci-row-meta', item.name + ' · ' + item.email));
        button.append(el('p', 'ci-row-preview', item.message));
        if (!item.readAt) button.append(el('span', 'label label-primary', 'חדש'));
        button.addEventListener('click', () => openItem(item.id));
        list.append(button);
      });
    }
    async function load() {
      list.textContent = 'טוען פניות…';
      try {
        const params = new URLSearchParams({ q: search.value.trim(), status: status.value });
        const data = await request('/submissions?' + params);
        rows = data.submissions || [];
        unreadCount = Number(data.unreadCount) || 0;
        renderList();
      } catch (err) { list.textContent = err.message; }
    }
    async function openItem(id) {
      activeId = id;
      try {
        const data = await request('/submissions/' + encodeURIComponent(id));
        const item = data.submission;
        detail.replaceChildren();
        detail.append(el('h2', '', item.subject));
        detail.append(el('p', 'ci-muted', date(item.createdAt)));
        detail.append(el('p', '', 'שם: ' + item.name));
        detail.append(el('p', '', 'דוא״ל: ' + item.email));
        if (item.username) detail.append(el('p', '', 'משתמש: @' + item.username));
        detail.append(el('article', 'ci-message', item.message));
        if (item.uid) {
          const chat = el('button', 'btn btn-default', 'פתיחת צ׳אט עם המשתמש');
          chat.type = 'button';
          chat.addEventListener('click', async () => {
            chat.disabled = true;
            try {
              const result = await request('/submissions/' + encodeURIComponent(id) + '/chat', {
                method: 'POST',
                body: JSON.stringify({})
              });
              window.location.assign(result.url);
            } catch (err) {
              window.alert(err.message);
              chat.disabled = false;
            }
          });
          detail.append(chat);
        }
        const controls = el('div', 'ci-controls');
        const select = el('select', 'form-control');
        [['new','חדשה'],['in_progress','בטיפול'],['resolved','טופלה']].forEach(pair => {
          const option = el('option', '', pair[1]); option.value = pair[0]; option.selected = item.status === pair[0]; select.append(option);
        });
        const update = el('button', 'btn btn-primary', 'עדכון סטטוס');
        update.addEventListener('click', async () => {
          try { await request('/submissions/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ status: select.value }) }); await load(); }
          catch (err) { window.alert(err.message); }
        });
        controls.append(select, update);
        detail.append(controls);
        const history = el('div', 'ci-history');
        history.append(el('h3', '', 'היסטוריית תשובות'));
        (item.replies || []).forEach(reply => {
          const block = el('div', 'ci-reply');
          block.append(el('small', '', date(reply.createdAt) + (reply.channel === 'email' ? ' · דוא״ל' : ' · פנימי')), el('p', '', reply.message));
          history.append(block);
        });
        const textarea = el('textarea', 'form-control');
        textarea.rows = 4; textarea.placeholder = 'כתיבת תשובה פנימית…';
        const emailLabel = el('label', 'ci-email-reply-option');
        const emailCheck = el('input');
        emailCheck.type = 'checkbox';
        emailLabel.append(emailCheck, document.createTextNode(' שליחת התשובה גם לכתובת הדוא״ל של הפונה (אם האפשרות הופעלה בהגדרות)'));
        const replyButton = el('button', 'btn btn-primary', 'שמירת תשובה בהיסטוריה');
        replyButton.addEventListener('click', async () => {
          try {
            await request('/submissions/' + encodeURIComponent(id) + '/replies', { method: 'POST', body: JSON.stringify({ message: textarea.value, sendEmail: emailCheck.checked }) });
            await openItem(id);
          } catch (err) { window.alert(err.message); }
        });
        history.append(textarea, emailLabel, replyButton);
        detail.append(history);
        const remove = el('button', 'btn btn-danger', 'מחיקת הפנייה');
        remove.addEventListener('click', async () => {
          if (!window.confirm('למחוק את הפנייה ואת היסטוריית התשובות שלה?')) return;
          try { await request('/submissions/' + encodeURIComponent(id), { method: 'DELETE' }); activeId = null; detail.textContent = 'הפנייה נמחקה.'; await load(); }
          catch (err) { window.alert(err.message); }
        });
        detail.append(remove);
        await load();
        window.dispatchEvent(new Event('contact-inbox:refresh-unread'));
      } catch (err) { detail.textContent = err.message; }
    }

    document.getElementById('ci-refresh').addEventListener('click', load);
    search.addEventListener('keydown', event => { if (event.key === 'Enter') load(); });
    status.addEventListener('change', load);

    const prefsMessage = document.getElementById('ci-prefs-message');
    request('/preferences').then(data => {
      document.getElementById('ci-notify').checked = !!data.preferences.notify;
      document.getElementById('ci-staff-email').value = data.preferences.email || '';
    }).catch(err => { prefsMessage.textContent = err.message; });
    document.getElementById('ci-save-prefs').addEventListener('click', async () => {
      try {
        await request('/preferences', { method: 'PUT', body: JSON.stringify({
          notify: document.getElementById('ci-notify').checked,
          email: document.getElementById('ci-staff-email').value
        }) });
        prefsMessage.textContent = 'ההעדפות נשמרו.';
      } catch (err) { prefsMessage.textContent = err.message; }
    });

    const adminSettings = document.getElementById('ci-admin-settings');
    request('/settings').then(data => {
      const cfg = data.settings;
      adminSettings.hidden = false;
      document.getElementById('ci-groups').value = (cfg.allowedGroups || ['administrators']).join(', ');
      document.getElementById('ci-retention').value = cfg.retentionDays || 0;
      document.getElementById('ci-rate').value = cfg.maxPerHour || 5;
      document.getElementById('ci-email-notifications').checked = !!cfg.emailNotifications;
      document.getElementById('ci-email-replies').checked = !!cfg.emailReplies;
      document.getElementById('ci-smtp-note').textContent = data.smtpConfigured
        ? 'SMTP וכתובת שולח פעילים לפי הגדרות NodeBB.'
        : 'SMTP או כתובת השולח אינם מוגדרים. שליחת תשובות בדוא״ל תישאר מושבתת עד להגדרת שניהם.';
    }).catch(() => {});
    document.getElementById('ci-save-settings').addEventListener('click', async () => {
      const message = document.getElementById('ci-settings-message');
      try {
        await request('/settings', { method: 'PUT', body: JSON.stringify({
          allowedGroups: document.getElementById('ci-groups').value.split(',').map(v => v.trim()).filter(Boolean),
          retentionDays: Number(document.getElementById('ci-retention').value),
          maxPerHour: Number(document.getElementById('ci-rate').value),
          emailNotifications: document.getElementById('ci-email-notifications').checked,
          emailReplies: document.getElementById('ci-email-replies').checked
        }) });
        message.textContent = 'ההגדרות נשמרו.';
      } catch (err) { message.textContent = err.message; }
    });
    load();
  }

  function start() {
    addTopbarIcon();
    initInbox();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  if (window.jQuery) window.jQuery(window).on('action:ajaxify.end', start);
}());
