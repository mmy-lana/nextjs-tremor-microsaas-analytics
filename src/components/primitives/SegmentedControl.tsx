'use client';

import { useCallback, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Segmented control following the ARIA tabs pattern.
 *
 * Arrow keys move between options, Home/End jump to the ends, and the active
 * tab is the only one in the tab order (roving tabindex), which is what lets a
 * keyboard user reach the group with a single Tab.
 *
 * Every option is at least 44px tall so it clears the touch-target floor.
 */

export interface SegmentedOption<TValue extends string> {
  value: TValue;
  label: string;
  /** Short label used below `sm` where horizontal space is scarce. */
  shortLabel?: string;
}

export interface SegmentedControlProps<TValue extends string> {
  options: readonly SegmentedOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  ariaLabel: string;
  className?: string;
  /** Render the short label at every width. */
  alwaysShort?: boolean;
}

export function SegmentedControl<TValue extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  alwaysShort = false,
}: SegmentedControlProps<TValue>) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const focusOption = useCallback((index: number) => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const buttons = list.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const target = buttons.item(((index % buttons.length) + buttons.length) % buttons.length);
    target?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (options.length === 0) {
        return;
      }
      const current = Math.max(
        0,
        options.findIndex((option) => option.value === value),
      );

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          onChange(options[(current + 1) % options.length]?.value ?? value);
          focusOption(current + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          onChange(options[(current - 1 + options.length) % options.length]?.value ?? value);
          focusOption(current - 1);
          break;
        case 'Home':
          event.preventDefault();
          onChange(options[0]?.value ?? value);
          focusOption(0);
          break;
        case 'End':
          event.preventDefault();
          onChange(options[options.length - 1]?.value ?? value);
          focusOption(options.length - 1);
          break;
        default:
          break;
      }
    },
    [focusOption, onChange, options, value],
  );

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-100/80 p-1',
        'dark:border-zinc-800 dark:bg-zinc-900/80',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-11 min-w-11 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
              selected
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
          >
            {alwaysShort && option.shortLabel !== undefined ? (
              option.shortLabel
            ) : (
              <>
                <span className={cn(option.shortLabel === undefined && 'hidden sm:inline')}>
                  {option.label}
                </span>
                {option.shortLabel !== undefined && (
                  <span className="sm:hidden">{option.shortLabel}</span>
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;