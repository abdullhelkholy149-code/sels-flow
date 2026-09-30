'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import {
  CsrfField,
  Field,
  FieldErrors,
  FormMessage,
  InlineSubmitButton,
  SelectField,
  SubmitButton,
  type ActionResult,
} from '@/components/ui/form';
import {
  createCategoryAction,
  createPriceListAction,
  createPriceListItemAction,
  createProductAction,
  createUnitAction,
  deleteCategoryAction,
  deletePriceListAction,
  deletePriceListItemAction,
  deleteProductAction,
  deleteUnitAction,
  setProductActiveAction,
  updateCategoryAction,
  updatePriceListAction,
  updatePriceListItemAction,
  updateProductAction,
  updateUnitAction,
} from '@/server/catalog/actions';

export interface Option {
  value: string;
  label: string;
}

export function CreateCategoryForm() {
  const t = useTranslations('catalog');
  const [state, formAction] = useActionState(createCategoryAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <FieldErrors errors={state && !state.ok ? state.errors : {}} />
      <Field
        label={t('categoryName')}
        name="name"
        autoComplete="off"
        error={state && !state.ok ? state.errors.name : undefined}
      />
      <Field
        label={t('nameEn')}
        name="nameEn"
        dir="ltr"
        required={false}
        error={state && !state.ok ? state.errors.nameEn : undefined}
      />
      <FormMessage result={state} />
      <SubmitButton className="w-full">{t('addCategory')}</SubmitButton>
    </form>
  );
}

export function CreateUnitForm() {
  const t = useTranslations('catalog');
  const [state, formAction] = useActionState(createUnitAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <FieldErrors errors={state && !state.ok ? state.errors : {}} />
      <Field
        label={t('unitName')}
        name="name"
        autoComplete="off"
        error={state && !state.ok ? state.errors.name : undefined}
      />
      <Field
        label={t('nameEn')}
        name="nameEn"
        dir="ltr"
        required={false}
        error={state && !state.ok ? state.errors.nameEn : undefined}
      />
      <FormMessage result={state} />
      <SubmitButton className="w-full">{t('addUnit')}</SubmitButton>
    </form>
  );
}

export function CreateProductForm({
  categories,
  units,
  defaultVatRate,
}: {
  categories: Option[];
  units: Option[];
  defaultVatRate: string;
}) {
  const t = useTranslations('catalog');
  const [state, formAction] = useActionState(createProductAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <FieldErrors errors={errors} />
      <Field
        label={t('productCode')}
        name="code"
        dir="ltr"
        autoComplete="off"
        error={errors.code}
      />
      <Field label={t('productNameAr')} name="nameAr" error={errors.nameAr} />
      <Field label={t('nameEn')} name="nameEn" dir="ltr" required={false} error={errors.nameEn} />
      <SelectField
        label={t('category')}
        name="categoryId"
        options={categories}
        error={errors.categoryId}
      />
      <SelectField label={t('unit')} name="unitId" options={units} error={errors.unitId} />
      <Field
        label={t('packSize')}
        name="packSize"
        type="text"
        inputMode="decimal"
        dir="ltr"
        required={false}
        error={errors.packSize}
      />
      <Field
        label={t('vatRate')}
        name="vatRate"
        type="text"
        inputMode="decimal"
        dir="ltr"
        defaultValue={defaultVatRate}
        error={errors.vatRate}
      />
      <Field
        label={t('costPrice')}
        name="costPrice"
        type="text"
        inputMode="decimal"
        dir="ltr"
        required={false}
        error={errors.costPrice}
      />
      <FormMessage result={state} />
      <SubmitButton className="w-full">{t('addProduct')}</SubmitButton>
    </form>
  );
}

export function ProductActiveToggle({
  productId,
  isActive,
}: {
  productId: string;
  isActive: boolean;
}) {
  const t = useTranslations('catalog');
  const [state, formAction] = useActionState(setProductActiveAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <CsrfField />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
      <InlineSubmitButton variant={isActive ? 'secondary' : 'primary'}>
        {isActive ? t('deactivate') : t('activate')}
      </InlineSubmitButton>
      <FormMessage result={state} />
    </form>
  );
}

