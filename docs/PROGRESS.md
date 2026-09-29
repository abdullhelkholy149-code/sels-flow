# سجل التقدّم — SalesFlow

هذا الملف هو السجل الرسمي لتقدّم المراحل. يُحدَّث في **بداية** كل مرحلة (الخطة) وفي
**نهايتها** (الملخص + نتائج التحقق + الـ commit).

---

## حالة التقدّم الحالية

| المرحلة | الحالة | معيار القبول | التحقق |
|---|---|---|---|
| 0 Bootstrap | قيد التنفيذ | `docker compose up` → صفحة عربية RTL + اختبارات خضراء | ⛔ معلّق (لا توجد أدوات على الجهاز) |
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

## ⛔ بانتظار التحقق (Verification Blockers)

هذه البيئة **لا تحتوي** على Node.js أو Docker أو PostgreSQL. لذلك كل ما يلي مكتوب
لكن **لم يُنفَّذ بعد**. لا تُعتبر أي مرحلة منتهية قبل تشغيل هذه القائمة:

```bash
npm install
npm run db:generate          # prisma generate
npm run db:migrate           # إنشاء أول migration + تطبيقها على قاعدة بيانات فارغة
npm run typecheck            # tsc --noEmit
npm run lint                 # eslint
npm run test                 # vitest run (unit)
npm run test:int             # vitest run (يحتاج قاعدة بيانات اختبار)
npm run ci                   # السلسلة كاملة
docker compose up            # app + postgres + worker
```

### قاعدة بيانات الاختبار

```bash
docker compose -f docker-compose.test.yml up -d
npm run test:int
```

### قائمة تدقيق يدوية قبل إعلان المرحلة 0 منتهية

- [ ] `docker compose up` يقلع بنجاح والصفحة العربية تظهر RTL على `/ar`
- [ ] `GET /api/health` يرجع `200` مع `{"status":"ok","checks":{"database":"up"}}`
- [ ] `npx prisma migrate dev` أنشأ `prisma/migrations/0_init/migration.sql` بلا أخطاء
- [ ] `npx prisma migrate status` نظيف على قاعدة فارغة وعلى قاعدة مُبذورة
- [ ] `npm run typecheck` بلا أخطاء
- [ ] `npm run lint` بلا أخطاء
- [ ] `npm run test` أخضر
- [ ] `npm run format:check` بلا أخطاء
- [ ] كل الأسرار من ملف `.env` فقط، ولا قيم سرية داخل المستودع

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

⛔ **معلّقة** — بانتظار `npm install && npm run ci` (انظر القائمة أعلاه).

### الـ Commit

`phase-0: bootstrap project, docker compose, prisma, rtl arabic shell, health endpoint`
