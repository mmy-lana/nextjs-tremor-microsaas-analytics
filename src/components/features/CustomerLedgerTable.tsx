'use client';

import { useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

import { ConfirmDialog } from '@/components/primitives/ConfirmDialog';
import { EmptyStateCard } from '@/components/primitives/EmptyStateCard';
import { SlideOverDrawer } from '@/components/primitives/SlideOverDrawer';
import { STATUS_BADGE_CLASS, STATUS_LABEL, TIER_LABEL } from '@/lib/chartUtils';
import { selectLedgerCustomers } from '@/lib/calculations';
import {
  cn,
  formatCompactCurrencyFromCents,
  formatCurrencyFromCents,
  formatDate,
  formatInteger,
} from '@/lib/utils';
import type {
  CustomerRecord,
  DashboardFilterState,
  DashboardStateSnapshot,
  SubscriptionStatus,
  SubscriptionTier,
} from '@/types/analytics';

/**
 * The customer ledger.
 *
 * Two presentations of one dataset: a sortable, paginated table from `md` up,
 * and card rows below it where "Load more" replaces pagination because a
 * numbered page control at 360px would eat a third of the screen.
 *
 * Every action is opened from a row and carries that row's `version` as
 * `expectedVersion`, so an edit made in another tab is rejected rather than
 * silently overwriting the other tab's change.
 */

const PAGE_SIZE = 10;
const MOBILE_PAGE_SIZE = 20;

export interface LedgerActions {
  updateTier: (args: {
    customerId: string;
    newTier: SubscriptionTier;
    newMrrCents: number;
    expectedVersion: number;
  }) => Promise<string | null>;
  convertTrial: (args: {
    customerId: string;
    newTier: SubscriptionTier;
    newMrrCents: number;
    expectedVersion: number;
  }) => Promise<string | null>;
  cancelTrial: (args: {
    customerId: string;
    expectedVersion: number;
  }) => Promise<string | null>;
  reactivate: (args: {
    customerId: string;
    newTier: SubscriptionTier;
    newMrrCents: number;
    expectedVersion: number;
  }) => Promise<string | null>;
  cancelSubscription: (args: {
    customerId: string;
    expectedVersion: number;
  }) => Promise<string | null>;
}

export interface CustomerLedgerTableProps {
  snapshot: DashboardStateSnapshot;
  filters: DashboardFilterState;
  actions: LedgerActions;
  onResetFilters: () => void;
  onSortChange: (field: DashboardFilterState['sortField']) => void;
}

type PendingAction =
  | { kind: 'cancel' }
  | { kind: 'convert'; tier: SubscriptionTier; mrrCents: number }
  | { kind: 'reactivate'; tier: SubscriptionTier; mrrCents: number };

export function CustomerLedgerTable({
  snapshot,
  filters,
  actions,
  onResetFilters,
  onSortChange,
}: CustomerLedgerTableProps) {
  const customers = useMemo(
    () => selectLedgerCustomers(snapshot, filters),
    [filters, snapshot],
  );

  const [page, setPage] = useState(0);
  const [mobileLimit, setMobileLimit] = useState(MOBILE_PAGE_SIZE);
  const [sheetCustomerId, setSheetCustomerId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  // A mutation can shrink the result set, so the offset is clamped rather than
  // left pointing past the end.
  const pageCount = Math.max(1, Math.ceil(customers.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleDesktop = customers.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const visibleMobile = customers.slice(0, mobileLimit);

  const sheetCustomer =
    sheetCustomerId === null
      ? null
      : customers.find((customer) => customer.id === sheetCustomerId) ?? null;

  const runAction = async (action: PendingAction, customer: CustomerRecord): Promise<void> => {
    setBusy(true);
    try {
      let error: string | null = null;
      switch (action.kind) {
        case 'cancel':
          error = await actions.cancelSubscription({
            customerId: customer.id,
            expectedVersion: customer.version,
          });
          break;
        case 'convert':
          error = await actions.convertTrial({
            customerId: customer.id,
            newTier: action.tier,
            newMrrCents: action.mrrCents,
            expectedVersion: customer.version,
          });
          break;
        case 'reactivate':
          error = await actions.reactivate({
            customerId: customer.id,
            newTier: action.tier,
            newMrrCents: action.mrrCents,
            expectedVersion: customer.version,
          });
          break;
        default:
          error = 'Unknown action';
      }
      if (error === null) {
        setPending(null);
        setSheetCustomerId(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="customers"
      aria-labelledby="customers-heading"
      className="flex min-w-0 scroll-mt-20 flex-col gap-3"
    >
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2 id="customers-heading" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Customers
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatInteger(customers.length)} matching{' '}
          {customers.length === 1 ? 'account' : 'accounts'}
        </p>
      </header>

      {customers.length === 0 ? (
        <EmptyStateCard
          title="No customers match these filters"
          description="The search term only narrows this table and the customers CSV. Clear it, or widen the tier and channel filters."
          actionLabel="Reset filters"
          onAction={onResetFilters}
        />
      ) : (
        <>
          <div className="relative hidden min-w-0 overflow-x-auto overscroll-x-contain rounded-xl border border-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 md:block dark:border-zinc-800">
            <table className="hidden w-full min-w-[720px] border-separate border-spacing-0 text-sm md:table">
              <caption className="sr-only">
                Customer ledger. {customers.length} accounts match the current filters.
              </caption>
              <thead>
                <tr>
                  <SortHeader field="organizationName" label="Organization" filters={filters} onSort={onSortChange} />
                  <SortHeader field="status" label="Status" filters={filters} onSort={onSortChange} />
                  <SortHeader field="mrrCents" label="MRR" filters={filters} onSort={onSortChange} align="right" />
                  <th
                    scope="col"
                    className="border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                  >
                    Tier
                  </th>
                  <SortHeader field="createdAt" label="Joined" filters={filters} onSort={onSortChange} />
                  <th
                    scope="col"
                    className="border-b border-zinc-200 bg-white px-3 py-2 text-right text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleDesktop.map((customer) => (
                  <tr key={customer.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-zinc-100 bg-white px-3 py-2 text-left font-normal dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      <span className="block max-w-[16rem] truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {customer.organizationName}
                      </span>
                      <span className="block max-w-[16rem] truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {customer.email}
                      </span>
                    </th>
                    <td className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                      <StatusPill status={customer.status} />
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2 text-right tabular-nums text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">
                      {formatCurrencyFromCents(customer.mrrCents)}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      {TIER_LABEL[customer.tier]}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2 tabular-nums text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      {formatDate(customer.createdAt)}
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2 text-right dark:border-zinc-800">
                      <RowActionsButton customer={customer} onOpen={() => setSheetCustomerId(customer.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex min-w-0 flex-col gap-2 md:hidden">
            {visibleMobile.map((customer) => (
              <li
                key={customer.id}
                className="flex min-w-0 items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {customer.organizationName}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {TIER_LABEL[customer.tier]} · {formatDate(customer.createdAt)}
                  </p>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                    <StatusPill status={customer.status} />
                    <span className="text-xs font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
                      {formatCompactCurrencyFromCents(customer.mrrCents)}
                    </span>
                  </div>
                </div>
                <RowActionsButton customer={customer} onOpen={() => setSheetCustomerId(customer.id)} />
              </li>
            ))}
          </ul>

          <div className="hidden min-w-0 items-center justify-between gap-3 md:flex">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Page {safePage + 1} of {pageCount}
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={safePage === 0}
                data-testid="ledger-prev"
                className={cn(
                  'min-h-11 min-w-11 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700',
                  'hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                  'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
                )}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                disabled={safePage >= pageCount - 1}
                data-testid="ledger-next"
                className={cn(
                  'min-h-11 min-w-11 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700',
                  'hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                  'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
                )}
              >
                Next
              </button>
            </div>
          </div>

          {customers.length > mobileLimit && (
            <button
              type="button"
              onClick={() => setMobileLimit((limit) => limit + MOBILE_PAGE_SIZE)}
              data-testid="ledger-load-more"
              className={cn(
                'min-h-11 w-full rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700',
                'hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                'md:hidden dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
              )}
            >
              Load more ({formatInteger(customers.length - mobileLimit)} remaining)
            </button>
          )}
        </>
      )}

      <SlideOverDrawer
        open={sheetCustomer !== null}
        onClose={() => {
          setSheetCustomerId(null);
          setPending(null);
        }}
        title={sheetCustomer?.organizationName ?? 'Customer'}
        description={sheetCustomer === null ? undefined : `${sheetCustomer.email} · v${sheetCustomer.version}`}
        placement="bottom"
      >
        {sheetCustomer !== null && (
          <RowActionSheet
            customer={sheetCustomer}
            actions={actions}
            busy={busy}
            onRequestConfirm={(action) => setPending(action)}
          />
        )}
      </SlideOverDrawer>

      <ConfirmDialog
        open={pending !== null && sheetCustomer !== null}
        title={
          pending?.kind === 'cancel'
            ? `Cancel ${sheetCustomer?.organizationName ?? 'this subscription'}?`
            : `Reactivate ${sheetCustomer?.organizationName ?? 'this subscription'}?`
        }
        description={
          pending?.kind === 'cancel'
            ? 'This zeroes the MRR, records the loss in the ledger and cannot be undone from this screen.'
            : 'This creates a new reactivation event and restores the account to active.'
        }
        consequences={
          pending?.kind === 'cancel'
            ? ['The account keeps its history; only its current MRR is zeroed.']
            : undefined
        }
        confirmLabel={pending?.kind === 'cancel' ? 'Cancel subscription' : 'Reactivate'}
        busy={busy}
        onConfirm={() => {
          if (pending !== null && sheetCustomer !== null) {
            void runAction(pending, sheetCustomer);
          }
        }}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Parts                                    */
/* -------------------------------------------------------------------------- */

function SortHeader({
  field,
  label,
  filters,
  onSort,
  align = 'left',
}: {
  field: DashboardFilterState['sortField'];
  label: string;
  filters: DashboardFilterState;
  onSort: (field: DashboardFilterState['sortField']) => void;
  align?: 'left' | 'right';
}) {
  const active = filters.sortField === field;
  return (
    <th
      scope="col"
      aria-sort={active ? (filters.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(
        'border-b border-zinc-200 bg-white px-3 py-0 dark:border-zinc-800 dark:bg-zinc-950',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        data-testid={`sort-${field}`}
        className={cn(
          'flex min-h-11 w-full items-center gap-1 px-1 text-xs font-medium text-zinc-500',
          'hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
          'dark:text-zinc-400 dark:hover:text-zinc-50',
          align === 'right' && 'justify-end',
        )}
      >
        {label}
        <span aria-hidden="true" className="text-[10px]">
          {active ? (filters.sortDirection === 'asc' ? '\u2191' : '\u2193') : ''}
        </span>
      </button>
    </th>
  );
}

function StatusPill({ status }: { status: SubscriptionStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        STATUS_BADGE_CLASS[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function RowActionsButton({
  customer,
  onOpen,
}: {
  customer: CustomerRecord;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Actions for ${customer.organizationName}`}
      data-testid={`row-actions-${customer.id}`}
      className={cn(
        'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300',
        'text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
        'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
      )}
    >
      <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

function RowActionSheet({
  customer,
  actions,
  busy: parentBusy,
  onRequestConfirm,
}: {
  customer: CustomerRecord;
  actions: LedgerActions;
  busy: boolean;
  onRequestConfirm: (action: PendingAction) => void;
}) {
  const [busy, setBusy] = useState(false);
  const tierLocked = parentBusy || busy;
  const [tier, setTier] = useState<SubscriptionTier>(customer.tier);
  const [price, setPrice] = useState(
    (customer.mrrCents / 100).toFixed(customer.mrrCents % 100 === 0 ? 0 : 2),
  );

  const parsedCents = useMemo(() => {
    const dollars = Number(price);
    if (!Number.isFinite(dollars) || dollars < 0) {
      return null;
    }
    return Math.round(dollars * 100);
  }, [price]);

  const changeTier = async (): Promise<void> => {
    if (parsedCents === null) {
      return;
    }
    setBusy(true);
    try {
      await actions.updateTier({
        customerId: customer.id,
        newTier: tier,
        newMrrCents: parsedCents,
        expectedVersion: customer.version,
      });
    } finally {
      setBusy(false);
    }
  };

  const actionButton =
    'min-h-11 w-full rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-50';

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Status</dt>
          <dd className="mt-0.5">
            <StatusPill status={customer.status} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">MRR</dt>
          <dd className="mt-0.5 tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrencyFromCents(customer.mrrCents)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Previous MRR</dt>
          <dd className="mt-0.5 tabular-nums text-zinc-900 dark:text-zinc-100">
            {customer.previousMrrCents === 0
              ? '—'
              : formatCurrencyFromCents(customer.previousMrrCents)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">Version</dt>
          <dd className="mt-0.5 tabular-nums text-zinc-900 dark:text-zinc-100">
            {customer.version}
          </dd>
        </div>
      </dl>

      {(customer.status === 'active' || customer.status === 'past_due') && (
        <div className="flex min-w-0 flex-col gap-2">
          <label
            htmlFor="sheet-tier"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-200"
          >
            Change tier
          </label>
          <div className="flex min-w-0 flex-col gap-2">
            <select
              id="sheet-tier"
              value={tier}
              onChange={(event) => setTier(event.target.value as SubscriptionTier)}
              className="min-h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            >
              {(Object.keys(TIER_LABEL) as SubscriptionTier[]).map((option) => (
                <option key={option} value={option}>
                  {TIER_LABEL[option]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void changeTier()}
              disabled={tierLocked || parsedCents === null || parsedCents < 1}
              data-testid="sheet-save-tier"
              className={cn(
                actionButton,
                'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
              )}
            >
              Save tier change
            </button>
          </div>
        </div>
      )}

      {customer.status === 'trialing' && (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            This account is trialing. Convert it to start earning, or cancel the
            trial.
          </p>
          <button
            type="button"
            onClick={() => {
              if (parsedCents !== null && parsedCents > 0) {
                onRequestConfirm({ kind: 'convert', tier, mrrCents: parsedCents });
              }
            }}
            disabled={tierLocked || parsedCents === null || parsedCents < 1}
            className={cn(
              actionButton,
              'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
            )}
          >
            Convert to {TIER_LABEL[tier]} at{' '}
            {parsedCents === null ? '—' : formatCurrencyFromCents(parsedCents)}
          </button>
          <button
            type="button"
            onClick={() =>
              void actions.cancelTrial({
                customerId: customer.id,
                expectedVersion: customer.version,
              })
            }
            disabled={tierLocked}
            data-testid="sheet-cancel-trial"
            className={cn(
              actionButton,
              'border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-500/10',
            )}
          >
            Cancel trial
          </button>
        </div>
      )}

      {customer.status === 'canceled' && (
        <button
          type="button"
          onClick={() => {
            if (parsedCents !== null && parsedCents > 0) {
              onRequestConfirm({ kind: 'reactivate', tier, mrrCents: parsedCents });
            }
          }}
          disabled={tierLocked || parsedCents === null || parsedCents < 1}
          data-testid="sheet-reactivate"
          className={cn(
            actionButton,
            'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
          )}
        >
          Reactivate at {parsedCents === null ? '—' : formatCurrencyFromCents(parsedCents)}
        </button>
      )}

      {(customer.status === 'active' || customer.status === 'past_due') && (
        <button
          type="button"
          onClick={() => onRequestConfirm({ kind: 'cancel' })}
          disabled={tierLocked}
          data-testid="sheet-cancel-subscription"
          className={cn(
            actionButton,
            'border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-500/10',
          )}
        >
          Cancel subscription
        </button>
      )}

      <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <label
          htmlFor="sheet-price"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-200"
        >
          Monthly MRR
        </label>
        <input
          id="sheet-price"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Used by tier changes, trial conversions and reactivations.
        </p>
      </div>
    </div>
  );
}

export default CustomerLedgerTable;