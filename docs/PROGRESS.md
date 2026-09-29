# سجل التقدّم — SalesFlow

هذا الملف هو السجل الرسمي لتقدّم المراحل. يُحدَّث في **بداية** كل مرحلة (الخطة) وفي
**نهايتها** (الملخص + نتائج التحقق + الـ commit).

---

## حالة التقدّم الحالية

| المرحلة | الحالة | معيار القبول | التحقق |
|---|---|---|---|
| 0 Bootstrap | **منتهية ومتحقَّقة** | صفحة عربية RTL + اختبارات خضراء | ✅ خط الأنابيب على PostgreSQL |
| 1 Auth/RBAC | لم تبدأ | — | — |
| 2 الكتالوج والتسعير | لم تبدأ | — | — |
| 3 المناديب والعملاء | لم تبدأ | — | — |
| 4 المخازن والعهدة | لم تبدأ | — | — |
| 5 الطلبيات | لم تبدأ | — | — |
| 6 الفواتير والمال | لم تبدأ | — | — |
| 7 الزيارات والمسارات | لم تبدأ | — | — |
| 8 المرتجعات | لم تبدأ | — | — |
| 9 التقييمات والإشعارات | لم تبدأ | — | — |
| 10 اللوحات والتقارير | لم تبدأ | — | — |
| 11 التصلب | لم تبدأ | — | — |
| 12 الفاتورة الإلكترونية | **ممنوعة إلا بتعليم صريح** | — | — |

---

## ✅ ما تم التحقق منه فعلياً

البيئة المعتمدة للتطوير هي **GitHub Codespaces** (حاوية لينكس + PostgreSQL)،
لأن جهاز التطوير لا يحمل Node ولا Docker. نتيجة الفحوص على Node 24 / npm 11:

| الأمر | النتيجة |
|---|---|
| `npm install` | 488 حزمة، صفر ثغرات |
| `npm run db:generate` | نجح |
| `npm run typecheck` | نظيف |
| `npm run lint` | نظيف |
| `npm run format:check` | نظيف |
| `npm run test` | 34/34 ناجحة |
| `npm run db:validate` | المخطط صالح |
| `npx prisma migrate diff` | أنشأ `prisma/migrations/20260101000000_init_foundation/` |
| `npm run build` | نجح، `/ar` و`/en` مبنيّان static |
| `npm audit --audit-level=high` | صفر (كانت 15 منها 3 حرجة) |

## ⏳ بانتظار التحقق (على PostgreSQL حقيقي)

الترحيلات مولَّدة والبناء ناجح، لكن لم يُشغَّل شيء مقابل قاعدة بيانات بعد.
أول تشغيل في Codespaces يغطي هذه القائمة:

```bash
npm run db:setup          # prisma migrate deploy + prisma db seed
npm run test:int          # اختبارات التكامل على salesflow_test
npm run dev               # ثم افتح /ar وتأكد أن الاتجاه RTL
curl -i localhost:3000/api/health   # يتوقع 200 و database: up
npm run build && npm start
```

### قائمة تدقيق يدوية قبل إعلان المرحلة 0 منتهية

- [x] `npm run typecheck` بلا أخطاء
- [x] `npm run lint` بلا أخطاء
- [x] `npm run format:check` بلا أخطاء
- [x] `npm run test` أخضر (34/34)
- [x] `npm run db:validate` والمخطط صالح
- [x] `npm run build` ناجح
- [x] `npm audit --audit-level=high` صفر
- [x] `prisma/migrations/` مولَّدة ومُودعة مع `migration_lock.toml`
- [x] لا قيم سرية داخل المستودع؛ الأسرار من `.env` فقط
- [ ] `npm run db:setup` يطبّق الترحيلات على قاعدة فارغة
- [ ] `npm run test:int` أخضر
- [ ] `/ar` تظهر RTL والصفحة تقرأ بالعربية
- [ ] `GET /api/health` يرجع `200` مع `{"status":"ok","checks":{"database":"up"}}`
- [ ] `npm run build && npm start` يعمل خارج بيئة التطوير

### التحقق من خط الأنابيع على GitHub

خط الأنابيب يغطي ما لا يمكن التحقق منه إلا على PostgreSQL حقيقي، وهو بالتالي
الدليل النهائي للمرحلة صفر:

| Job | ماذا يثبت |
|---|---|
| `verify` | الأنواع والفحص والتنسيق، المخطط، الترحيلات على قاعدة فارغة، وحدات، تكامل، صفر ثغرات |
| `serve` | البناء، تشغيل السيرفر، `database: up`، `/ar` بـ `dir="rtl"`، ترويسات الأمان |

آخر تشغيل: `main` @ `c8742ac` — كلا الـ job ناجحين.

## ✅ حالة المرحلة 0

**منتهية ومتحقَّقة.** كل عناصر معيار القبول أعلاه تحققت منها خط الأنابيب على
PostgreSQL 16 حقيقي. لا شيء متبقٍ قبل المرحلة الأولى.

---

## المرحلة 0 — Bootstrap

### الخطة (بداية المرحلة)

1. هيكل المجلدات: `src/app`, `src/lib`, `src/i18n`, `src/config`, `tests/{unit,integration,e2e}`, `prisma`, `docs`, `scripts`.
2. إعداد السلسلة: TypeScript صارم، ESLint مسطّح، Prettier، سكريبتات npm.
3. Docker Compose: `postgres` + `app` + `worker`، و Dockerfile متعدد المراحل على `node:22-bookworm-slim`.
4. Prisma: مخطط الأساس (المستخدمون/الأدوار/إعدادات الشركة/سجل التدقيق/عدّاد المستندات) + مولّد العميل الوحيد.
5. i18n: عربي افتراضي RTL، إنجليزي جاهز، `next-intl` عبر middleware.
6. هيكل الواجهة: design tokens في Tailwind، shell بسيط (Header/Container) + صفحة ترحيب عربية.
7. `/api/health` مع فحص الاتصال بقاعدة البيانات.
8. PWA: manifest + أيقونة (بدون تخزين offline).
9. تسجيل منظّم (`pino`) مع `requestId` وسكربت CI وهيكل التوثيق.
10. اختبارات وحدة: تطابق مفاتيح الترجمة بين العربية والإنجليزية، وتحقق من متغيرات البيئة، وتنسيق المال والكميات والتواريخ.

### الملخص (نهاية المرحلة)

انظر [`docs/phase-0-summary.md`](./phase-0-summary.md).

### نتائج التحقق

✅ **آلياً مكتمل** — كل ما لا يحتاج قاعدة بيانات (الجدول أعلاه).
⏳ **معلّق** — الترحيلات على PostgreSQL حقيقي و`/api/health` و`test:int`.

### الـ Commit

- `phase-0: bootstrap project, docker compose, prisma, rtl arabic shell, health endpoint`
- `phase-0: verify phase 0, patch money and date formatting, add codespaces devcontainer`
