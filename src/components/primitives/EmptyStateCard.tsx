'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Zero-result card.
 *
 * Always offers the way out: a filter that cannot be cleared from the empty
 * state is a dead end, so the reset button is part of the component rather than
 * something each caller has to remember to add.
 */

export interface EmptyStateCardProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Secondary action, e.g. "Add customer". */
  secondaryAction?: { label: string; onAction: () => void };
  icon?: ReactNode;
  className?: string;
}

export function EmptyStateCard({
  title,
  description,
  actionLabel,
  onAction,
  secondaryAction,
  icon,
  className,
}: EmptyStateCardProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300',
        'bg-white/60 px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-900/40',
        className,
      )}
    >
      {icon !== undefined && (
        <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-500">
          {icon}
        </span>
      )}
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
        <p className="mx-auto max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      </div>
      {(onAction !== undefined || secondaryAction !== undefined) && (
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-2">
          {onAction !== undefined && actionLabel !== undefined && (
            <button
              type="button"
              onClick={onAction}
              className={cn(
                'min-h-11 min-w-11 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white',
                'transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                'dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white',
              )}
            >
              {actionLabel}
            </button>
          )}
          {secondaryAction !== undefined && (
            <button
              type="button"
              onClick={secondaryAction.onAction}
              className={cn(
                'min-h-11 min-w-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700',
                'transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
              )}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default EmptyStateCard;