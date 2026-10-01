'use client';

import { useMemo } from 'react';

import { EmptyStateCard } from '@/components/primitives/EmptyStateCard';
import {
  CHANNEL_LABEL,
  MOVEMENT_HAS_DELTA,
  MOVEMENT_LABEL,
  MOVEMENT_TONE,
  TIER_LABEL,
} from '@/lib/chartUtils';
import { filterCustomerIds, resolveWindow } from '@/lib/calculations';
import {
  cn,
  EM_DASH,
  formatCurrencyFromCents,
  formatDateTimeUtc,
  formatSignedCurrencyFromCents,
} from '@/lib/utils';
import type {
  DashboardFilterState,
  DashboardStateSnapshot,
  RevenueMovementEvent,
} from '@/types/analytics';

/**
 * Recent revenue movements.
 *
 * Trial movements deliberately show a dash instead of a dollar figure: a trial
 * carries no MRR, so printing "$0.00" next to "Trial converted" would read as a
 * failed conversion rather than the contract it actually is.
 */

export interface RevenueMovementFeedProps {
  snapshot: DashboardStateSnapshot;
  filters: DashboardFilterState;
  now: Date;
  limit?: number;
  onResetFilters: () => void;
}

export function RevenueMovementFeed({
  snapshot,
  filters,
  now,
  limit = 40,
  onResetFilters,
}: RevenueMovementFeedProps) {
  const events = useMemo(() => {
    const customerIds = filterCustomerIds(snapshot, filters);
    const window = resolveWindow(snapshot, filters.dateRange, now);

    return snapshot.events
      .filter((event) => {
        if (!customerIds.has(event.customerId)) {
          return false;
        }
        const at = Date.parse(event.occurredAt);
        return at > window.startDayEndMs && at <= window.endDayEndMs;
      })
      // The id tie-breaker keeps the order total. Two movements can share a
      // millisecond, and an unstable sort would reshuffle the feed between
      // renders for no reason the user can see.
      .sort(
        (a, b) =>
          Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
          b.id.localeCompare(a.id),
      )
      .slice(0, limit);
  }, [filters, limit, now, snapshot]);

  return (
    <section
      id="activity"
      aria-labelledby="activity-heading"
      className="flex min-w-0 scroll-mt-20 flex-col gap-3"
    >
      <header className="min-w-0">
        <h2 id="activity-heading" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Revenue movements
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The {Math.min(limit, events.length)} most recent events inside the selected
          window.
        </p>
      </header>

      {events.length === 0 ? (
        <EmptyStateCard
          title="No movements in this window"
          description="Widen the date range or clear the tier and channel filters to see activity again."
          actionLabel="Reset filters"
          onAction={onResetFilters}
        />
      ) : (
        <ol className="flex min-w-0 flex-col gap-2">
          {events.map((event) => (
            <MovementRow key={event.id} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}

function MovementRow({ event }: { event: RevenueMovementEvent }) {
  const tone = MOVEMENT_TONE[event.type];
  const hasDelta = MOVEMENT_HAS_DELTA[event.type];

  return (
    <li
      className={cn(
        'flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border bg-white px-3 py-2',
        'border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900',
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {event.organizationName}
        </span>
        <span className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {MOVEMENT_LABEL[event.type]}
          {' · '}
          {TIER_LABEL[event.tier]}
          {' · '}
          {CHANNEL_LABEL[event.channel]}
          {' · '}
          {formatDateTimeUtc(event.occurredAt)}
        </span>
      </div>

      <div className="flex min-w-0 shrink-0 flex-col items-end">
        <span className={cn('text-sm font-medium tabular-nums', TONE_CLASS[tone])}>
          {hasDelta
            ? formatSignedCurrencyFromCents(event.deltaMrrCents)
            : EM_DASH}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {hasDelta
            ? `${formatCurrencyFromCents(event.mrrBeforeCents)} \u2192 ${formatCurrencyFromCents(event.mrrAfterCents)}`
            : 'No MRR change'}
        </span>
      </div>
    </li>
  );
}

const TONE_CLASS: Readonly<Record<string, string>> = {
  new_business: 'text-emerald-700 dark:text-emerald-300',
  expansion: 'text-indigo-700 dark:text-indigo-300',
  contraction: 'text-amber-700 dark:text-amber-300',
  churn: 'text-rose-700 dark:text-rose-300',
  reactivation: 'text-sky-700 dark:text-sky-300',
  trial_started: 'text-zinc-600 dark:text-zinc-300',
  trial_converted: 'text-emerald-700 dark:text-emerald-300',
  trial_canceled: 'text-rose-700 dark:text-rose-300',
};

export default RevenueMovementFeed;