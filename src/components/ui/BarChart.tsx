'use client';

import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  CHART_COLOR,
  coerceChartIndex,
  type ChartSelectionState,
  type ChartTone,
} from '@/lib/chartUtils';
import { EmptyPlot } from '@/components/ui/AreaChart';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { cn } from '@/lib/utils';

/**
 * Stacked or grouped bar chart.
 *
 * The tap contract matches `AreaChart` exactly: selection comes from the
 * chart-level `onClick` state, never from `<Bar onClick>`, because a click
 * handler on the bar itself only fires when the pointer happens to land exactly
 * on a rectangle — which is unreliable with a finger.
 */

export interface BarSeries {
  key: string;
  label: string;
  tone: ChartTone;
}

export interface BarChartPoint {
  label: string;
  caption: string;
  [seriesKey: string]: number | string;
}

export interface BarChartProps {
  data: readonly BarChartPoint[];
  series: readonly BarSeries[];
  hiddenIds?: ReadonlySet<string>;
  /** `stacked` sums the series; `grouped` places them side by side. */
  layout?: 'stacked' | 'grouped';
  heightClassName?: string;
  summary: string;
  ariaLabel: string;
  formatValue?: (value: number, series: BarSeries) => string;
  formatTick?: (value: number) => string;
  selectedIndex?: number | null;
  onSelectIndex?: (index: number | null) => void;
  className?: string;
}

function defaultFormatTick(value: number): string {
  return String(value);
}

export function BarChart({
  data,
  series,
  hiddenIds,
  layout = 'stacked',
  heightClassName = 'h-64',
  summary,
  ariaLabel,
  formatValue,
  formatTick = defaultFormatTick,
  selectedIndex = null,
  onSelectIndex,
  className,
}: BarChartProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const visible = series.filter((entry) => !(hiddenIds?.has(entry.key) ?? false));

  const handleClick = (state: ChartSelectionState): void => {
    if (onSelectIndex === undefined) {
      return;
    }
    const index = coerceChartIndex(state.activeTooltipIndex);
    if (index === null || index >= data.length) {
      onSelectIndex(null);
      return;
    }
    onSelectIndex(index);
  };

  const selectedPoint =
    selectedIndex !== null && selectedIndex >= 0 ? data[selectedIndex] : undefined;

  const axisTick = { fill: 'var(--chart-axis-text)', fontSize: 11 };

  return (
    <figure className={cn('flex min-w-0 flex-col gap-2', className)}>
      <figcaption className="sr-only">{summary}</figcaption>
      <div className={cn('w-full', heightClassName)} role="img" aria-label={ariaLabel}>
        {data.length === 0 ? (
          <EmptyPlot label="No activity in this window" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart
              data={data as BarChartPoint[]}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              onClick={handleClick}
            >
              <CartesianGrid
                stroke="var(--chart-grid)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={axisTick}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-grid)' }}
                minTickGap={16}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={formatTick}
              />
              <Tooltip
                cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.4 }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  if (active !== true || payload === undefined || payload.length === 0) {
                    return null;
                  }
                  const first = payload[0];
                  if (first === undefined) {
                    return null;
                  }
                  const point = first.payload as BarChartPoint | undefined;
                  return (
                    <div className="min-w-44 rounded-lg border border-zinc-200 bg-white/95 p-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900/95">
                      <p className="mb-1 font-medium text-zinc-900 dark:text-zinc-50">
                        {point?.caption ?? ''}
                      </p>
                      {payload.map((entry) => {
                        const meta = series.find(
                          (candidate) => candidate.key === String(entry.dataKey),
                        );
                        const numeric =
                          typeof entry.value === 'number' ? entry.value : Number(entry.value);
                        if (meta === undefined || !Number.isFinite(numeric)) {
                          return null;
                        }
                        return (
                          <div
                            key={String(entry.dataKey)}
                            className="flex items-center justify-between gap-4 py-0.5"
                          >
                            <span className="text-zinc-600 dark:text-zinc-300">
                              {meta.label}
                            </span>
                            <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                              {formatValue ? formatValue(numeric, meta) : String(numeric)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              {selectedPoint !== undefined && (
                <ReferenceLine
                  x={selectedPoint.label}
                  stroke="var(--chart-neutral)"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
              )}
              {visible.map((entry) => (
                <Bar
                  key={entry.key}
                  dataKey={entry.key}
                  name={entry.label}
                  stackId={layout === 'stacked' ? 'stack' : undefined}
                  fill={CHART_COLOR[entry.tone]}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={!prefersReducedMotion}
                  animationDuration={450}
                />
              ))}
            </RechartsBarChart>
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}

export default BarChart;