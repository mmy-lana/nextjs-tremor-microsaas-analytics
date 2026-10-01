import type {
  DashboardStateSnapshot,
  MutationContext,
  MutationResult,
  StoreState,
} from '@/types/analytics';
import { generateSeed } from '@/lib/seed';
import { validateSnapshot } from '@/lib/validators';
import { startOfUtcDay } from '@/lib/utils';

/**
 * The persistence boundary.
 *
 * Responsibilities:
 *  - serialize every read-modify-write cycle behind a cross-tab lock
 *  - validate whatever comes back out of `localStorage` before trusting it
 *  - keep a module-level `StoreState` cache so subscribers never re-parse JSON
 *  - fan out changes to subscribers, including changes made by other tabs
 *
 * Everything browser-specific is guarded by `typeof window !== 'undefined'` so
 * the module imports cleanly under Vitest's Node environment, where the
 * in-memory lock queue and a null storage backend are used instead.
 */

export const STATE_KEY = 'microsaas_v1_state';
export const THEME_KEY = 'microsaas_v1_theme';
export const UI_PREFS_KEY = 'microsaas_v1_ui_prefs';

export const LOCK_NAME = 'microsaas_state_lock';

export const QUOTA_ERROR_MESSAGE = 'Storage quota exceeded';
export const CORRUPT_STATE_MESSAGE =
  'Stored analytics data could not be read and was left untouched';

/** Frozen so `useSyncExternalStore` can rely on a stable server snapshot. */
export const SERVER_SKELETON_STATE: StoreState = Object.freeze({
  status: 'loading',
  snapshot: null,
  error: null,
}) as StoreState;

/* -------------------------------------------------------------------------- */
/*                                  Backend                                  */
/* -------------------------------------------------------------------------- */

interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Resolved lazily on every access so tests can install a stub backend by
 * assigning `globalThis.localStorage` before the first call.
 */
function resolveBackend(): StorageBackend | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }
  const candidate = (globalThis as { localStorage?: StorageBackend }).localStorage;
  return candidate ?? null;
}

function isQuotaError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'QuotaExceededError'
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Lock                                   */
/* -------------------------------------------------------------------------- */

let memoryLockQueue: Promise<unknown> = Promise.resolve();

/**
 * Serializes mutations across every tab on the origin.
 *
 * `navigator.locks` is used when the browser provides it, which is the only way
 * to make a read-modify-write cycle atomic across tabs. Where it is missing
 * (older Safari, and Node under test) a promise chain provides the same
 * guarantee within a single JavaScript context.
 */
export async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(LOCK_NAME, async () => fn());
  }
  const result = memoryLockQueue.then(() => fn());
  memoryLockQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/* -------------------------------------------------------------------------- */
/*                                Id sourcing                                */
/* -------------------------------------------------------------------------- */

let idCounter = 0;

function randomToken(): string {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID().replaceAll('-', '').slice(0, 24);
  }
  // Counter-based fallback keeps ids unique and well-formed without crypto.
  idCounter += 1;
  return `${Date.now().toString(36)}${idCounter.toString(36)}`.padStart(24, '0').slice(0, 24);
}

/**
 * Builds an id that satisfies `/^[a-z0-9_-]{6,36}$/i`.
 *
 * `MutationContext.nextId` hands out the *token* alone; reducers add the `cus_`
 * or `evt_` prefix themselves, which keeps the prefix choice inside the domain
 * layer instead of leaking it through the context.
 */
export function makeId(prefix: string): string {
  return `${prefix}_${randomToken()}`;
}

/** The id source handed to reducers: a bare lowercase token. */
export const makeIdToken = (): string => randomToken();

/* -------------------------------------------------------------------------- */
/*                              Store state cache                            */
/* -------------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();

let currentState: StoreState = SERVER_SKELETON_STATE;
let lastKnownRevision = 0;
let storageListenerAttached = false;

export function getStoreState(): StoreState {
  return currentState;
}

export function getLastKnownRevision(): number {
  return lastKnownRevision;
}

function setStoreState(next: StoreState): void {
  const unchanged =
    next.status === currentState.status &&
    next.snapshot === currentState.snapshot &&
    next.error === currentState.error;
  if (unchanged) {
    return;
  }
  currentState = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

function publishReady(snapshot: DashboardStateSnapshot): void {
  lastKnownRevision = snapshot.revision;
  setStoreState({ status: 'ready', snapshot, error: null });
}

function publishError(error: string, snapshot: DashboardStateSnapshot | null): void {
  setStoreState({ status: 'error', snapshot, error });
}

/* -------------------------------------------------------------------------- */
/*                              Snapshot reads                               */
/* -------------------------------------------------------------------------- */

