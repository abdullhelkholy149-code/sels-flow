# التشغيل والصيانة — SalesFlow

هذا الملف دليل تشغيل. يُستكمل مرحلةً بمرحلة. المرحلة الحادية عشرة تجعله
كاملاً: نسخ احتياطي، استعادة، نشر، مراقبة.

> الحالة الحالية: التشغيل على GitHub Codespaces مُتحقَّق من إعداداته، والتحقق
> الآلي نجح. التشغيل الفعلي على PostgreSQL متبقٍ. انظر `PROGRESS.md`.

---

## 1. بيئات التطوير

| البيئة | الاستخدام | الحالة |
|---|---|---|
| **GitHub Codespaces** | التطوير اليومي | ✅ مُهيّأ في `.devcontainer/` |
| جهاز محلي + Docker | بديل | يعمل بنفس الملفات |

### 1.1 GitHub Codespaces (الطريقة المعتمدة)

اضغط **Code** في أعلى صفحة المستودع. يحدث التالي تلقائياً:

1. يُبنى `Dockerfile` حتى مرحلة `dev` (Node 22 + `postgresql-client`)
2. تشتغل خدمة `postgres` من `.devcontainer/docker-compose.yml`
3. ينشئ `post-create.sh` ملف `.env` بأسرار تطوير مولّدة، **ولا يُستنسخ أي سر من GitHub**
4. `npm ci` ثم `prisma generate`
5. `prisma migrate deploy` ثم `prisma db seed`
6. يُفتح منفذ 3000 في المتصفح تلقائياً

بعدها:

```bash
npm run dev               # http://localhost:3000/ar
npm run worker            # طرفية ثانية
npm run test:int          # اختبارات التكامل (قاعدة salesflow_test)
npm run db:setup          # ترحيلات + بذور من جديد
```

ملاحظات مهمة:

- **`.env` لا يُودَع** (في `.gitignore`). إن حُذف، يُعاد إنشاؤه تلقائياً.
- **`APP_URL`**: روابط المشاركة في الفواتير تستخدم `APP_URL`. في Codespaces عنوان
  المنفذ يتغير، فحدّثه من متغير بيئة الـ Codespace عند استخدام الروابط.
- **قاعدة البيانات دائمة** في volume باسم `postgres-data`. لإعادة قاعدة نظيفة:
  `docker compose -f .devcontainer/docker-compose.yml down -v`.
- **الاعتماديات** في volume منفصل عن الـ bind mount، فإعادة بناء الصورة لا تمسّها.

### 1.2 المتطلبات للتشغيل المحلي

| الأداة | النسخة | ملاحظة |
|---|---|---|
| Node.js | 22 LTS | مطلوب للتطوير والبناء |
| Docker Desktop | أحدث إصدار | لـ compose وقاعدة البيانات |
| PostgreSQL | 16 | عبر compose، أو محلي للتطوير |

---

## 2. التشغيل المحلي

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev          # التطبيق
npm run worker       # طابور المهام في طرفية منفصلة
```

على ويندوز PowerShell، بدل `cp` استخدم:

```powershell
Copy-Item .env.example .env
```

ولتوليد أسرار حقيقية على ويندوز:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

بدون Docker محلياً، شغّل Postgres محلياً وحدّث `DATABASE_URL` في `.env`.

---

## 3. الخدمات في compose

| الخدمة | الدور | المنفذ |
|---|---|---|
| `postgres` | قاعدة البيانات | 5432 داخلياً |
| `app` | تطبيق Next.js | 3000 |
| `worker` | طابور المهام (pg-boss) | لا يوجد |

---

## 4. متغيرات البيئة

كلها في `.env` من `.env.example`. لا يُكتب أي سر في المستودع.
`src/config/env.ts` يتحقق منها بـ Zod عند الإقلاع ويفشل مبكراً إن نقصت.

---

## 5. قاعدة البيانات

```bash
npm run db:generate     # توليد عميل Prisma
npm run db:migrate      # تطبيق الترحيلات
npm run db:deploy       # تطبيق الترحيلات في الإنتاج فقط
npm run db:seed         # بيانات تجريبية
npm run db:studio       # متصفح البيانات
```

---

## 6. النسخ الاحتياطي والاستعادة

> ستُستكمل في المرحلة الحادية عشرة مع تمرين فعلي وتوثيق المدة الزمنية.

نسخة احتياطية يومية:

```bash
pg_dump --format=custom --file backup_$(date +%F).dump "$DATABASE_URL"
```

استعادة:

```bash
pg_restore --clean --if-exists --dbname "$DATABASE_URL" backup_YYYY-MM-DD.dump
```

---

## 7. النشر

> لم يُحدد بعد. سيُوثَّق في المرحلة الحادية عشرة بعد قرار استضافة نهائي.

---

## 8. المراقبة والسجلات

- سجلات منظّمة JSON على stdout عبر pino، بحقل `requestId` و`userId` عند توفره.
- نقطة فحص الصحة: `GET /api/health`.
- عند فشل خدمة أو ارتفاع زمن الاستجابة: راجع الحاوية عبر `docker compose logs`.
