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
    // NodeBB's vanilla header assigns this id to the <a>, not its wrapping <li>.
    const link = document.getElementById('contact-inbox-nav');
    if (!link) return;
    const navItem = link.closest('li') || link;

    // The chat control lives in #logged-in-menu, separate from #main-nav.
    // Move the inbox item into that same list immediately before the chat item.
    const chatItem = document.querySelector('#logged-in-menu > li.chats, #chat_dropdown')?.closest('li');
    if (chatItem && chatItem.parentNode && navItem.parentNode !== chatItem.parentNode) {
      chatItem.parentNode.insertBefore(navItem, chatItem);
    } else if (chatItem && chatItem.parentNode && navItem.nextSibling !== chatItem) {
      chatItem.parentNode.insertBefore(navItem, chatItem);
    }

    const anchor = link.matches('a') ? link : link.querySelector('a');
    if (!anchor) return;
    anchor.classList.add('ci-nav-anchor');
    let badge = anchor.querySelector('.ci-nav-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ci-nav-badge';
      badge.hidden = true;
      anchor.appendChild(badge);
    }
    try {
      const result = await request('/unread');
      const count = Number(result.count) || 0;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
      navItem.hidden = false;
    } catch (err) {
      if (/403|forbidden|הרשאה|401/i.test(err.message)) navItem.hidden = true;
    }
  }

  async function notify(message, type) {
    try {
      const show = alerts => {
        if (!alerts) return false;
        if (type === 'success' && typeof alerts.success === 'function') { alerts.success(message, 5000); return true; }
        if ((type === 'danger' || type === 'error') && typeof alerts.error === 'function') { alerts.error(message, 10000); return true; }
        if (type === 'warning' && typeof alerts.warning === 'function') { alerts.warning(message, 5000); return true; }
        if (typeof alerts.info === 'function') { alerts.info(message, 5000); return true; }
        return false;
      };
      // NodeBB 4.15 ships the AMD "alerts" module. Use its actual toaster API.
      if (typeof window.require === 'function') {
        const alerts = await new Promise((resolve, reject) => window.require(['alerts'], resolve, reject));
        if (show(alerts)) return;
      }
      if (window.app && typeof window.app.alert === 'function') {
        window.app.alert({ title: type === 'success' ? 'הצלחה' : 'הודעה', message, type: type === 'danger' ? 'danger' : type || 'info', timeout: 5000 });
        return;
      }
    } catch (err) {
      console.error('[contact-inbox] NodeBB toaster notification failed:', err);
    }
    console.error('[contact-inbox] Native NodeBB alerts module is unavailable:', message);
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
        if (view === 'history') {
          const reopen = el('button', 'btn btn-warning', 'סמן כלא טופל');
          reopen.type = 'button';
          reopen.addEventListener('click', async () => {
            reopen.disabled = true;
            try {
              await request('/submissions/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ status: 'new' }) });
              activeId = null;
              detail.replaceChildren(el('p', 'ci-empty', 'הפנייה הוחזרה לפניות הפעילות.'));
              await load();
              await notify('הפנייה סומנה כלא טופלה והוחזרה לפניות הפעילות.', 'success');
              window.dispatchEvent(new Event('contact-inbox:refresh-unread'));
            } catch (err) { await notify(err.message, 'danger'); reopen.disabled = false; }
          });
          actions.append(reopen);
        }
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
                const result = await request('/submissions/' + encodeURIComponent(id), { method: 'DELETE' });
                if (!result || result.success !== true || result.deleted !== true || result.id !== id) {
                  throw new Error('השרת לא אישר שהפנייה נמחקה בפועל.');
                }
                closeModal(wrap);
                activeId = null;
                detail.replaceChildren(el('p', 'ci-empty', 'הפנייה נמחקה.'));
                await load();
                await notify('הפנייה נמחקה בהצלחה.', 'success');
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
        const groupsLabel = el('label', '', 'קבוצות מורשות');
        const groupsWrap = el('div', 'ci-groups-list');
        const groupData = await request('/groups');
        const selected = new Set(settings.allowedGroups || ['administrators']);
        (groupData.groups || []).forEach(name => {
          const label = el('label', 'checkbox ci-group-option', name);
          const input = el('input');
          input.type = 'checkbox';
          input.value = name;
          input.checked = selected.has(name);
          label.prepend(input);
          groupsWrap.append(label);
        });
        const rateLabel = el('label', '', 'מספר פניות מרבי מכתובת IP בשעה');
        const rateInput = el('input', 'form-control'); rateInput.type = 'number'; rateInput.min = '1'; rateInput.max = '30'; rateInput.value = settings.maxPerHour || 5;
        const repliesLabel = el('label', 'checkbox', 'אפשר שליחת תשובות בדוא״ל'); const repliesInput = el('input'); repliesInput.type = 'checkbox'; repliesInput.checked = !!settings.emailReplies; repliesLabel.prepend(repliesInput);
        form.append(el('h3', '', 'הגדרות מנהל'), groupsLabel, groupsWrap, rateLabel, rateInput, repliesLabel,
          el('p', 'text-muted', settings.smtpConfigured ? 'SMTP וכתובת השולח מוגדרים.' : 'SMTP או כתובת השולח אינם מוגדרים; שליחת תשובות לא תהיה זמינה.'));
        form.dataset.adminSettings = '1';
        form._adminFields = { groupsWrap, rateInput, repliesInput };
      }
      const prefs = el('section', 'ci-personal-prefs');
      prefs.append(el('h3', '', 'העדפות התראות אישיות'));
      const personalNotify = el('input'); personalNotify.type = 'checkbox';
      const personalLabel = el('label', '', 'קבלת התראות דוא״ל לכתובת שבחשבון שלי');
      personalLabel.prepend(personalNotify);
      const extraEmails = el('div', 'ci-extra-emails');
      const addEmail = el('button', 'btn btn-default', '+ הוספת כתובת דוא״ל נוספת'); addEmail.type = 'button';
      function addEmailField(value) {
        const row = el('div', 'ci-extra-email-row');
        const input = el('input', 'form-control'); input.type = 'email'; input.placeholder = 'כתובת דוא״ל נוספת'; input.value = value || '';
        const remove = el('button', 'btn btn-default', 'הסרה'); remove.type = 'button';
        remove.addEventListener('click', () => row.remove());
        row.append(input, remove); extraEmails.append(row);
      }
      addEmail.addEventListener('click', () => addEmailField(''));
      prefs.append(personalLabel, extraEmails, addEmail); form.append(prefs);
      const p = await request('/preferences');
      personalNotify.checked = !!p.preferences.notify;
      (p.preferences.extraEmails || []).forEach(addEmailField);
      const save = el('button', 'btn btn-primary', 'שמירת הגדרות'); save.type = 'button';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await request('/preferences', { method: 'PUT', body: JSON.stringify({ notify: personalNotify.checked, extraEmails: Array.from(extraEmails.querySelectorAll('input')).map(input => input.value.trim()).filter(Boolean) }) });
          if (isAdmin && form._adminFields) {
            const f = form._adminFields;
            await request('/settings', { method: 'PUT', body: JSON.stringify({
              allowedGroups: Array.from(f.groupsWrap.querySelectorAll('input:checked')).map(input => input.value),
              maxPerHour: Number(f.rateInput.value), retentionDays: Number(settings.retentionDays) || 0,
              emailReplies: f.repliesInput.checked
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
          emailReplies: !!settings.emailReplies
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