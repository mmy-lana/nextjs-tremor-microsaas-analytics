import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  AddCustomerPayload,
  CustomerRecord,
  DashboardStateSnapshot,
  MutationContext,
  MutationResult,
  SubscriptionTier,
} from '@/types/analytics';
import { generateSeed } from '@/lib/seed';
import {
  addCustomerSubscription,
  cancelSubscription,
  cancelTrial,
  convertTrial,
  reactivateSubscription,
  updateCustomerTier,
} from '@/lib/mutations';
import {
  QUOTA_ERROR_MESSAGE,
  STATE_KEY,
  initStore,
  getStoreState,
  readStoredSnapshot,
  resetDemoDataset,
  resetStoreCache,
  runMutation,
  applyIncomingSnapshot,
  withStateLock,
} from '@/lib/storage';
import {
  assertLedgerInvariant,
  validateCustomerRecord,
  validateEmail,
  validateId,
  validateSnapshot,
} from '@/lib/validators';
import { MS_PER_DAY, startOfUtcDay } from '@/lib/utils';

/** Frozen anchor instant: every test in this file sees the same clock. */
const FROZEN_NOW = new Date('2026-03-17T14:22:31.482Z');
const SEED = 42;

const MS_PER_DAY_LOCAL = MS_PER_DAY;

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                 */
/* -------------------------------------------------------------------------- */

function seedSnapshot(): DashboardStateSnapshot {
  return generateSeed(FROZEN_NOW, SEED);
}

/** Deterministic, restartable id source shaped like the production one. */
function makeContext(now: Date, counter = { value: 0 }): MutationContext {
  counter.value += 1;
  const token = counter.value.toString(16).padStart(24, '0').slice(0, 24);
  return { now, nextId: () => token };
}

function unwrap(result: MutationResult): DashboardStateSnapshot {
  if (!result.ok) {
    throw new Error(`Expected a successful mutation, received: ${result.error}`);
  }
  return result.snapshot;
}

function expectFailure(result: MutationResult, expectedFragment: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  expect(result.error.toLowerCase()).toContain(expectedFragment.toLowerCase());
}

function customerById(
  snapshot: DashboardStateSnapshot,
  customerId: string,
): CustomerRecord {
  const found = snapshot.customers.find((customer) => customer.id === customerId);
  if (found === undefined) {
    throw new Error(`No customer with id ${customerId}`);
  }
  return found;
}

function eventsFor(snapshot: DashboardStateSnapshot, customerId: string) {
  return snapshot.events.filter((event) => event.customerId === customerId);
}

