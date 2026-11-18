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

  let navRefreshInProgress = false;
  async function refreshNavigationIcon() {
    if (navRefreshInProgress) return;
    navRefreshInProgress = true;
    try {
      // Verify access before exposing or updating the private inbox shortcut.
      let count;
      try {
        const result = await request('/unread');
        count = Number(result.count);
      } catch (apiError) {
        return;
      }
      count = Number.isFinite(count) && count > 0 ? count : 0;

      // Prefer the chat control inside NodeBB's left sidebar. Some themes
      // render additional chat controls elsewhere (header/mobile menus).
      const chatControls = Array.from(document.querySelectorAll('[component="chat/dropdown"]'));
      const chatToggle = chatControls.find(node => node.closest('nav.sidebar')) || chatControls[0];
      if (!chatToggle) return;

      const chatItem = chatToggle.closest('li') || chatToggle;
      let navList = chatItem.parentElement;
      while (navList && navList !== document.body && !['UL', 'OL'].includes(navList.tagName)) {
        navList = navList.parentElement;
      }
      if (!navList || navList === document.body) return;

      const route = page;
      const existingLinks = Array.from(document.querySelectorAll(
        'a#contact-inbox-nav, a[href="' + route + '"], a[href$="/plugins/contact-inbox"]'
      )).filter(node => node instanceof HTMLAnchorElement);
      let anchor = existingLinks.find(node => node.closest('ul, ol') === navList) || existingLinks[0] || null;

      // Keep exactly one inbox shortcut and move its navigation item next to
      // the chat item. This works whether NodeBB or the plugin created it.
      existingLinks.forEach(node => {
        if (node === anchor) return;
        const duplicateItem = node.closest('li');
        if (duplicateItem && duplicateItem !== chatItem) duplicateItem.remove();
        else node.remove();
      });

      let item = anchor && anchor.closest('li');
      if (!anchor) {
        item = document.createElement('li');
        item.className = chatItem.classList.contains('nav-item') ? chatItem.className : 'nav-item';
        anchor = document.createElement('a');
        anchor.className = 'nav-link navigation-link d-flex gap-2 align-items-center';
        anchor.id = 'contact-inbox-nav';
        anchor.href = route;
        const icon = document.createElement('i');
        icon.setAttribute('aria-hidden', 'true');
        anchor.appendChild(icon);
        const label = document.createElement('span');
        label.className = 'nav-text small visible-open fw-semibold';
        label.textContent = 'תיבת פניות';
        anchor.appendChild(label);
        item.appendChild(anchor);
      } else if (!item) {
        item = document.createElement('li');
        item.className = 'nav-item';
        anchor.parentNode.insertBefore(item, anchor);
        item.appendChild(anchor);
      }

      if (item.parentElement !== navList || item.previousElementSibling !== chatItem) {
        navList.insertBefore(item, chatItem.nextElementSibling);
      }

      anchor.id = 'contact-inbox-nav';
      anchor.href = route;
      anchor.title = 'תיבת פניות';
      anchor.setAttribute('aria-label', 'תיבת פניות');
      anchor.classList.add('ci-nav-anchor');

      // Font Awesome 7's regular envelope is the outline-only variant.
      let icon = anchor.querySelector('i');
      if (!icon) {
        icon = document.createElement('i');
        anchor.insertBefore(icon, anchor.firstChild);
      }
      icon.classList.remove('fa', 'fa-solid', 'fa-envelope-o', 'fa-envelope');
      icon.classList.add('fa-regular', 'fa-envelope');
      icon.setAttribute('aria-hidden', 'true');
      icon.style.fontWeight = '400';

      // Use NodeBB's native collapsed/expanded navigation counter markup.
      // This gives the badge the same color, shape and responsive placement
      // as the built-in chat and notification counters.
      let compactBadge = anchor.querySelector('.ci-nav-count-compact');
      if (!compactBadge) {
        compactBadge = document.createElement('span');
        compactBadge.className = 'ci-nav-count-compact visible-closed position-absolute badge rounded-1 bg-primary';
        compactBadge.setAttribute('aria-hidden', 'true');
        anchor.appendChild(compactBadge);
      }
      let expandedBadge = anchor.querySelector('.ci-nav-count-expanded');
      if (!expandedBadge) {
        expandedBadge = document.createElement('span');
        expandedBadge.className = 'ci-nav-count-expanded visible-open badge rounded-1 bg-primary';
        expandedBadge.setAttribute('aria-hidden', 'true');
        anchor.appendChild(expandedBadge);
      }
      const countText = count > 99 ? '99+' : String(count);
      [compactBadge, expandedBadge].forEach(badge => {
        badge.textContent = countText;
        badge.classList.toggle('hidden', count === 0);
      });
      // Remove the earlier custom badge if this item was already rendered.
      anchor.querySelectorAll('.ci-nav-badge').forEach(badge => badge.remove());
      anchor.dataset.contactInboxCount = String(count);
    } catch (err) {
      console.error('[contact-inbox] could not update inbox navigation icon:', err);
    } finally {
      navRefreshInProgress = false;
    }
  }

  async function notify(message, type) {
    try {
      if (window.app && typeof window.app.require === 'function') {
        const alerts = await window.app.require('alerts');
        if (type === 'success' && typeof alerts.success === 'function') { alerts.success(message, 5000); return; }
        if ((type === 'danger' || type === 'error') && typeof alerts.error === 'function') { alerts.error(message, 10000); return; }
        if (type === 'warning' && typeof alerts.warning === 'function') { alerts.warning(message, 5000); return; }
        if (typeof alerts.info === 'function') { alerts.info(message, 5000); return; }
      }
    } catch (err) {
      console.error('[contact-inbox] failed to load NodeBB alerts module:', err);
    }
    console.error('[contact-inbox] NodeBB alerts unavailable:', message);
  }

  function modal(title, bodyNode, buttons) {
    // NodeBB 4.x bundles Bootbox. Use its Bootstrap-backed dialog instead
    // of a native browser confirm or a hand-built modal with mismatched CSS.
    if (window.bootbox && typeof window.bootbox.dialog === 'function' && $) {
      let dialog;
      const dialogButtons = {};
      (buttons || []).forEach((spec, index) => {
        dialogButtons['ci_button_' + index] = {
          label: spec.label,
          className: spec.className || 'btn-default',
          callback: function () {
            const wrap = dialog && dialog[0];
            const button = wrap && wrap.querySelectorAll('.modal-footer button')[index];
            if (spec.onClick) {
              Promise.resolve(spec.onClick(wrap, button)).catch(err => notify(err.message || 'הפעולה נכשלה.', 'danger'));
              return false;
            }
            return true;
          },
        };
      });
      dialog = window.bootbox.dialog({
        title: title,
        message: $(bodyNode),
        buttons: dialogButtons,
        onEscape: true,
        backdrop: true,
        centerVertical: true,
        className: 'ci-modal',
      });
      return { element: dialog && dialog[0], close: () => dialog && dialog.modal('hide') };
    }
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
        if (spec.onClick) await spec.onClick(wrap, b); else closeModal(wrap);
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
          const confirmBody = el('p', '', 'למחוק לצמיתות את הפנייה ואת כל התשובות שלה? לא ניתן לשחזר את המידע לאחר המחיקה.');
          modal('אישור מחיקת פנייה', confirmBody, [
            { label: 'ביטול', className: 'btn-default' },
            { label: 'מחיקה לצמיתות', className: 'btn-danger', onClick: async (wrap, button) => {
              button.disabled = true;
              try {
                const result = await request('/submissions/' + encodeURIComponent(id) + '/delete', { method: 'POST', body: '{}' });
                if (!result || result.deleted !== true) throw new Error('השרת לא אישר שהפנייה נמחקה בפועל.');
                closeModal(wrap);
                activeId = null;
                detail.replaceChildren(el('p', 'ci-empty', 'הפנייה נמחקה.'));
                await load();
                await notify('הפנייה נמחקה בהצלחה.', 'success');
                window.dispatchEvent(new Event('contact-inbox:refresh-unread'));
              } catch (err) {
                await notify(err.message || 'מחיקת הפנייה נכשלה.', 'danger');
                button.disabled = false;
              }
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
        const retentionLabel = el('label', '', 'מחיקה אוטומטית של פניות מההיסטוריה לאחר (ימים; 0 = ללא מחיקה אוטומטית)');
        const retentionInput = el('input', 'form-control'); retentionInput.type = 'number'; retentionInput.min = '0'; retentionInput.max = '3650'; retentionInput.value = settings.retentionDays || 0;
        form.append(el('h3', '', 'הגדרות מנהל'), groupsLabel, groupsWrap, rateLabel, rateInput, repliesLabel, retentionLabel, retentionInput,
          el('p', 'text-muted', settings.smtpConfigured ? 'SMTP וכתובת השולח מוגדרים.' : 'SMTP או כתובת השולח אינם מוגדרים; שליחת תשובות לא תהיה זמינה.'));
        form.dataset.adminSettings = '1';
        form._adminFields = { groupsWrap, rateInput, repliesInput, retentionInput };
      }
      const prefs = el('section', 'ci-personal-prefs');
      prefs.append(el('h3', '', 'העדפות התראות אישיות'));
      const personalNotify = el('input', 'form-check-input'); personalNotify.type = 'checkbox';
      const personalLabel = el('label', 'form-check form-switch ci-notify-switch', 'קבלת התראות דוא״ל לכתובת שבחשבון שלי');
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
              maxPerHour: Number(f.rateInput.value), retentionDays: Number(f.retentionInput.value) || 0,
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
    if (isSettingsPage) {
      renderSettingsPage().catch(err => { document.getElementById('ci-settings-content').textContent = err.message; });
    } else {
      document.getElementById('ci-history-tools').hidden = view !== 'history';
      document.getElementById('ci-history-button').textContent = view === 'history' ? 'חזרה לפניות פעילות' : 'היסטוריית פניות';
      document.getElementById('ci-back-button').hidden = true;
      load();
    }
  }

  function start() { refreshNavigationIcon(); initInbox(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  if ($) $(window).on('action:ajaxify.end', start);
  window.addEventListener('contact-inbox:refresh-unread', refreshNavigationIcon);
  if (!window.__ciNavRefreshTimer) window.__ciNavRefreshTimer = window.setInterval(refreshNavigationIcon, 30000);
  const observer = new MutationObserver(() => {
    const item = document.getElementById('contact-inbox-nav');
    const chat = document.querySelector('[component="chat/dropdown"], a[href*="/chats"], a[href*="/chat"]');
    if (!item && chat) refreshNavigationIcon();
  });
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
}());