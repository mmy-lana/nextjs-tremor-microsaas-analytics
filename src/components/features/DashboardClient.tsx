'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Wrench } from 'lucide-react';

import { AppHeader, type NavAnchor } from '@/components/molecules/AppHeader';
import { FilterControlBar } from '@/components/molecules/FilterControlBar';
import { InteractiveChartInspector } from '@/components/molecules/InteractiveChartInspector';
import { KpiBentoCard } from '@/components/molecules/KpiBentoCard';
import { NewSubscriptionModal } from '@/components/molecules/NewSubscriptionModal';
import { CohortRetentionMatrix } from '@/components/features/CohortRetentionMatrix';
import { CustomerLedgerTable } from '@/components/features/CustomerLedgerTable';
import { MrrCompositionChart } from '@/components/features/MrrCompositionChart';
import { RevenueMovementFeed } from '@/components/features/RevenueMovementFeed';
import { TierDistributionCard } from '@/components/features/TierDistributionCard';
import { ConfirmDialog } from '@/components/primitives/ConfirmDialog';
import {
  useAnalyticsStore,
  VERSION_CONFLICT_ANNOUNCEMENT,
} from '@/hooks/useAnalyticsStore';
import { useUiPrefs } from '@/hooks/useUiPrefs';
import { useCsvExport } from '@/hooks/useCsvExport';
import {
  bucketSeries,
  computeKpis,
  dailyDerivedMetrics,
  filterCustomerIds,
  kpiSeries,
  resolveWindow,
} from '@/lib/calculations';
import {
  buildCustomersCsv,
  buildDailyMrrCsv,
  customersFilename,
  dailyMrrFilename,
} from '@/lib/csv';
import { initStore } from '@/lib/storage';
import {
  bucketModeFor,
  CHART_TONE_CLASS,
  formatAxisCurrencyFromCents,
} from '@/lib/chartUtils';
import { cn, formatDate } from '@/lib/utils';
import type {
  AddCustomerPayload,
  DashboardStateSnapshot,
  DerivedDailyMetric,
  KpiMetricKey,
  SubscriptionTier,
} from '@/types/analytics';

/**
 * Root client component.
 *
 * Owns the two pieces of cross-section UI state — which KPI is selected and
 * which chart bucket is pinned — plus the store, the filter preferences and the
 * export/download wiring. Everything below it is presentational.
 */

const NAV_ANCHORS: readonly NavAnchor[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'cohorts', label: 'Cohorts' },
  { id: 'customers', label: 'Customers' },
  { id: 'activity', label: 'Activity' },
];

const KPI_ORDER: readonly KpiMetricKey[] = ['netMrr', 'arr', 'nrr', 'logoChurn'];

/**
 * Reads the ambient clock. Wrapped so it can be memoised against the snapshot:
 * the value must stay stable between renders, but re-read after every write.
 */
function readClock(snapshot: DashboardStateSnapshot | null): Date {
  void snapshot;
  return new Date();
}

/** Secondary figures below the four headline cards. */
const STAT_STRIP = [
  { key: 'arpuCents', label: 'ARPU' },
  { key: 'estimatedLtvCents', label: 'Est. LTV' },
  { key: 'activeCustomersCount', label: 'Active customers' },
  { key: 'trialConversionRatePercent', label: 'Trial conversion' },
] as const;

