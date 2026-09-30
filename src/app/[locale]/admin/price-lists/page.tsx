import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  AddPriceForm,
  CreatePriceListForm,
  DeletePriceListButton,
  EditPriceListForm,
  PriceItemActions,
  type EditablePriceItem,
  type Option,
} from '@/components/catalog/catalog-forms';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PERMISSIONS, roleCan } from '@/lib/auth/permissions';
import { formatDate, formatMoney } from '@/lib/format';
import { requirePermissionFor } from '@/server/auth/guard';
import {
  getPriceList,
  listPriceListItems,
  listPriceLists,
  listProducts,
  type PriceListItemRow,
} from '@/server/catalog/queries';

type Translate = (key: string, values?: Record<string, string | number>) => string;

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ list?: string; productSearch?: string }>;
};

/** A price list changes whenever a window is added, so it is never cached. */
export const dynamic = 'force-dynamic';

export default async function PriceListsPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const { actor } = await requirePermissionFor(locale, PERMISSIONS.PRICING_READ);
  const canWrite = roleCan(actor.role, PERMISSIONS.PRICING_WRITE);

  const lists = await listPriceLists();
  // The first list is opened by default, so the screen is never just a list of
  // links with no prices visible.
  const selectedId =
    query.list && lists.some((list) => list.id === query.list) ? query.list : lists[0]?.id;

  const [selected, items, products] = await Promise.all([
    selectedId ? getPriceList(selectedId) : null,
    selectedId ? listPriceListItems(selectedId) : Promise.resolve([]),
    // The product picker is a page of results, not the whole catalog: a search
    // box narrows it, so a long catalog never loads into a dropdown.
    canWrite ? listProducts({ page: 1, search: query.productSearch }) : Promise.resolve(null),
  ]);

  const t = await getTranslations('pricing');
  const tCommon = await getTranslations('common');

  return (
    <>
      <SiteHeader />
      <main className="flex-1 py-8">
        <Container size="lg">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-ink">{t('title')}</h1>
            <p className="text-sm text-ink-muted">{t('subtitle')}</p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_2fr]">
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('lists', { count: lists.length })}</CardTitle>
                </CardHeader>
                <CardBody>
                  {lists.length === 0 ? (
                    <p className="py-4 text-center text-sm text-ink-subtle">{t('emptyLists')}</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {lists.map((list) => (
                        <li key={list.id}>
                          <Link
                            href={`/${locale}/admin/price-lists?list=${list.id}`}
                            aria-current={list.id === selectedId ? 'page' : undefined}
                            className={
                              list.id === selectedId
                                ? 'flex items-center justify-between rounded-card bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700'
                                : 'flex items-center justify-between rounded-card px-3 py-2 text-sm text-ink-muted hover:bg-surface-muted'
                            }
                          >
                            <span>{list.name}</span>
                            <span className="text-xs text-ink-subtle">
                              {t('itemCount', { count: list.itemCount })}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {canWrite && selected ? (
                    <div className="mt-3 flex flex-wrap items-start gap-3 border-t border-surface-border pt-3">
                      <EditPriceListForm
                        priceList={{
                          id: selected.id,
                          name: selected.name,
                          nameEn: selected.nameEn ?? '',
                        }}
                      />
                      <DeletePriceListButton priceListId={selected.id} />
                    </div>
                  ) : null}
                </CardBody>
              </Card>

              {canWrite ? (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('createList')}</CardTitle>
                    </CardHeader>
                    <CardBody>
                      <CreatePriceListForm />
                    </CardBody>
                  </Card>

                  {selected && products ? (
                    <Card>
                      <CardHeader>
                        <CardTitle>{t('addPriceTo', { name: selected.name })}</CardTitle>
                      </CardHeader>
                      <CardBody>
                        <form
                          className="mb-3 flex gap-2"
                          action={`/${locale}/admin/price-lists`}
                          method="get"
                        >
                          <input type="hidden" name="list" value={selected.id} />
                          <input
                            type="search"
                            name="productSearch"
                            defaultValue={query.productSearch ?? ''}
                            placeholder={t('searchProduct')}
                            aria-label={t('searchProduct')}
                            className="w-full rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm"
                          />
                          <button
                            type="submit"
                            className="rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm"
                          >
                            {tCommon('search')}
                          </button>
                        </form>
                        {products.rows.length > 0 ? (
                          <>
                            <AddPriceForm
                              priceLists={lists.map<Option>((list) => ({
                                value: list.id,
                                label: list.name,
                              }))}
                              products={products.rows.map<Option>((product) => ({
                                value: product.id,
                                label: `${product.code} — ${product.nameAr}`,
                              }))}
                            />
                            {products.pageCount > 1 ? (
                              <p className="mt-2 text-xs text-ink-subtle">
                                {t('showingFirst', { count: products.pageCount })}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          // The search box stays visible, so a search with no
                          // hits can be corrected instead of stranding the user.
                          <p className="py-4 text-center text-sm text-ink-subtle">
                            {t('noProductsFound')}
                          </p>
                        )}
                      </CardBody>
                    </Card>
                  ) : null}
                </>
              ) : null}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{selected ? selected.name : t('noListSelected')}</CardTitle>
              </CardHeader>
              <CardBody>
                {!selected ? (
                  <p className="py-8 text-center text-sm text-ink-subtle">{t('emptyLists')}</p>
                ) : items.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-subtle">{t('emptyItems')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[40rem] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-surface-border text-start text-xs text-ink-subtle">
                          <th className="p-2 text-start font-medium">{t('product')}</th>
                          <th className="p-2 text-start font-medium">{t('unit')}</th>
                          <th className="p-2 text-start font-medium">{t('priceExcludingVat')}</th>
                          <th className="p-2 text-start font-medium">{t('vatRate')}</th>
                          <th className="p-2 text-start font-medium">{t('validFrom')}</th>
                          <th className="p-2 text-start font-medium">{t('validTo')}</th>
                          <th className="p-2 text-start font-medium">{t('status')}</th>
                          {canWrite ? (
                            <th className="p-2 text-start font-medium">{t('actions')}</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <PriceItemRowView key={item.id} item={item} canWrite={canWrite} t={t} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

function PriceItemRowView({
  item,
  canWrite,
  t,
}: {
  item: PriceListItemRow;
  canWrite: boolean;
  t: Translate;
}) {
  const editable: EditablePriceItem = {
    id: item.id,
    price: Number(item.price).toFixed(2),
    validFrom: item.validFrom.toISOString().slice(0, 10),
    validTo: item.validTo ? item.validTo.toISOString().slice(0, 10) : '',
  };

  return (
    <tr className="border-b border-surface-border/60">
      <td className="p-2 text-ink">
        <div className="font-medium" dir="ltr">
          {item.productCode}
        </div>
        <div className="text-xs text-ink-muted">{item.productNameAr}</div>
      </td>
      <td className="p-2 text-ink-muted">{item.unitName}</td>
      <td className="p-2 text-ink-muted" dir="ltr">
        {formatMoney(item.price)}
      </td>
      <td className="p-2 text-ink-muted" dir="ltr">
        {item.vatRate.toFixed(2)}%
      </td>
      <td className="p-2 text-ink-muted" dir="ltr">
        {formatDate(item.validFrom)}
      </td>
      <td className="p-2 text-ink-muted" dir="ltr">
        {item.validTo ? formatDate(item.validTo) : t('openEnded')}
      </td>
      <td className="p-2">
        <span
          className={
            item.isCurrent
              ? 'rounded-full bg-success-soft px-2 py-0.5 text-xs text-success'
              : 'rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted'
          }
        >
          {item.isCurrent ? t('current') : t('expired')}
        </span>
      </td>
      {canWrite ? (
        <td className="p-2">
          <PriceItemActions item={editable} />
        </td>
      ) : null}
    </tr>
  );
}
