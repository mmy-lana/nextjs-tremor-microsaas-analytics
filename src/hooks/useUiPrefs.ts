'use client';

import { useCallback, useSyncExternalStore } from 'react';

import type { DashboardFilterState } from '@/types/analytics';
import { UI_PREFS_KEY } from '@/lib/storage';

/**
 * Device-level filter preferences.
 *
 * Kept in its own store and its own key so changing a filter never bumps the
 * business revision. Filter state belongs to a device, not to the dataset:
 * sharing it across tabs would make two windows fight over the same value, and
 * writing it into the business snapshot would mean every filter tweak looked
 * like a data mutation.
 *
 * Persistence is best-effort: a blocked storage backend falls back to in-memory
 * state for the session rather than throwing during a render.
 */

export const DEFAULT_FILTER_STATE: DashboardFilterState = Object.freeze({
  dateRange: '30d',
  tier: 'all',
  channel: 'all',
  searchQuery: '',
  sortField: 'createdAt',
  sortDirection: 'desc',
});

type Listener = () => void;

const listeners = new Set<Listener>();

let currentFilters: DashboardFilterState = { ...DEFAULT_FILTER_STATE };
let hydratedFromStorage = false;

function readPersistedFilters(): DashboardFilterState {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_FILTER_STATE };
  }
  try {
    const raw = window.localStorage.getItem(UI_PREFS_KEY);
    if (raw === null) {
      return { ...DEFAULT_FILTER_STATE };
    }
    const parsed = JSON.parse(raw) as Partial<DashboardFilterState>;
    return sanitizeFilters(parsed);
  } catch {
    return { ...DEFAULT_FILTER_STATE };
  }
}

/** Coerces an arbitrary persisted blob back into a valid filter state. */
export function sanitizeFilters(value: unknown): DashboardFilterState {
  const candidate =
    typeof value === 'object' && value !== null
      ? (value as Partial<DashboardFilterState>)
      : {};

  const dateRange =
    candidate.dateRange === '7d' ||
    candidate.dateRange === '30d' ||
    candidate.dateRange === '90d' ||
    candidate.dateRange === '12m' ||
    candidate.dateRange === 'all'
      ? candidate.dateRange
      : DEFAULT_FILTER_STATE.dateRange;

  const tier =
    candidate.tier === 'all' ||
    candidate.tier === 'starter' ||
    candidate.tier === 'pro' ||
    candidate.tier === 'scale' ||
    candidate.tier === 'enterprise'
      ? candidate.tier
      : DEFAULT_FILTER_STATE.tier;

  const channel =
    candidate.channel === 'all' ||
    candidate.channel === 'organic_search' ||
    candidate.channel === 'product_hunt' ||
    candidate.channel === 'x_social' ||
    candidate.channel === 'direct' ||
    candidate.channel === 'referral'
      ? candidate.channel
      : DEFAULT_FILTER_STATE.channel;

  const sortField =
    candidate.sortField === 'organizationName' ||
    candidate.sortField === 'mrrCents' ||
    candidate.sortField === 'createdAt' ||
    candidate.sortField === 'status'
      ? candidate.sortField
      : DEFAULT_FILTER_STATE.sortField;

  return {
    dateRange,
    tier,
    channel,
    searchQuery: typeof candidate.searchQuery === 'string' ? candidate.searchQuery : '',
    sortField,
    sortDirection: candidate.sortDirection === 'asc' ? 'asc' : 'desc',
  };
}

function publish(filters: DashboardFilterState): void {
  if (
    currentFilters.dateRange === filters.dateRange &&
    currentFilters.tier === filters.tier &&
    currentFilters.channel === filters.channel &&
    currentFilters.searchQuery === filters.searchQuery &&
    currentFilters.sortField === filters.sortField &&
    currentFilters.sortDirection === filters.sortDirection
  ) {
    return;
  }
  currentFilters = filters;
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * Reads persisted filters exactly once, outside the render pass.
 *
 * `subscribe` is invoked by React when the store is mounted, which is a commit
 * and not a render, so this is the only place where mutating the module cache is
 * safe. Doing it inside `getSnapshot` meant the first render of every consumer
 * mutated module state, which is an impure read: React may call it for a render
 * it then discards, and the module value would have advanced anyway.
 */
function hydrateOnce(): void {
  if (hydratedFromStorage) {
    return;
  }
  hydratedFromStorage = true;
  const persisted = readPersistedFilters();
  if (
    persisted.dateRange !== currentFilters.dateRange ||
    persisted.tier !== currentFilters.tier ||
    persisted.channel !== currentFilters.channel ||
    persisted.searchQuery !== currentFilters.searchQuery ||
    persisted.sortField !== currentFilters.sortField ||
    persisted.sortDirection !== currentFilters.sortDirection
  ) {
    publish(persisted);
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  hydrateOnce();
  return () => {
    listeners.delete(listener);
  };
}

/** Pure: returns the cached value and never changes it. */
function getSnapshot(): DashboardFilterState {
  return currentFilters;
}

function getServerSnapshot(): DashboardFilterState {
  return DEFAULT_FILTER_STATE;
}

function persist(filters: DashboardFilterState): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(filters));
  } catch {
    // In-memory state is still correct for this session.
  }
}

/** Test seam: drops the cached filters so the next read re-hydrates. */
export function resetUiPrefs(): void {
  hydratedFromStorage = false;
  currentFilters = { ...DEFAULT_FILTER_STATE };
}

export interface UseUiPrefsResult {
  filters: DashboardFilterState;
  setFilters: (patch: Partial<DashboardFilterState>) => void;
  resetFilters: () => void;
}

export function useUiPrefs(): UseUiPrefsResult {
  const filters = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setFilters = useCallback((patch: Partial<DashboardFilterState>) => {
    const next = sanitizeFilters({ ...currentFilters, ...patch });
    publish(next);
    persist(next);
  }, []);

  const resetFilters = useCallback(() => {
    const next = { ...DEFAULT_FILTER_STATE };
    publish(next);
    persist(next);
  }, []);

  return { filters, setFilters, resetFilters };
}