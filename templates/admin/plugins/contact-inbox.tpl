<div class="contact-inbox-page" dir="rtl">
  <div class="contact-inbox-header">
    <div><h1>תיבת פניות</h1><p>ניהול פניות שהתקבלו דרך טופס צור קשר</p></div>
    <span id="ci-unread" class="label label-primary">לא נקראו: —</span>
  </div>
  <div class="contact-inbox-toolbar">
    <input id="ci-search" class="form-control" type="search" placeholder="חיפוש לפי שם, דוא״ל, נושא או תוכן">
    <select id="ci-status" class="form-control">
      <option value="all">כל הסטטוסים</option><option value="new">חדשות</option>
      <option value="in_progress">בטיפול</option><option value="resolved">טופלו</option>
    </select>
    <button id="ci-refresh" class="btn btn-primary">רענון</button>
  </div>
  <div class="contact-inbox-layout">
    <section id="ci-list" class="contact-inbox-list" aria-live="polite"><p>טוען פניות…</p></section>
    <section id="ci-detail" class="contact-inbox-detail"><p>בחר פנייה כדי להציג את פרטיה.</p></section>
  </div>
  <details class="ci-preferences">
    <summary>העדפות אישיות והתראות</summary>
    <label><input id="ci-notify" type="checkbox"> שליחת הודעת דוא״ל אליי כשמתקבלת פנייה חדשה</label>
    <input id="ci-staff-email" class="form-control" type="email" placeholder="כתובת הדוא״ל לקבלת התראות">
    <button id="ci-save-prefs" class="btn btn-default" type="button">שמירת העדפות אישיות</button>
    <p id="ci-prefs-message" role="status"></p>
  </details>
  <details class="ci-admin-settings" id="ci-admin-settings" hidden>
    <summary>הגדרות מנהל</summary>
    <label>קבוצות מורשות (שמות קבוצות מופרדים בפסיקים)</label>
    <input id="ci-groups" class="form-control" value="administrators">
    <label>מחיקה אוטומטית לאחר מספר ימים (0 = מחיקה ידנית בלבד)</label>
    <input id="ci-retention" class="form-control" type="number" min="0" max="3650" value="0">
    <label>מספר פניות מרבי מכתובת IP בשעה</label>
    <input id="ci-rate" class="form-control" type="number" min="1" max="30" value="5">
    <label><input id="ci-email-notifications" type="checkbox"> הפעלת התראות דוא״ל לצוות (כל איש צוות צריך להצטרף בהעדפות האישיות)</label>
    <label><input id="ci-email-replies" type="checkbox"> אפשרות לשליחת תשובות בדוא״ל (דורש SMTP פעיל בהגדרות NodeBB)</label>
    <p id="ci-smtp-note" class="text-muted"></p>
    <button id="ci-save-settings" class="btn btn-primary" type="button">שמירת הגדרות</button>
    <p id="ci-settings-message" role="status"></p>
  </details>
</div>