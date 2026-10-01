import type {
  AcquisitionChannel,
  DateRangePreset,
  KpiMetricKey,
  RevenueMovementType,
  SubscriptionStatus,
  SubscriptionTier,
} from '@/types/analytics';
import {
  EM_DASH,
  formatCompactCurrencyFromCents,
  formatCurrencyWholeFromCents,
  formatPercent,
} from '@/lib/utils';

/**
 * Colour, label and axis helpers shared by the chart primitives.
 *
 * Tailwind v4 discovers class names by scanning source text, so every class in
 * this file is a complete static literal inside a lookup map. Interpolating a
 * name (`bg-indigo-${n}`) would produce utilities the scanner never sees.
 *
 * The module is pure: no clock, no DOM, no storage.
 */

export type ChartTone =
  | 'gross'
  | 'new'
  | 'expansion'
  | 'contraction'
  | 'churn'
  | 'neutral';

/** Series colour, referenced as a CSS variable so dark mode needs no JS. */
export const CHART_COLOR: Readonly<Record<ChartTone, string>> = {
  gross: 'var(--chart-gross)',
  new: 'var(--chart-new)',
  expansion: 'var(--chart-expansion)',
  contraction: 'var(--chart-contraction)',
  churn: 'var(--chart-churn)',
  neutral: 'var(--chart-neutral)',
};

/** Text classes that pair with each tone. */
export const CHART_TONE_CLASS: Readonly<Record<ChartTone, string>> = {
  gross: 'text-sky-700 dark:text-sky-300',
  new: 'text-emerald-700 dark:text-emerald-300',
  expansion: 'text-indigo-700 dark:text-indigo-300',
  contraction: 'text-amber-700 dark:text-amber-300',
  churn: 'text-rose-700 dark:text-rose-300',
  neutral: 'text-zinc-600 dark:text-zinc-300',
};

export const CHART_TONE_BORDER: Readonly<Record<ChartTone, string>> = {
  gross: 'border-sky-200 dark:border-sky-900',
  new: 'border-emerald-200 dark:border-emerald-900',
  expansion: 'border-indigo-200 dark:border-indigo-900',
  contraction: 'border-amber-200 dark:border-amber-900',
  churn: 'border-rose-200 dark:border-rose-900',
  neutral: 'border-zinc-200 dark:border-zinc-800',
};

/* -------------------------------------------------------------------------- */
/*                                   Labels                                  */
/* -------------------------------------------------------------------------- */

export const TIER_LABEL: Readonly<Record<SubscriptionTier, string>> = {
  starter: 'Starter',
  pro: 'Pro',
  scale: 'Scale',
  enterprise: 'Enterprise',
};

export const TIER_TONE: Readonly<Record<SubscriptionTier, ChartTone>> = {
  starter: 'neutral',
  pro: 'new',
  scale: 'expansion',
  enterprise: 'gross',
};

export const CHANNEL_LABEL: Readonly<Record<AcquisitionChannel, string>> = {
  organic_search: 'Organic search',
  product_hunt: 'Product Hunt',
  x_social: 'X / social',
  direct: 'Direct',
  referral: 'Referral',
};

export const CHANNEL_TONE: Readonly<Record<AcquisitionChannel, ChartTone>> = {
  organic_search: 'gross',
  product_hunt: 'expansion',
  x_social: 'contraction',
  direct: 'new',
  referral: 'churn',
};

export const STATUS_LABEL: Readonly<Record<SubscriptionStatus, string>> = {
  active: 'Active',
  trialing: 'Trialing',
  past_due: 'Past due',
  canceled: 'Canceled',
};

export const STATUS_TONE: Readonly<Record<SubscriptionStatus, ChartTone>> = {
  active: 'new',
  trialing: 'gross',
  past_due: 'contraction',
  canceled: 'churn',
};

/** Badge classes per status: colour is never the only signal, the text is. */
export const STATUS_BADGE_CLASS: Readonly<Record<SubscriptionStatus, string>> = {
  active:
    'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  trialing:
    'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300',
  past_due:
    'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300',
  canceled:
    'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300',
};

export const MOVEMENT_LABEL: Readonly<Record<RevenueMovementType, string>> = {
  new_business: 'New business',
  expansion: 'Expansion',
  contraction: 'Contraction',
  churn: 'Churn',
  reactivation: 'Reactivation',
  trial_started: 'Trial started',
  trial_converted: 'Trial converted',
  trial_canceled: 'Trial canceled',
};

/** Movements that legitimately carry a dollar delta. */
export const MOVEMENT_HAS_DELTA: Readonly<Record<RevenueMovementType, boolean>> = {
  new_business: true,
  expansion: true,
  contraction: true,
  churn: true,
  reactivation: true,
  trial_started: false,
  trial_converted: false,
  trial_canceled: false,
};

export const MOVEMENT_TONE: Readonly<Record<RevenueMovementType, ChartTone>> = {
  new_business: 'new',
  expansion: 'expansion',
  contraction: 'contraction',
  churn: 'churn',
  reactivation: 'gross',
  trial_started: 'neutral',
  trial_converted: 'new',
  trial_canceled: 'churn',
};

