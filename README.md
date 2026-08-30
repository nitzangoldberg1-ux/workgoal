# WorkGoal – GitHub Pages + Firebase

## קישורים לאחר פרסום
אם ה-Repository שלך נקרא `workgoal`:
- שחקנים: `https://USERNAME.github.io/workgoal/`
- מנהל: `https://USERNAME.github.io/workgoal/admin.html`

## 1. Firebase
1. היכנס ל-Firebase Console וצור Project חדש.
2. Build → Firestore Database → Create database.
3. Authentication → Sign-in method:
   - Enable **Anonymous** לשחקנים.
   - Enable **Email/Password** למנהל.
4. Authentication → Users → Add user וצור חשבון מנהל עם אימייל וסיסמה.
5. Project settings → Your apps → Web app → Register app.
6. העתק את `firebaseConfig` והדבק בקובץ `firebase-config.js`.
7. בקובץ `firebase-config.js` החלף את `ADMIN_EMAIL` באימייל המנהל.
8. בקובץ `firestore.rules` החלף `your-admin@email.com` באותו אימייל והדבק את הכל ב-Firestore → Rules → Publish.

## 2. GitHub Pages
העלה את כל הקבצים ל-Repository.
Settings → Pages → Deploy from a branch → main / root → Save.

## מה עובד בגרסה הזו
- שני קישורים: ממשק שחקן וממשק מנהל.
- ברירת מחדל 4 קבוצות × 5 שחקנים, וניתן לשנות.
- הרשמת שחקן בשם מלא.
- מנהל מגריל קבוצות, מזיז שחקנים בין קבוצות וחושף אותן.
- שעון משחק: הגדרת דקות/שניות, הפעלה, עצירה, המשך ואיפוס.
- השעון מסתנכרן גם למסך השחקנים לאחר חשיפת הקבוצות.
- לוח תוצאות חי: המנהל בוחר אילו שתי קבוצות משחקות כרגע.
- הוספת גול עם בחירת כובש ומבשל.
- התוצאה, הגולים והבישולים מתעדכנים אוטומטית ב-Firebase ובפרופילי השחקנים.
- ביטול גול במקרה של טעות, כולל תיקון התוצאה והסטטיסטיקה.
- איפוס תוצאה ואירועי גולים.
- בסיום משחק המנהל מסמן MVP וניצחון ושומר משחק אחד לכל שחקן.
- פרופיל שחקן: משחקים, גולים, בישולים, MVP, ניצחונות ואחוז ניצחונות.

## הערת MVP חשובה
כרגע הסטטיסטיקה המצטברת נמצאת במסמכי השחקנים של המשחק `current`. לגרסה מלאה עם היסטוריה רב-משחקית וקביעות של פרופיל לאורך זמן, מומלץ בשלב הבא ליצור collections נפרדים: `users`, `matches`, `matchPlayers`, `events`.
