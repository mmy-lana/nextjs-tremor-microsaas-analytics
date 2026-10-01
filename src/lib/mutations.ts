import type {
  AddCustomerPayload,
  CustomerRecord,
  DashboardStateSnapshot,
  MutationContext,
  MutationResult,
  RevenueMovementEvent,
  RevenueMovementType,
  SubscriptionTier,
} from '@/types/analytics';
import {
  assertLedgerInvariant,
  formatErrors,
  validateAddCustomerPayload,
  validateCustomerRecord,
  validateId,
  validateMrrCents,
  validateTier,
} from '@/lib/validators';
import { addUtcDays, toYearMonth } from '@/lib/utils';

/**
 * Pure, synchronous reducers over the dashboard snapshot.
 *
 * Every reducer is `(snapshot, args, ctx) => MutationResult`. They never touch
 * `window`, `localStorage` or the ambient clock: "now" arrives through
 * `ctx.now` and every new id through `ctx.nextId`, so the whole layer runs
 * unchanged in Node under Vitest.
 *
 * Concurrency model: a customer mutation carries `expectedVersion` and is
 * rejected when the stored version has moved on, which is what makes two tabs
 * editing the same row safe.
 */

const CUSTOMER_ID_PREFIX = 'cus';
const EVENT_ID_PREFIX = 'evt';
const TRIAL_LENGTH_DAYS = 14;

export const CONCURRENCY_CONFLICT_MESSAGE =
  'Concurrency conflict: customer version mismatch';

export interface VersionedCustomerArgs {
  customerId: string;
  expectedVersion: number;
}

export interface TierChangeArgs extends VersionedCustomerArgs {
  newTier: SubscriptionTier;
  newMrrCents: number;
}

/** Structural reducer shape, so `storage.ts` never has to import this module. */
export type Reducer<TAArgs> = (
  snapshot: DashboardStateSnapshot,
  args: TAArgs,
  ctx: MutationContext,
) => MutationResult;

/* -------------------------------------------------------------------------- */
/*                                 Internals                                 */
/* -------------------------------------------------------------------------- */

function customerIdFor(nextId: () => string): string {
  return `${CUSTOMER_ID_PREFIX}_${nextId()}`;
}

function eventIdFor(nextId: () => string): string {
  return `${EVENT_ID_PREFIX}_${nextId()}`;
}

function findCustomerIndex(
  snapshot: DashboardStateSnapshot,
  customerId: string,
): number {
  return snapshot.customers.findIndex((customer) => customer.id === customerId);
}

interface BuildEventInput {
  customer: CustomerRecord;
  type: RevenueMovementType;
  tierBefore: SubscriptionTier;
  tierAfter: SubscriptionTier;
  isFirstEvent: boolean;
  mrrBeforeCents: number;
  mrrAfterCents: number;
  occurredAt: string;
  nextId: () => string;
}

function buildEvent(input: BuildEventInput): RevenueMovementEvent {
  return {
    id: eventIdFor(input.nextId),
    customerId: input.customer.id,
    organizationName: input.customer.organizationName,
    tier: input.tierAfter,
    channel: input.customer.channel,
    type: input.type,
    mrrBeforeCents: input.mrrBeforeCents,
    mrrAfterCents: input.mrrAfterCents,
    deltaMrrCents: input.mrrAfterCents - input.mrrBeforeCents,
    previousTier: input.isFirstEvent ? null : input.tierBefore,
    currentTier: input.tierAfter,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
  };
}

/**
 * Re-checks the ledger invariant before a reducer reports success, and rejects
 * the whole mutation if the event log and the customer rows disagree.
 */
function commit(
  snapshot: DashboardStateSnapshot,
  customers: CustomerRecord[],
  events: RevenueMovementEvent[],
): MutationResult {
  const next: DashboardStateSnapshot = { ...snapshot, customers, events };
  try {
    assertLedgerInvariant(next);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, snapshot: next };
}

/** Applies a customer patch and stamps the optimistic-concurrency fields. */
function withMutationStamp(
  customer: CustomerRecord,
  patch: Partial<CustomerRecord>,
  nowIso: string,
): CustomerRecord {
  return {
    ...customer,
    ...patch,
    version: customer.version + 1,
    updatedAt: nowIso,
  };
}

function validatePatchedCustomer(customer: CustomerRecord, others: CustomerRecord[]): string | null {
  const otherEmails = new Set<string>();
  const otherIds = new Set<string>();
  for (const other of others) {
    if (other.id === customer.id) {
      continue;
    }
    otherEmails.add(other.email);
    otherIds.add(other.id);
  }
  const result = validateCustomerRecord(customer, { otherEmails, otherIds });
  return result.valid ? null : formatErrors(result.errors);
}

