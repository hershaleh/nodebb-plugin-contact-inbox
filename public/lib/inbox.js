(function () {
  'use strict';
  if (window.__contactInboxLoaded) return;
  window.__contactInboxLoaded = true;

  const root = document.querySelector('.contact-inbox-page');
  if (!root) return;
  const list = document.getElementById('ci-list');
  const detail = document.getElementById('ci-detail');
  const search = document.getElementById('ci-search');
  const status = document.getElementById('ci-status');
  const unread = document.getElementById('ci-unread');
  let activeId = null;
  let rows = [];

  function el(tag, cls, value) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function date(value) {
    return new Date(value).toLocaleString('he-IL');
  }
  async function request(url, options) {
    const opts = options || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = document.querySelector('meta[name="csrf-token"]');
    if (token && opts.method && opts.method !== 'GET') opts.headers['x-csrf-token'] = token.content;
    const response = await fetch(url, opts);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'הפעולה נכשלה');
    return data;
  }
  function renderList() {
    list.replaceChildren();
    if (!rows.length) {
      list.append(el('p', 'text-muted', 'לא נמצאו פניות.'));
      unread.textContent = 'לא נקראו: 0';
      return;
    }
    unread.textContent = 'לא נקראו: ' + rows.filter(item => !item.readAt).length;
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
      const data = await request('/api/plugins/contact-inbox/submissions?' + params);
      rows = data.submissions || [];
      renderList();
    } catch (err) { list.textContent = err.message; }
  }
  async function openItem(id) {
    activeId = id;
    try {
      const data = await request('/api/plugins/contact-inbox/submissions/' + encodeURIComponent(id));
      const item = data.submission;
      detail.replaceChildren();
      detail.append(el('h2', '', item.subject));
      detail.append(el('p', 'ci-muted', date(item.createdAt)));
      detail.append(el('p', '', 'שם: ' + item.name));
      detail.append(el('p', '', 'דוא״ל: ' + item.email));
      if (item.username) detail.append(el('p', '', 'משתמש: @' + item.username));
      detail.append(el('article', 'ci-message', item.message));
      if (item.uid) {
        const chat = el('a', 'btn btn-default', 'פתיחת צ׳אט עם המשתמש');
        chat.href = '/user/' + encodeURIComponent(item.username) + '/chats';
        detail.append(chat);
      }
      const controls = el('div', 'ci-controls');
      const select = el('select', 'form-control');
      [['new','חדשה'],['in_progress','בטיפול'],['resolved','טופלה']].forEach(pair => {
        const option = el('option', '', pair[1]); option.value = pair[0]; option.selected = item.status === pair[0]; select.append(option);
      });
      const update = el('button', 'btn btn-primary', 'עדכון סטטוס');
      update.addEventListener('click', async () => {
        try { await request('/api/plugins/contact-inbox/submissions/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); await load(); }
        catch (err) { window.alert(err.message); }
      });
      controls.append(select, update);
      detail.append(controls);
      const history = el('div', 'ci-history');
      history.append(el('h3', '', 'היסטוריית תשובות'));
      (item.replies || []).forEach(reply => {
        const block = el('div', 'ci-reply');
        block.append(el('small', '', date(reply.createdAt)), el('p', '', reply.message));
        history.append(block);
      });
      const textarea = el('textarea', 'form-control');
      textarea.rows = 4; textarea.placeholder = 'כתיבת תשובה פנימית…';
      const replyButton = el('button', 'btn btn-primary', 'שמירת תשובה בהיסטוריה');
      replyButton.addEventListener('click', async () => {
        try {
          await request('/api/plugins/contact-inbox/submissions/' + encodeURIComponent(id) + '/replies', { method: 'POST', body: JSON.stringify({ message: textarea.value, sendEmail: false }) });
          await openItem(id);
        } catch (err) { window.alert(err.message); }
      });
      history.append(textarea, replyButton);
      detail.append(history);
      const remove = el('button', 'btn btn-danger', 'מחיקת הפנייה');
      remove.addEventListener('click', async () => {
        if (!window.confirm('למחוק את הפנייה ואת היסטוריית התשובות שלה?')) return;
        try { await request('/api/plugins/contact-inbox/submissions/' + encodeURIComponent(id), { method: 'DELETE' }); activeId = null; detail.textContent = 'הפנייה נמחקה.'; await load(); }
        catch (err) { window.alert(err.message); }
      });
      detail.append(remove);
      await load();
    } catch (err) { detail.textContent = err.message; }
  }
  document.getElementById('ci-refresh').addEventListener('click', load);
  search.addEventListener('keydown', event => { if (event.key === 'Enter') load(); });
  status.addEventListener('change', load);
  load();
}());