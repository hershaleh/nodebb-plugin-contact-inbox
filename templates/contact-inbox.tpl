<div class="container contact-inbox-page" dir="rtl">
  <header class="contact-inbox-header">
    <div><h1>תיבת פניות</h1><p>ניהול פניות שהתקבלו דרך טופס צור קשר</p></div>
    <div class="ci-header-actions">
      <span id="ci-count" class="label label-primary" aria-live="polite">פניות חדשות: —</span>
      <button id="ci-history-button" class="btn btn-default" type="button">היסטוריית פניות</button>
      <button id="ci-settings-button" class="btn btn-default" type="button"><i class="fa fa-cog" aria-hidden="true"></i> הגדרות</button>
      <button id="ci-back-button" class="btn btn-default" type="button" hidden>חזרה לתיבת הפניות</button>
    </div>
  </header>
  <main id="ci-inbox-page">
    <div class="contact-inbox-toolbar">
      <input id="ci-search" class="form-control" type="search" placeholder="חיפוש לפי שם, דוא״ל, נושא או תוכן" aria-label="חיפוש פניות">
      <select id="ci-status" class="form-control" aria-label="סינון לפי סטטוס">
        <option value="all">כל הסטטוסים</option><option value="new">חדשות</option><option value="in_progress">בטיפול</option>
      </select>
      <button id="ci-refresh" class="btn btn-primary" type="button">רענון</button>
    </div>
    <section id="ci-history-tools" class="ci-history-tools" hidden>
      <div><strong>היסטוריית פניות שטופלו</strong><p class="text-muted">כאן נשמרות פניות שסומנו כטופלו. קריאת פנייה אינה מעבירה אותה לכאן.</p></div>
      <button id="ci-history-clear" class="btn btn-danger" type="button">מחיקת כל ההיסטוריה</button>
      <div id="ci-retention-admin" class="ci-retention-admin" hidden>
        <label for="ci-retention">מחיקה אוטומטית של פניות מההיסטוריה לאחר (ימים; 0 = ללא מחיקה אוטומטית)</label>
        <div class="ci-retention-row"><input id="ci-retention" class="form-control" type="number" min="0" max="3650" value="0"><button id="ci-retention-save" class="btn btn-default" type="button">שמירת מדיניות</button></div>
        <p id="ci-retention-message" role="status"></p>
      </div>
    </section>
    <div class="contact-inbox-layout">
      <section id="ci-list" class="contact-inbox-list" aria-label="רשימת פניות" aria-live="polite"><p>טוען פניות…</p></section>
      <section id="ci-detail" class="contact-inbox-detail" aria-label="פרטי הפנייה"><p class="ci-empty">בחר פנייה כדי להציג את פרטיה.</p></section>
    </div>
  </main>
  <main id="ci-settings-page" hidden>
    <h2>הגדרות תיבת הפניות</h2>
    <p class="text-muted">הגדרות אישיות והגדרות ניהול. הגדרות מחיקת היסטוריה נמצאות במסך היסטוריית הפניות.</p>
    <div id="ci-settings-content" class="ci-settings-content"><p>טוען הגדרות…</p></div>
  </main>
</div>