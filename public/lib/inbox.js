(function () {
  'use strict';
  if (window.__contactInboxLoaded) return;
  window.__contactInboxLoaded = true;
  const rel = (window.config && window.config.relative_path) || '';
  const API = rel + '/api/v3/plugins/contact-inbox';
  const page = rel + '/plugins/contact-inbox';
  const $ = window.jQuery;

  let csrfToken = window.config && window.config.csrf_token;

  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    const response = await fetch(rel + '/api/config', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const config = await response.json().catch(() => ({}));
    csrfToken = config.csrf_token || (config.response && config.response.csrf_token) || '';
    if (!csrfToken) throw new Error('לא ניתן לקבל אסימון אבטחה מ-NodeBB. יש לרענן את הדף ולהתחבר מחדש.');
    return csrfToken;
  }

  async function request(path, options) {
    const opts = Object.assign({ credentials: 'same-origin' }, options || {});
    const method = String(opts.method || 'GET').toUpperCase();
    opts.headers = Object.assign({ 'Content-Type': 'application/json', 'Accept': 'application/json' }, opts.headers || {});
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      opts.headers['x-csrf-token'] = await getCsrfToken();
    }
    const response = await fetch(API + path, opts);
    const bodyText = await response.text();
    let raw = {};
    try { raw = bodyText ? JSON.parse(bodyText) : {}; } catch (_) { raw = { error: bodyText.slice(0, 500) }; }
    const data = raw && raw.response && typeof raw.response === 'object' ? raw.response : raw;
    if (!response.ok) {
      const message = (raw.status && raw.status.message) || (data.status && data.status.message) ||
        data.error || raw.error || ('שגיאת שרת (' + response.status + ')');
      throw new Error(message);
    }
    if (raw.status && raw.status.code && raw.status.code !== 'ok') {
      throw new Error(raw.status.message || 'הפעולה נכשלה');
    }
    return data;
  }

  async function refreshNavigationIcon() {
    const item = document.getElementById('contact-inbox-nav');
    if (!item) return;
    const link = item.querySelector('a');
    if (!link) return;
    let badge = link.querySelector('.ci-nav-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ci-nav-badge';
      badge.hidden = true;
      link.appendChild(badge);
    }
    try {
      const result = await request('/unread');
      const count = Number(result.count) || 0;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
      item.hidden = false;
    } catch (err) {
      if (/403|forbidden|הרשאה|401/i.test(err.message)) item.hidden = true;
    }
  }

  async function notify(message, type) {
    try {
      if (typeof window.require === 'function') {
        const alerts = await new Promise((resolve, reject) => {
          window.require(['alerts'], resolve, reject);
        });
        if (type === 'success' && typeof alerts.success === 'function') return alerts.success(message);
        if ((type === 'danger' || type === 'error') && typeof alerts.error === 'function') return alerts.error(message);
        if (type === 'warning' && typeof alerts.warning === 'function') return alerts.warning(message);
        if (typeof alerts.info === 'function') return alerts.info(message);
      }
    } catch (err) {
      // Fall back to a local toast if the NodeBB alerts module is unavailable.
    }
    let host = document.getElementById('ci-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ci-toast-host';
      host.className = 'ci-toast-host';
      document.body.appendChild(host);
    }
    const note = document.createElement('div');
    note.className = 'alert alert-' + (type || 'info') + ' ci-toast';
    note.setAttribute('role', 'status');
    note.textContent = message;
    host.appendChild(note);
    window.setTimeout(() => note.remove(), 5000);
  }

  function modal(title, bodyNode, buttons) {
    const wrap = document.createElement('div');
    wrap.className = 'modal fade ci-modal';
    wrap.tabIndex = -1;
    wrap.innerHTML = '<div class="modal-dialog"><div class="modal-content"><div class="modal-header"><button type="button" class="close" data-dismiss="modal" data-bs-dismiss="modal" aria-label="סגירה"><span aria-hidden="true">&times;</span></button><h4 class="modal-title"></h4></div><div class="modal-body"></div><div class="modal-footer"></div></div></div>';
    wrap.querySelector('.modal-title').textContent = title;
    wrap.querySelector('.modal-body').appendChild(bodyNode);
    const footer = wrap.querySelector('.modal-footer');
    (buttons || []).forEach(spec => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn ' + (spec.className || 'btn-default'); b.textContent = spec.label;
      b.addEventListener('click', async () => {
        if (spec.onClick) await spec.onClick(wrap, b);
      });
      footer.appendChild(b);
    });
    document.body.appendChild(wrap);
    const close = () => closeModal(wrap);
    if (window.bootstrap && window.bootstrap.Modal) {
      wrap.addEventListener('hidden.bs.modal', () => wrap.remove(), { once: true });
      window.bootstrap.Modal.getOrCreateInstance(wrap, { backdrop: 'static', keyboard: true }).show();
    } else if ($ && $.fn && $.fn.modal) {
      $(wrap).on('hidden.bs.modal', () => wrap.remove()).modal({ backdrop: 'static', keyboard: true, show: true });
    } else {
      wrap.classList.add('in'); wrap.style.display = 'block';
      wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
      wrap.querySelector('[data-dismiss="modal"]').addEventListener('click', close);
    }
    return { element: wrap, close };
  }

  function closeModal(wrap) {
    if (!wrap) return;
    if (window.bootstrap && window.bootstrap.Modal) {
      const instance = window.bootstrap.Modal.getInstance(wrap);
      if (instance) { instance.hide(); return; }
    }
    if ($ && $.fn && $.fn.modal) { $(wrap).modal('hide'); return; }
    wrap.remove();
  }

  function initInbox() {
    const root = document.querySelector('.contact-inbox-page');
    if (!root || root.dataset.initialized) return;
    root.dataset.initialized = '1';
    const list = document.getElementById('ci-list');
    const detail = document.getElementById('ci-detail');
    const search = document.getElementById('ci-search');
    const status = document.getElementById('ci-status');
    const count = document.getElementById('ci-count');
    const historyButton = document.getElementById('ci-history-button');
    const settingsButton = document.getElementById('ci-settings-button');
    const routePath = (window.location.pathname || '').replace(/\/+$/, '');
    const isSettingsPage = routePath.endsWith('/settings');
    let view = routePath.endsWith('/history') ? 'history' : 'active', activeId = null, settings = null, isAdmin = false;

    const el = (tag, cls, value) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (value !== undefined) node.textContent = value;
      return node;
    };
    const date = value => new Date(value).toLocaleString('he-IL');
    const field = (label, value, cls) => {
      const box = el('div', 'ci-detail-field ' + (cls || ''));
      box.append(el('div', 'ci-field-label', label), el('div', 'ci-field-value', value || '—'));
      return box;
    };
    function updateHeader(data) {
      count.textContent = view === 'active'
        ? 'פניות חדשות: ' + (Number(data.newCount) || 0)
        : 'בהיסטוריה: ' + (Number(data.historyCount) || 0);
      historyButton.textContent = view === 'active' ? 'היסטוריית פניות' : 'חזרה לפניות חדשות';
      historyButton.classList.toggle('active', view === 'history');
    }
    async function load() {
      list.textContent = 'טוען פניות…';
      try {
        const params = new URLSearchParams({ q: search.value.trim(), status: status.value, view });
        const data = await request('/submissions?' + params.toString());
        updateHeader(data);
        render(data.submissions || []);
      } catch (err) { list.textContent = err.message; }
    }
    function render(items) {
      list.replaceChildren();
      if (!items.length) {
        list.append(el('div', 'ci-empty', view === 'history' ? 'אין פניות בהיסטוריה.' : 'אין פניות חדשות.'));
        return;
      }
      items.forEach(item => {
        const button = el('button', 'ci-row' + (item.id === activeId ? ' active' : ''), '');
        button.type = 'button';
        const top = el('div', 'ci-row-top');
        top.append(el('strong', '', item.subject), el('small', '', date(item.createdAt)));
        button.append(top, el('div', 'ci-row-meta', item.name + ' · ' + item.email));
        button.append(el('p', 'ci-row-preview', item.message));
        if (item.status === 'in_progress') button.append(el('span', 'label label-info', 'בטיפול'));
        button.addEventListener('click', () => openItem(item.id));
        list.append(button);
      });
    }
    async function openItem(id) {
      activeId = id;
      try {
        const result = await request('/submissions/' + encodeURIComponent(id));
        const item = result.submission;
        detail.replaceChildren();
        detail.append(el('h2', 'ci-subject', item.subject));
        detail.append(field('פרטי הפונה', item.name + ' · ' + item.email, 'ci-person'));
        detail.append(field('תאריך קבלה', date(item.createdAt)));
        if (item.username) detail.append(field('חשבון בפורום', '@' + item.username));
        detail.append(field('תוכן הפנייה', item.message, 'ci-message-card'));
        if (item.replies && item.replies.length) {
          const history = el('section', 'ci-replies');
          history.append(el('h3', '', 'תשובות קודמות'));
          item.replies.forEach(reply => {
            const card = el('article', 'ci-reply');
            card.append(el('small', '', date(reply.createdAt) + (reply.channel === 'email' ? ' · נשלח בדוא״ל' : ' · תשובה פנימית')));
            card.append(el('p', '', reply.message)); history.append(card);
          });
          detail.append(history);
        }
        const actions = el('div', 'ci-actions');
        const chat = el('button', 'btn btn-default', 'התחלת צ׳אט עם המשתמש');
        chat.type = 'button'; chat.disabled = !item.uid || !item.username;
        chat.title = chat.disabled ? 'הפנייה לא משויכת לחשבון משתמש בפורום' : '';
        chat.addEventListener('click', async () => {
          chat.disabled = true;
          try {
            const data = await request('/submissions/' + encodeURIComponent(id) + '/chat', { method: 'POST', body: '{}' });
            if (!data.url) throw new Error('לא התקבל קישור לצ׳אט');
            window.location.assign(data.url);
          } catch (err) { notify(err.message, 'danger'); chat.disabled = false; }
        });
        actions.append(chat);
        const email = el('button', 'btn btn-primary', 'שליחת תשובה מדוא״ל הפורום');
        email.type = 'button'; email.disabled = !settings || !settings.emailReplies || !settings.smtpConfigured;
        email.title = email.disabled ? 'יש להפעיל תשובות בדוא״ל ולהגדיר SMTP וכתובת שולח' : '';
        email.addEventListener('click', () => {
          const form = document.createElement('div');
          form.append(el('p', 'text-muted', 'התשובה תישלח אל: ' + item.email));
          const textarea = el('textarea', 'form-control'); textarea.rows = 6; textarea.placeholder = 'כתיבת תשובה…'; form.append(textarea);
          modal('שליחת תשובה בדוא״ל', form, [
            { label: 'ביטול', className: 'btn-default' },
            { label: 'שליחה', className: 'btn-primary', onClick: async (wrap, button) => {
              if (!textarea.value.trim()) { notify('יש לכתוב את תוכן התשובה.', 'warning'); return; }
              button.disabled = true;
              try {
                await request('/submissions/' + encodeURIComponent(id) + '/replies', { method: 'POST', body: JSON.stringify({ message: textarea.value, sendEmail: true }) });
                closeModal(wrap); await openItem(id); notify('התשובה נשלחה ונשמרה בהיסטוריה.', 'success');
              } catch (err) { notify(err.message, 'danger'); button.disabled = false; }
            }}
          ]);
        });
        actions.append(email);
        if (view === 'active') {
          const done = el('button', 'btn btn-success', 'סמן כטופל');
          done.type = 'button';
          done.addEventListener('click', async () => {
            done.disabled = true;
            try {
              await request('/submissions/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ status: 'resolved' }) });
              activeId = null; detail.replaceChildren(el('p', 'ci-empty', 'הפנייה הועברה להיסטוריה.')); await load(); await notify('הפנייה סומנה כטופלה והועברה להיסטוריה.', 'success');
              window.dispatchEvent(new Event('contact-inbox:refresh-unread'));
            } catch (err) { notify(err.message, 'danger'); done.disabled = false; }
          });
          actions.append(done);
        }
        const remove = el('button', 'btn btn-danger', 'מחיקת הפנייה');
        remove.type = 'button';
        remove.addEventListener('click', () => {
          const confirmText = el('p', '', 'למחוק לצמיתות את הפנייה ואת כל התשובות שלה?');
          modal('אישור מחיקת פנייה', confirmText, [
            { label: 'ביטול', className: 'btn-default' },
            { label: 'מחיקה לצמיתות', className: 'btn-danger', onClick: async (wrap, button) => {
              button.disabled = true;
              try {
                await request('/submissions/' + encodeURIComponent(id) + '/delete', { method: 'POST', body: '{}' });
                closeModal(wrap); activeId = null; detail.replaceChildren(el('p', 'ci-empty', 'הפנייה נמחקה.')); await load(); await notify('הפנייה נמחקה בהצלחה.', 'success');
                window.dispatchEvent(new Event('contact-inbox:refresh-unread'));
              } catch (err) { notify(err.message, 'danger'); button.disabled = false; }
            }}
          ]);
        });
        actions.append(remove); detail.append(actions);
        await load();
      } catch (err) { detail.textContent = err.message; }
    }

    historyButton.addEventListener('click', () => {
      window.location.assign(page + (view === 'active' ? '/history' : ''));
    });
    document.getElementById('ci-back-button').addEventListener('click', () => {
      window.location.assign(page);
    });
    document.getElementById('ci-refresh').addEventListener('click', load);
    search.addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
    status.addEventListener('change', load);

    async function loadSettings() {
      const caps = await request('/capabilities');
      settings = { emailReplies: !!caps.emailReplies, smtpConfigured: !!caps.smtpConfigured };
      isAdmin = !!caps.isAdmin;
      if (isAdmin) {
        const data = await request('/settings');
        settings = Object.assign(data.settings, { smtpConfigured: !!data.smtpConfigured });
      }
    }
    settingsButton.addEventListener('click', () => {
      window.location.assign(page + '/settings');
    });

    async function renderSettingsPage() {
      const inboxPage = document.getElementById('ci-inbox-page');
      const settingsPage = document.getElementById('ci-settings-page');
      if (!settingsPage) return;
      if (inboxPage) inboxPage.hidden = true;
      settingsPage.hidden = false;
      root.querySelector('h1').textContent = 'הגדרות תיבת הפניות';
      historyButton.hidden = true;
      settingsButton.hidden = true;
      document.getElementById('ci-back-button').hidden = false;
      const content = document.getElementById('ci-settings-content');
      content.replaceChildren(el('p', '', 'טוען הגדרות…'));
      await loadSettings();
      const form = el('div', 'ci-settings-form');
      if (isAdmin) {
        const groupsLabel = el('label', '', 'קבוצות מורשות (שמות מופרדים בפסיקים)');
        const groupsInput = el('input', 'form-control'); groupsInput.value = (settings.allowedGroups || ['administrators']).join(', ');
        const rateLabel = el('label', '', 'מספר פניות מרבי מכתובת IP בשעה');
        const rateInput = el('input', 'form-control'); rateInput.type = 'number'; rateInput.min = '1'; rateInput.max = '30'; rateInput.value = settings.maxPerHour || 5;
        const notifyLabel = el('label', 'checkbox', 'התראות דוא״ל לצוות'); const notifyInput = el('input'); notifyInput.type = 'checkbox'; notifyInput.checked = !!settings.emailNotifications; notifyLabel.prepend(notifyInput);
        const repliesLabel = el('label', 'checkbox', 'אפשר שליחת תשובות בדוא״ל'); const repliesInput = el('input'); repliesInput.type = 'checkbox'; repliesInput.checked = !!settings.emailReplies; repliesLabel.prepend(repliesInput);
        form.append(el('h3', '', 'הגדרות מנהל'), groupsLabel, groupsInput, rateLabel, rateInput, notifyLabel, repliesLabel,
          el('p', 'text-muted', settings.smtpConfigured ? 'SMTP וכתובת השולח מוגדרים.' : 'SMTP או כתובת השולח אינם מוגדרים; שליחת תשובות לא תהיה זמינה.'));
        form.dataset.adminSettings = '1';
        form._adminFields = { groupsInput, rateInput, notifyInput, repliesInput };
      }
      const prefs = el('section', 'ci-personal-prefs');
      prefs.append(el('h3', '', 'העדפות התראות אישיות'));
      const personalEmail = el('input', 'form-control'); personalEmail.type = 'email'; personalEmail.placeholder = 'כתובת לקבלת התראות';
      const personalNotify = el('input'); personalNotify.type = 'checkbox';
      const personalLabel = el('label', '', 'שליחת התראה אליי כשמתקבלת פנייה חדשה'); personalLabel.prepend(personalNotify);
      prefs.append(personalEmail, personalLabel); form.append(prefs);
      const p = await request('/preferences');
      personalEmail.value = p.preferences.email || ''; personalNotify.checked = !!p.preferences.notify;
      const save = el('button', 'btn btn-primary', 'שמירת הגדרות'); save.type = 'button';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await request('/preferences', { method: 'PUT', body: JSON.stringify({ email: personalEmail.value, notify: personalNotify.checked }) });
          if (isAdmin && form._adminFields) {
            const f = form._adminFields;
            await request('/settings', { method: 'PUT', body: JSON.stringify({
              allowedGroups: f.groupsInput.value.split(',').map(v => v.trim()).filter(Boolean),
              maxPerHour: Number(f.rateInput.value), retentionDays: Number(settings.retentionDays) || 0,
              emailNotifications: f.notifyInput.checked, emailReplies: f.repliesInput.checked
            }) });
          }
          await notify('ההגדרות נשמרו.', 'success');
        } catch (err) { await notify(err.message, 'danger'); }
        finally { save.disabled = false; }
      });
      form.append(save);
      content.replaceChildren(form);
    }
    document.getElementById('ci-history-clear').addEventListener('click', () => {
      modal('מחיקת היסטוריית הפניות', el('p', '', 'למחוק לצמיתות את כל הפניות שסומנו כטופלו ואת היסטוריית התשובות שלהן?'), [
        { label: 'ביטול', className: 'btn-default' },
        { label: 'מחיקת כל ההיסטוריה', className: 'btn-danger', onClick: async (wrap, button) => {
          button.disabled = true;
          try { const result = await request('/history/clear', { method: 'POST', body: '{}' }); closeModal(wrap); notify('נמחקו ' + result.deleted + ' פניות מההיסטוריה.', 'success'); await load(); window.dispatchEvent(new Event('contact-inbox:refresh-unread')); }
          catch (err) { notify(err.message, 'danger'); button.disabled = false; }
        }}
      ]);
    });
    document.getElementById('ci-retention-save').addEventListener('click', async () => {
      const msg = document.getElementById('ci-retention-message');
      try {
        await loadSettings();
        if (!isAdmin) throw new Error('רק מנהל ראשי יכול לשנות את מדיניות השמירה.');
        await request('/settings', { method: 'PUT', body: JSON.stringify({
          allowedGroups: settings.allowedGroups || ['administrators'],
          maxPerHour: settings.maxPerHour || 5,
          retentionDays: Number(document.getElementById('ci-retention').value),
          emailNotifications: !!settings.emailNotifications, emailReplies: !!settings.emailReplies
        }) });
        msg.textContent = 'מדיניות השמירה נשמרה.'; await notify('מדיניות שמירת ההיסטוריה נשמרה.', 'success');
      } catch (err) { msg.textContent = err.message; }
    });
    if (isSettingsPage) {
      renderSettingsPage().catch(err => { document.getElementById('ci-settings-content').textContent = err.message; });
    } else {
      document.getElementById('ci-history-tools').hidden = view !== 'history';
      document.getElementById('ci-history-button').textContent = view === 'history' ? 'חזרה לפניות פעילות' : 'היסטוריית פניות';
      document.getElementById('ci-back-button').hidden = true;
      loadSettings().then(() => {
        if (isAdmin && document.getElementById('ci-retention')) {
          document.getElementById('ci-retention').value = settings.retentionDays || 0;
          document.getElementById('ci-retention-admin').hidden = false;
        }
      }).catch(err => notify(err.message, 'danger'));
      load();
    }
  }

  function start() { refreshNavigationIcon(); initInbox(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  if ($) $(window).on('action:ajaxify.end', start);
  window.addEventListener('contact-inbox:refresh-unread', refreshNavigationIcon);
  if (!window.__ciNavRefreshTimer) window.__ciNavRefreshTimer = window.setInterval(refreshNavigationIcon, 30000);
  const observer = new MutationObserver(() => { const item = document.getElementById('contact-inbox-nav'); if (item && !item.querySelector('.ci-nav-badge')) refreshNavigationIcon(); });
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
}());