function replaceCustomer(
  snapshot: DashboardStateSnapshot,
  index: number,
  next: CustomerRecord,
  appendedEvents: RevenueMovementEvent[],
): MutationResult {
  const customers = snapshot.customers.map((customer, i) => (i === index ? next : customer));
  const error = validatePatchedCustomer(next, customers);
  if (error !== null) {
    return { ok: false, error };
  }
  return commit(snapshot, customers, [...snapshot.events, ...appendedEvents]);
}

/**
 * Resolves the customer a versioned mutation targets, or the failure the caller
 * should return. Centralising it keeps the guard order identical everywhere:
 * existence, then optimistic concurrency.
 */
function resolveTarget(
  snapshot: DashboardStateSnapshot,
  args: VersionedCustomerArgs,
): { ok: true; index: number; customer: CustomerRecord } | { ok: false; error: string } {
  const index = findCustomerIndex(snapshot, args.customerId);
  if (index < 0) {
    return { ok: false, error: `Customer not found: ${args.customerId}` };
  }
  const customer = snapshot.customers[index];
  if (customer === undefined) {
    return { ok: false, error: `Customer not found: ${args.customerId}` };
  }
  if (customer.version !== args.expectedVersion) {
    return { ok: false, error: CONCURRENCY_CONFLICT_MESSAGE };
  }
  return { ok: true, index, customer };
}

