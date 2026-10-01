'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type {
  AddCustomerPayload,
  MutationResult,
  StoreState,
} from '@/types/analytics';
import {
  addCustomerSubscription,
  cancelSubscription,
  cancelTrial,
  convertTrial,
  reactivateSubscription,
  updateCustomerTier,
  type TierChangeArgs,
  type VersionedCustomerArgs,
} from '@/lib/mutations';
import {
  SERVER_SKELETON_STATE,
  STATE_KEY,
  applyIncomingSnapshot,
  getStoreState,
  initStore,
  readStoredSnapshot,
  resetDemoDataset,
  runMutation,
  subscribeToStore,
  type SnapshotReducer,
} from '@/lib/storage';

/**
 * Reactive access to the persisted snapshot.
 *
 * `useSyncExternalStore` reads the module-level cache in `storage.ts`, so a
 * render never triggers a JSON parse and never writes. Same-tab mutations notify
 * the cache directly; the `storage` event covers the other tabs.
 */

export const STORE_NOT_READY_MESSAGE = 'Store not ready';
export const CONFLICT_ERROR_PREFIX = 'Concurrency conflict';
export const VERSION_CONFLICT_ANNOUNCEMENT =
  'This record changed in another tab. Refreshed, please retry.';

export interface AnalyticsActions {
  addCustomer: (payload: AddCustomerPayload) => Promise<MutationResult>;
  updateTier: (args: TierChangeArgs) => Promise<MutationResult>;
  cancelSubscription: (args: VersionedCustomerArgs) => Promise<MutationResult>;
  convertTrial: (args: TierChangeArgs) => Promise<MutationResult>;
  cancelTrial: (args: VersionedCustomerArgs) => Promise<MutationResult>;
  reactivate: (args: TierChangeArgs) => Promise<MutationResult>;
  resetDemo: () => Promise<MutationResult>;
}

export interface AnalyticsStore {
  state: StoreState;
  actions: AnalyticsActions;
}

export interface UseAnalyticsStoreOptions {
  /** Called after a version conflict so the UI can announce the reload. */
  onConflict?: () => void;
}

function getServerSnapshot(): StoreState {
  return SERVER_SKELETON_STATE;
}

function notReady(): MutationResult {
  return { ok: false, error: STORE_NOT_READY_MESSAGE };
}

/**
 * Reloads the cached snapshot from disk without re-seeding.
 *
 * Used after a version conflict so the user is looking at the other tab's edit
 * instead of being asked to retry against a row that no longer exists in that
 * shape.
 */
function refreshFromStorage(): void {
  try {
    const read = readStoredSnapshot();
    if (read.kind === 'ok') {
      applyIncomingSnapshot(JSON.stringify(read.snapshot));
    }
  } catch {
    // A failed refresh leaves the previous cache in place; the next conflict
    // will retry it.
  }
}

export function useAnalyticsStore(options: UseAnalyticsStoreOptions = {}): AnalyticsStore {
  const { onConflict } = options;
  const state = useSyncExternalStore(subscribeToStore, getStoreState, getServerSnapshot);

  const run = useCallback(
    async <TArgs,>(reducer: SnapshotReducer<TArgs>, args: TArgs): Promise<MutationResult> => {
      if (state.status !== 'ready') {
        return notReady();
      }
      const result = await runMutation(reducer, args);
      if (!result.ok && result.error.startsWith(CONFLICT_ERROR_PREFIX)) {
        refreshFromStorage();
        onConflict?.();
      }
      return result;
    },
    [onConflict, state.status],
  );

  const actions = useMemo<AnalyticsActions>(
    () => ({
      addCustomer: (payload) => run(addCustomerSubscription, payload),
      updateTier: (args) => run(updateCustomerTier, args),
      cancelSubscription: (args) => run(cancelSubscription, args),
      convertTrial: (args) => run(convertTrial, args),
      cancelTrial: (args) => run(cancelTrial, args),
      reactivate: (args) => run(reactivateSubscription, args),
      resetDemo: async () => {
        if (state.status !== 'ready') {
          return notReady();
        }
        return resetDemoDataset();
      },
    }),
    [run, state.status],
  );

  return { state, actions };
}

export { initStore, STATE_KEY };