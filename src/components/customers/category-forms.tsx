'use client';

/**
 * Customer category forms (Phase 3).
 *
 * Categories are reference data, not money: no decimals, no dates, no audit
 * trail beyond who typed the name. They live in the admin customers screen
 * because that is where an operator is already looking when they wonder why a
 * customer has no category.
 */
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import {
  CsrfField,
  Field,
  FieldErrors,
  FormMessage,
  InlineSubmitButton,
  SubmitButton,
} from '@/components/ui/form';
import {
  createCustomerCategoryAction,
  deleteCustomerCategoryAction,
  updateCustomerCategoryAction,
} from '@/server/customers/actions';

export interface CategoryOption {
  id: string;
  name: string;
  nameEn: string | null;
  customerCount: number;
}

export function CreateCategoryForm() {
  const t = useTranslations('customers');
  const [state, formAction] = useActionState(createCustomerCategoryAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <FieldErrors errors={errors} />
      <Field label={t('categoryName')} name="name" autoComplete="off" error={errors.name} />
      <Field
        label={t('nameEn')}
        name="nameEn"
        dir="ltr"
        required={false}
        autoComplete="off"
        error={errors.nameEn}
      />
      <FormMessage result={state} />
      <SubmitButton className="w-full">{t('addCategory')}</SubmitButton>
    </form>
  );
}

/**
 * One row per category: rename in place, or delete.
 *
 * A category in use cannot be deleted, and the button says so rather than
 * failing on submit - the same wording the service uses, so the screen and the
 * rule do not disagree.
 */
export function CategoryRow({ category }: { category: CategoryOption }) {
  const t = useTranslations('customers');
  const [state, formAction] = useActionState(updateCustomerCategoryAction, null);
  const [deleteState, deleteAction] = useActionState(deleteCustomerCategoryAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <tr className="border-b border-surface-border/60">
      <td className="p-2">
        <form action={formAction} className="flex flex-wrap items-start gap-2">
          <CsrfField />
          <input type="hidden" name="categoryId" value={category.id} />
          <span className="sr-only">{t('categoryName')}</span>
          <input
            name="name"
            defaultValue={category.name}
            aria-label={t('categoryName')}
            className="rounded-card border border-surface-border bg-white px-2 py-1 text-sm"
          />
          <input
            name="nameEn"
            defaultValue={category.nameEn ?? ''}
            dir="ltr"
            aria-label={t('nameEn')}
            className="rounded-card border border-surface-border bg-white px-2 py-1 text-sm"
          />
          <InlineSubmitButton>{t('saveChanges')}</InlineSubmitButton>
          {errors.name ? <span className="text-xs text-danger">{errors.name}</span> : null}
        </form>
      </td>
      <td className="p-2 text-ink-muted">{category.customerCount}</td>
      <td className="p-2">
        <form action={deleteAction}>
          <CsrfField />
          <input type="hidden" name="categoryId" value={category.id} />
          <InlineSubmitButton variant="danger" disabled={category.customerCount > 0}>
            {category.customerCount > 0 ? t('deleteBlockedByCustomers') : t('delete')}
          </InlineSubmitButton>
          {deleteState?.ok ? (
            <span className="ms-2 text-xs text-success">{deleteState.message}</span>
          ) : null}
        </form>
      </td>
    </tr>
  );
}
