'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { useHydrated } from '@/hooks/useHydrated';
import { cn } from '@/lib/utils';

/**
 * Slide-over drawer rendered into `#drawer-root`.
 *
 * Behaviour, in the order it matters:
 *  - renders nothing until mounted, so the portal target is guaranteed to exist
 *  - marks `#app-root` inert (never the drawer itself) and restores it on close,
 *    which removes the rest of the page from the tab order and from AT without
 *    needing to hide it visually
 *  - locks body scroll and restores the previous value, including `''`
 *  - traps Tab inside the panel
 *  - closes on Escape and returns focus to whatever opened it
 *
 * A drawer can be presented as a side sheet or as a bottom sheet; both share this
 * behaviour and differ only in `placement`.
 */

export interface SlideOverDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** `side` slides in from the left rail; `bottom` is a mobile action sheet. */
  placement?: 'side' | 'bottom';
  /** Sticky footer, typically the Apply/Reset pair on the filter drawer. */
  footer?: ReactNode;
  /** Width of the side placement. */
  className?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function SlideOverDrawer({
  open,
  onClose,
  title,
  description,
  children,
  placement = 'side',
  footer,
  className,
}: SlideOverDrawerProps) {
  const hydrated = useHydrated();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

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

    const panel = panelRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusables?.item(0)?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const current = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (current === undefined || current.length === 0) {
        return;
      }
      const first = current.item(0);
      const last = current.item(current.length - 1);
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
  }, [handleClose, open]);

  if (!hydrated || !open) {
    return null;
  }

  const portalTarget = document.getElementById('drawer-root');
  if (portalTarget === null) {
    return null;
  }

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        placement === 'side' ? 'justify-start' : 'items-end justify-center',
      )}
    >
      <div
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px] dark:bg-black/60"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description === undefined ? undefined : 'slideover-description'}
        data-testid="slide-over-drawer"
        data-placement={placement}
        className={cn(
          'relative flex min-w-0 flex-col border-zinc-200 bg-white shadow-2xl',
          'dark:border-zinc-800 dark:bg-zinc-950',
          placement === 'side'
            ? 'h-full w-[min(20rem,88vw)] border-r'
            : 'max-h-[85vh] w-full rounded-t-2xl border-t',
          className,
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {title}
            </h2>
            {description !== undefined && (
              <p
                id="slideover-description"
                className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className={cn(
              'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-200',
              'text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
              'dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800',
            )}
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {children}
        </div>

        {footer !== undefined && (
          <div className="shrink-0 border-t border-zinc-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-zinc-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    portalTarget,
  );
}

export default SlideOverDrawer;