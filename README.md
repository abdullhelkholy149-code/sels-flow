# SalesFlow

نظام توزيع منتجات عبر مناديب بيع إلى عملاء في مصر. تطبيق ويب بسيط (بدون وضع
offline)، بواجهة عربية من اليمين إلى اليسار، وطبقة خادم تتحقق من الصلاحيات
والأمان على كل استعلام.

التوثيق في `docs/`:

| الملف | المحتوى |
|---|---|
| [`docs/PHASES-PLAN.md`](docs/PHASES-PLAN.md) | خطة المراحل 0 إلى 12 ومعايير القبول |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | سجل التقدّم الفعلي وقائمة ما ينتظر التحقق |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | القرارات والبدائل والأسباب |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | دليل التشغيل والصيانة |
| [`docs/E-INVOICE.md`](docs/E-INVOICE.md) | الفاتورة الإلكترونية: بنية فقط، بلا تنفيذ |

## التشغيل على GitHub Codespaces (الطريقة المفضّلة)

اضغط **Code** في أعلى صفحة المستودع على GitHub. الـ devcontainer مبني في
`.devcontainer/` ويقوم تلقائياً بما يلي عند أول إنشاء:

1. يبني صورة التطوير ويشغّل PostgreSQL 16 بجانبه
2. ينشئ `.env` بأسرار تطوير مولّدة تلقائياً (لا تُنسخ من أي مكان)
3. يثبّت الحزم و`prisma generate`
4. يطبّق الترحيلات ويزرع أول حساب مدير
5. يعرض منفذ 3000 تلقائياً في المتصفح

بعدها داخل الـ Codespace:

```bash
npm run dev               # http://localhost:3000/ar
npm run worker            # طابور المهام
```

لإعادة بناء قاعدة البيانات من الصفر:

```bash
npm run db:setup          # ترحيلات + بذور
```

## التشغيل على جهاز محلي (بديل)

```bash
cp .env.example .env      # ثم عدّل الأسرار: openssl rand -base64 32
npm install
docker compose up         # postgres + migrate + app + worker
```

أو بدون Docker:

```bash
npm run dev
npm run worker
```

## التحقق قبل اعتبار أي مرحلة منتهية

```bash
npm run ci                # typecheck + lint + unit tests
npm run test:int          # اختبارات تكامل على PostgreSQL حقيقي
npm run test:e2e          # اختبارات المتصفح
```

## قواعد لا تُكسر

- المال: `NUMERIC(14,2)` و`decimal.js`. ممنوع أي `number` في حساب مالي.
- الكميات: `NUMERIC(14,3)`.
- كل معاملة مالية أو مخزنية داخل معاملة واحدة مع `SELECT ... FOR UPDATE`.
- المستندات المالية والمخزنية لا تُعدَّل ولا تُحذف بعد الترحيل. التصحيح بإشعار دائن.
- كل استعلام يمر بطبقة وصول تفحص النطاق على الخادم، وليس في الواجهة فقط.
- واجهة المستخدم بالعربي من ملفات الترجمة. لا نصوص ثابتة داخل المكونات.
- لا أسرار في المستودع. ولا بيانات وهمية خارج `prisma/seed.ts`.