function validatePositiveMrr(value: unknown, field: string): MutationResult | null {
  const result = validateMrrCents(value);
  if (!result.valid) {
    return { ok: false, error: formatErrors(result.errors) };
  }
  if (result.data === undefined || result.data < 1) {
    return { ok: false, error: `${field}: Must be at least 1 cent` };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*                                addCustomer                                */
/* -------------------------------------------------------------------------- */

/**
 * Creates a customer and the first event in their ledger.
 *
 * A `trialing` payload emits a zero-delta `trial_started` and holds
 * `trialEndsAt` 14 days out; an `active` payload emits `new_business` whose
 * delta is the customer's opening MRR.
 */
export function addCustomerSubscription(
  snapshot: DashboardStateSnapshot,
  payload: AddCustomerPayload,
  ctx: MutationContext,
): MutationResult {
  const nowIso = ctx.now.toISOString();
  const takenIds = new Set(snapshot.customers.map((customer) => customer.id));
  const takenEmails = new Set(snapshot.customers.map((customer) => customer.email));

  const id = customerIdFor(ctx.nextId);
  const idResult = validateId(id, takenIds);
  if (!idResult.valid) {
    return { ok: false, error: formatErrors(idResult.errors) };
  }

  const payloadResult = validateAddCustomerPayload(payload, {
    otherEmails: takenEmails,
  });
  if (!payloadResult.valid) {
    return { ok: false, error: formatErrors(payloadResult.errors) };
  }
  if (payloadResult.data === undefined) {
    return { ok: false, error: formatErrors(payloadResult.errors) };
  }

  const data = payloadResult.data;
  const isTrial = data.status === 'trialing';

  const record: CustomerRecord = {
    id,
    version: 1,
    organizationName: data.organizationName,
    email: data.email,
    tier: data.tier,
    status: data.status,
    billingInterval: data.billingInterval,
    mrrCents: isTrial ? 0 : data.mrrCents,
    previousMrrCents: 0,
    channel: data.channel,
    countryCode: data.countryCode,
    seatCount: data.seatCount,
    apiCalls30d: data.apiCalls30d,
    cohortMonth: toYearMonth(nowIso),
    createdAt: nowIso,
    updatedAt: nowIso,
    trialStartedAt: isTrial ? nowIso : null,
    trialEndsAt: isTrial ? addUtcDays(ctx.now, TRIAL_LENGTH_DAYS).toISOString() : null,
    convertedAt: null,
    canceledAt: null,
  };

  const mrrBeforeCents = 0;
  const mrrAfterCents = record.mrrCents;
  const event = buildEvent({
    customer: record,
    type: isTrial ? 'trial_started' : 'new_business',
    tierBefore: data.tier,
    tierAfter: data.tier,
    isFirstEvent: true,
    mrrBeforeCents,
    mrrAfterCents,
    occurredAt: nowIso,
    nextId: ctx.nextId,
  });

  const customers = [...snapshot.customers, record];
  const recordError = validatePatchedCustomer(record, customers);
  if (recordError !== null) {
    return { ok: false, error: recordError };
  }

  return commit(snapshot, customers, [...snapshot.events, event]);
}

/* -------------------------------------------------------------------------- */
/*                              updateCustomerTier                           */
/* -------------------------------------------------------------------------- */

/**
 * Moves a paying account onto a new tier and MRR.
 *
 * Same tier *and* same MRR is a no-op that returns the input snapshot by
 * reference. A pure tier change at unchanged MRR updates the tier without
 * emitting an event. Any MRR change emits `expansion` or `contraction`, and a
 * contraction records the pre-change MRR in `previousMrrCents`.
 */
export const updateCustomerTier: Reducer<TierChangeArgs> = (snapshot, args, ctx) => {
  const target = resolveTarget(snapshot, args);
  if (!target.ok) {
    return { ok: false, error: target.error };
  }
  const { index, customer } = target;

  if (customer.status === 'canceled') {
    return { ok: false, error: 'Cannot change the tier of a canceled subscription' };
  }
  if (customer.status === 'trialing') {
    return { ok: false, error: 'Convert the trial before changing the tier' };
  }

  const tierResult = validateTier(args.newTier);
  if (!tierResult.valid) {
    return { ok: false, error: formatErrors(tierResult.errors) };
  }
  const mrrFailure = validatePositiveMrr(args.newMrrCents, 'newMrrCents');
  if (mrrFailure !== null) {
    return mrrFailure;
  }

  if (customer.tier === args.newTier && customer.mrrCents === args.newMrrCents) {
    return { ok: true, snapshot };
  }

  const nowIso = ctx.now.toISOString();
  const deltaMrrCents = args.newMrrCents - customer.mrrCents;

  if (deltaMrrCents === 0) {
    const next = withMutationStamp(customer, { tier: args.newTier }, nowIso);
    return replaceCustomer(snapshot, index, next, []);
  }

  const type: RevenueMovementType =
    deltaMrrCents > 0 ? 'expansion' : 'contraction';

  const event = buildEvent({
    customer,
    type,
    tierBefore: customer.tier,
    tierAfter: args.newTier,
    isFirstEvent: !snapshot.events.some((e) => e.customerId === customer.id),
    mrrBeforeCents: customer.mrrCents,
    mrrAfterCents: args.newMrrCents,
    occurredAt: nowIso,
    nextId: ctx.nextId,
  });

  const next = withMutationStamp(
    customer,
    {
      tier: args.newTier,
      mrrCents: args.newMrrCents,
      ...(type === 'contraction' ? { previousMrrCents: customer.mrrCents } : {}),
    },
    nowIso,
  );

  return replaceCustomer(snapshot, index, next, [event]);
};

/* -------------------------------------------------------------------------- */
/*                            cancelSubscription                             */
/* -------------------------------------------------------------------------- */

/**
 * Cancels a paying subscription: emits `churn` for the full MRR, zeroes the
 * balance and records the pre-churn MRR in `previousMrrCents`.
 *
 * Trialing accounts are rejected on purpose. A `churn` event is contractually
 * non-zero, and a trial holds no MRR, so the correct operation is `cancelTrial`.
 * Cancelling an already-canceled account is a no-op.
 */
export const cancelSubscription: Reducer<VersionedCustomerArgs> = (snapshot, args, ctx) => {
  const target = resolveTarget(snapshot, args);
  if (!target.ok) {
    return { ok: false, error: target.error };
  }
  const { index, customer } = target;

  if (customer.status === 'canceled') {
    return { ok: true, snapshot };
  }
  if (customer.status === 'trialing') {
    return { ok: false, error: 'Cancel the trial with cancelTrial instead' };
  }

  const nowIso = ctx.now.toISOString();
  const event = buildEvent({
    customer,
    type: 'churn',
    tierBefore: customer.tier,
    tierAfter: customer.tier,
    isFirstEvent: !snapshot.events.some((e) => e.customerId === customer.id),
    mrrBeforeCents: customer.mrrCents,
    mrrAfterCents: 0,
    occurredAt: nowIso,
    nextId: ctx.nextId,
  });

  const next = withMutationStamp(
    customer,
    {
      status: 'canceled',
      mrrCents: 0,
      previousMrrCents: customer.mrrCents,
      canceledAt: nowIso,
    },
    nowIso,
  );

  return replaceCustomer(snapshot, index, next, [event]);
};

/* -------------------------------------------------------------------------- */
/*                               convertTrial                                */
/* -------------------------------------------------------------------------- */

/**
 * Converts a trial into a paying subscription.
 *
 * Two events are appended: a zero-delta `trial_converted` that records the
 * intent, then `new_business` carrying the opening MRR.
 */
export const convertTrial: Reducer<TierChangeArgs> = (snapshot, args, ctx) => {
  const target = resolveTarget(snapshot, args);
  if (!target.ok) {
    return { ok: false, error: target.error };
  }
  const { index, customer } = target;

  if (customer.status !== 'trialing') {
    return { ok: false, error: 'Only a trialing subscription can be converted' };
  }

  const tierResult = validateTier(args.newTier);
  if (!tierResult.valid) {
    return { ok: false, error: formatErrors(tierResult.errors) };
  }
  const mrrFailure = validatePositiveMrr(args.newMrrCents, 'newMrrCents');
  if (mrrFailure !== null) {
    return mrrFailure;
  }

  const nowIso = ctx.now.toISOString();
  const isFirstEvent = !snapshot.events.some((e) => e.customerId === customer.id);

  const convertedEvent = buildEvent({
    customer,
    type: 'trial_converted',
    tierBefore: customer.tier,
    tierAfter: customer.tier,
    isFirstEvent,
    mrrBeforeCents: 0,
    mrrAfterCents: 0,
    occurredAt: nowIso,
    nextId: ctx.nextId,
  });

  const newBusinessEvent = buildEvent({
    customer,
    type: 'new_business',
    tierBefore: customer.tier,
    tierAfter: args.newTier,
    isFirstEvent: false,
    mrrBeforeCents: 0,
    mrrAfterCents: args.newMrrCents,
    occurredAt: nowIso,
    nextId: ctx.nextId,
  });

  const next = withMutationStamp(
    customer,
    {
      status: 'active',
      tier: args.newTier,
      mrrCents: args.newMrrCents,
      convertedAt: nowIso,
    },
    nowIso,
  );

  return replaceCustomer(snapshot, index, next, [convertedEvent, newBusinessEvent]);
};

/* -------------------------------------------------------------------------- */
/*                                cancelTrial                                */
/* -------------------------------------------------------------------------- */

/**
 * Abandons a trial. Emits a zero-delta `trial_canceled` and cancels the account.
 */
export const cancelTrial: Reducer<VersionedCustomerArgs> = (snapshot, args, ctx) => {
  const target = resolveTarget(snapshot, args);
  if (!target.ok) {
    return { ok: false, error: target.error };
  }
  const { index, customer } = target;

  if (customer.status !== 'trialing') {
    return { ok: false, error: 'Only a trialing subscription can be canceled as a trial' };
  }

  const nowIso = ctx.now.toISOString();
  const event = buildEvent({
    customer,
    type: 'trial_canceled',
    tierBefore: customer.tier,
    tierAfter: customer.tier,
    isFirstEvent: !snapshot.events.some((e) => e.customerId === customer.id),
    mrrBeforeCents: 0,
    mrrAfterCents: 0,
    occurredAt: nowIso,
    nextId: ctx.nextId,
  });

  const next = withMutationStamp(
    customer,
    { status: 'canceled', mrrCents: 0, canceledAt: nowIso },
    nowIso,
  );

  return replaceCustomer(snapshot, index, next, [event]);
};

/* -------------------------------------------------------------------------- */
/*                          reactivateSubscription                           */
/* -------------------------------------------------------------------------- */

/**
 * Brings a canceled account back. Emits `reactivation` whose delta is the
 * restored MRR, and clears `canceledAt`.
 *
 * `previousMrrCents` intentionally keeps the pre-churn balance: it is defined as
 * the MRR immediately before the latest churn or contraction, and a reactivation
 * is neither.
 */
export const reactivateSubscription: Reducer<TierChangeArgs> = (snapshot, args, ctx) => {
  const target = resolveTarget(snapshot, args);
  if (!target.ok) {
    return { ok: false, error: target.error };
  }
  const { index, customer } = target;

  if (customer.status !== 'canceled') {
    return { ok: false, error: 'Only a canceled subscription can be reactivated' };
  }

  const tierResult = validateTier(args.newTier);
  if (!tierResult.valid) {
    return { ok: false, error: formatErrors(tierResult.errors) };
  }
  const mrrFailure = validatePositiveMrr(args.newMrrCents, 'newMrrCents');
  if (mrrFailure !== null) {
    return mrrFailure;
  }

  const nowIso = ctx.now.toISOString();
  const event = buildEvent({
    customer,
    type: 'reactivation',
    tierBefore: customer.tier,
    tierAfter: args.newTier,
    isFirstEvent: !snapshot.events.some((e) => e.customerId === customer.id),
    mrrBeforeCents: customer.mrrCents,
    mrrAfterCents: args.newMrrCents,
    occurredAt: nowIso,
    nextId: ctx.nextId,
  });

  const next = withMutationStamp(
    customer,
    {
      status: 'active',
      tier: args.newTier,
      mrrCents: args.newMrrCents,
      canceledAt: null,
    },
    nowIso,
  );

  return replaceCustomer(snapshot, index, next, [event]);
};