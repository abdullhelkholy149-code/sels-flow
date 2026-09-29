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

## المتطلبات

- Node.js 22 LTS
- Docker (للتشغيل المحلي الكامل) أو PostgreSQL 16 محلياً

## التشغيل

```bash
cp .env.example .env      # ثم عدّل الأسرار: openssl rand -base64 32
npm install
docker compose up         # postgres + migrate + app + worker
```

أو محلياً بدون Docker:

```bash
npm run dev               # التطبيق على http://localhost:3000/ar
npm run worker            # طابور المهام
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