export function DeleteProductButton({ productId }: { productId: string }) {
  const t = useTranslations('catalog');
  const [state, formAction] = useActionState(deleteProductAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <CsrfField />
      <input type="hidden" name="productId" value={productId} />
      <InlineSubmitButton variant="danger">{t('delete')}</InlineSubmitButton>
      <FormMessage result={state} />
    </form>
  );
}

/**
 * A delete control for a master record that is not on the main table (a category
 * or a unit). The same three steps as everything else; the service refuses if the
 * record is still in use, and the message comes back to this row.
 */
export function DeleteNamedRecordButton({
  recordId,
  action,
}: {
  recordId: string;
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}) {
  const t = useTranslations('catalog');
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="shrink-0">
      <CsrfField />
      <input type="hidden" name="productId" value={recordId} />
      <button
        type="submit"
        className="rounded-md px-2 py-1 text-xs text-danger hover:bg-danger-soft"
      >
        {t('delete')}
      </button>
      {state && !state.ok && state.message ? (
        <span role="alert" className="mt-1 block text-2xs text-danger">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function CategoryList({
  categories,
}: {
  categories: ReadonlyArray<{
    id: string;
    name: string;
    nameEn: string | null;
    productCount: number;
  }>;
}) {
  const t = useTranslations('catalog');
  if (categories.length === 0) return null;

  return (
    <ul className="mb-4 flex flex-col gap-1">
      {categories.map((category) => (
        <li
          key={category.id}
          className="flex items-center justify-between gap-2 rounded-card bg-surface-muted px-3 py-1.5 text-sm"
        >
          <span className="truncate text-ink-muted">
            {category.name}
            <span className="ms-2 text-2xs text-ink-subtle">
              {t('productCount', { count: category.productCount })}
            </span>
          </span>
          <NamedRecordEditor
            id={category.id}
            name={category.name}
            nameEn={category.nameEn ?? ''}
            nameLabel={t('categoryName')}
            idField="categoryId"
            updateAction={updateCategoryAction}
            deleteAction={deleteCategoryAction}
          />
        </li>
      ))}
    </ul>
  );
}

export function UnitList({
  units,
}: {
  units: ReadonlyArray<{ id: string; name: string; nameEn: string | null; productCount: number }>;
}) {
  const t = useTranslations('catalog');
  if (units.length === 0) return null;

  return (
    <ul className="mb-4 flex flex-col gap-1">
      {units.map((unit) => (
        <li
          key={unit.id}
          className="flex items-center justify-between gap-2 rounded-card bg-surface-muted px-3 py-1.5 text-sm"
        >
          <span className="truncate text-ink-muted">
            {unit.name}
            <span className="ms-2 text-2xs text-ink-subtle">
              {t('productCount', { count: unit.productCount })}
            </span>
          </span>
          <NamedRecordEditor
            id={unit.id}
            name={unit.name}
            nameEn={unit.nameEn ?? ''}
            nameLabel={t('unitName')}
            idField="unitId"
            updateAction={updateUnitAction}
            deleteAction={deleteUnitAction}
          />
        </li>
      ))}
    </ul>
  );
}

export function DeletePriceListButton({ priceListId }: { priceListId: string }) {
  const t = useTranslations('pricing');
  const [state, formAction] = useActionState(deletePriceListAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <CsrfField />
      <input type="hidden" name="productId" value={priceListId} />
      <InlineSubmitButton variant="danger">{t('deleteList')}</InlineSubmitButton>
      <FormMessage result={state} />
    </form>
  );
}

export function CreatePriceListForm() {
  const t = useTranslations('pricing');
  const [state, formAction] = useActionState(createPriceListAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <FieldErrors errors={state && !state.ok ? state.errors : {}} />
      <Field
        label={t('listName')}
        name="name"
        autoComplete="off"
        error={state && !state.ok ? state.errors.name : undefined}
      />
      <Field
        label={t('nameEn')}
        name="nameEn"
        dir="ltr"
        required={false}
        error={state && !state.ok ? state.errors.nameEn : undefined}
      />
      <FormMessage result={state} />
      <SubmitButton className="w-full">{t('addList')}</SubmitButton>
    </form>
  );
}

export function AddPriceForm({
  priceLists,
  products,
}: {
  priceLists: Option[];
  products: Option[];
}) {
  const t = useTranslations('pricing');
  const [state, formAction] = useActionState(createPriceListItemAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <FieldErrors errors={errors} />
      <SelectField label={t('listName')} name="priceListId" options={priceLists} />
      <SelectField label={t('product')} name="productId" options={products} />
      <Field
        label={t('priceExcludingVat')}
        name="price"
        type="text"
        inputMode="decimal"
        dir="ltr"
        error={errors.price}
      />
      <Field
        label={t('validFrom')}
        name="validFrom"
        type="date"
        dir="ltr"
        error={errors.validFrom}
      />
      <Field
        label={t('validTo')}
        name="validTo"
        type="date"
        dir="ltr"
        required={false}
        error={errors.validTo}
      />
      <p className="text-xs text-ink-subtle">{t('windowHint')}</p>
      <FormMessage result={state} />
      <SubmitButton className="w-full">{t('addPrice')}</SubmitButton>
    </form>
  );
}

/** The product fields an edit form shows, already trimmed to plain strings. */
export interface EditableProduct {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  categoryId: string;
  unitId: string;
  packSize: string;
  vatRate: string;
  costPrice: string;
  isActive: boolean;
}

/**
 * The product edit form, collapsed behind a summary so the table stays readable.
 * `isActive` rides along as a hidden field: the update action replaces the whole
 * product, and the status has its own toggle, so this form must not reset it.
 */
export function EditProductForm({
  product,
  categories,
  units,
}: {
  product: EditableProduct;
  categories: Option[];
  units: Option[];
}) {
  const t = useTranslations('catalog');
  const [state, formAction] = useActionState(updateProductAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <details className="w-full">
      <summary className="cursor-pointer text-xs text-brand-700">{t('edit')}</summary>
      <form action={formAction} className="mt-2 flex w-64 flex-col gap-3" noValidate>
        <CsrfField />
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="isActive" value={product.isActive ? 'true' : 'false'} />
        <FieldErrors errors={errors} />
        <Field
          label={t('productCode')}
          name="code"
          dir="ltr"
          autoComplete="off"
          defaultValue={product.code}
          error={errors.code}
        />
        <Field
          label={t('productNameAr')}
          name="nameAr"
          defaultValue={product.nameAr}
          error={errors.nameAr}
        />
        <Field
          label={t('nameEn')}
          name="nameEn"
          dir="ltr"
          required={false}
          defaultValue={product.nameEn}
          error={errors.nameEn}
        />
        <SelectField
          label={t('category')}
          name="categoryId"
          options={categories}
          defaultValue={product.categoryId}
          error={errors.categoryId}
        />
        <SelectField
          label={t('unit')}
          name="unitId"
          options={units}
          defaultValue={product.unitId}
          error={errors.unitId}
        />
        <Field
          label={t('packSize')}
          name="packSize"
          inputMode="decimal"
          dir="ltr"
          required={false}
          defaultValue={product.packSize}
          error={errors.packSize}
        />
        <Field
          label={t('vatRate')}
          name="vatRate"
          inputMode="decimal"
          dir="ltr"
          defaultValue={product.vatRate}
          error={errors.vatRate}
        />
        <Field
          label={t('costPrice')}
          name="costPrice"
          inputMode="decimal"
          dir="ltr"
          required={false}
          defaultValue={product.costPrice}
          error={errors.costPrice}
        />
        <FormMessage result={state} />
        <InlineSubmitButton variant="primary">{t('save')}</InlineSubmitButton>
      </form>
    </details>
  );
}

/**
 * Rename-and-delete control for a master record (a category, a unit or a price
 * list). The update action and the id field name differ per record, so both are
 * passed in; nothing else changes.
 */
export function NamedRecordEditor({
  id,
  name,
  nameEn,
  nameLabel,
  idField,
  updateAction,
  deleteAction,
}: {
  id: string;
  name: string;
  nameEn: string;
  nameLabel: string;
  idField: string;
  updateAction: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  deleteAction: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}) {
  const t = useTranslations('catalog');
  const [state, formAction] = useActionState(updateAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <div className="flex shrink-0 items-center gap-2">
      <details>
        <summary className="cursor-pointer text-xs text-brand-700">{t('edit')}</summary>
        <form action={formAction} className="mt-2 flex w-56 flex-col gap-2" noValidate>
          <CsrfField />
          <input type="hidden" name={idField} value={id} />
          <FieldErrors errors={errors} />
          <Field label={nameLabel} name="name" defaultValue={name} error={errors.name} />
          <Field
            label={t('nameEn')}
            name="nameEn"
            dir="ltr"
            required={false}
            defaultValue={nameEn}
            error={errors.nameEn}
          />
          <FormMessage result={state} />
          <InlineSubmitButton variant="primary">{t('save')}</InlineSubmitButton>
        </form>
      </details>
      <DeleteNamedRecordButton recordId={id} action={deleteAction} />
    </div>
  );
}

/** Renames the price list currently open in the right hand column. */
export function EditPriceListForm({
  priceList,
}: {
  priceList: { id: string; name: string; nameEn: string };
}) {
  const t = useTranslations('pricing');
  const [state, formAction] = useActionState(updatePriceListAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <details>
      <summary className="cursor-pointer text-xs text-brand-700">{t('edit')}</summary>
      <form action={formAction} className="mt-2 flex w-56 flex-col gap-2" noValidate>
        <CsrfField />
        <input type="hidden" name="priceListId" value={priceList.id} />
        <FieldErrors errors={errors} />
        <Field
          label={t('listName')}
          name="name"
          defaultValue={priceList.name}
          error={errors.name}
        />
        <Field
          label={t('nameEn')}
          name="nameEn"
          dir="ltr"
          required={false}
          defaultValue={priceList.nameEn}
          error={errors.nameEn}
        />
        <FormMessage result={state} />
        <InlineSubmitButton variant="primary">{t('save')}</InlineSubmitButton>
      </form>
    </details>
  );
}

/** The price and window of one existing price row, plus its removal. */
export interface EditablePriceItem {
  id: string;
  price: string;
  validFrom: string;
  validTo: string;
}

export function PriceItemActions({ item }: { item: EditablePriceItem }) {
  const t = useTranslations('pricing');
  const [state, formAction] = useActionState(updatePriceListItemAction, null);
  const [deleteState, deleteFormAction] = useActionState(deletePriceListItemAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <div className="flex flex-col gap-2">
      <details>
        <summary className="cursor-pointer text-xs text-brand-700">{t('editPrice')}</summary>
        <form action={formAction} className="mt-2 flex w-56 flex-col gap-2" noValidate>
          <CsrfField />
          <input type="hidden" name="priceItemId" value={item.id} />
          <FieldErrors errors={errors} />
          <Field
            label={t('priceExcludingVat')}
            name="price"
            inputMode="decimal"
            dir="ltr"
            defaultValue={item.price}
            error={errors.price}
          />
          <Field
            label={t('validFrom')}
            name="validFrom"
            type="date"
            dir="ltr"
            defaultValue={item.validFrom}
            error={errors.validFrom}
          />
          <Field
            label={t('validTo')}
            name="validTo"
            type="date"
            dir="ltr"
            required={false}
            defaultValue={item.validTo}
            error={errors.validTo}
          />
          <FormMessage result={state} />
          <InlineSubmitButton variant="primary">{t('save')}</InlineSubmitButton>
        </form>
      </details>
      <form action={deleteFormAction}>
        <CsrfField />
        <input type="hidden" name="productId" value={item.id} />
        <InlineSubmitButton variant="danger">{t('deletePrice')}</InlineSubmitButton>
        <FormMessage result={deleteState} />
      </form>
    </div>
  );
}
