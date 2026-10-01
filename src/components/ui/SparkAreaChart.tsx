'use client';

import { Area, AreaChart as RechartsAreaChart, ResponsiveContainer } from 'recharts';

import { CHART_COLOR, CHART_TONE_CLASS, type ChartTone } from '@/lib/chartUtils';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { cn } from '@/lib/utils';

/**
 * Non-interactive sparkline.
 *
 * Rendered inside a KPI card button, so it carries no tooltip, no axes and no
 * interaction of its own: the card itself is the single control, and a nested
 * interactive element would break both the tap target and the a11y tree.
 */

export interface SparkPoint {
  /** Bucket label, used only for the accessible summary. */
  label: string;
  value: number;
}

export interface SparkAreaChartProps {
  data: readonly SparkPoint[];
  tone?: ChartTone;
  /** Describes the trend for screen readers, e.g. "Net MRR, last 30 days". */
  ariaLabel: string;
  className?: string;
  /** Tailwind height class; the width is always fluid. */
  heightClassName?: string;
}

export function SparkAreaChart({
  data,
  tone = 'gross',
  ariaLabel,
  className,
  heightClassName = 'h-12',
}: SparkAreaChartProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const colour = CHART_COLOR[tone];

  return (
    <div
      className={cn('w-full', heightClassName, className)}
      role="img"
      aria-label={ariaLabel}
    >
      {data.length === 0 ? (
        <div
          className={cn(
            'h-full w-full rounded-md border border-dashed border-zinc-200 dark:border-zinc-800',
            CHART_TONE_CLASS[tone],
          )}
        />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <RechartsAreaChart
            data={data as SparkPoint[]}
            margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id={`spark-${tone}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colour} stopOpacity={0.35} />
                <stop offset="100%" stopColor={colour} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke={colour}
              strokeWidth={1.5}
              fill={`url(#spark-${tone})`}
              dot={false}
              isAnimationActive={!prefersReducedMotion}
              animationDuration={400}
            />
          </RechartsAreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default SparkAreaChart;