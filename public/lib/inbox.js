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
        anchor.className = 'nav-link navigation-link';
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

      // Match NodeBB's native notification navigation structure exactly:
      // icon + relative wrapper + native navigation/count badge + label.
      // The envelope is outlined when empty and solid when there are unread items.
      const oldSvg = anchor.querySelector('svg.ci-nav-envelope');
      if (oldSvg) oldSvg.remove();
      anchor.querySelectorAll('.ci-nav-count-compact, .ci-nav-count-expanded, .ci-nav-badge').forEach(node => node.remove());

      anchor.className = 'nav-link navigation-link d-flex gap-2 justify-content-between align-items-center ci-nav-anchor';
      anchor.replaceChildren();

      const content = document.createElement('span');
      content.className = 'd-flex gap-2 align-items-center text-nowrap truncate-open';

      const iconWrap = document.createElement('span');
      iconWrap.className = 'position-relative';

      const icon = document.createElement('i');
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('component', 'contact-inbox/icon');
      icon.className = count > 0 ? 'fa fa-fw fa-envelope' : 'fa-regular fa-envelope';

      const badge = document.createElement('span');
      badge.setAttribute('component', 'navigation/count');
      badge.className = 'visible-closed position-absolute top-0 start-100 translate-middle badge rounded-1 bg-primary';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.toggle('hidden', count === 0);

      iconWrap.append(icon, badge);

      const label = document.createElement('span');
      label.className = 'nav-text small visible-open fw-semibold truncate-text';
      label.textContent = 'תיבת פניות';

      content.append(iconWrap, label);
      anchor.appendChild(content);
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

  // Mark only this plugin's staff notifications as read when the inbox is opened.
  // Other NodeBB notifications remain untouched.
  function markStaffInboxNotificationsRead() {
    const socket = window.socket;
    if (!socket || typeof socket.emit !== 'function') return;
    socket.emit('notifications.get', {}, (err, data) => {
      if (err) {
        console.error('[contact-inbox] could not load staff notifications:', err);
        return;
      }
      const unread = data && Array.isArray(data.unread) ? data.unread : [];
      const inboxNotifications = unread.filter(notification =>
        notification && notification.type === 'contact-inbox-new' && notification.nid
      );
      inboxNotifications.forEach(notification => {
        socket.emit('notifications.markRead', notification.nid, markErr => {
          if (markErr) {
            console.error('[contact-inbox] could not mark staff notification as read:', markErr);
          }
        });
      });
    });
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
    if (!isSettingsPage) markStaffInboxNotificationsRead();
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
        ? 'פניות שלא נקראו: ' + (Number(data.newCount) || 0)
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
    async function markReadState(item, unread) {
      await request('/submissions/' + encodeURIComponent(item.id) + '/' + (unread ? 'unread' : 'read'), { method: 'POST', body: '{}' });
      await load(); if (activeId === item.id) await openItem(item.id);
      window.dispatchEvent(new Event('contact-inbox:refresh-unread'));
      await notify(unread ? 'הפנייה סומנה כלא נקראה עבורך.' : 'הפנייה סומנה כנקראה עבורך.', 'success');
    }
    async function openChat(item) {
      const data = await request('/submissions/' + encodeURIComponent(item.id) + '/chat', { method: 'POST', body: '{}' });
      if (!data.url) throw new Error('לא התקבל קישור לצ׳אט');
      window.location.assign(data.url);
    }
    function emailReply(item) {
      const body = el('div'); body.append(el('p', 'text-muted', 'התשובה תישלח אל: ' + item.email));
      const textarea = el('textarea', 'form-control'); textarea.rows = 6; textarea.placeholder = 'כתיבת תשובה…'; body.append(textarea);
      modal('שליחת תשובה בדוא״ל', body, [
        { label: 'ביטול', className: 'btn-default' },
        { label: 'שליחה', className: 'btn-primary', onClick: async (wrap, button) => {
          if (!textarea.value.trim()) { notify('יש לכתוב את תוכן התשובה.', 'warning'); return; }
          button.disabled = true;
          try {
            await request('/submissions/' + encodeURIComponent(item.id) + '/replies', { method: 'POST', body: JSON.stringify({ message: textarea.value, sendEmail: true }) });
            closeModal(wrap); await openItem(item.id); await notify('התשובה נשלחה ונשמרה בהיסטוריה.', 'success');
          } catch (err) { await notify(err.message, 'danger'); button.disabled = false; }
        }},
      ]);
    }
    async function setStatus(item, status) {
      await request('/submissions/' + encodeURIComponent(item.id), { method: 'PUT', body: JSON.stringify({ status }) });
      activeId = null; detail.replaceChildren(el('p', 'ci-empty', status === 'resolved' ? 'הפנייה הועברה להיסטוריה.' : 'הפנייה הוחזרה לפניות הפעילות.'));
      await load(); window.dispatchEvent(new Event('contact-inbox:refresh-unread'));
      await notify(status === 'resolved' ? 'הפנייה סומנה כטופלה והועברה להיסטוריה.' : 'הפנייה סומנה כלא טופלה והוחזרה לתיבה כלא נקראה.', 'success');
    }
    function deleteItem(item) {
      modal('אישור מחיקת פנייה', el('p', '', 'למחוק לצמיתות את הפנייה ואת כל התשובות שלה? לא ניתן לשחזר את המידע לאחר המחיקה.'), [
        { label: 'ביטול', className: 'btn-default' },
        { label: 'מחיקה לצמיתות', className: 'btn-danger', onClick: async (wrap, button) => {
          button.disabled = true;
          try {
            const result = await request('/submissions/' + encodeURIComponent(item.id) + '/delete', { method: 'POST', body: '{}' });
            if (!result || result.deleted !== true) throw new Error('השרת לא אישר שהפנייה נמחקה בפועל.');
            closeModal(wrap); if (activeId === item.id) { activeId = null; detail.replaceChildren(el('p', 'ci-empty', 'הפנייה נמחקה.')); }
            await load(); await notify('הפנייה נמחקה בהצלחה.', 'success'); window.dispatchEvent(new Event('contact-inbox:refresh-unread'));
          } catch (err) { await notify(err.message, 'danger'); button.disabled = false; }
        }},
      ]);
    }
    function addMenuAction(menu, label, icon, action, disabled) {
      const button = el('button', 'ci-menu-item'); button.type = 'button'; button.disabled = !!disabled;
      const glyph = el('i', 'fa ' + icon); glyph.setAttribute('aria-hidden', 'true'); button.append(glyph, el('span', '', label));
      button.addEventListener('click', async event => { event.stopPropagation(); if (button.disabled) return; menu.hidden = true; try { await action(); } catch (err) { await notify(err.message, 'danger'); } });
      menu.append(button);
    }
    function cardMenu(item) {
      const wrap = el('div', 'ci-card-menu'), trigger = el('button', 'ci-menu-trigger', '⋮'), menu = el('div', 'ci-menu');
      // Inline positioning and visibility make the control appear even if the
      // theme overrides plugin SCSS or its compiled stylesheet is stale.
      wrap.style.cssText = 'position:absolute!important;top:6px!important;left:6px!important;z-index:30!important;display:block!important;visibility:visible!important;opacity:1!important;direction:rtl!important;';
      trigger.type = 'button';
      trigger.style.cssText = 'display:flex!important;align-items:center!important;justify-content:center!important;width:34px!important;height:34px!important;padding:0!important;margin:0!important;border:1px solid var(--bs-border-color,#ccc)!important;border-radius:6px!important;background:var(--bs-body-bg,#fff)!important;color:var(--bs-body-color,#222)!important;font-size:25px!important;line-height:1!important;cursor:pointer!important;visibility:visible!important;opacity:1!important;';
      trigger.setAttribute('aria-label', 'פעולות לפנייה'); trigger.setAttribute('aria-haspopup', 'true'); trigger.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
      trigger.addEventListener('click', event => {
        event.stopPropagation(); const opening = menu.hidden;
        document.querySelectorAll('.ci-menu').forEach(node => { node.hidden = true; });
        document.querySelectorAll('.ci-menu-trigger').forEach(node => node.setAttribute('aria-expanded', 'false'));
        menu.hidden = !opening; trigger.setAttribute('aria-expanded', String(opening));
      });
      menu.addEventListener('click', event => event.stopPropagation());
      if (view === 'active') {
        addMenuAction(menu, item.readByMe ? 'סימון כלא נקרא' : 'סימון כנקרא', item.readByMe ? 'fa-envelope' : 'fa-envelope-open', () => markReadState(item, item.readByMe));
        addMenuAction(menu, 'שליחת צ׳אט למשתמש', 'fa-comments', () => openChat(item), !item.uid || !item.username);
        addMenuAction(menu, 'שליחת תשובה במייל', 'fa-envelope', () => emailReply(item), !settings || !settings.smtpConfigured);
        addMenuAction(menu, 'סימון כטופל', 'fa-check', () => setStatus(item, 'resolved'));
        addMenuAction(menu, 'מחיקה', 'fa-trash', () => deleteItem(item));
      } else {
        addMenuAction(menu, 'סמן כלא טופל', 'fa-rotate-left', () => setStatus(item, 'new'));
        addMenuAction(menu, 'מחיקה', 'fa-trash', () => deleteItem(item));
      }
      wrap.append(trigger, menu); return wrap;
    }
    function render(items) {
      list.replaceChildren();
      if (!items.length) { list.append(el('div', 'ci-empty', view === 'history' ? 'אין פניות בהיסטוריה.' : 'אין פניות התואמות לסינון.')); return; }
      items.forEach(item => {
        const card = el('article', 'ci-row' + (item.id === activeId ? ' active' : '') + (view === 'active' && !item.readByMe ? ' ci-row-unread' : ''));
        card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', 'פתיחת פנייה: ' + item.subject);
        const top = el('div', 'ci-row-top'); top.append(el('strong', '', item.subject), el('small', '', date(item.createdAt)));
        // Add the menu first so it remains at the upper-left corner even
        // when the theme applies unexpected layout rules to card children.
        card.append(cardMenu(item));
        card.append(top, el('div', 'ci-row-meta', item.name + ' · ' + item.email), el('p', 'ci-row-preview', item.message));
        if (view === 'history') card.append(el('span', 'label label-default', 'טופלה'));
        else card.append(el('span', 'ci-read-state' + (item.readByMe ? '' : ' ci-unread-state'), item.readByMe ? 'נקראה' : 'לא נקראה'));
        card.addEventListener('click', event => { if (!event.target.closest('.ci-card-menu')) openItem(item.id); });
        card.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('.ci-card-menu')) { event.preventDefault(); openItem(item.id); } });
        list.append(card);
      });
    }
    async function openItem(id) {
      activeId = id;
      try {
        const result = await request('/submissions/' + encodeURIComponent(id)), item = result.submission;
        detail.replaceChildren();
        // Mirror the card actions in the opened details pane, anchored at its
        // upper-left corner. The same menu builder keeps actions identical in
        // the active inbox and history views.
        detail.style.position = 'relative';
        detail.style.paddingTop = '48px';
        detail.append(cardMenu(item), el('h2', 'ci-subject', item.subject));
        detail.append(field('פרטי הפונה', item.name + ' · ' + item.email, 'ci-person'), field('תאריך קבלה', date(item.createdAt)));
        if (item.username) detail.append(field('חשבון בפורום', '@' + item.username));
        detail.append(field('תוכן הפנייה', item.message, 'ci-message-card'));
        if (item.replies && item.replies.length) {
          const history = el('section', 'ci-replies'); history.append(el('h3', '', 'תשובות קודמות'));
          item.replies.forEach(reply => { const card = el('article', 'ci-reply'); card.append(el('small', '', date(reply.createdAt) + (reply.channel === 'email' ? ' · נשלח בדוא״ל' : ' · תשובה פנימית')), el('p', '', reply.message)); history.append(card); });
          detail.append(history);
        }
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
      settings = { smtpConfigured: !!caps.smtpConfigured };
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
      const inboxPage = document.getElementById('ci-inbox-page'), settingsPage = document.getElementById('ci-settings-page');
      if (!settingsPage) return; if (inboxPage) inboxPage.hidden = true; settingsPage.hidden = false;
      root.querySelector('h1').textContent = 'הגדרות תיבת הפניות';
      const headerSubtitle = root.querySelector('.contact-inbox-header p');
      if (headerSubtitle) headerSubtitle.hidden = true;
      historyButton.hidden = true; settingsButton.hidden = true; document.getElementById('ci-back-button').hidden = false;
      const content = document.getElementById('ci-settings-content'); content.replaceChildren(el('p', '', 'טוען הגדרות…'));
      await loadSettings();
      const form = el('div', 'ci-settings-form');
      if (isAdmin) {
        const general = el('section', 'ci-settings-section'); general.append(el('h3', '', 'הגדרות'));
        const groupsLabel = el('label', '', 'קבוצות מורשות'), groupsWrap = el('div', 'ci-groups-list');
        const groupData = await request('/groups'), selected = new Set(settings.allowedGroups || ['administrators']);
        (groupData.groups || []).forEach(name => { const label = el('label', 'checkbox ci-group-option', name), input = el('input'); input.type = 'checkbox'; input.value = name; input.checked = selected.has(name); label.prepend(input); groupsWrap.append(label); });
        const rateLabel = el('label', '', 'מספר פניות מרבי מכתובת IP בשעה'), rateInput = el('input', 'form-control');
        rateInput.type = 'number'; rateInput.min = '1'; rateInput.max = '30'; rateInput.value = settings.maxPerHour || 5;
        const retentionLabel = el('label', '', 'מחיקה אוטומטית של פניות מההיסטוריה לאחר (ימים; 0 = ללא מחיקה אוטומטית)'), retentionInput = el('input', 'form-control');
        retentionInput.type = 'number'; retentionInput.min = '0'; retentionInput.max = '3650'; retentionInput.value = settings.retentionDays || 0;
        general.append(groupsLabel, groupsWrap, rateLabel, rateInput, retentionLabel, retentionInput); form.append(general);
        form._adminFields = { groupsWrap, rateInput, retentionInput };
      }
      const alerts = el('section', 'ci-settings-section'); alerts.append(el('h3', '', 'התראות'));
      const submitter = el('div', 'ci-settings-subsection'); submitter.append(el('h4', '', 'התראת אישור לפונה'));
      const submitterLabel = el('label', 'checkbox ci-setting-checkbox', 'שליחת התראת אישור למשתמש רשום לאחר שליחת פנייה'), submitterInput = el('input');
      submitterInput.type = 'checkbox'; submitterInput.checked = !!(settings && settings.notifySubmitter); submitterLabel.prepend(submitterInput);
      const delayLabel = el('label', '', 'השהיה לפני שליחת ההתראה (בדקות)'), delayInput = el('input', 'form-control');
      delayInput.type = 'number'; delayInput.min = '1'; delayInput.max = '10080'; delayInput.step = '1'; delayInput.value = (settings && settings.submitterNotificationDelayMinutes) || 5;
      submitter.append(submitterLabel, delayLabel, delayInput, el('p', 'text-muted', 'ההתראה תופיע בדף ההתראות הרגיל של המשתמש, לאחר ההשהיה שנקבעה. אורחים לא יקבלו התראה זו.'));
      if (isAdmin) alerts.append(submitter);
      const prefs = el('div', 'ci-settings-subsection ci-personal-prefs'); prefs.append(el('h4', '', 'התראות לצוות'));
      const p = await request('/preferences');
      const forumInput = el('input', 'form-check-input'); forumInput.type = 'checkbox'; forumInput.checked = !!p.preferences.notifyInForum;
      const forumLabel = el('label', 'form-check form-switch ci-notify-switch', 'קבלת התראות בפורום'); forumLabel.prepend(forumInput);
      const emailInput = el('input', 'form-check-input'); emailInput.type = 'checkbox'; emailInput.checked = !!p.preferences.notify;
      emailInput.disabled = !settings.smtpConfigured;
      const emailLabel = el('label', 'form-check form-switch ci-notify-switch', 'קבלת התראות בדוא״ל לכתובת שבחשבון שלי'); emailLabel.prepend(emailInput);
      const extraEmails = el('div', 'ci-extra-emails'), addEmail = el('button', 'btn btn-default', '+ הוספת כתובת דוא״ל נוספת'); addEmail.type = 'button';
      function addEmailField(value) { const row = el('div', 'ci-extra-email-row'), input = el('input', 'form-control'), remove = el('button', 'btn btn-default', 'הסרה'); input.type = 'email'; input.placeholder = 'כתובת דוא״ל נוספת'; input.value = value || ''; remove.type = 'button'; remove.addEventListener('click', () => row.remove()); row.append(input, remove); extraEmails.append(row); }
      addEmail.addEventListener('click', () => addEmailField('')); (p.preferences.extraEmails || []).forEach(addEmailField);
      prefs.append(forumLabel, emailLabel);
      if (!settings.smtpConfigured) prefs.append(el('p', 'text-muted ci-smtp-warning', 'התראות דוא״ל אינן זמינות עד להפעלת SMTP בהגדרות הדוא״ל של NodeBB.'));
      prefs.append(extraEmails, addEmail); alerts.append(prefs); form.append(alerts);
      const save = el('button', 'btn btn-primary', 'שמירת הגדרות'); save.type = 'button';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await request('/preferences', { method: 'PUT', body: JSON.stringify({ notifyInForum: forumInput.checked, notify: settings.smtpConfigured ? emailInput.checked : !!p.preferences.notify, extraEmails: Array.from(extraEmails.querySelectorAll('input')).map(input => input.value.trim()).filter(Boolean) }) });
          if (isAdmin && form._adminFields) { const f = form._adminFields; await request('/settings', { method: 'PUT', body: JSON.stringify({ allowedGroups: Array.from(f.groupsWrap.querySelectorAll('input:checked')).map(input => input.value), maxPerHour: Number(f.rateInput.value), retentionDays: Number(f.retentionInput.value) || 0, notifySubmitter: submitterInput.checked, submitterNotificationDelayMinutes: Number(delayInput.value) || 5 }) }); }
          await notify('ההגדרות נשמרו.', 'success');
        } catch (err) { await notify(err.message, 'danger'); } finally { save.disabled = false; }
      });
      form.append(save); content.replaceChildren(form);
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
      loadSettings().then(load).catch(err => { list.textContent = err.message; });
    }
  }

  // NodeBB stores notifications in the notification center, but does not
  // automatically show a toast for every custom notification type. Display
  // the staff inbox notification through NodeBB's native toast system.
  function bindStaffNotificationToast() {
    const socket = window.socket;
    if (!socket || typeof socket.on !== 'function' || socket.__ciStaffToastBound) return;
    socket.__ciStaffToastBound = true;
    socket.on('event:new_notification', async data => {
      const notification = data && data.notification;
      if (!notification || notification.type !== 'contact-inbox-new') return;
      try {
        if (!window.app || typeof window.app.require !== 'function') return;
        const alerts = await window.app.require('alerts');
        if (alerts && typeof alerts.alert === 'function') {
          alerts.alert({
            message: 'התקבלה פנייה חדשה בתיבת הפניות.',
            type: 'info',
            timeout: 7000,
            clickfn: () => window.location.assign(page),
          });
        }
      } catch (err) {
        console.error('[contact-inbox] could not display staff notification toast:', err);
      }
    });
  }

  function start() { bindStaffNotificationToast(); refreshNavigationIcon(); initInbox(); }
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