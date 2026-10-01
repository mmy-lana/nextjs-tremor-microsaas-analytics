'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

import { useHydrated } from '@/hooks/useHydrated';
import { cn } from '@/lib/utils';

/**
 * Two-step confirmation for destructive actions.
 *
 * "Cancel subscription", "Reset demo data" and "Repair local state" all destroy
 * work the user cannot get back, so none of them can be a single click. The
 * default focus is the cancel button: the safe choice should be the one a
 * reflexive Enter press lands on.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Extra consequences spelled out before the user commits. */
  consequences?: readonly string[];
  confirmLabel: string;
  cancelLabel?: string;
  /** Set while the action runs; disables both buttons and blocks re-entry. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: 'danger' | 'default';
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ConfirmDialog({
  open,
  title,
  description,
  consequences,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
  tone = 'danger',
}: ConfirmDialogProps) {
  const hydrated = useHydrated();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const handleCancel = useCallback(() => {
    if (busy) {
      return;
    }
    onCancel();
  }, [busy, onCancel]);

  useEffect(() => {
    if (!open) {
      return;
    }

    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const appRoot = document.getElementById('app-root');
    appRoot?.setAttribute('inert', '');

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // The safe choice gets focus by default.
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (nodes === undefined || nodes.length === 0) {
        return;
      }
      const first = nodes.item(0);
      const last = nodes.item(nodes.length - 1);
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      appRoot?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [handleCancel, open]);

  const portalTarget = hydrated ? document.getElementById('drawer-root') : null;
  if (!open || portalTarget === null) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px] dark:bg-black/60"
        onClick={handleCancel}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        data-testid="confirm-dialog"
        className={cn(
          'relative flex w-full max-w-md min-w-0 flex-col gap-4 rounded-2xl border p-5 shadow-2xl',
          'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              tone === 'danger'
                ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
            )}
          >
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h2
              id="confirm-dialog-title"
              className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
            >
              {title}
            </h2>
            <p
              id="confirm-dialog-description"
              className="text-sm text-zinc-600 dark:text-zinc-300"
            >
              {description}
            </p>
          </div>
        </div>

        {consequences !== undefined && consequences.length > 0 && (
          <ul className="min-w-0 space-y-1 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            {consequences.map((item) => (
              <li key={item} className="min-w-0">
                {item}
              </li>
            ))}
          </ul>
        )}

        <div className="flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className={cn(
              'min-h-11 min-w-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700',
              'transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
              'disabled:cursor-not-allowed disabled:opacity-60',
              'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
            )}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'min-h-11 min-w-11 rounded-lg px-4 text-sm font-medium text-white',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
              'disabled:cursor-not-allowed disabled:opacity-60',
              tone === 'danger'
                ? 'bg-rose-600 hover:bg-rose-500'
                : 'bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white',
            )}
          >
            {busy ? 'Working\u2026' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}

export type { ReactNode };

export default ConfirmDialog;