function findCustomer(
  snapshot: DashboardStateSnapshot,
  predicate: (customer: CustomerRecord) => boolean,
): CustomerRecord {
  const found = snapshot.customers.find(predicate);
  if (found === undefined) {
    throw new Error('No seeded customer matched the predicate');
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/*                            In-memory storage stub                         */
/* -------------------------------------------------------------------------- */

class FakeStorage {
  private readonly map = new Map<string, string>();

  writes = 0;

  /** Armed after seeding so the first write succeeds and the next one fails. */
  private failure: Error | null = null;

  failNextWritesWith(error: Error): void {
    this.failure = error;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failure !== null) {
      throw this.failure;
    }
    this.writes += 1;
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

function quotaError(): Error {
  const error = new Error('quota');
  error.name = 'QuotaExceededError';
  return error;
}

let originalLocalStorage: unknown;

beforeEach(() => {
  originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  resetStoreCache();
});

afterEach(() => {
  if (originalLocalStorage === undefined) {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  } else {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
  }
  resetStoreCache();
});

/* -------------------------------------------------------------------------- */
/*                              Seed guarantees                              */
/* -------------------------------------------------------------------------- */

describe('generateSeed', () => {
  it('is deterministic for a frozen date and seed constant', () => {
    expect(JSON.stringify(seedSnapshot())).toBe(JSON.stringify(seedSnapshot()));
  });

  it('produces different data for a different seed constant', () => {
    const a = JSON.stringify(generateSeed(FROZEN_NOW, 42));
    const b = JSON.stringify(generateSeed(FROZEN_NOW, 43));
    expect(a).not.toBe(b);
  });

  it('anchors asOf at UTC midnight of the supplied instant', () => {
    const snapshot = seedSnapshot();
    expect(snapshot.asOf).toBe('2026-03-17T00:00:00.000Z');
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.revision).toBe(1);
  });

  it('satisfies the ledger invariant', () => {
    const snapshot = seedSnapshot();
    expect(() => assertLedgerInvariant(snapshot)).not.toThrow();
    for (const customer of snapshot.customers) {
      const sum = eventsFor(snapshot, customer.id).reduce(
        (acc, event) => acc + event.deltaMrrCents,
        0,
      );
      expect(sum).toBe(customer.mrrCents);
    }
  });

  it('passes full snapshot validation after a JSON round trip', () => {
    const snapshot = seedSnapshot();
    const result = validateSnapshot(JSON.parse(JSON.stringify(snapshot)) as unknown);
    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('gives every customer a valid record', () => {
    const snapshot = seedSnapshot();
    for (const customer of snapshot.customers) {
      const result = validateCustomerRecord(customer, {
        otherEmails: new Set<string>(),
        otherIds: new Set<string>(),
      });
      expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    }
  });

  it('anchors at least ten paying customers on day 0 so the `all` baseline is non-zero', () => {
    const snapshot = seedSnapshot();
    const dayZero = new Date(Date.parse(snapshot.asOf) - 400 * MS_PER_DAY_LOCAL);
    const dayZeroKey = dayZero.toISOString().slice(0, 10);

    const dayZeroCustomers = snapshot.customers.filter(
      (customer) => customer.createdAt.slice(0, 10) === dayZeroKey,
    );
    expect(dayZeroCustomers.length).toBeGreaterThanOrEqual(10);

    const dayZeroPaying = dayZeroCustomers.filter((customer) => customer.mrrCents > 0);
    expect(dayZeroPaying.length).toBeGreaterThanOrEqual(10);

    // The `all` growth baseline is the MRR reconstructed at the end of day 0.
    const endOfDayZero = dayZero.getTime() + MS_PER_DAY_LOCAL;
    const reconstructed = snapshot.events
      .filter((event) => Date.parse(event.occurredAt) < endOfDayZero)
      .reduce((acc, event) => acc + event.deltaMrrCents, 0);
    expect(reconstructed).toBeGreaterThan(0);
  });

  it('guarantees every preset window carries activity, including 7d', () => {
    const snapshot = seedSnapshot();
    const endOfAsOf = Date.parse(snapshot.asOf) + MS_PER_DAY_LOCAL - 1;

    const windows = [
      { preset: '7d', days: 7 },
      { preset: '30d', days: 30 },
      { preset: '90d', days: 90 },
      { preset: '12m', days: 365 },
    ] as const;

    for (const window of windows) {
      const start = Date.parse(snapshot.asOf) - window.days * MS_PER_DAY_LOCAL + MS_PER_DAY_LOCAL - 1;
      const count = snapshot.events.filter((event) => {
        const at = Date.parse(event.occurredAt);
        return at > start && at <= endOfAsOf;
      }).length;
      expect(count, `window ${window.preset}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('covers every revenue movement type in the generated ledger', () => {
    const snapshot = seedSnapshot();
    const types = new Set(snapshot.events.map((event) => event.type));
    expect(types).toContain('new_business');
    expect(types).toContain('trial_started');
    expect(types).toContain('trial_converted');
    expect(types).toContain('trial_canceled');
    expect(types).toContain('expansion');
    expect(types).toContain('contraction');
    expect(types).toContain('churn');
    expect(types).toContain('reactivation');
  });

  it('keeps trial movements at a zero delta and every other movement consistent', () => {
    const snapshot = seedSnapshot();
    for (const event of snapshot.events) {
      expect(event.deltaMrrCents).toBe(event.mrrAfterCents - event.mrrBeforeCents);
      const isTrialMovement =
        event.type === 'trial_started' ||
        event.type === 'trial_converted' ||
        event.type === 'trial_canceled';
      if (isTrialMovement) {
        expect(event.deltaMrrCents).toBe(0);
      }
    }
  });

  it('assigns unique ids and emails across the book', () => {
    const snapshot = seedSnapshot();
    expect(new Set(snapshot.customers.map((c) => c.id)).size).toBe(
      snapshot.customers.length,
    );
    expect(new Set(snapshot.customers.map((c) => c.email)).size).toBe(
      snapshot.customers.length,
    );
    expect(new Set(snapshot.events.map((e) => e.id)).size).toBe(snapshot.events.length);
  });
});

/* -------------------------------------------------------------------------- */
/*                              Ledger invariant                             */
/* -------------------------------------------------------------------------- */

describe('ledger invariant', () => {
  it('detects a tampered customer balance', () => {
    const snapshot = seedSnapshot();
    const tampered: DashboardStateSnapshot = {
      ...snapshot,
      customers: snapshot.customers.map((customer, index) =>
        index === 0 ? { ...customer, mrrCents: customer.mrrCents + 1_000 } : customer,
      ),
    };
    expect(() => assertLedgerInvariant(tampered)).toThrow(/Ledger invariant broken/);
  });

  it('detects a dropped event', () => {
    const snapshot = seedSnapshot();
    const withDelta = snapshot.events.findIndex((event) => event.deltaMrrCents !== 0);
    expect(withDelta).toBeGreaterThanOrEqual(0);
    const tampered: DashboardStateSnapshot = {
      ...snapshot,
      events: snapshot.events.filter((_, index) => index !== withDelta),
    };
    expect(() => assertLedgerInvariant(tampered)).toThrow(/Ledger invariant broken/);
  });

  it('rejects a snapshot whose ledger does not balance during validation', () => {
    const snapshot = seedSnapshot();
    const tampered = JSON.parse(JSON.stringify(snapshot)) as DashboardStateSnapshot;
    const first = tampered.customers[0];
    if (first !== undefined) {
      first.mrrCents += 500;
    }
    const result = validateSnapshot(tampered);
    expect(result.valid).toBe(false);
    expect(result.errors['ledger']).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/*                             addCustomerSubscription                        */
/* -------------------------------------------------------------------------- */

describe('addCustomerSubscription', () => {
  const payload: AddCustomerPayload = {
    organizationName: 'Aperture Test Labs',
    email: 'owner@aperture.example',
    tier: 'pro',
    status: 'active',
    billingInterval: 'monthly',
    mrrCents: 9_900,
    channel: 'direct',
    countryCode: 'US',
    seatCount: 12,
    apiCalls30d: 4_200,
  };

  it('creates an active customer with a new_business event equal to the MRR', () => {
    const snapshot = seedSnapshot();
    const before = snapshot.events.length;
    const result = addCustomerSubscription(snapshot, payload, makeContext(FROZEN_NOW));
    const next = unwrap(result);

    const created = next.customers.find((c) => c.email === payload.email);
    expect(created).toBeDefined();
    if (created === undefined) {
      return;
    }

    expect(created.version).toBe(1);
    expect(created.previousMrrCents).toBe(0);
    expect(created.status).toBe('active');
    expect(created.cohortMonth).toBe('2026-03');
    expect(created.createdAt).toBe(FROZEN_NOW.toISOString());
    expect(created.updatedAt).toBe(FROZEN_NOW.toISOString());
    expect(created.trialStartedAt).toBeNull();
    expect(created.convertedAt).toBeNull();
    expect(created.canceledAt).toBeNull();

    const events = eventsFor(next, created.id);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe('new_business');
    expect(event?.mrrBeforeCents).toBe(0);
    expect(event?.mrrAfterCents).toBe(9_900);
    expect(event?.deltaMrrCents).toBe(9_900);
    expect(event?.previousTier).toBeNull();

    expect(next.events).toHaveLength(before + 1);
    expect(() => assertLedgerInvariant(next)).not.toThrow();
    // A reducer must never bump the revision: that belongs to the storage layer.
    expect(next.revision).toBe(snapshot.revision);
    expect(next.asOf).toBe(snapshot.asOf);
  });

  it('creates a trialing customer with a zero-delta trial_started event', () => {
    const snapshot = seedSnapshot();
    const result = addCustomerSubscription(
      snapshot,
      { ...payload, status: 'trialing', mrrCents: 0 },
      makeContext(FROZEN_NOW),
    );
    const next = unwrap(result);

    const created = next.customers.find((c) => c.email === payload.email);
    expect(created).toBeDefined();
    if (created === undefined) {
      return;
    }

    expect(created.status).toBe('trialing');
    expect(created.mrrCents).toBe(0);
    expect(created.trialStartedAt).toBe(FROZEN_NOW.toISOString());
    expect(created.trialEndsAt).toBe(
      new Date(FROZEN_NOW.getTime() + 14 * MS_PER_DAY_LOCAL).toISOString(),
    );

    const event = eventsFor(next, created.id)[0];
    expect(event?.type).toBe('trial_started');
    expect(event?.deltaMrrCents).toBe(0);
    expect(() => assertLedgerInvariant(next)).not.toThrow();
  });

  it('trims the organization name and lowercases the email', () => {
    const snapshot = seedSnapshot();
    const next = unwrap(
      addCustomerSubscription(
        snapshot,
        { ...payload, organizationName: '  Spaced Out Co  ', email: 'MiXeD@Case.Example' },
        makeContext(FROZEN_NOW),
      ),
    );
    const created = next.customers.find((c) => c.email === 'mixed@case.example');
    expect(created?.organizationName).toBe('Spaced Out Co');
  });

  it('rejects a duplicate email regardless of casing', () => {
    const snapshot = seedSnapshot();
    const existing = snapshot.customers[0];
    expect(existing).toBeDefined();
    if (existing === undefined) {
      return;
    }
    const result = addCustomerSubscription(
      snapshot,
      { ...payload, email: existing.email.toUpperCase() },
      makeContext(FROZEN_NOW),
    );
    expectFailure(result, 'email');
  });

  it('rejects an invalid payload without touching the snapshot', () => {
    const snapshot = seedSnapshot();
    const cases: ReadonlyArray<readonly [string, Partial<AddCustomerPayload>]> = [
      ['organizationName', { organizationName: '   ' }],
      ['organizationName', { organizationName: 'x'.repeat(81) }],
      ['email', { email: 'not-an-email' }],
      ['tier', { tier: 'platinum' as SubscriptionTier }],
      ['billingInterval', { billingInterval: 'weekly' as AddCustomerPayload['billingInterval'] }],
      ['countryCode', { countryCode: 'usa' }],
      ['countryCode', { countryCode: 'us' }],
      ['mrrCents', { mrrCents: 9_900.5 }],
      ['mrrCents', { mrrCents: -100 }],
      ['mrrCents', { mrrCents: 50_000_001 }],
      ['seatCount', { seatCount: 0 }],
      ['seatCount', { seatCount: 10_001 }],
      ['apiCalls30d', { apiCalls30d: -1 }],
      ['channel', { channel: 'carrier_pigeon' as AddCustomerPayload['channel'] }],
      ['status', { status: 'canceled' as AddCustomerPayload['status'] }],
      ['mrrCents', { status: 'trialing', mrrCents: 5_000 }],
    ];

    for (const [field, patch] of cases) {
      const result = addCustomerSubscription(
        snapshot,
        { ...payload, ...patch } as AddCustomerPayload,
        makeContext(FROZEN_NOW),
      );
      expect(result.ok, `case ${field}`).toBe(false);
      if (result.ok) {
        continue;
      }
      expect(result.error.toLowerCase()).toContain(field.toLowerCase());
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                              updateCustomerTier                           */
/* -------------------------------------------------------------------------- */

describe('updateCustomerTier', () => {
  it('emits an expansion event when MRR grows', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'active' && c.mrrCents > 0);
    const result = updateCustomerTier(
      snapshot,
      {
        customerId: target.id,
        newTier: 'scale',
        newMrrCents: target.mrrCents + 5_000,
        expectedVersion: target.version,
      },
      makeContext(FROZEN_NOW),
    );
    const next = unwrap(result);

    const updated = customerById(next, target.id);
    expect(updated.tier).toBe('scale');
    expect(updated.mrrCents).toBe(target.mrrCents + 5_000);
    expect(updated.version).toBe(target.version + 1);
    expect(updated.updatedAt).toBe(FROZEN_NOW.toISOString());
    // An expansion does not overwrite the pre-contraction balance.
    expect(updated.previousMrrCents).toBe(target.previousMrrCents);

    const event = eventsFor(next, target.id).at(-1);
    expect(event?.type).toBe('expansion');
    expect(event?.deltaMrrCents).toBe(5_000);
    expect(event?.mrrBeforeCents).toBe(target.mrrCents);
    expect(event?.mrrAfterCents).toBe(target.mrrCents + 5_000);
    expect(event?.previousTier).toBe(target.tier);
    expect(event?.currentTier).toBe('scale');
    expect(() => assertLedgerInvariant(next)).not.toThrow();
  });

  it('emits a contraction event and records the pre-change MRR', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(
      snapshot,
      (c) => (c.status === 'active' || c.status === 'past_due') && c.mrrCents > 2_000,
    );
    const newMrrCents = target.mrrCents - 1_000;
    const next = unwrap(
      updateCustomerTier(
        snapshot,
        {
          customerId: target.id,
          newTier: 'starter',
          newMrrCents,
          expectedVersion: target.version,
        },
        makeContext(FROZEN_NOW),
      ),
    );

    const updated = customerById(next, target.id);
    expect(updated.mrrCents).toBe(newMrrCents);
    expect(updated.previousMrrCents).toBe(target.mrrCents);

    const event = eventsFor(next, target.id).at(-1);
    expect(event?.type).toBe('contraction');
    expect(event?.deltaMrrCents).toBe(-1_000);
    expect(() => assertLedgerInvariant(next)).not.toThrow();
  });

  it('returns the same snapshot reference for a no-op tier and MRR', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'active' && c.mrrCents > 0);
    const result = updateCustomerTier(
      snapshot,
      {
        customerId: target.id,
        newTier: target.tier,
        newMrrCents: target.mrrCents,
        expectedVersion: target.version,
      },
      makeContext(FROZEN_NOW),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot).toBe(snapshot);
    }
  });

  it('changes the tier without emitting an event when MRR is unchanged', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'active' && c.mrrCents > 0);
    const nextTier = target.tier === 'starter' ? 'pro' : 'starter';
    const before = eventsFor(snapshot, target.id).length;

    const next = unwrap(
      updateCustomerTier(
        snapshot,
        {
          customerId: target.id,
          newTier: nextTier,
          newMrrCents: target.mrrCents,
          expectedVersion: target.version,
        },
        makeContext(FROZEN_NOW),
      ),
    );

    expect(customerById(next, target.id).tier).toBe(nextTier);
    expect(eventsFor(next, target.id)).toHaveLength(before);
    expect(() => assertLedgerInvariant(next)).not.toThrow();
  });

  it('rejects a canceled subscription', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'canceled');
    const result = updateCustomerTier(
      snapshot,
      {
        customerId: target.id,
        newTier: 'pro',
        newMrrCents: 1_000,
        expectedVersion: target.version,
      },
      makeContext(FROZEN_NOW),
    );
    expectFailure(result, 'canceled');
  });

  it('rejects a trialing subscription', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'trialing');
    const result = updateCustomerTier(
      snapshot,
      {
        customerId: target.id,
        newTier: 'pro',
        newMrrCents: 1_000,
        expectedVersion: target.version,
      },
      makeContext(FROZEN_NOW),
    );
    expectFailure(result, 'trial');
  });

  it('rejects a stale expectedVersion', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'active');
    const result = updateCustomerTier(
      snapshot,
      {
        customerId: target.id,
        newTier: 'pro',
        newMrrCents: 1_000,
        expectedVersion: target.version + 7,
      },
      makeContext(FROZEN_NOW),
    );
    expectFailure(result, 'Concurrency conflict');
  });

  it('rejects an unknown customer id', () => {
    const snapshot = seedSnapshot();
    const result = updateCustomerTier(
      snapshot,
      { customerId: 'cus_missing', newTier: 'pro', newMrrCents: 100, expectedVersion: 1 },
      makeContext(FROZEN_NOW),
    );
    expectFailure(result, 'not found');
  });
});

/* -------------------------------------------------------------------------- */
/*                            cancelSubscription                             */
/* -------------------------------------------------------------------------- */

describe('cancelSubscription', () => {
  it('emits churn for the full MRR and zeroes the balance', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'active' && c.mrrCents > 0);
    const next = unwrap(
      cancelSubscription(
        snapshot,
        { customerId: target.id, expectedVersion: target.version },
        makeContext(FROZEN_NOW),
      ),
    );

    const updated = customerById(next, target.id);
    expect(updated.status).toBe('canceled');
    expect(updated.mrrCents).toBe(0);
    expect(updated.previousMrrCents).toBe(target.mrrCents);
    expect(updated.canceledAt).toBe(FROZEN_NOW.toISOString());
    expect(updated.version).toBe(target.version + 1);

    const event = eventsFor(next, target.id).at(-1);
    expect(event?.type).toBe('churn');
    expect(event?.deltaMrrCents).toBe(-target.mrrCents);
    expect(event?.mrrAfterCents).toBe(0);
    expect(() => assertLedgerInvariant(next)).not.toThrow();
  });

  it('is idempotent: cancelling a canceled subscription is a no-op', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'canceled');
    const result = cancelSubscription(
      snapshot,
      { customerId: target.id, expectedVersion: target.version },
      makeContext(FROZEN_NOW),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot).toBe(snapshot);
    }
  });

  it('refuses to cancel a trial, which must use cancelTrial', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'trialing');
    const result = cancelSubscription(
      snapshot,
      { customerId: target.id, expectedVersion: target.version },
      makeContext(FROZEN_NOW),
    );
    expectFailure(result, 'cancelTrial');
  });
});

/* -------------------------------------------------------------------------- */
/*                                 convertTrial                               */
/* -------------------------------------------------------------------------- */

describe('convertTrial', () => {
  it('appends trial_converted then new_business', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'trialing');
    const before = eventsFor(snapshot, target.id);
    const next = unwrap(
      convertTrial(
        snapshot,
        {
          customerId: target.id,
          newTier: 'pro',
          newMrrCents: 7_500,
          expectedVersion: target.version,
        },
        makeContext(FROZEN_NOW),
      ),
    );

    const updated = customerById(next, target.id);
    expect(updated.status).toBe('active');
    expect(updated.tier).toBe('pro');
    expect(updated.mrrCents).toBe(7_500);
    expect(updated.convertedAt).toBe(FROZEN_NOW.toISOString());

    const appended = eventsFor(next, target.id).slice(before.length);
    expect(appended.map((event) => event.type)).toEqual([
      'trial_converted',
      'new_business',
    ]);
    expect(appended[0]?.deltaMrrCents).toBe(0);
    expect(appended[0]?.mrrBeforeCents).toBe(0);
    expect(appended[0]?.mrrAfterCents).toBe(0);
    expect(appended[1]?.deltaMrrCents).toBe(7_500);
    expect(() => assertLedgerInvariant(next)).not.toThrow();
  });

  it('rejects a customer that is not trialing', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'active');
    const result = convertTrial(
      snapshot,
      {
        customerId: target.id,
        newTier: 'pro',
        newMrrCents: 1_000,
        expectedVersion: target.version,
      },
      makeContext(FROZEN_NOW),
    );
    expectFailure(result, 'trialing');
  });

  it('rejects a zero-MRR conversion', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'trialing');
    const result = convertTrial(
      snapshot,
      {
        customerId: target.id,
        newTier: 'pro',
        newMrrCents: 0,
        expectedVersion: target.version,
      },
      makeContext(FROZEN_NOW),
    );
    expectFailure(result, 'newMrrCents');
  });
});

/* -------------------------------------------------------------------------- */
/*                                cancelTrial                                */
/* -------------------------------------------------------------------------- */

describe('cancelTrial', () => {
  it('emits trial_canceled and cancels the account', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'trialing');
    const next = unwrap(
      cancelTrial(
        snapshot,
        { customerId: target.id, expectedVersion: target.version },
        makeContext(FROZEN_NOW),
      ),
    );

    const updated = customerById(next, target.id);
    expect(updated.status).toBe('canceled');
    expect(updated.mrrCents).toBe(0);
    expect(updated.canceledAt).toBe(FROZEN_NOW.toISOString());

    const event = eventsFor(next, target.id).at(-1);
    expect(event?.type).toBe('trial_canceled');
    expect(event?.deltaMrrCents).toBe(0);
    expect(() => assertLedgerInvariant(next)).not.toThrow();
  });

  it('rejects a paying subscription', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'active');
    const result = cancelTrial(
      snapshot,
      { customerId: target.id, expectedVersion: target.version },
      makeContext(FROZEN_NOW),
    );
    expectFailure(result, 'trialing');
  });
});

/* -------------------------------------------------------------------------- */
/*                           reactivateSubscription                          */
/* -------------------------------------------------------------------------- */

describe('reactivateSubscription', () => {
  it('emits reactivation and restores the account to active', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(
      snapshot,
      (c) => c.status === 'canceled' && eventsFor(snapshot, c.id).some((e) => e.type === 'churn'),
    );
    const next = unwrap(
      reactivateSubscription(
        snapshot,
        {
          customerId: target.id,
          newTier: 'pro',
          newMrrCents: 4_200,
          expectedVersion: target.version,
        },
        makeContext(FROZEN_NOW),
      ),
    );

    const updated = customerById(next, target.id);
    expect(updated.status).toBe('active');
    expect(updated.tier).toBe('pro');
    expect(updated.mrrCents).toBe(4_200);
    expect(updated.canceledAt).toBeNull();

    const event = eventsFor(next, target.id).at(-1);
    expect(event?.type).toBe('reactivation');
    expect(event?.deltaMrrCents).toBe(4_200);
    expect(() => assertLedgerInvariant(next)).not.toThrow();
  });

  it('keeps the pre-churn balance in previousMrrCents', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(
      snapshot,
      (c) => c.status === 'canceled' && eventsFor(snapshot, c.id).some((e) => e.type === 'churn'),
    );
    const expectedPrevious = target.previousMrrCents;
    expect(expectedPrevious).toBeGreaterThan(0);

    const next = unwrap(
      reactivateSubscription(
        snapshot,
        {
          customerId: target.id,
          newTier: 'pro',
          newMrrCents: 4_200,
          expectedVersion: target.version,
        },
        makeContext(FROZEN_NOW),
      ),
    );
    expect(customerById(next, target.id).previousMrrCents).toBe(expectedPrevious);
  });

  it('rejects an account that is not canceled', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'active');
    const result = reactivateSubscription(
      snapshot,
      {
        customerId: target.id,
        newTier: 'pro',
        newMrrCents: 1_000,
        expectedVersion: target.version,
      },
      makeContext(FROZEN_NOW),
    );
    expectFailure(result, 'canceled');
  });
});

/* -------------------------------------------------------------------------- */
/*                            Full mutation journeys                         */
/* -------------------------------------------------------------------------- */

describe('mutation journeys', () => {
  it('adds, expands, cancels, then reactivates while the ledger holds', () => {
    const snapshot = seedSnapshot();
    const ctx = makeContext(FROZEN_NOW);
    const payload: AddCustomerPayload = {
      organizationName: 'Journey Industries',
      email: 'finance@journey.example',
      tier: 'pro',
      status: 'active',
      billingInterval: 'annual',
      mrrCents: 9_900,
      channel: 'referral',
      countryCode: 'DE',
      seatCount: 25,
      apiCalls30d: 10_000,
    };

    const added = unwrap(addCustomerSubscription(snapshot, payload, ctx));
    const created = customerById(added, added.customers.at(-1)?.id ?? '');

    const expanded = unwrap(
      updateCustomerTier(
        added,
        {
          customerId: created.id,
          newTier: 'scale',
          newMrrCents: 25_000,
          expectedVersion: created.version,
        },
        ctx,
      ),
    );

    const canceled = unwrap(
      cancelSubscription(
        expanded,
        { customerId: created.id, expectedVersion: created.version + 1 },
        ctx,
      ),
    );

    const reactivated = unwrap(
      reactivateSubscription(
        canceled,
        {
          customerId: created.id,
          newTier: 'scale',
          newMrrCents: 20_000,
          expectedVersion: canceled.customers.find((c) => c.id === created.id)?.version ?? 0,
        },
        ctx,
      ),
    );

    const finalCustomer = customerById(reactivated, created.id);
    expect(finalCustomer.status).toBe('active');
    expect(finalCustomer.mrrCents).toBe(20_000);
    expect(finalCustomer.version).toBe(4);
    expect(() => assertLedgerInvariant(reactivated)).not.toThrow();

    const types = eventsFor(reactivated, created.id).map((event) => event.type);
    expect(types).toEqual(['new_business', 'expansion', 'churn', 'reactivation']);
    // 9_900 + 15_100 - 25_000 + 20_000 === 20_000
    expect(
      eventsFor(reactivated, created.id).reduce((acc, e) => acc + e.deltaMrrCents, 0),
    ).toBe(20_000);
  });

  it('rejects a second edit that reuses a now-stale version', () => {
    const snapshot = seedSnapshot();
    const ctx = makeContext(FROZEN_NOW);
    const target = findCustomer(snapshot, (c) => c.status === 'active' && c.mrrCents > 0);

    const first = unwrap(
      updateCustomerTier(
        snapshot,
        {
          customerId: target.id,
          newTier: 'scale',
          newMrrCents: target.mrrCents + 1_000,
          expectedVersion: target.version,
        },
        ctx,
      ),
    );
    const stale = updateCustomerTier(
      first,
      {
        customerId: target.id,
        newTier: 'enterprise',
        newMrrCents: target.mrrCents + 2_000,
        expectedVersion: target.version,
      },
      ctx,
    );
    expectFailure(stale, 'Concurrency conflict');
  });
});

/* -------------------------------------------------------------------------- */
/*                                 Validators                                */
/* -------------------------------------------------------------------------- */

describe('field validators', () => {
  it('enforces the id grammar and uniqueness', () => {
    expect(validateId('cus_1a2b3c4d').valid).toBe(true);
    expect(validateId('short').valid).toBe(false);
    expect(validateId('has spaces here').valid).toBe(false);
    expect(validateId('cus_1a2b3c4d', new Set(['cus_1a2b3c4d'])).valid).toBe(false);
  });

  it('enforces the email grammar, casing and uniqueness', () => {
    const first = validateEmail('  Owner@Example.COM ');
    expect(first.valid).toBe(true);
    expect(first.data).toBe('owner@example.com');
    expect(validateEmail('nope').valid).toBe(false);
    expect(validateEmail('a@b').valid).toBe(false);
    expect(validateEmail('a@b.com', new Set(['a@b.com'])).valid).toBe(false);
  });

  it('rejects a trial customer that carries MRR', () => {
    const snapshot = seedSnapshot();
    const target = findCustomer(snapshot, (c) => c.status === 'trialing');
    const broken: CustomerRecord = { ...target, mrrCents: 1_000 };
    const result = validateCustomerRecord(broken, {
      otherEmails: new Set<string>(),
      otherIds: new Set<string>(),
    });
    expect(result.valid).toBe(false);
    expect(result.errors['mrrCents']).toBeDefined();
  });

  it('rejects a cohort month that disagrees with createdAt', () => {
    const snapshot = seedSnapshot();
    const target = snapshot.customers[0];
    expect(target).toBeDefined();
    if (target === undefined) {
      return;
    }
    const result = validateCustomerRecord(
      { ...target, cohortMonth: '1999-01' },
      { otherEmails: new Set<string>(), otherIds: new Set<string>() },
    );
    expect(result.valid).toBe(false);
    expect(result.errors['cohortMonth']).toBeDefined();
  });

  it('rejects a snapshot with a bad schema version', () => {
    const snapshot = seedSnapshot();
    const result = validateSnapshot({ ...snapshot, schemaVersion: 2 });
    expect(result.valid).toBe(false);
    expect(result.errors['schemaVersion']).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/*                                  Storage                                  */
/* -------------------------------------------------------------------------- */

describe('storage layer', () => {
  it('seeds storage on first init and reports ready state', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    expect(getStoreState().status).toBe('loading');
    await initStore();

    const state = getStoreState();
    expect(state.status).toBe('ready');
    expect(state.error).toBeNull();
    expect(state.snapshot?.revision).toBe(1);
    expect(fake.getItem(STATE_KEY)).not.toBeNull();
    expect(() => assertLedgerInvariant(state.snapshot as DashboardStateSnapshot)).not.toThrow();
  });

  it('does not overwrite an existing valid snapshot', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    await initStore();
    const seededWrites = fake.writes;

    resetStoreCache();
    await initStore();
    expect(fake.writes).toBe(seededWrites);
    expect(getStoreState().status).toBe('ready');
  });

  it('surfaces corrupt data without destroying it', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    fake.setItem(STATE_KEY, '{not json');
    const writesBefore = fake.writes;

    await initStore();

    const state = getStoreState();
    expect(state.status).toBe('error');
    expect(state.error).toBeTruthy();
    // The unreadable payload is left exactly as the user left it.
    expect(fake.getItem(STATE_KEY)).toBe('{not json');
    expect(fake.writes).toBe(writesBefore);
  });

  it('rejects a snapshot that fails validation without overwriting it', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    const broken = seedSnapshot();
    const first = broken.customers[0];
    if (first !== undefined) {
      first.mrrCents += 1_000;
    }
    fake.setItem(STATE_KEY, JSON.stringify(broken));
    const before = fake.getItem(STATE_KEY);

    await initStore();
    expect(getStoreState().status).toBe('error');
    expect(fake.getItem(STATE_KEY)).toBe(before);
  });

  it('persists a mutation, bumps the revision and refreshes subscribers', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    await initStore();
    const seeded = getStoreState().snapshot as DashboardStateSnapshot;

    let notifications = 0;
    const unsubscribe = (await import('@/lib/storage')).subscribeToStore(() => {
      notifications += 1;
    });

    const target = findCustomer(seeded, (c) => c.status === 'active' && c.mrrCents > 0);
    const result = await runMutation(updateCustomerTier, {
      customerId: target.id,
      newTier: 'scale',
      newMrrCents: target.mrrCents + 3_000,
      expectedVersion: target.version,
    });

    expect(result.ok).toBe(true);
    const state = getStoreState();
    expect(state.snapshot?.revision).toBe(seeded.revision + 1);
    expect(state.snapshot?.asOf).toBe(startOfUtcDay(new Date()).toISOString());
    expect(notifications).toBeGreaterThan(0);

    const stored = readStoredSnapshot();
    expect(stored.kind).toBe('ok');
    if (stored.kind === 'ok') {
      expect(() => assertLedgerInvariant(stored.snapshot)).not.toThrow();
    }
    unsubscribe();
  });

  it('skips the write and the revision bump for a no-op mutation', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    await initStore();
    const seeded = getStoreState().snapshot as DashboardStateSnapshot;
    const writesBefore = fake.writes;

    const target = findCustomer(seeded, (c) => c.status === 'active' && c.mrrCents > 0);
    const result = await runMutation(updateCustomerTier, {
      customerId: target.id,
      newTier: target.tier,
      newMrrCents: target.mrrCents,
      expectedVersion: target.version,
    });

    expect(result.ok).toBe(true);
    expect(fake.writes).toBe(writesBefore);
    expect(getStoreState().snapshot?.revision).toBe(seeded.revision);
  });

  it('surfaces a quota error and keeps the previously persisted snapshot', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    await initStore();
    const before = fake.getItem(STATE_KEY);

    // Only the mutation's write fails, the way a full quota behaves.
    fake.failNextWritesWith(quotaError());

    const seeded = getStoreState().snapshot as DashboardStateSnapshot;
    const target = findCustomer(seeded, (c) => c.status === 'active' && c.mrrCents > 0);
    const result = await runMutation(updateCustomerTier, {
      customerId: target.id,
      newTier: 'scale',
      newMrrCents: target.mrrCents + 1_000,
      expectedVersion: target.version,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(QUOTA_ERROR_MESSAGE);
    }
    expect(getStoreState().status).toBe('error');
    expect(fake.getItem(STATE_KEY)).toBe(before);
  });

  it('returns a reducer failure verbatim without writing', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    await initStore();
    const writesBefore = fake.writes;

    const result = await runMutation(cancelTrial, {
      customerId: 'cus_missing',
      expectedVersion: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
    expect(fake.writes).toBe(writesBefore);
  });

  it('resets the demo dataset and keeps the revision moving forward', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    await initStore();

    const result = await resetDemoDataset();
    expect(result.ok).toBe(true);
    expect(getStoreState().snapshot?.revision).toBeGreaterThan(1);
    expect(() =>
      assertLedgerInvariant(getStoreState().snapshot as DashboardStateSnapshot),
    ).not.toThrow();
  });

  it('serializes concurrent mutations without losing a write', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    await initStore();

    const seeded = getStoreState().snapshot as DashboardStateSnapshot;
    const targets = seeded.customers.filter((c) => c.status === 'active' && c.mrrCents > 0).slice(0, 5);

    await Promise.all(
      targets.map((target) =>
        runMutation(updateCustomerTier, {
          customerId: target.id,
          newTier: 'scale',
          newMrrCents: target.mrrCents + 1_234,
          expectedVersion: target.version,
        }),
      ),
    );

    const stored = readStoredSnapshot();
    expect(stored.kind).toBe('ok');
    if (stored.kind !== 'ok') {
      return;
    }
    // Five serialized mutations, each bumping the revision exactly once.
    expect(stored.snapshot.revision).toBe(seeded.revision + targets.length);
    expect(() => assertLedgerInvariant(stored.snapshot)).not.toThrow();
  });

  it('runs work through the lock in submission order', async () => {
    const order: number[] = [];
    await Promise.all([
      withStateLock(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(1);
      }),
      withStateLock(async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  });
});

/* -------------------------------------------------------------------------- */
/*                             Cross-tab behaviour                           */
/* -------------------------------------------------------------------------- */

describe('cross-tab synchronisation', () => {
  it('applies a snapshot with a higher revision and ignores a stale one', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    await initStore();

    const current = getStoreState().snapshot as DashboardStateSnapshot;
    const newer: DashboardStateSnapshot = {
      ...current,
      revision: current.revision + 5,
      updatedAt: new Date().toISOString(),
    };
    applyIncomingSnapshot(JSON.stringify(newer));
    expect(getStoreState().snapshot?.revision).toBe(newer.revision);

    // An echo of the old revision must not roll the tab backwards.
    applyIncomingSnapshot(JSON.stringify(current));
    expect(getStoreState().snapshot?.revision).toBe(newer.revision);
  });

  it('enters the error state on unparseable cross-tab data without losing the snapshot', async () => {
    const fake = new FakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    await initStore();
    const before = getStoreState().snapshot;

    applyIncomingSnapshot('{{{');

    const state = getStoreState();
    expect(state.status).toBe('error');
    expect(state.error).toBeTruthy();
    expect(state.snapshot).toBe(before);
  });
});