'use client';

import { X } from 'lucide-react';

import { MetricBadge } from '@/components/primitives/MetricBadge';
import {
  CHART_TONE_CLASS,
  KPI_LABEL,
  type ChartTone,
} from '@/lib/chartUtils';
import { cn, EM_DASH, formatPercent } from '@/lib/utils';
import type { KpiMetricKey, KpiResult } from '@/types/analytics';

/**
 * Pinned readout above the charts.
 *
 * Selecting a KPI card changes what the headline reads; tapping a chart pins a
 * bucket and adds that bucket's composition underneath. Both live here so the
 * numbers a user is comparing are always in the same place, rather than spread
 * across tooltips that vanish on touch.
 */

export interface InspectorComposition {
  key: string;
  label: string;
  tone: ChartTone;
  formattedValue: string;
}

export interface InteractiveChartInspectorProps {
  metric: KpiMetricKey;
  kpis: KpiResult;
  /** Pinned bucket, or null when nothing is selected. */
  selectedPoint: { index: number; date: string; caption: string } | null;
  /** Composition of the pinned bucket; empty when no bucket is selected. */
  composition: readonly InspectorComposition[];
  onClearPoint: () => void;
}

/**
 * Picks the figure the inspector headlines for the selected metric.
 *
 * The current value is read from `current` and only the *delta* depends on
 * `previous`. `previous` is null for the all-time preset and for any window
 * that predates the data, and bailing out on it would blank the headline on
 * exactly those ranges -- the reader is left with no number at all.
 */
function headlineFor(metric: KpiMetricKey, kpis: KpiResult): {
  value: string;
  delta: number | null;
  inverse: boolean;
} {
  const { current, previous } = kpis;
  switch (metric) {
    case 'netMrr':
    case 'arr':
      return {
        value: formatPercent(current.mrrGrowthPercent),
        delta: previous === null ? null : current.mrrGrowthPercent,
        inverse: false,
      };
    case 'nrr':
      return {
        value: formatPercent(current.netRevenueRetentionPercent, 2),
        delta:
          previous === null ||
          current.netRevenueRetentionPercent === null ||
          previous.netRevenueRetentionPercent === null
            ? null
            : current.netRevenueRetentionPercent - previous.netRevenueRetentionPercent,
        inverse: false,
      };
    case 'logoChurn':
      return {
        value: formatPercent(current.logoChurnRatePercent, 2),
        delta:
          previous === null
            ? null
            : current.logoChurnRatePercent - previous.logoChurnRatePercent,
        inverse: true,
      };
    default:
      return { value: EM_DASH, delta: null, inverse: false };
  }
}

export function InteractiveChartInspector({
  metric,
  kpis,
  selectedPoint,
  composition,
  onClearPoint,
}: InteractiveChartInspectorProps) {
  const headline = headlineFor(metric, kpis);

  return (
    <div
      data-testid="chart-inspector"
      data-selected-point={selectedPoint === null ? '' : String(selectedPoint.index)}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4',
        'dark:border-zinc-800 dark:bg-zinc-900',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {KPI_LABEL[metric]}
          </p>
          <p className="mt-0.5 flex min-w-0 items-baseline gap-2">
            {headline.value !== EM_DASH && (
              <span className="truncate text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {headline.value}
              </span>
            )}
            {headline.delta !== null && (
              <MetricBadge value={headline.delta} inverse={headline.inverse} />
            )}
            {kpis.previous === null && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                No comparable previous window
              </span>
            )}
          </p>
        </div>

        {selectedPoint !== null && (
          <button
            type="button"
            onClick={onClearPoint}
            data-testid="clear-selection"
            className={cn(
              'inline-flex min-h-11 min-w-11 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5',
              'text-xs font-medium text-zinc-700 hover:bg-zinc-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
              'dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800',
            )}
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="whitespace-nowrap">{selectedPoint.caption}</span>
          </button>
        )}
      </div>

      {selectedPoint !== null && (
        <dl
          data-testid="inspector-composition"
          className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 border-t border-zinc-100 pt-3 sm:grid-cols-3 lg:grid-cols-5 dark:border-zinc-800"
        >
          {composition.map((entry) => (
            <div key={entry.key} className="flex min-w-0 flex-col">
              <dt className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {entry.label}
              </dt>
              <dd
                className={cn(
                  'truncate text-sm font-medium tabular-nums',
                  CHART_TONE_CLASS[entry.tone],
                )}
              >
                {entry.formattedValue}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {selectedPoint === null && (
        <p className="border-t border-zinc-100 pt-3 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          Tap a point on a chart to pin its values here.
        </p>
      )}
    </div>
  );
}

export default InteractiveChartInspector;