'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Delta chip for a metric.
 *
 * The arrow, the sign and the number are all present, so the direction is never
 * carried by colour alone. Metrics where a rise is bad — churn, for one — set
 * `inverse`, which flips the palette without hiding the direction.
 *
 * A `null` value means "not computable" rather than "unchanged", and renders as
 * a neutral dash rather than a misleading zero.
 */

export type MetricBadgeTone = 'positive' | 'negative' | 'neutral' | 'good' | 'bad';

export interface MetricBadgeProps {
  /** Signed percentage, or `null` when the metric cannot be computed. */
  value: number | null;
  /** Treat an increase as bad (churn) instead of good. */
  inverse?: boolean;
  /** Appended after the number, e.g. "pts". */
  suffix?: string;
  className?: string;
}

const TONE_CLASS: Readonly<Record<MetricBadgeTone, string>> = {
  positive:
    'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  negative:
    'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300',
  neutral:
    'bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300',
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  bad: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300',
};

const ARROW_CLASS: Readonly<Record<MetricBadgeTone, string>> = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-zinc-500 dark:text-zinc-400',
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
};

export function MetricBadge({ value, inverse = false, suffix, className }: MetricBadgeProps) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
          TONE_CLASS.neutral,
          className,
        )}
      >
        <Minus aria-hidden="true" className="h-3 w-3" />
        <span>&#8212;</span>
        <span className="sr-only">not comparable with the previous period</span>
      </span>
    );
  }

  const rounded = Math.round(value * 10) / 10;
  const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';

  let tone: MetricBadgeTone;
  if (direction === 'flat') {
    tone = 'neutral';
  } else {
    const risingIsGood = !inverse;
    const rising = direction === 'up';
    const good = rising === risingIsGood;
    tone = good ? 'good' : 'bad';
  }

  const Icon =
    direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset tabular-nums',
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('h-3 w-3', ARROW_CLASS[tone])} />
      <span>
        {direction === 'up' ? '+' : direction === 'down' ? '\u2212' : ''}
        {Math.abs(rounded).toFixed(1)}%
        {suffix ?? ''}
      </span>
      <span className="sr-only">
        {direction === 'up'
          ? `up ${Math.abs(rounded).toFixed(1)} percent`
          : direction === 'down'
            ? `down ${Math.abs(rounded).toFixed(1)} percent`
            : 'unchanged'}
      </span>
    </span>
  );
}

export default MetricBadge;