'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Menu, RotateCcw, UserPlus } from 'lucide-react';

import { ThemeToggle } from '@/components/primitives/ThemeToggle';
import { SlideOverDrawer } from '@/components/primitives/SlideOverDrawer';
import { ConfirmDialog } from '@/components/primitives/ConfirmDialog';
import { cn } from '@/lib/utils';

/**
 * Application header.
 *
 * One component covers every breakpoint: the desktop rail owns navigation below
 * `lg`, so the header shows a hamburger there instead, and both render the same
 * actions. Keeping them in one place is what stops the mobile and desktop
 * headers from drifting apart.
 */

export interface NavAnchor {
  id: string;
  label: string;
}

export interface AppHeaderProps {
  anchors: readonly NavAnchor[];
  onOpenAddCustomer: () => void;
  onExportCustomers: () => void;
  onExportDailyMrr: () => void;
  onResetDemo: () => Promise<void> | void;
}

export function AppHeader({
  anchors,
  onOpenAddCustomer,
  onExportCustomers,
  onExportDailyMrr,
  onResetDemo,
}: AppHeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  // Set when the menu was opened from the keyboard, so the effect below moves
  // focus into it. A click open leaves focus on the trigger, which is where the
  // pointer already is. A ref rather than state: this is a one-shot instruction
  // consumed by the effect, not a value anything renders from.
  const focusFirstExportItemRef = useRef(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const closeExportMenu = useCallback((restoreFocus: boolean) => {
    setExportOpen(false);
    focusFirstExportItemRef.current = false;
    if (restoreFocus) {
      exportTriggerRef.current?.focus();
    }
  }, []);

  // Runs on commit once the menu is in the DOM, so there is something to focus.
  useEffect(() => {
    if (!exportOpen || !focusFirstExportItemRef.current) {
      return;
    }
    focusFirstExportItemRef.current = false;
    exportMenuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
  }, [exportOpen]);

  /**
   * WAI-ARIA menu keyboard model: arrows move between items, Home and End jump
   * to the ends, Escape closes and returns focus to the trigger, and Tab leaves
   * the menu entirely rather than walking its items.
   */
  const onExportMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(
      exportMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) {
      return;
    }
    const currentIndex = items.findIndex((item) => item === document.activeElement);

    const focusAt = (index: number): void => {
      const wrapped = ((index % items.length) + items.length) % items.length;
      items[wrapped]?.focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(currentIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(currentIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(items.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        closeExportMenu(true);
        break;
      case 'Tab':
        closeExportMenu(false);
        break;
      default:
        break;
    }
  };

  // Escape closes the menu from anywhere, including while focus is still on the
  // trigger, and a click outside dismisses it without stealing focus back.
  useEffect(() => {
    if (!exportOpen) {
      return;
    }
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeExportMenu(true);
      }
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, [closeExportMenu, exportOpen]);

  const runReset = async (): Promise<void> => {
    setResetting(true);
    try {
      await onResetDemo();
    } finally {
      setResetting(false);
      setConfirmResetOpen(false);
      setDrawerOpen(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="flex items-center gap-2 px-3 pt-[env(safe-area-inset-top)] sm:px-4">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          data-testid="nav-toggle"
          className={cn(
            'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-200',
            'text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
            'dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800',
            'lg:hidden',
          )}
        >
          <Menu aria-hidden="true" className="h-5 w-5" />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Ledgerly
            </span>
            <span className="hidden truncate text-xs text-zinc-500 dark:text-zinc-400 sm:block">
              Micro-SaaS analytics
            </span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenAddCustomer}
            data-testid="open-add-customer"
            className={cn(
              'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3',
              'text-sm font-medium text-white transition-colors hover:bg-zinc-700',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
              'dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white',
            )}
          >
            <UserPlus aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Add customer</span>
          </button>

          <div className="relative">
            <button
              type="button"
              ref={exportTriggerRef}
              onClick={() => setExportOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && !exportOpen) {
                  event.preventDefault();
                  focusFirstExportItemRef.current = true;
                  setExportOpen(true);
                }
              }}
              aria-expanded={exportOpen}
              aria-haspopup="menu"
              aria-controls={exportOpen ? 'export-menu' : undefined}
              aria-label="Export data"
              data-testid="export-menu-toggle"
              className={cn(
                'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3',
                'text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                'dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800',
              )}
            >
              <Download aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown aria-hidden="true" className="hidden h-3 w-3 sm:inline" />
            </button>

            {exportOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden="true"
                  onClick={() => closeExportMenu(false)}
                />
                <div
                  id="export-menu"
                  ref={exportMenuRef}
                  role="menu"
                  aria-label="Export data"
                  onKeyDown={onExportMenuKeyDown}
                  className={cn(
                    'absolute right-0 z-20 mt-1 min-w-52 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg',
                    'dark:border-zinc-800 dark:bg-zinc-900',
                  )}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeExportMenu(false);
                      onExportCustomers();
                    }}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-zinc-700',
                      'hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                      'dark:text-zinc-200 dark:hover:bg-zinc-800',
                    )}
                  >
                    <Download aria-hidden="true" className="h-4 w-4" />
                    Customers CSV
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeExportMenu(false);
                      onExportDailyMrr();
                    }}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-zinc-700',
                      'hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                      'dark:text-zinc-200 dark:hover:bg-zinc-800',
                    )}
                  >
                    <Download aria-hidden="true" className="h-4 w-4" />
                    Daily MRR CSV
                  </button>
                </div>
              </>
            )}
          </div>

          <ThemeToggle />
        </div>
      </div>

      <SlideOverDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Navigation"
        placement="side"
        footer={
          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            data-testid="reset-demo-data"
            className={cn(
              'flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-rose-300 px-4 text-sm font-medium',
              'text-rose-700 transition-colors hover:bg-rose-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
              'dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-500/10',
            )}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Reset demo data
          </button>
        }
      >
        <nav aria-label="Sections">
          <ul className="flex min-w-0 flex-col gap-1">
            {anchors.map((anchor) => (
              <li key={anchor.id} className="min-w-0">
                <a
                  href={`#${anchor.id}`}
                  onClick={() => setDrawerOpen(false)}
                  className={cn(
                    'flex min-h-11 min-w-0 items-center rounded-lg px-3 text-sm font-medium text-zinc-700',
                    'hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                    'dark:text-zinc-200 dark:hover:bg-zinc-800',
                  )}
                >
                  <span className="truncate">{anchor.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </SlideOverDrawer>

      <ConfirmDialog
        open={confirmResetOpen}
        title="Reset demo data?"
        description="This rebuilds the seeded dataset from scratch."
        consequences={[
          'Every subscription, tier change and cancellation you made is discarded.',
          'The revision keeps moving forward, so other tabs will pick up the reset.',
        ]}
        confirmLabel="Reset data"
        busy={resetting}
        onConfirm={() => void runReset()}
        onCancel={() => setConfirmResetOpen(false)}
      />
    </header>
  );
}

export default AppHeader;