export default function DashboardClient() {
  const [announcement, setAnnouncement] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [selectedKpi, setSelectedKpi] = useState<KpiMetricKey>('netMrr');
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  const announce = useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  const { state, actions } = useAnalyticsStore({
    onConflict: () => announce(VERSION_CONFLICT_ANNOUNCEMENT),
  });
  const { filters, setFilters, resetFilters } = useUiPrefs();
  const { download } = useCsvExport();

  useEffect(() => {
    void initStore();
  }, []);

  const snapshot = state.snapshot;

  // Re-read the clock whenever the snapshot changes. Every mutation stamps a
  // fresh `asOf`, so a long-lived tab still rolls over at midnight instead of
  // computing against the moment it first mounted.
  const now = useMemo(() => readClock(snapshot), [snapshot]);

  const kpis = useMemo(
    () => (snapshot === null ? null : computeKpis(snapshot, filters, now)),
    [filters, now, snapshot],
  );

  const kpiSeriesByMetric = useMemo(() => {
    if (snapshot === null) {
      return new Map<KpiMetricKey, { date: string; value: number }[]>();
    }
    const map = new Map<KpiMetricKey, { date: string; value: number }[]>();
    for (const metric of KPI_ORDER) {
      map.set(metric, kpiSeries(snapshot, filters, now, metric));
    }
    return map;
  }, [filters, now, snapshot]);

  const compositionRows = useMemo<DerivedDailyMetric[]>(() => {
    if (snapshot === null) {
      return [];
    }
    const customerIds = filterCustomerIds(snapshot, filters);
    const window = resolveWindow(snapshot, filters.dateRange, now);
    const daily = dailyDerivedMetrics(snapshot, customerIds, window);
    return bucketSeries(daily, bucketModeFor(filters.dateRange, window.windowDays));
  }, [filters, now, snapshot]);

  const takenEmails = useMemo(
    () => new Set((snapshot?.customers ?? []).map((customer) => customer.email)),
    [snapshot],
  );

  const composition = useMemo(() => {
    const row = pinnedIndex === null ? undefined : compositionRows[pinnedIndex];
    if (row === undefined) {
      return [];
    }
    return [
      { key: 'new', label: 'New & returning', tone: 'new' as const, cents: row.newMrrCents },
      { key: 'expansion', label: 'Expansion', tone: 'expansion' as const, cents: row.expansionMrrCents },
      { key: 'contraction', label: 'Contraction', tone: 'contraction' as const, cents: row.contractionMrrCents },
      { key: 'churn', label: 'Churned', tone: 'churn' as const, cents: row.churnedMrrCents },
      { key: 'gross', label: 'Gross MRR', tone: 'gross' as const, cents: row.grossMrrCents },
      { key: 'subscribers', label: 'Subscribers', tone: 'neutral' as const, cents: row.activeSubscribers },
    ].map((entry) => ({
      key: entry.key,
      label: entry.label,
      tone: entry.tone,
      formattedValue:
        entry.key === 'subscribers'
          ? String(entry.cents)
          : formatAxisCurrencyFromCents(entry.cents),
    }));
  }, [compositionRows, pinnedIndex]);

  // The chart reports a bucket by index; the date and caption are derived from
  // the same rows so the readout and the plot can never disagree.
  const handleSelectPoint = useCallback((index: number | null) => {
    setPinnedIndex(index);
  }, []);

  const pinnedPoint = useMemo(() => {
    if (pinnedIndex === null) {
      return null;
    }
    const row = compositionRows[pinnedIndex];
    if (row === undefined) {
      return null;
    }
    return { index: pinnedIndex, date: row.date, caption: formatDate(row.date) };
  }, [compositionRows, pinnedIndex]);

  const handleAddCustomer = useCallback(
    async (payload: AddCustomerPayload): Promise<string | null> => {
      const result = await actions.addCustomer(payload);
      if (!result.ok) {
        announce(result.error);
        return result.error;
      }
      announce(`${payload.organizationName} added.`);
      return null;
    },
    [actions, announce],
  );

  const handleSortChange = useCallback(
    (field: Parameters<typeof setFilters>[0]['sortField']) => {
      setFilters(
        filters.sortField === field
          ? { sortDirection: filters.sortDirection === 'asc' ? 'desc' : 'asc' }
          : { sortField: field, sortDirection: 'asc' },
      );
    },
    [filters.sortDirection, filters.sortField, setFilters],
  );

  const effectiveAsOf = useMemo(() => {
    if (snapshot === null) {
      return null;
    }
    return resolveWindow(snapshot, 'all', now).effectiveAsOfMs;
  }, [now, snapshot]);

  const handleExportCustomers = useCallback(() => {
    if (snapshot === null || effectiveAsOf === null) {
      return;
    }
    download({
      filename: customersFilename(effectiveAsOf),
      contents: buildCustomersCsv(snapshot, filters),
    });
    announce('Customers CSV exported.');
  }, [announce, download, effectiveAsOf, filters, snapshot]);

  const handleExportDailyMrr = useCallback(() => {
    if (snapshot === null || effectiveAsOf === null) {
      return;
    }
    const customerIds = filterCustomerIds(snapshot, filters);
    const window = resolveWindow(snapshot, filters.dateRange, now);
    const daily = dailyDerivedMetrics(snapshot, customerIds, window);
    download({
      filename: dailyMrrFilename(effectiveAsOf),
      contents: buildDailyMrrCsv(daily),
    });
    announce('Daily MRR CSV exported.');
  }, [announce, download, effectiveAsOf, filters, now, snapshot]);

  const ledgerActions = useMemo(
    () => ({
      updateTier: async (args: {
        customerId: string;
        newTier: SubscriptionTier;
        newMrrCents: number;
        expectedVersion: number;
      }): Promise<string | null> => {
        const result = await actions.updateTier(args);
        if (!result.ok) {
          announce(result.error);
          return result.error;
        }
        announce('Tier updated.');
        return null;
      },
      convertTrial: async (args: {
        customerId: string;
        newTier: SubscriptionTier;
        newMrrCents: number;
        expectedVersion: number;
      }): Promise<string | null> => {
        const result = await actions.convertTrial(args);
        if (!result.ok) {
          announce(result.error);
          return result.error;
        }
        announce('Trial converted.');
        return null;
      },
      cancelTrial: async (args: {
        customerId: string;
        expectedVersion: number;
      }): Promise<string | null> => {
        const result = await actions.cancelTrial(args);
        if (!result.ok) {
          announce(result.error);
          return result.error;
        }
        announce('Trial canceled.');
        return null;
      },
      reactivate: async (args: {
        customerId: string;
        newTier: SubscriptionTier;
        newMrrCents: number;
        expectedVersion: number;
      }): Promise<string | null> => {
        const result = await actions.reactivate(args);
        if (!result.ok) {
          announce(result.error);
          return result.error;
        }
        announce('Subscription reactivated.');
        return null;
      },
      cancelSubscription: async (args: {
        customerId: string;
        expectedVersion: number;
      }): Promise<string | null> => {
        const result = await actions.cancelSubscription(args);
        if (!result.ok) {
          announce(result.error);
          return result.error;
        }
        announce('Subscription canceled.');
        return null;
      },
    }),
    [actions, announce],
  );

  const resetDemo = useCallback(async () => {
    const result = await actions.resetDemo();
    announce(result.ok ? 'Demo data reset.' : result.error);
  }, [actions, announce]);

  const repairState = useCallback(async () => {
    const result = await actions.resetDemo();
    announce(result.ok ? 'Local analytics data repaired.' : result.error);
  }, [actions, announce]);

  if (state.status === 'loading' || snapshot === null || kpis === null) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="flex min-h-screen min-w-0 flex-col">
      <span role="status" aria-live="polite" className="sr-only" data-testid="live-region">
        {announcement}
      </span>

      <AppHeader
        anchors={NAV_ANCHORS}
        onOpenAddCustomer={() => setModalOpen(true)}
        onExportCustomers={handleExportCustomers}
        onExportDailyMrr={handleExportDailyMrr}
        onResetDemo={resetDemo}
      />

      {state.status === 'error' && state.error !== null && (
        <div
          role="alert"
          data-testid="error-banner"
          className="mx-3 mt-3 flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 sm:mx-4 dark:border-amber-900 dark:bg-amber-500/10"
        >
          <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100">
            {state.error} The data shown below is the last version that could be
            read.
          </p>
          <button
            type="button"
            onClick={() => setRepairOpen(true)}
            data-testid="repair-state"
            className={cn(
              'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-400 px-3',
              'text-sm font-medium text-amber-900 hover:bg-amber-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
              'dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-500/20',
            )}
          >
            <Wrench aria-hidden="true" className="h-4 w-4" />
            Repair local state
          </button>
        </div>
      )}

      <main className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-1 flex-col gap-8 px-3 py-5 sm:px-4 lg:flex-row lg:gap-6 lg:pl-[264px] lg:pr-4">
        <nav
          aria-label="Dashboard sections"
          className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[240px] lg:flex-col lg:border-r lg:border-zinc-200 lg:bg-white lg:px-3 lg:py-20 lg:dark:border-zinc-800 lg:dark:bg-zinc-950"
        >
          <ul className="flex min-w-0 flex-col gap-1">
            {NAV_ANCHORS.map((anchor) => (
              <li key={anchor.id} className="min-w-0">
                <a
                  href={`#${anchor.id}`}
                  className={cn(
                    'flex min-h-11 min-w-0 items-center rounded-lg px-3 text-sm font-medium text-zinc-700',
                    'hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                    'dark:text-zinc-200 dark:hover:bg-zinc-800',
                  )}
                >
                  <span className="truncate">{anchor.label}</span>
                </a>
              </li>
            ))}
          </ul>

          <div className="mt-auto pt-4">
            <button
              type="button"
              onClick={() => setRepairOpen(true)}
              data-testid="rail-repair"
              className={cn(
                'flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700',
                'hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
              )}
            >
              <Wrench aria-hidden="true" className="h-4 w-4" />
              <span className="truncate">Reset demo data</span>
            </button>
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <section
            id="overview"
            aria-labelledby="overview-heading"
            className="flex min-w-0 scroll-mt-20 flex-col gap-4"
          >
            <header className="min-w-0">
              <h1
                id="overview-heading"
                className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
              >
                Overview
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                As of {formatDate(snapshot.asOf)} · snapshot revision{' '}
                {snapshot.revision}
              </p>
            </header>

            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {KPI_ORDER.map((metric) => (
                <KpiBentoCard
                  key={metric}
                  metric={metric}
                  kpis={kpis}
                  series={kpiSeriesByMetric.get(metric) ?? []}
                  selected={selectedKpi === metric}
                  onSelect={setSelectedKpi}
                />
              ))}
            </div>

            <dl className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
              {STAT_STRIP.map((stat) => {
                const value = kpis.current[stat.key];
                const display =
                  stat.key === 'trialConversionRatePercent'
                    ? typeof value === 'number'
                      ? `${value.toFixed(1)}%`
                      : '—'
                    : stat.key === 'activeCustomersCount'
                      ? String(value)
                      : formatAxisCurrencyFromCents(value as number);
                return (
                  <div
                    key={stat.key}
                    className="flex min-w-0 flex-col rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <dt className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {stat.label}
                    </dt>
                    <dd
                      className={cn(
                        'truncate text-base font-semibold tabular-nums',
                        CHART_TONE_CLASS.neutral,
                      )}
                    >
                      {display}
                    </dd>
                  </div>
                );
              })}
            </dl>

            <InteractiveChartInspector
              metric={selectedKpi}
              kpis={kpis}
              selectedPoint={pinnedPoint}
              composition={composition}
              onClearPoint={() => setPinnedIndex(null)}
            />
          </section>

          <MrrCompositionChart
            snapshot={snapshot}
            filters={filters}
            now={now}
            selectedIndex={pinnedIndex}
            onSelectIndex={handleSelectPoint}
          />

          <TierDistributionCard snapshot={snapshot} filters={filters} />

          <CohortRetentionMatrix snapshot={snapshot} filters={filters} now={now} />

          <div className="flex min-w-0 flex-col gap-6">
            <FilterControlBar
              filters={filters}
              onChange={setFilters}
              onReset={resetFilters}
            />
            <CustomerLedgerTable
              snapshot={snapshot}
              filters={filters}
              actions={ledgerActions}
              onResetFilters={resetFilters}
              onSortChange={handleSortChange}
            />
          </div>

          <RevenueMovementFeed
            snapshot={snapshot}
            filters={filters}
            now={now}
            onResetFilters={resetFilters}
          />

          <footer className="pb-[env(safe-area-inset-bottom)] text-xs text-zinc-400 dark:text-zinc-500">
            All data is generated locally in your browser and stored in
            localStorage. Nothing leaves this device.
          </footer>
        </div>
      </main>

      <NewSubscriptionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleAddCustomer}
        takenEmails={takenEmails}
      />

      <ConfirmDialog
        open={repairOpen}
        title="Repair local state?"
        description="The stored analytics snapshot could not be read. Rebuilding it replaces it with fresh demo data."
        consequences={[
          'Every local subscription, tier change and cancellation is discarded.',
          'The unreadable snapshot is replaced only after you confirm.',
        ]}
        confirmLabel="Rebuild data"
        tone="default"
        onConfirm={() => {
          setRepairOpen(false);
          void repairState();
        }}
        onCancel={() => setRepairOpen(false)}
      />

    </div>
  );
}

/**
 * Loading skeleton.
 *
 * Every block reserves the height of the real content, so the swap to loaded
 * content does not move anything on screen (CLS stays at zero).
 */
function DashboardSkeleton(): React.ReactElement {
  const card = 'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';

  return (
    <div className="flex min-h-screen min-w-0 flex-col">
      <div className="h-16 border-b border-zinc-200 dark:border-zinc-800" />
      <main className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-1 flex-col gap-8 px-3 py-5 sm:px-4">
        <section className="flex min-w-0 flex-col gap-4">
          <div className="h-7 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className={cn(card, 'h-44 p-4')}>
                <div className="h-3 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="mt-3 h-8 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="mt-4 h-10 w-full rounded bg-zinc-100 dark:bg-zinc-800/60" />
              </div>
            ))}
          </div>
          <div className={cn(card, 'h-24 p-4')} />
        </section>
        <div className={cn(card, 'h-80 p-4')} />
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <div className={cn(card, 'h-64 p-4')} />
          <div className={cn(card, 'h-64 p-4')} />
        </div>
        <div className={cn(card, 'h-72 p-4')} />
      </main>
    </div>
  );
}