export const DATE_RANGE_LABEL: Readonly<Record<DateRangePreset, string>> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '12m': 'Last 12 months',
  all: 'All time',
};

export const DATE_RANGE_SHORT_LABEL: Readonly<Record<DateRangePreset, string>> = {
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  '12m': '12M',
  all: 'All',
};

export const KPI_LABEL: Readonly<Record<KpiMetricKey, string>> = {
  netMrr: 'Net MRR',
  arr: 'ARR',
  nrr: 'NRR',
  logoChurn: 'Logo churn',
};

/* -------------------------------------------------------------------------- */
/*                                Tap contract                               */
/* -------------------------------------------------------------------------- */

/**
 * The shape a Recharts chart-level `onClick` receives.
 *
 * Recharts types the handler's first argument as the chart props, which do not
 * declare `activeTooltipIndex` even though the runtime state carries it. Naming
 * the field here keeps the wrapper honest about what it reads.
 */
export interface ChartSelectionState {
  activeTooltipIndex?: number | string | null;
  activeLabel?: string | number | undefined;
}

/**
 * Normalises Recharts' `activeTooltipIndex` into a usable array index.
 *
 * Upstream the field is `number | TooltipIndex | undefined` where `TooltipIndex`
 * is `string | null`. `Number(null)` is `0` rather than "absent", so null is
 * rejected explicitly instead of coercing into a false hit on the first bucket.
 */
export function coerceChartIndex(raw: unknown): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const index = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(index) || !Number.isInteger(index) || index < 0) {
    return null;
  }
  return index;
}

/* -------------------------------------------------------------------------- */
/*                              Axis + domain                                */
/* -------------------------------------------------------------------------- */

/** Currency axis tick: whole units, compact once the numbers get long. */
export function formatAxisCurrencyFromCents(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return formatCompactCurrencyFromCents(value);
  }
  return formatCurrencyWholeFromCents(value);
}

/** Percentage axis tick, rounded to whole percent. */
export function formatAxisPercent(value: number): string {
  return formatPercent(value, 0);
}

/**
 * Pads a value domain so a series never touches the plot edge, and pins zero
 * into the domain for any chart that shows magnitudes.
 */
export function niceDomain(
  values: readonly number[],
  options: { includeZero?: boolean; padding?: number } = {},
): readonly [number, number] {
  const includeZero = options.includeZero ?? true;
  const padding = options.padding ?? 0.08;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    return [min, max + 1];
  }

  const span = max - min;
  return [min - span * padding, max + span * padding];
}

/* -------------------------------------------------------------------------- */
/*                                   Buckets                                 */
/* -------------------------------------------------------------------------- */

/** Windows longer than this render weekly buckets to keep the plot readable. */
export const WEEKLY_THRESHOLD_DAYS = 120;

export function windowDaysFor(dateRange: DateRangePreset): number | null {
  switch (dateRange) {
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
    case '12m':
      return 365;
    case 'all':
      return null;
    default:
      return null;
  }
}

/** True when the preset's window is too long to plot one point per day. */
export function shouldBucketWeekly(
  dateRange: DateRangePreset,
  resolvedWindowDays: number,
): boolean {
  return (
    dateRange === '12m' ||
    dateRange === 'all' ||
    resolvedWindowDays > WEEKLY_THRESHOLD_DAYS
  );
}

export type BucketMode = 'day' | 'week';

export function bucketModeFor(dateRange: DateRangePreset, windowDays: number): BucketMode {
  return shouldBucketWeekly(dateRange, windowDays) ? 'week' : 'day';
}

/* -------------------------------------------------------------------------- */
/*                                 Heat cells                                */
/* -------------------------------------------------------------------------- */

/**
 * Retention heat classes. Buckets are static literals so the Tailwind scanner
 * sees each one; the percentage is always printed in the cell too, so colour is
 * never the only carrier of meaning.
 */
export function heatCellClass(percent: number | null): string {
  if (percent === null) {
    return 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800/60 dark:text-zinc-500';
  }
  if (percent >= 90) {
    return 'bg-emerald-600/90 text-white dark:bg-emerald-500/90';
  }
  if (percent >= 75) {
    return 'bg-emerald-500/70 text-emerald-950 dark:bg-emerald-600/50 dark:text-emerald-50';
  }
  if (percent >= 60) {
    return 'bg-amber-400/70 text-amber-950 dark:bg-amber-500/40 dark:text-amber-50';
  }
  if (percent >= 40) {
    return 'bg-orange-400/70 text-orange-950 dark:bg-orange-500/40 dark:text-orange-50';
  }
  if (percent > 0) {
    return 'bg-rose-400/70 text-rose-950 dark:bg-rose-500/40 dark:text-rose-50';
  }
  return 'bg-rose-600/90 text-white dark:bg-rose-500/90';
}

/** Renders an unelapsed cohort cell. */
export const HEAT_EMPTY_LABEL = EM_DASH;