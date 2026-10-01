'use client';

import { SparkAreaChart, type SparkPoint } from '@/components/ui/SparkAreaChart';
import { MetricBadge } from '@/components/primitives/MetricBadge';
import { CHART_TONE_CLASS, KPI_LABEL, type ChartTone } from '@/lib/chartUtils';
import {
  EM_DASH,
  cn,
  formatCompactCurrencyFromCents,
  formatCurrencyFromCents,
  formatPercent,
} from '@/lib/utils';
import type { KpiMetricKey, KpiResult } from '@/types/analytics';

/**
 * A single headline metric.
 *
 * The whole card is one button — selecting the KPI changes what the inspector
 * reads — and it deliberately contains no nested interactive elements, because a
 * button inside a button is invalid HTML and unusable with assistive tech.
 *
 * The value is rendered twice, compact and full, with the choice made purely in
 * CSS. A JavaScript media query would have to run before paint to avoid a
 * layout shift, and the compact form has to be decided at 360px anyway.
 */

export interface KpiBentoCardProps {
  metric: KpiMetricKey;
  kpis: KpiResult;
  series: readonly SparkPoint[];
  selected: boolean;
  onSelect: (metric: KpiMetricKey) => void;
}

interface MetricPresentation {
  full: string;
  compact: string;
  caption: string;
  /** Signed percentage against the previous window, or null when unavailable. */
  delta: number | null;
  /** An increase in this metric is bad news. */
  inverse: boolean;
  tone: ChartTone;
}

function presentMetric(metric: KpiMetricKey, kpis: KpiResult): MetricPresentation {
  const { current, previous } = kpis;

  switch (metric) {
    case 'netMrr':
      return {
        full: formatCurrencyFromCents(current.netMrrCents),
        compact: formatCompactCurrencyFromCents(current.netMrrCents),
        caption: 'Monthly recurring revenue',
        delta: previous === null ? null : current.mrrGrowthPercent,
        inverse: false,
        tone: 'gross',
      };
    case 'arr':
      return {
        full: formatCurrencyFromCents(current.arrCents),
        compact: formatCompactCurrencyFromCents(current.arrCents),
        caption: 'Annualised run rate',
        delta: previous === null ? null : current.mrrGrowthPercent,
        inverse: false,
        tone: 'expansion',
      };
    case 'nrr':
      return {
        full: formatPercent(current.netRevenueRetentionPercent, 2),
        compact: formatPercent(current.netRevenueRetentionPercent, 1),
        caption: 'Net revenue retention',
        delta:
          previous === null || previous.netRevenueRetentionPercent === null
            ? null
            : (current.netRevenueRetentionPercent ?? 0) - (previous.netRevenueRetentionPercent ?? 0),
        inverse: false,
        tone: 'new',
      };
    case 'logoChurn':
      return {
        full: formatPercent(current.logoChurnRatePercent, 2),
        compact: formatPercent(current.logoChurnRatePercent, 1),
        caption: 'Share of logos lost in window',
        delta:
          previous === null
            ? null
            : current.logoChurnRatePercent - previous.logoChurnRatePercent,
        inverse: true,
        tone: 'churn',
      };
    default:
      return {
        full: EM_DASH,
        compact: EM_DASH,
        caption: '',
        delta: null,
        inverse: false,
        tone: 'neutral',
      };
  }
}

export function KpiBentoCard({
  metric,
  kpis,
  series,
  selected,
  onSelect,
}: KpiBentoCardProps) {
  const presentation = presentMetric(metric, kpis);
  const value = presentation.full === EM_DASH ? EM_DASH : presentation.full;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(metric)}
      data-testid={`kpi-card-${metric}`}
      className={cn(
        'flex min-h-11 min-w-0 flex-col gap-3 rounded-xl border p-4 text-left',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
        selected
          ? 'border-zinc-900 bg-white ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-900 dark:ring-zinc-100'
          : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700',
      )}
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {KPI_LABEL[metric]}
          </span>
          <span className="mt-0.5 block truncate text-xs text-zinc-400 dark:text-zinc-500">
            {presentation.caption}
          </span>
        </span>
        {presentation.delta !== null && (
          <MetricBadge
            value={presentation.delta}
            inverse={presentation.inverse}
            className="shrink-0"
          />
        )}
      </span>

      <span
        className={cn(
          'block min-w-0 truncate text-2xl font-semibold tabular-nums sm:text-3xl',
          CHART_TONE_CLASS[presentation.tone],
        )}
      >
        <span className="sm:hidden">{presentation.compact}</span>
        <span className="hidden sm:inline">{value}</span>
      </span>

      <span className="block min-w-0">
        <SparkAreaChart
          data={series}
          tone={presentation.tone}
          heightClassName="h-10"
          ariaLabel={`${KPI_LABEL[metric]} trend across the selected window`}
        />
      </span>
    </button>
  );
}

export default KpiBentoCard;