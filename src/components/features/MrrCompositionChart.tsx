'use client';

import { useMemo, useState } from 'react';

import { AreaChart, type AreaChartPoint, type AreaSeries } from '@/components/ui/AreaChart';
import { BarChart, type BarChartPoint, type BarSeries } from '@/components/ui/BarChart';
import { Legend } from '@/components/ui/Legend';
import { SegmentedControl, type SegmentedOption } from '@/components/primitives/SegmentedControl';
import { bucketModeFor, CHART_TONE_CLASS, formatAxisCurrencyFromCents, type ChartTone } from '@/lib/chartUtils';
import {
  bucketSeries,
  dailyDerivedMetrics,
  filterCustomerIds,
  resolveWindow,
} from '@/lib/calculations';
import {
  formatCompactCurrencyFromCents,
  formatDate,
  formatDateShort,
} from '@/lib/utils';
import type {
  DashboardFilterState,
  DashboardStateSnapshot,
  DerivedDailyMetric,
} from '@/types/analytics';

/**
 * MRR composition over the selected window.
 *
 * The chart always plots composition. Selecting a KPI card changes what the
 * inspector *reads*, not what is drawn — the purpose of this chart is to explain
 * what moved the number, and swapping the series based on the headline would
 * hide exactly the flows the user is trying to account for.
 */

export type CompositionMode = 'area' | 'bar';

const MODE_OPTIONS: readonly SegmentedOption<CompositionMode>[] = [
  { value: 'area', label: 'Area', shortLabel: 'Area' },
  { value: 'bar', label: 'Bars', shortLabel: 'Bars' },
];

type FlowKey =
  | 'newMrrCents'
  | 'expansionMrrCents'
  | 'contractionMrrCents'
  | 'churnedMrrCents';

const COMPOSITION: ReadonlyArray<{ key: FlowKey; label: string; tone: ChartTone }> = [
  { key: 'newMrrCents', label: 'New & returning', tone: 'new' },
  { key: 'expansionMrrCents', label: 'Expansion', tone: 'expansion' },
  { key: 'contractionMrrCents', label: 'Contraction', tone: 'contraction' },
  { key: 'churnedMrrCents', label: 'Churned', tone: 'churn' },
];

export interface MrrCompositionChartProps {
  snapshot: DashboardStateSnapshot;
  filters: DashboardFilterState;
  now: Date;
  selectedIndex: number | null;
  onSelectIndex: (index: number | null) => void;
}

function toChartPoint(row: DerivedDailyMetric): AreaChartPoint & BarChartPoint {
  return {
    label: row.date,
    caption: formatDate(row.date),
    newMrrCents: row.newMrrCents,
    expansionMrrCents: row.expansionMrrCents,
    contractionMrrCents: row.contractionMrrCents,
    churnedMrrCents: row.churnedMrrCents,
  };
}

export function MrrCompositionChart({
  snapshot,
  filters,
  now,
  selectedIndex,
  onSelectIndex,
}: MrrCompositionChartProps) {
  const [mode, setMode] = useState<CompositionMode>('area');
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set<string>());

  const { rows, bucketMode } = useMemo(() => {
    const customerIds = filterCustomerIds(snapshot, filters);
    const window = resolveWindow(snapshot, filters.dateRange, now);
    const daily = dailyDerivedMetrics(snapshot, customerIds, window);
    const mode = bucketModeFor(filters.dateRange, window.windowDays);
    return { rows: bucketSeries(daily, mode), bucketMode: mode };
  }, [filters, now, snapshot]);

  const areaSeries: AreaSeries[] = useMemo(
    () => COMPOSITION.map((entry) => ({ ...entry, stackId: 'composition' })),
    [],
  );
  const barSeries: BarSeries[] = useMemo(() => [...COMPOSITION], []);

  /** Window totals, shown beside each legend entry. */
  const totals = useMemo(() => {
    const sums = new Map<FlowKey, number>();
    for (const entry of COMPOSITION) {
      sums.set(entry.key, rows.reduce((acc, row) => acc + row[entry.key], 0));
    }
    return sums;
  }, [rows]);

  const summary = useMemo(() => {
    const total = (key: FlowKey): string =>
      formatCompactCurrencyFromCents(totals.get(key) ?? 0);
    return `MRR flows across ${rows.length} buckets: new and returning ${total('newMrrCents')}, expansion ${total('expansionMrrCents')}, contraction ${total('contractionMrrCents')}, churn ${total('churnedMrrCents')}.`;
  }, [rows.length, totals]);

  const toggleSeries = (id: string): void => {
    setHiddenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatValue = (value: number): string => formatCompactCurrencyFromCents(value);

  return (
    <section
      id="revenue"
      aria-labelledby="revenue-heading"
      className="flex min-w-0 scroll-mt-20 flex-col gap-4"
    >
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="revenue-heading"
            className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
          >
            MRR composition
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            What moved the number, by {bucketMode === 'week' ? 'week' : 'day'}.
          </p>
        </div>
        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          ariaLabel="Chart form"
          className="shrink-0"
        />
      </header>

      <Legend
        items={COMPOSITION.map((entry) => ({
          id: entry.key,
          label: entry.label,
          tone: entry.tone,
          value: formatCompactCurrencyFromCents(totals.get(entry.key) ?? 0),
        }))}
        hiddenIds={hiddenIds}
        onToggle={toggleSeries}
        ariaLabel="Toggle MRR flow series"
      />

      <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        {mode === 'area' ? (
          <AreaChart
            data={rows.map(toChartPoint)}
            series={areaSeries}
            hiddenIds={hiddenIds}
            heightClassName="h-64 xl:h-72"
            summary={summary}
            ariaLabel="MRR composition over the selected window"
            formatValue={formatValue}
            formatTick={formatAxisCurrencyFromCents}
            selectedIndex={selectedIndex}
            onSelectIndex={onSelectIndex}
          />
        ) : (
          <BarChart
            data={rows.map(toChartPoint)}
            series={barSeries}
            hiddenIds={hiddenIds}
            layout="stacked"
            heightClassName="h-64 xl:h-72"
            summary={summary}
            ariaLabel="MRR composition over the selected window"
            formatValue={formatValue}
            formatTick={formatAxisCurrencyFromCents}
            selectedIndex={selectedIndex}
            onSelectIndex={onSelectIndex}
          />
        )}
      </div>

      <p
        className={`text-xs ${CHART_TONE_CLASS.neutral} dark:text-zinc-400`}
        data-testid="mrr-bucket-caption"
      >
        Tap the chart to pin a bucket. {rows.length} {bucketMode === 'week' ? 'weekly' : 'daily'}{' '}
        buckets from {formatDateShort(rows[0]?.date ?? now)} to{' '}
        {formatDateShort(rows[rows.length - 1]?.date ?? now)}.
      </p>
    </section>
  );
}

export default MrrCompositionChart;