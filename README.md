# דולר

אפליקציה לאייפון שמראה את השער היציג של הדולר, ושולחת הודעה בטלגרם כשהשער נמוך מהממוצע של 30 הימים האחרונים ב-1% לפחות.

זה לא חיזוי ולא ייעוץ השקעות. זה כלל פשוט ושקוף, וההחלטה אם לקנות נשארת שלך.

## איך זה עובד

- `scripts/check.mjs` מוריד את השער היציג מבנק ישראל, מחשב ממוצע, כותב את `data/rates.json` ושולח הודעה בטלגרם אם צריך (פעם אחת לכל יום מסחר).
- `.github/workflows/check.yml` מריץ את הבדיקה ב-GitHub פעמיים ביום (16:00 ו-20:00 שעון חורף).
- `index.html` היא האפליקציה עצמה, ש-GitHub Pages מארח.
- `config.json` קובע את הכלל: `thresholdPercent` (כמה אחוזים מתחת לממוצע) ו-`windowDays` (על כמה ימים מחושב הממוצע).

## הגדרה

1. **בוט בטלגרם:** פתח את `@BotFather` בטלגרם, שלח `/newbot`, בחר שם ושמור את הטוקן שתקבל. אחר כך פתח את הבוט החדש ולחץ Start.
2. **מזהה הצ'אט:** הרץ `node scripts/get-chat-id.mjs`, הדבק את הטוקן, ושמור את המספר שיודפס.
3. **מאגר ב-GitHub:** צור מאגר ציבורי חדש (למשל `dollar-alert`) והעלה אליו את כל הקבצים בתיקייה הזו.
4. **סודות:** במאגר, Settings → Secrets and variables → Actions → New repository secret. הוסף `TELEGRAM_BOT_TOKEN` ו-`TELEGRAM_CHAT_ID`.
5. **אתר:** Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.
6. **בדיקה:** Actions → Dollar rate check → Run workflow → סמן "Send a test message" → Run. אמורה להגיע הודעה בטלגרם.
7. **באייפון:** פתח ב-Safari את `https://<שם-המשתמש>.github.io/dollar-alert/`, לחץ שיתוף → "הוסף למסך הבית".

## פיתוח מקומי

```bash
node scripts/check.mjs --dry      # מעדכן את הנתונים בלי לשלוח הודעות
node scripts/dev-server.mjs       # http://localhost:5173
node dev/make-fixtures.mjs        # נתוני בדיקה קיצוניים, ואז ?data=worst
```
