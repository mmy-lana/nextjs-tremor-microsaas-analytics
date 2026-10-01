'use client';

import { CHART_COLOR, CHART_TONE_CLASS, type ChartTone } from '@/lib/chartUtils';
import { cn } from '@/lib/utils';

/**
 * Horizontal bar list.
 *
 * Built from plain elements rather than an SVG so it wraps, scrolls and reads
 * correctly at 360px. Every row prints its own numeric value, so the bar length
 * is a secondary cue rather than the only way to read the number.
 */

export interface BarListItem {
  id: string;
  label: string;
  value: number;
  tone: ChartTone;
  /** Pre-formatted value; falls back to a plain number when omitted. */
  formattedValue?: string;
}

export interface BarListProps {
  items: readonly BarListItem[];
  /** Rendered to the right of the section title. */
  emptyLabel?: string;
  ariaLabel: string;
  className?: string;
}

export function BarList({
  items,
  emptyLabel = 'Nothing to show for this filter',
  ariaLabel,
  className,
}: BarListProps) {
  const max = items.reduce((acc, item) => Math.max(acc, Math.abs(item.value)), 0);

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <ul aria-label={ariaLabel} className="flex min-w-0 flex-col gap-2.5">
        {items.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {emptyLabel}
          </li>
        )}
        {items.map((item) => {
          const ratio = max > 0 ? Math.abs(item.value) / max : 0;
          const widthPercent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
          return (
            <li key={item.id} className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-zinc-700 dark:text-zinc-200">
                  {item.label}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-sm font-medium tabular-nums',
                    CHART_TONE_CLASS[item.tone],
                  )}
                >
                  {item.formattedValue ?? item.value}
                </span>
              </div>
              <div
                aria-hidden="true"
                className="h-2 w-full min-w-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${widthPercent}%`,
                    backgroundColor: CHART_COLOR[item.tone],
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default BarList;