type ReadOutcome =
  | { kind: 'missing' }
  | { kind: 'ok'; snapshot: DashboardStateSnapshot }
  | { kind: 'invalid'; message: string };

/** Reads and validates the persisted snapshot without mutating store state. */
export function readStoredSnapshot(): ReadOutcome {
  const backend = resolveBackend();
  if (backend === null) {
    return { kind: 'missing' };
  }

  let raw: string | null;
  try {
    raw = backend.getItem(STATE_KEY);
  } catch {
    return { kind: 'invalid', message: CORRUPT_STATE_MESSAGE };
  }
  if (raw === null) {
    return { kind: 'missing' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { kind: 'invalid', message: CORRUPT_STATE_MESSAGE };
  }

  const result = validateSnapshot(parsed);
  if (!result.valid || result.data === undefined) {
    return { kind: 'invalid', message: CORRUPT_STATE_MESSAGE };
  }
  return { kind: 'ok', snapshot: result.data };
}

function writeSnapshot(snapshot: DashboardStateSnapshot): MutationResult {
  const backend = resolveBackend();
  if (backend === null) {
    return { ok: false, error: 'Local storage is unavailable' };
  }
  try {
    backend.setItem(STATE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    if (isQuotaError(error)) {
      return { ok: false, error: QUOTA_ERROR_MESSAGE };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to persist analytics data',
    };
  }
  return { ok: true, snapshot };
}

function stampForWrite(snapshot: DashboardStateSnapshot, now: Date): DashboardStateSnapshot {
  return {
    ...snapshot,
    asOf: startOfUtcDay(now).toISOString(),
    revision: snapshot.revision + 1,
    updatedAt: now.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*                                 Mutations                                 */
/* -------------------------------------------------------------------------- */

/** Structural reducer type, kept here so this module never imports `mutations`. */
export type SnapshotReducer<TAArgs> = (
  snapshot: DashboardStateSnapshot,
  args: TAArgs,
  ctx: MutationContext,
) => MutationResult;

/**
 * Runs one reducer against the persisted snapshot and writes the result back.
 *
 * The whole read-validate-reduce-write cycle happens inside `withStateLock`, so
 * two tabs can never interleave and lose a write.
 *
 * A reducer that reports `{ ok: false }` is returned unchanged. A reducer that
 * returns the *same snapshot reference* it was given means "no-op": nothing is
 * written and the revision does not move, which keeps an idempotent second click
 * from inflating the revision counter.
 */
export async function runMutation<TAgs>(
  reducer: SnapshotReducer<TAgs>,
  args: TAgs,
): Promise<MutationResult> {
  return withStateLock(async () => {
    const read = readStoredSnapshot();
    if (read.kind === 'invalid') {
      publishError(read.message, currentState.snapshot);
      return { ok: false, error: read.message };
    }
    if (read.kind === 'missing') {
      const message = 'Analytics data is not initialised';
      publishError(message, currentState.snapshot);
      return { ok: false, error: message };
    }

    const ctx: MutationContext = { now: new Date(), nextId: makeIdToken };
    const result = reducer(read.snapshot, args, ctx);
    if (!result.ok) {
      return result;
    }
    if (result.snapshot === read.snapshot) {
      publishReady(read.snapshot);
      return result;
    }

    const stamped = stampForWrite(result.snapshot, ctx.now);
    const written = writeSnapshot(stamped);
    if (!written.ok) {
      publishError(written.error, read.snapshot);
      return written;
    }

    publishReady(stamped);
    return written;
  });
}

/**
 * Seeds storage on first load.
 *
 * Re-checks the key *inside* the lock so two tabs opening at the same moment
 * cannot both seed. If the key exists but fails validation the data is left
 * exactly as it is and the store moves to the error state, because silently
 * overwriting a user's unsaved work is worse than surfacing the problem.
 */
export async function initStore(): Promise<void> {
  await withStateLock(async () => {
    const read = readStoredSnapshot();
    if (read.kind === 'ok') {
      publishReady(read.snapshot);
      return;
    }
    if (read.kind === 'invalid') {
      publishError(read.message, currentState.snapshot);
      return;
    }

    const seeded = generateSeed(new Date());
    const written = writeSnapshot({ ...seeded, revision: 1 });
    if (!written.ok) {
      publishError(written.error, currentState.snapshot);
      return;
    }
    publishReady(written.snapshot);
  });
}

/**
 * Rebuilds the demo dataset from scratch, discarding every local change.
 *
 * The revision keeps moving forward rather than resetting to 1, so a tab that
 * still holds the old snapshot can tell it is stale.
 */
export async function resetDemoDataset(): Promise<MutationResult> {
  return withStateLock(async () => {
    const read = readStoredSnapshot();
    const baseRevision = read.kind === 'ok' ? read.snapshot.revision : lastKnownRevision;
    const seeded = generateSeed(new Date());
    const written = writeSnapshot({
      ...seeded,
      revision: Math.max(baseRevision, lastKnownRevision, 1) + 1,
    });
    if (!written.ok) {
      publishError(written.error, currentState.snapshot);
      return written;
    }
    publishReady(written.snapshot);
    return written;
  });
}

/** Forces the store back into a usable state, used by the error banner. */
export function resetStoreState(): void {
  currentState = SERVER_SKELETON_STATE;
}

/** Test seam: drops the cached state so the next read starts from scratch. */
export function resetStoreCache(): void {
  currentState = SERVER_SKELETON_STATE;
  lastKnownRevision = 0;
}

/* -------------------------------------------------------------------------- */
/*                            Subscription + tabs                            */
/* -------------------------------------------------------------------------- */

export function subscribeToStore(listener: Listener): () => void {
  listeners.add(listener);
  attachStorageListener();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detachStorageListener();
    }
  };
}

/**
 * Applies a snapshot that arrived from another tab.
 *
 * Revisions are monotonic, so anything at or below the current revision is a
 * stale echo and is dropped. A payload that fails to parse or validate puts the
 * store into the error state *without* overwriting the local copy.
 */
export function applyIncomingSnapshot(raw: string | null): void {
  if (raw === null) {
    void initStore();
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    publishError(CORRUPT_STATE_MESSAGE, currentState.snapshot);
    return;
  }

  const result = validateSnapshot(parsed);
  if (!result.valid || result.data === undefined) {
    publishError(CORRUPT_STATE_MESSAGE, currentState.snapshot);
    return;
  }

  const incoming = result.data;
  const current = currentState.snapshot;
  if (current !== null && incoming.revision <= current.revision) {
    return;
  }
  publishReady(incoming);
}

function onStorageEvent(event: StorageEvent): void {
  if (event.key === null) {
    // A `localStorage.clear()` in another tab arrives with a null key.
    void initStore();
    return;
  }
  if (event.key !== STATE_KEY) {
    return;
  }
  applyIncomingSnapshot(event.newValue);
}

function attachStorageListener(): void {
  if (storageListenerAttached || typeof window === 'undefined') {
    return;
  }
  window.addEventListener('storage', onStorageEvent);
  storageListenerAttached = true;
}

function detachStorageListener(): void {
  if (!storageListenerAttached || typeof window === 'undefined') {
    return;
  }
  window.removeEventListener('storage', onStorageEvent);
  storageListenerAttached = false;
}

/* -------------------------------------------------------------------------- */
/*                                Theme prefs                                */
/* -------------------------------------------------------------------------- */

export type ThemePreference = 'light' | 'dark';

/** Persists the theme choice, tolerating a blocked or full storage backend. */
export function readThemePreference(): ThemePreference | null {
  const backend = resolveBackend();
  if (backend === null) {
    return null;
  }
  try {
    const raw = backend.getItem(THEME_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  const backend = resolveBackend();
  if (backend === null) {
    return;
  }
  try {
    backend.setItem(THEME_KEY, preference);
  } catch {
    // A blocked storage backend must not break the theme toggle.
  }
}