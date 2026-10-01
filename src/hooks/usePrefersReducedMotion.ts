'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tracks `prefers-reduced-motion`.
 *
 * Charts pass the result straight to Recharts' `isAnimationActive`, which turns
 * an animated plot into a static one for users who asked the OS for less motion.
 *
 * The server snapshot is always `false`: the server cannot know the visitor's
 * preference, and rendering still on the server then animating on the client is
 * preferable to a hydration mismatch.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const mediaQuery = window.matchMedia(QUERY);
  mediaQuery.addEventListener('change', onStoreChange);
  return () => mediaQuery.removeEventListener('change', onStoreChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}