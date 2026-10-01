'use client';

import {
  Area,
  AreaChart as RechartsAreaChart,
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
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { cn } from '@/lib/utils';

/**
 * Multi-series area chart.
 *
 * Interaction contract: selection is read from the *chart-level* `onClick`
 * state rather than from a child `<Area>`, so a tap anywhere in the plot —
 * including the padding between two buckets — selects the nearest bucket. A tap
 * that resolves to no bucket clears the selection, which is also how the chart
 * behaves when tapped outside the plotted region.
 */

export interface AreaSeries {
  key: string;
  label: string;
  tone: ChartTone;
  /** Series sharing a stackId are summed; others overlay independently. */
  stackId?: string;
}

export interface AreaChartPoint {
  /** Bucket key used by the X axis. */
  label: string;
  /** Human-readable bucket label for the tooltip and the summary line. */
  caption: string;
  [seriesKey: string]: number | string;
}

export interface AreaChartProps {
  data: readonly AreaChartPoint[];
  series: readonly AreaSeries[];
  hiddenIds?: ReadonlySet<string>;
  heightClassName?: string;
  /** Screen-reader summary; the plot itself is described by `ariaLabel`. */
  summary: string;
  ariaLabel: string;
  formatValue?: (value: number, series: AreaSeries) => string;
  formatTick?: (value: number) => string;
  selectedIndex?: number | null;
  onSelectIndex?: (index: number | null) => void;
  className?: string;
}

function defaultFormatTick(value: number): string {
  return String(value);
}

export function AreaChart({
  data,
  series,
  hiddenIds,
  heightClassName = 'h-64',
  summary,
  ariaLabel,
  formatValue,
  formatTick = defaultFormatTick,
  selectedIndex = null,
  onSelectIndex,
  className,
}: AreaChartProps) {
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
            <RechartsAreaChart
              data={data as AreaChartPoint[]}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              onClick={handleClick}
            >
              <defs>
                {series.map((entry) => (
                  <linearGradient
                    key={`gradient-${entry.key}`}
                    id={`gradient-${entry.key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={CHART_COLOR[entry.tone]}
                      stopOpacity={0.32}
                    />
                    <stop
                      offset="100%"
                      stopColor={CHART_COLOR[entry.tone]}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                ))}
              </defs>

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
                minTickGap={24}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={formatTick}
              />
              <Tooltip
                cursor={{ stroke: 'var(--chart-neutral)', strokeWidth: 1 }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  if (active !== true || payload === undefined || payload.length === 0) {
                    return null;
                  }
                  const first = payload[0];
                  if (first === undefined) {
                    return null;
                  }
                  const point = first.payload as AreaChartPoint | undefined;
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
                <Area
                  key={entry.key}
                  type="monotone"
                  dataKey={entry.key}
                  name={entry.label}
                  stackId={entry.stackId}
                  stroke={CHART_COLOR[entry.tone]}
                  strokeWidth={2}
                  fill={`url(#gradient-${entry.key})`}
                  activeDot={{ r: 4 }}
                  dot={false}
                  isAnimationActive={!prefersReducedMotion}
                  animationDuration={450}
                />
              ))}
            </RechartsAreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}

export function EmptyPlot({ label }: { label: string }): React.ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-zinc-200 px-4 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      {label}
    </div>
  );
}

export default AreaChart;