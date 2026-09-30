/**
 * The catalog half of the development seed, kept apart from `seed.ts` so it has
 * no side effects: importing this module neither opens a database connection nor
 * runs the seed. That lets a unit test check the shape of the data - above all
 * that every product names a unit and a category that exist - without a
 * PostgreSQL server, which is exactly the class of mistake that is otherwise
 * only found by running the seed.
 *
 * This is the ONLY file allowed to contain fake data (specification rule 5).
 */

/** A date as a `DATE` column wants it: midnight UTC, no time part. */
function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export interface SeedProduct {
  code: string;
  nameAr: string;
  nameEn: string;
  category: string;
  unit: string;
  packSize: number | null;
  cost: number;
  vatRate: number;
}

export const UNITS: ReadonlyArray<{ name: string; nameEn: string }> = [
  { name: 'قطعة', nameEn: 'piece' },
  { name: 'كرتونة', nameEn: 'carton' },
  { name: 'دستة', nameEn: 'dozen' },
  { name: 'كيلو', nameEn: 'kg' },
  { name: 'متر', nameEn: 'm' },
  { name: 'لتر', nameEn: 'litre' },
  { name: 'رول', nameEn: 'roll' },
  { name: 'باكيت', nameEn: 'pack' },
];

export const CATEGORIES: ReadonlyArray<{ name: string; nameEn: string }> = [
  { name: 'مشروبات', nameEn: 'Beverages' },
  { name: 'بقالة', nameEn: 'Groceries' },
  { name: 'منظفات', nameEn: 'Cleaning' },
  { name: 'عناية شخصية', nameEn: 'Personal care' },
  { name: 'معلبات وأرز', nameEn: 'Canned goods and rice' },
];

