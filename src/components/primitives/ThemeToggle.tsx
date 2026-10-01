'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

import { THEME_KEY, type ThemePreference } from '@/lib/storage';
import { cn } from '@/lib/utils';

/**
 * Light/dark toggle.
 *
 * The preference lives in exactly one place — the `microsaas_v1_theme` key and
 * the `.dark` class on `<html>`. The blocking script in `layout.tsx` sets both
 * before first paint, so this control *derives* its state from the DOM rather
 * than keeping a copy that could drift.
 *
 * Both icons are rendered and swapped by a `dark:` variant, which keeps the
 * correct glyph visible from the very first paint with no hydration flash; the
 * accessible label comes from the subscription.
 */

/** Broadcast so every mounted control updates without prop drilling. */
const THEME_EVENT = 'microsaas:themechange';

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onStoreChange);
  // Another tab changing the preference updates this tab's class too.
  window.addEventListener('storage', onStoreChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

function getSnapshot(): ThemePreference {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function getServerSnapshot(): ThemePreference {
  return 'light';
}

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = preference === 'dark';

  const toggle = useCallback(() => {
    const next: ThemePreference = isDark ? 'light' : 'dark';

    document.documentElement.classList.toggle('dark', next === 'dark');
    document.documentElement.style.colorScheme = next;

    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // The toggle still works for this session even if storage is blocked.
    }

    window.dispatchEvent(new Event(THEME_EVENT));
  }, [isDark]);

  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
      data-testid="theme-toggle"
      data-theme={preference}
      className={cn(
        'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700',
        'transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
        'dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800',
        className,
      )}
    >
      <Moon aria-hidden="true" className="h-5 w-5 dark:hidden" />
      <Sun aria-hidden="true" className="hidden h-5 w-5 dark:block" />
    </button>
  );
}

export default ThemeToggle;