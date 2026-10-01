'use client';

import { useSyncExternalStore } from 'react';

/**
 * False during server rendering and the hydration render, true afterwards.
 *
 * Portal-based overlays need the DOM before they can mount, but reading
 * `document` during render would break hydration. `useSyncExternalStore` is the
 * supported way to express "client only": the hydration render uses the server
 * snapshot, so the first client render still matches the server output, and the
 * component re-renders with the real value immediately afterwards.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

function subscribeToNothing(): () => void {
  return () => undefined;
}