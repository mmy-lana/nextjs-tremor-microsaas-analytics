'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { CHART_COLOR, CHART_TONE_CLASS, type ChartTone } from '@/lib/chartUtils';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { cn } from '@/lib/utils';

/**
 * Donut chart with a centred value.
 *
 * The centre is a real DOM element rather than SVG text so it inherits the card's
 * typography and stays legible at 360px, where a donut would otherwise be tiny.
 */

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  tone: ChartTone;
  /** Pre-formatted slice value for the legend row. */
  formattedValue: string;
  /** Share of the total, 0-100. */
  sharePercent: number;
}

export interface DonutChartProps {
  slices: readonly DonutSlice[];
  /** Large value rendered in the hole, e.g. "$33.0K". */
  centerValue: string;
  centerLabel: string;
  ariaLabel: string;
  summary: string;
  className?: string;
}

export function DonutChart({
  slices,
  centerValue,
  centerLabel,
  ariaLabel,
  summary,
  className,
}: DonutChartProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const total = slices.reduce((acc, slice) => acc + slice.value, 0);

  return (
    <div className={cn('flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center', className)}>
      <figure className="flex min-w-0 flex-1 flex-col gap-2">
        <figcaption className="sr-only">{summary}</figcaption>
        <div className="relative mx-auto h-40 w-40 shrink-0 sm:h-44 sm:w-44">
          {total === 0 ? (
            <div className="flex h-full w-full items-center justify-center rounded-full border-8 border-zinc-100 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              No data
            </div>
          ) : (
            <>
              <div
                className="h-full w-full"
                role="img"
                aria-label={ariaLabel}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip
                      isAnimationActive={false}
                      content={({ active, payload }) => {
                        if (active !== true || payload === undefined || payload.length === 0) {
                          return null;
                        }
                        const entry = payload[0];
                        if (entry === undefined) {
                          return null;
                        }
                        const slice = slices.find(
                          (candidate) => candidate.id === String(entry.name),
                        );
                        return (
                          <div className="rounded-lg border border-zinc-200 bg-white/95 px-2 py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900/95">
                            <span className="font-medium text-zinc-900 dark:text-zinc-50">
                              {slice?.label ?? ''}
                            </span>
                            <span className="ml-2 tabular-nums text-zinc-600 dark:text-zinc-300">
                              {slice?.formattedValue ?? ''}
                            </span>
                          </div>
                        );
                      }}
                    />
                    <Pie
                      data={slices as DonutSlice[]}
                      dataKey="value"
                      nameKey="id"
                      innerRadius="62%"
                      outerRadius="92%"
                      paddingAngle={2}
                      stroke="none"
                      isAnimationActive={!prefersReducedMotion}
                      animationDuration={450}
                    >
                      {slices.map((slice) => (
                        <Cell key={slice.id} fill={CHART_COLOR[slice.tone]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
              >
                <span className="truncate text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {centerValue}
                </span>
                <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  {centerLabel}
                </span>
              </div>
            </>
          )}
        </div>
      </figure>

      <ul className="flex min-w-0 flex-1 flex-col gap-2">
        {slices.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            No revenue to distribute
          </li>
        )}
        {slices.map((slice) => (
          <li key={slice.id} className="flex min-w-0 items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: CHART_COLOR[slice.tone] }}
              />
              <span className="min-w-0 truncate text-sm text-zinc-700 dark:text-zinc-200">
                {slice.label}
              </span>
            </span>
            <span className="flex min-w-0 shrink-0 items-baseline gap-1.5">
              <span
                className={cn(
                  'text-sm font-medium tabular-nums',
                  CHART_TONE_CLASS[slice.tone],
                )}
              >
                {slice.formattedValue}
              </span>
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {slice.sharePercent.toFixed(1)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default DonutChart;