export const PRODUCTS: ReadonlyArray<SeedProduct> = [
  {
    code: 'BEV-001',
    nameAr: 'مياه معدنية 600 مل',
    nameEn: 'Mineral water 600ml',
    category: 'مشروبات',
    unit: 'قطعة',
    packSize: 12,
    cost: 4.5,
    vatRate: 14,
  },
  {
    code: 'BEV-002',
    nameAr: 'مياه معدنية 1.5 لتر',
    nameEn: 'Mineral water 1.5L',
    category: 'مشروبات',
    unit: 'قطعة',
    packSize: 6,
    cost: 9,
    vatRate: 14,
  },
  {
    code: 'BEV-003',
    nameAr: 'عصير برتقال 1 لتر',
    nameEn: 'Orange juice 1L',
    category: 'مشروبات',
    unit: 'قطعة',
    packSize: 6,
    cost: 28,
    vatRate: 14,
  },
  {
    code: 'BEV-004',
    nameAr: 'مشروب غازي 330 مل',
    nameEn: 'Soft drink 330ml',
    category: 'مشروبات',
    unit: 'قطعة',
    packSize: 24,
    cost: 11,
    vatRate: 14,
  },
  {
    code: 'BEV-005',
    nameAr: 'شاي فتلة 25 كيس',
    nameEn: 'Tea bags 25',
    category: 'مشروبات',
    unit: 'كرتونة',
    packSize: 12,
    cost: 155,
    vatRate: 14,
  },
  {
    code: 'BEV-006',
    nameAr: 'بودرة مشروب 200 جم',
    nameEn: 'Powdered drink 200g',
    category: 'مشروبات',
    unit: 'قطعة',
    packSize: 12,
    cost: 96,
    vatRate: 14,
  },
  {
    code: 'GRO-001',
    nameAr: 'أرز مصري 1 كجم',
    nameEn: 'Egyptian rice 1kg',
    category: 'بقالة',
    unit: 'كيلو',
    packSize: 10,
    cost: 42,
    vatRate: 14,
  },
  {
    code: 'GRO-002',
    nameAr: 'سكر 1 كجم',
    nameEn: 'Sugar 1kg',
    category: 'بقالة',
    unit: 'كيلو',
    packSize: 10,
    cost: 28,
    vatRate: 14,
  },
  {
    code: 'GRO-003',
    nameAr: 'زيت ذرة 800 مل',
    nameEn: 'Corn oil 800ml',
    category: 'بقالة',
    unit: 'قطعة',
    packSize: 12,
    cost: 62,
    vatRate: 14,
  },
  {
    code: 'GRO-004',
    nameAr: 'مكرونة 400 جم',
    nameEn: 'Pasta 400g',
    category: 'بقالة',
    unit: 'قطعة',
    packSize: 24,
    cost: 14,
    vatRate: 14,
  },
  {
    code: 'GRO-005',
    nameAr: 'عدس 1 كجم',
    nameEn: 'Lentils 1kg',
    category: 'بقالة',
    unit: 'كيلو',
    packSize: 10,
    cost: 38,
    vatRate: 0,
  },
  {
    code: 'GRO-006',
    nameAr: 'ملح طعام 1 كجم',
    nameEn: 'Table salt 1kg',
    category: 'بقالة',
    unit: 'كيلو',
    packSize: 10,
    cost: 6,
    vatRate: 0,
  },
  {
    code: 'CLN-001',
    nameAr: 'مسحوق غسيل 2 كجم',
    nameEn: 'Washing powder 2kg',
    category: 'منظفات',
    unit: 'قطعة',
    packSize: 6,
    cost: 118,
    vatRate: 14,
  },
  {
    code: 'CLN-002',
    nameAr: 'سائل جلي 1 لتر',
    nameEn: 'Dish soap 1L',
    category: 'منظفات',
    unit: 'لتر',
    packSize: 6,
    cost: 47,
    vatRate: 14,
  },
  {
    code: 'CLN-003',
    nameAr: 'منظف أرضيات 2 لتر',
    nameEn: 'Floor cleaner 2L',
    category: 'منظفات',
    unit: 'قطعة',
    packSize: 4,
    cost: 84,
    vatRate: 14,
  },
  {
    code: 'CLN-004',
    nameAr: 'معطر جو 300 مل',
    nameEn: 'Air freshener 300ml',
    category: 'منظفات',
    unit: 'قطعة',
    packSize: 12,
    cost: 39,
    vatRate: 14,
  },
  {
    code: 'CLN-005',
    nameAr: 'أكياس قمامة 30 كيس',
    nameEn: 'Bin liners 30',
    category: 'منظفات',
    unit: 'رول',
    packSize: 20,
    cost: 26,
    vatRate: 14,
  },
  {
    code: 'PER-001',
    nameAr: 'شامبو 400 مل',
    nameEn: 'Shampoo 400ml',
    category: 'عناية شخصية',
    unit: 'قطعة',
    packSize: 12,
    cost: 96,
    vatRate: 14,
  },
  {
    code: 'PER-002',
    nameAr: 'صابون استحمام 125 جم',
    nameEn: 'Bath soap 125g',
    category: 'عناية شخصية',
    unit: 'قطعة',
    packSize: 48,
    cost: 17,
    vatRate: 14,
  },
  {
    code: 'PER-003',
    nameAr: 'معجون أسنان 100 مل',
    nameEn: 'Toothpaste 100ml',
    category: 'عناية شخصية',
    unit: 'قطعة',
    packSize: 12,
    cost: 33,
    vatRate: 14,
  },
  {
    code: 'PER-004',
    nameAr: 'مناديل ورقية علبة',
    nameEn: 'Tissue box',
    category: 'عناية شخصية',
    unit: 'قطعة',
    packSize: 24,
    cost: 21,
    vatRate: 14,
  },
  {
    code: 'PER-005',
    nameAr: 'شفرة حلاقة 5 قطع',
    nameEn: 'Razor blades 5',
    category: 'عناية شخصية',
    unit: 'باكيت',
    packSize: 20,
    cost: 29,
    vatRate: 14,
  },
  {
    code: 'PER-006',
    nameAr: 'مزيل عرق 150 مل',
    nameEn: 'Deodorant 150ml',
    category: 'عناية شخصية',
    unit: 'قطعة',
    packSize: 12,
    cost: 54,
    vatRate: 14,
  },
  {
    code: 'CAN-001',
    nameAr: 'تونة 140 جم',
    nameEn: 'Tuna 140g',
    category: 'معلبات وأرز',
    unit: 'قطعة',
    packSize: 24,
    cost: 43,
    vatRate: 14,
  },
  {
    code: 'CAN-002',
    nameAr: 'فول مدمس 400 جم',
    nameEn: 'Fava beans 400g',
    category: 'معلبات وأرز',
    unit: 'قطعة',
    packSize: 12,
    cost: 26,
    vatRate: 14,
  },
  {
    code: 'CAN-003',
    nameAr: 'صلصة طماطم 400 جم',
    nameEn: 'Tomato paste 400g',
    category: 'معلبات وأرز',
    unit: 'قطعة',
    packSize: 12,
    cost: 31,
    vatRate: 14,
  },
  {
    code: 'CAN-004',
    nameAr: 'معجون تمر 400 جم',
    nameEn: 'Date paste 400g',
    category: 'معلبات وأرز',
    unit: 'قطعة',
    packSize: 12,
    cost: 74,
    vatRate: 14,
  },
  {
    code: 'CAN-005',
    nameAr: 'شوفان 500 جم',
    nameEn: 'Oats 500g',
    category: 'معلبات وأرز',
    unit: 'قطعة',
    packSize: 12,
    cost: 48,
    vatRate: 14,
  },
  {
    code: 'CAN-006',
    nameAr: 'حمص معلب 400 جم',
    nameEn: 'Chickpeas 400g',
    category: 'معلبات وأرز',
    unit: 'قطعة',
    packSize: 12,
    cost: 23,
    vatRate: 14,
  },
];

/**
 * Two price lists, each product with one closed window and one open window, so
 * the resolver has a history to choose from and the screens have a current price
 * and an expired one to show. The windows touch (31 March, then 1 April) without
 * overlapping, which is exactly the boundary the rule in D-018 allows.
 */
export const PRICE_LISTS: ReadonlyArray<{
  name: string;
  nameEn: string;
  markup: number;
}> = [
  { name: 'سعر التجزئة', nameEn: 'Retail price list', markup: 1.15 },
  { name: 'سعر الجملة', nameEn: 'Wholesale price list', markup: 1.08 },
];

export const FIRST_WINDOW = { validFrom: day('2026-01-01'), validTo: day('2026-03-31') };
export const CURRENT_WINDOW = { validFrom: day('2026-04-01'), validTo: null };
