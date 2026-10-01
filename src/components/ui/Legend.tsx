'use client';

import { CHART_COLOR, CHART_TONE_CLASS, type ChartTone } from '@/lib/chartUtils';
import { cn } from '@/lib/utils';

/**
 * Series toggle legend.
 *
 * Each entry is a real `<button>` with `aria-pressed`, so the state is
 * announced rather than implied by opacity, and every target clears the 44px
 * minimum touch size the layout rules require.
 */

export interface LegendItem {
  id: string;
  label: string;
  tone: ChartTone;
  /** Rendered to the right of the label, e.g. a live value. */
  value?: string;
}

export interface LegendProps {
  items: readonly LegendItem[];
  /** Ids that are currently hidden from the chart. */
  hiddenIds?: ReadonlySet<string>;
  onToggle: (id: string) => void;
  ariaLabel: string;
  className?: string;
}

export function Legend({
  items,
  hiddenIds,
  onToggle,
  ariaLabel,
  className,
}: LegendProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {items.map((item) => {
        const hidden = hiddenIds?.has(item.id) ?? false;
        return (
          <li key={item.id} className="min-w-0">
            <button
              type="button"
              aria-pressed={!hidden}
              onClick={() => onToggle(item.id)}
              className={cn(
                'flex min-h-11 min-w-11 items-center gap-2 rounded-lg border border-transparent px-2.5 text-left text-xs font-medium',
                'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                hidden
                  ? 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400'
                  : cn(CHART_TONE_CLASS[item.tone], 'hover:bg-zinc-100 dark:hover:bg-zinc-800'),
              )}
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: CHART_COLOR[item.tone],
                  opacity: hidden ? 0.3 : 1,
                }}
              />
              <span className={cn('min-w-0 truncate', hidden && 'line-through')}>
                {item.label}
              </span>
              {item.value !== undefined && (
                <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                  {item.value}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default Legend;