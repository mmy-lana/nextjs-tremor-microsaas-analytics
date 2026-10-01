import type {
  AcquisitionChannel,
  AddCustomerPayload,
  BillingInterval,
  CustomerRecord,
  DashboardStateSnapshot,
  RevenueMovementEvent,
  SubscriptionStatus,
  SubscriptionTier,
  ValidationResult,
} from '@/types/analytics';
import { isUtcIsoString, toYearMonth } from '@/lib/utils';

/**
 * Every guard that stands between untrusted input and the store.
 *
 * Validators are total: they never throw, and they never return a partially
 * populated `data`. Callers either get `{ valid: true, data }` with `data`
 * narrowed to the validated shape, or `{ valid: false, errors }` keyed by field.
 *
 * `noUncheckedIndexedAccess` is on for this project, so every record read out of
 * an untyped blob is narrowed through a type guard before its fields are
 * touched — an `unknown` that is not an object never reaches a field access.
 */

/* -------------------------------------------------------------------------- */
/*                              Result helpers                               */
/* -------------------------------------------------------------------------- */

export function validationOk<T>(data: T): ValidationResult<T> {
  return { valid: true, data, errors: {} };
}

export function validationFail<T>(
  errors: Record<string, string>,
): ValidationResult<T> {
  return { valid: false, errors };
}

/** Collapses an error map into a single message for `MutationResult`. */
export function formatErrors(errors: Record<string, string>): string {
  const entries = Object.entries(errors);
  if (entries.length === 0) {
    return 'Validation failed';
  }
  return entries
    .map(([field, message]) => `${field}: ${message}`)
    .join('; ');
}

function failWith<T>(field: string, message: string): ValidationResult<T> {
  return { valid: false, errors: { [field]: message } };
}

/* -------------------------------------------------------------------------- */
/*                               Narrowing guards                             */
/* -------------------------------------------------------------------------- */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): unknown {
  return source[key];
}

function readNumber(source: Record<string, unknown>, key: string): unknown {
  return source[key];
}

/* -------------------------------------------------------------------------- */
/*                              Enum membership                               */
/* -------------------------------------------------------------------------- */

export const SUBSCRIPTION_TIERS = [
  'starter',
  'pro',
  'scale',
  'enterprise',
] as const satisfies readonly SubscriptionTier[];

export const SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'canceled',
] as const satisfies readonly SubscriptionStatus[];

export const BILLING_INTERVALS = [
  'monthly',
  'annual',
] as const satisfies readonly BillingInterval[];

export const ACQUISITION_CHANNELS = [
  'organic_search',
  'product_hunt',
  'x_social',
  'direct',
  'referral',
] as const satisfies readonly AcquisitionChannel[];

function isMember<T extends string>(
  value: unknown,
  members: readonly T[],
): value is T {
  return typeof value === 'string' && (members as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/*                              Field validators                              */
/* -------------------------------------------------------------------------- */

const ID_PATTERN = /^[a-z0-9_-]{6,36}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MAX_MRR_CENTS = 50_000_000;
export const MIN_SEAT_COUNT = 1;
export const MAX_SEAT_COUNT = 10_000;

/** Matches the id grammar shared by seeded, generated and persisted ids. */
export function validateId(
  value: unknown,
  takenIds: ReadonlySet<string> = new Set<string>(),
): ValidationResult<string> {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    return failWith('id', 'Must be 6-36 characters of letters, digits, hyphen or underscore');
  }
  if (takenIds.has(value)) {
    return failWith('id', 'Must be unique across customers');
  }
  return validationOk(value);
}

/** Lowercases the address before validating, so stored emails are canonical. */
export function validateEmail(
  value: unknown,
  takenEmails: ReadonlySet<string> = new Set<string>(),
): ValidationResult<string> {
  if (typeof value !== 'string') {
    return failWith('email', 'Must be a string');
  }
  const normalized = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    return failWith('email', 'Must be a valid email address');
  }
  if (normalized.length > 254) {
    return failWith('email', 'Must be 254 characters or fewer');
  }
  if (takenEmails.has(normalized)) {
    return failWith('email', 'Must be unique across customers');
  }
  return validationOk(normalized);
}

export function validateOrganizationName(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') {
    return failWith('organizationName', 'Must be a string');
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return failWith('organizationName', 'Must not be empty');
  }
  if (trimmed.length > 80) {
    return failWith('organizationName', 'Must be 80 characters or fewer');
  }
  return validationOk(trimmed);
}

export function validateTier(value: unknown): ValidationResult<SubscriptionTier> {
  if (!isMember(value, SUBSCRIPTION_TIERS)) {
    return failWith('tier', 'Must be one of starter, pro, scale, enterprise');
  }
  return validationOk(value);
}

export function validateStatus(value: unknown): ValidationResult<SubscriptionStatus> {
  if (!isMember(value, SUBSCRIPTION_STATUSES)) {
    return failWith('status', 'Must be one of active, trialing, past_due, canceled');
  }
  return validationOk(value);
}

export function validateBillingInterval(
  value: unknown,
): ValidationResult<BillingInterval> {
  if (!isMember(value, BILLING_INTERVALS)) {
    return failWith('billingInterval', 'Must be monthly or annual');
  }
  return validationOk(value);
}

export function validateChannel(value: unknown): ValidationResult<AcquisitionChannel> {
  if (!isMember(value, ACQUISITION_CHANNELS)) {
    return failWith(
      'channel',
      'Must be one of organic_search, product_hunt, x_social, direct, referral',
    );
  }
  return validationOk(value);
}

export function validateCountryCode(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string' || !COUNTRY_PATTERN.test(value)) {
    return failWith('countryCode', 'Must be an uppercase ISO 3166-1 alpha-2 code');
  }
  return validationOk(value);
}

export function validateMrrCents(value: unknown): ValidationResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return failWith('mrrCents', 'Must be an integer number of cents');
  }
  if (value < 0 || value > MAX_MRR_CENTS) {
    return failWith('mrrCents', `Must be between 0 and ${MAX_MRR_CENTS}`);
  }
  return validationOk(value);
}

export function validatePreviousMrrCents(value: unknown): ValidationResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return failWith('previousMrrCents', 'Must be an integer number of cents');
  }
  if (value < 0 || value > MAX_MRR_CENTS) {
    return failWith('previousMrrCents', `Must be between 0 and ${MAX_MRR_CENTS}`);
  }
  return validationOk(value);
}

export function validateSeatCount(value: unknown): ValidationResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return failWith('seatCount', 'Must be an integer');
  }
  if (value < MIN_SEAT_COUNT || value > MAX_SEAT_COUNT) {
    return failWith('seatCount', `Must be between ${MIN_SEAT_COUNT} and ${MAX_SEAT_COUNT}`);
  }
  return validationOk(value);
}

export function validateApiCalls30d(value: unknown): ValidationResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return failWith('apiCalls30d', 'Must be an integer');
  }
  if (value < 0) {
    return failWith('apiCalls30d', 'Must not be negative');
  }
  return validationOk(value);
}

export function validateVersion(value: unknown): ValidationResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return failWith('version', 'Must be an integer of at least 1');
  }
  return validationOk(value);
}

/** A UTC ISO-8601 instant, or an explicit `null` for an unset timestamp. */
export function validateNullableTimestamp(
  value: unknown,
  field: string,
): ValidationResult<string | null> {
  if (value === null) {
    return validationOk(null);
  }
  if (!isUtcIsoString(value)) {
    return failWith(field, 'Must be a UTC ISO-8601 instant');
  }
  return validationOk(value);
}

export function validateTimestamp(value: unknown, field: string): ValidationResult<string> {
  if (!isUtcIsoString(value)) {
    return failWith(field, 'Must be a UTC ISO-8601 instant');
  }
  return validationOk(value);
}

export function validateCohortMonth(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string' || !YEAR_MONTH_PATTERN.test(value)) {
    return failWith('cohortMonth', 'Must match YYYY-MM');
  }
  return validationOk(value);
}

/* -------------------------------------------------------------------------- */
/*                            Aggregate validators                            */
/* -------------------------------------------------------------------------- */

/** Input for uniqueness-aware record validation. */
export interface CustomerRecordValidationContext {
  /** Emails owned by *other* customers; the record's own email is excluded. */
  otherEmails: ReadonlySet<string>;
  /** Ids owned by *other* customers; the record's own id is excluded. */
  otherIds: ReadonlySet<string>;
}

/**
 * Validates a fully-formed customer record, including every cross-field rule the
 * store relies on:
 *  - `mrrCents === 0` whenever `status === 'trialing'`
 *  - `updatedAt >= createdAt`
 *  - `trialEndsAt >= trialStartedAt`
 *  - `cohortMonth` equals the UTC `YYYY-MM` of `createdAt`
 */
export function validateCustomerRecord(
  value: unknown,
  context: CustomerRecordValidationContext,
): ValidationResult<CustomerRecord> {
  if (!isRecord(value)) {
    return failWith('customer', 'Must be an object');
  }

  const errors: Record<string, string> = {};
  const collect = <T>(result: ValidationResult<T>): T | undefined => {
    if (!result.valid) {
      Object.assign(errors, result.errors);
      return undefined;
    }
    return result.data;
  };

  const id = collect(validateId(readString(value, 'id'), context.otherIds));
  const organizationName = collect(
    validateOrganizationName(readString(value, 'organizationName')),
  );
  const email = collect(validateEmail(readString(value, 'email'), context.otherEmails));
  const tier = collect(validateTier(readString(value, 'tier')));
  const status = collect(validateStatus(readString(value, 'status')));
  const billingInterval = collect(
    validateBillingInterval(readString(value, 'billingInterval')),
  );
  const mrrCents = collect(validateMrrCents(readNumber(value, 'mrrCents')));
  const previousMrrCents = collect(
    validatePreviousMrrCents(readNumber(value, 'previousMrrCents')),
  );
  const channel = collect(validateChannel(readString(value, 'channel')));
  const countryCode = collect(validateCountryCode(readString(value, 'countryCode')));
  const seatCount = collect(validateSeatCount(readNumber(value, 'seatCount')));
  const apiCalls30d = collect(validateApiCalls30d(readNumber(value, 'apiCalls30d')));
  const version = collect(validateVersion(readNumber(value, 'version')));
  const cohortMonth = collect(validateCohortMonth(readString(value, 'cohortMonth')));
  const createdAt = collect(validateTimestamp(readString(value, 'createdAt'), 'createdAt'));
  const updatedAt = collect(validateTimestamp(readString(value, 'updatedAt'), 'updatedAt'));
  const trialStartedAt = collect(
    validateNullableTimestamp(readString(value, 'trialStartedAt'), 'trialStartedAt'),
  );
  const trialEndsAt = collect(
    validateNullableTimestamp(readString(value, 'trialEndsAt'), 'trialEndsAt'),
  );
  const convertedAt = collect(
    validateNullableTimestamp(readString(value, 'convertedAt'), 'convertedAt'),
  );
  const canceledAt = collect(
    validateNullableTimestamp(readString(value, 'canceledAt'), 'canceledAt'),
  );

  if (mrrCents !== undefined && status === 'trialing' && mrrCents !== 0) {
    errors['mrrCents'] = 'Must be 0 while the subscription is trialing';
  }

  if (createdAt !== undefined && updatedAt !== undefined && updatedAt < createdAt) {
    errors['updatedAt'] = 'Must not be earlier than createdAt';
  }

  if (
    trialStartedAt !== undefined &&
    trialEndsAt !== undefined &&
    trialStartedAt !== null &&
    trialEndsAt !== null &&
    trialEndsAt < trialStartedAt
  ) {
    errors['trialEndsAt'] = 'Must not be earlier than trialStartedAt';
  }

  if (createdAt !== undefined && cohortMonth !== undefined) {
    if (cohortMonth !== toYearMonth(createdAt)) {
      errors['cohortMonth'] = 'Must equal the UTC year-month of createdAt';
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return validationOk({
    id: id as string,
    version: version as number,
    organizationName: organizationName as string,
    email: email as string,
    tier: tier as SubscriptionTier,
    status: status as SubscriptionStatus,
    billingInterval: billingInterval as BillingInterval,
    mrrCents: mrrCents as number,
    previousMrrCents: previousMrrCents as number,
    channel: channel as AcquisitionChannel,
    countryCode: countryCode as string,
    seatCount: seatCount as number,
    apiCalls30d: apiCalls30d as number,
    cohortMonth: cohortMonth as string,
    createdAt: createdAt as string,
    updatedAt: updatedAt as string,
    trialStartedAt: trialStartedAt as string | null,
    trialEndsAt: trialEndsAt as string | null,
    convertedAt: convertedAt as string | null,
    canceledAt: canceledAt as string | null,
  });
}

/** Validates the `AddSubscriptionForm` payload before it becomes a record. */
export function validateAddCustomerPayload(
  value: unknown,
  context: { otherEmails: ReadonlySet<string> },
): ValidationResult<AddCustomerPayload> {
  if (!isRecord(value)) {
    return failWith('payload', 'Must be an object');
  }

  const errors: Record<string, string> = {};
  const collect = <T>(result: ValidationResult<T>): T | undefined => {
    if (!result.valid) {
      Object.assign(errors, result.errors);
      return undefined;
    }
    return result.data;
  };

  const organizationName = collect(
    validateOrganizationName(readString(value, 'organizationName')),
  );
  const email = collect(validateEmail(readString(value, 'email'), context.otherEmails));
  const tier = collect(validateTier(readString(value, 'tier')));
  const billingInterval = collect(
    validateBillingInterval(readString(value, 'billingInterval')),
  );
  const channel = collect(validateChannel(readString(value, 'channel')));
  const countryCode = collect(validateCountryCode(readString(value, 'countryCode')));
  const seatCount = collect(validateSeatCount(readNumber(value, 'seatCount')));
  const apiCalls30d = collect(validateApiCalls30d(readNumber(value, 'apiCalls30d')));
  const mrrCents = collect(validateMrrCents(readNumber(value, 'mrrCents')));

  const rawStatus = readString(value, 'status');
  if (rawStatus !== 'active' && rawStatus !== 'trialing') {
    errors['status'] = 'Must be active or trialing';
  }
  const status = rawStatus === 'active' || rawStatus === 'trialing' ? rawStatus : undefined;

  if (mrrCents !== undefined && status === 'trialing' && mrrCents !== 0) {
    errors['mrrCents'] = 'Must be 0 while the subscription is trialing';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return validationOk({
    organizationName: organizationName as string,
    email: email as string,
    tier: tier as SubscriptionTier,
    billingInterval: billingInterval as BillingInterval,
    status: status as 'active' | 'trialing',
    mrrCents: mrrCents as number,
    channel: channel as AcquisitionChannel,
    countryCode: countryCode as string,
    seatCount: seatCount as number,
    apiCalls30d: apiCalls30d as number,
  });
}

/* -------------------------------------------------------------------------- */
/*                             Snapshot validation                            */
/* -------------------------------------------------------------------------- */

const DELTA_EVENT_TYPES: ReadonlySet<string> = new Set([
  'new_business',
  'reactivation',
  'expansion',
  'contraction',
  'churn',
]);

/**
 * The event-sourced guarantee. For every customer, the sum of its events'
 * `deltaMrrCents` must equal its current `mrrCents`.
 *
 * This is checked by the seed generator, by every reducer before it returns, and
 * by every storage read before a snapshot is trusted.
 */
export function assertLedgerInvariant(snapshot: DashboardStateSnapshot): void {
  const sums = new Map<string, number>();
  for (const event of snapshot.events) {
    sums.set(event.customerId, (sums.get(event.customerId) ?? 0) + event.deltaMrrCents);
  }
  for (const customer of snapshot.customers) {
    const sum = sums.get(customer.id) ?? 0;
    if (sum !== customer.mrrCents) {
      throw new Error(
        `Ledger invariant broken for ${customer.id}: sum=${sum}, mrr=${customer.mrrCents}`,
      );
    }
  }
}

/**
 * Shape + invariant validation for a snapshot read back out of storage.
 *
 * A failure here means the persisted payload is unusable, so the caller must
 * surface an error state rather than silently re-seeding over user data.
 */
export function validateSnapshot(value: unknown): ValidationResult<DashboardStateSnapshot> {
  if (!isRecord(value)) {
    return failWith('snapshot', 'Must be an object');
  }

  const errors: Record<string, string> = {};

  if (value['schemaVersion'] !== 1) {
    errors['schemaVersion'] = 'Must be 1';
  }

  if (
    typeof value['revision'] !== 'number' ||
    !Number.isInteger(value['revision']) ||
    value['revision'] < 1
  ) {
    errors['revision'] = 'Must be an integer of at least 1';
  }

  if (!isUtcIsoString(value['asOf'])) {
    errors['asOf'] = 'Must be a UTC ISO-8601 instant';
  }

  if (!isUtcIsoString(value['updatedAt'])) {
    errors['updatedAt'] = 'Must be a UTC ISO-8601 instant';
  }

  const rawCustomers = value['customers'];
  const rawEvents = value['events'];

  if (!Array.isArray(rawCustomers)) {
    errors['customers'] = 'Must be an array';
  }
  if (!Array.isArray(rawEvents)) {
    errors['events'] = 'Must be an array';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  const customers: CustomerRecord[] = [];
  const events: RevenueMovementEvent[] = [];
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const seenEventIds = new Set<string>();

  for (const rawCustomer of rawCustomers as unknown[]) {
    if (!isRecord(rawCustomer)) {
      errors['customers'] = 'Every customer must be an object';
      continue;
    }
    const result = validateCustomerRecord(rawCustomer, {
      otherIds: new Set<string>(),
      otherEmails: new Set<string>(),
    });
    if (!result.valid) {
      Object.assign(errors, result.errors);
      continue;
    }
    if (result.data === undefined) {
      continue;
    }
    // Uniqueness is enforced across the list as it is walked, so an id or email
    // claimed by an earlier record fails this one.
    if (seenIds.has(result.data.id)) {
      errors['id'] = 'Customer ids must be unique';
      continue;
    }
    if (seenEmails.has(result.data.email)) {
      errors['email'] = 'Customer emails must be unique';
      continue;
    }
    seenIds.add(result.data.id);
    seenEmails.add(result.data.email);
    customers.push(result.data);
  }

  for (const rawEvent of rawEvents as unknown[]) {
    if (!isRecord(rawEvent)) {
      errors['events'] = 'Every event must be an object';
      continue;
    }
    const eventResult = validateRevenueMovementEvent(rawEvent, seenIds);
    if (!eventResult.valid) {
      Object.assign(errors, eventResult.errors);
      continue;
    }
    if (eventResult.data === undefined) {
      continue;
    }
    if (seenEventIds.has(eventResult.data.id)) {
      errors['id'] = 'Event ids must be unique';
      continue;
    }
    seenEventIds.add(eventResult.data.id);
    events.push(eventResult.data);
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  const snapshot: DashboardStateSnapshot = {
    schemaVersion: 1,
    revision: value['revision'] as number,
    asOf: value['asOf'] as string,
    updatedAt: value['updatedAt'] as string,
    customers,
    events,
  };

  try {
    assertLedgerInvariant(snapshot);
  } catch (error) {
    return {
      valid: false,
      errors: { ledger: error instanceof Error ? error.message : String(error) },
    };
  }

  return validationOk(snapshot);
}

/**
 * Validates one append-only event. `knownCustomerIds` enforces that every event
 * references a customer that exists in the same snapshot.
 */
export function validateRevenueMovementEvent(
  value: unknown,
  knownCustomerIds: ReadonlySet<string>,
): ValidationResult<RevenueMovementEvent> {
  if (!isRecord(value)) {
    return failWith('event', 'Must be an object');
  }

  const errors: Record<string, string> = {};
  const collect = <T>(result: ValidationResult<T>): T | undefined => {
    if (!result.valid) {
      Object.assign(errors, result.errors);
      return undefined;
    }
    return result.data;
  };

  const id = collect(validateId(readString(value, 'id')));
  const customerId = collect(validateId(readString(value, 'customerId')));
  const organizationName = collect(
    validateOrganizationName(readString(value, 'organizationName')),
  );
  const tier = collect(validateTier(readString(value, 'tier')));
  const channel = collect(validateChannel(readString(value, 'channel')));
  const mrrBeforeCents = collect(validateMrrCents(readNumber(value, 'mrrBeforeCents')));
  const mrrAfterCents = collect(validateMrrCents(readNumber(value, 'mrrAfterCents')));
  const occurredAt = collect(
    validateTimestamp(readString(value, 'occurredAt'), 'occurredAt'),
  );
  const createdAt = collect(validateTimestamp(readString(value, 'createdAt'), 'createdAt'));

  const rawType = readString(value, 'type');
  const REVENUE_MOVEMENT_TYPES = [
    'new_business',
    'expansion',
    'contraction',
    'churn',
    'reactivation',
    'trial_started',
    'trial_converted',
    'trial_canceled',
  ] as const;
  if (!isMember(rawType, REVENUE_MOVEMENT_TYPES)) {
    errors['type'] = 'Must be a known revenue movement type';
  }

  const deltaMrrCents = readNumber(value, 'deltaMrrCents');
  if (typeof deltaMrrCents !== 'number' || !Number.isInteger(deltaMrrCents)) {
    errors['deltaMrrCents'] = 'Must be an integer number of cents';
  } else if (
    typeof rawType === 'string' &&
    !DELTA_EVENT_TYPES.has(rawType) &&
    deltaMrrCents !== 0
  ) {
    errors['deltaMrrCents'] = 'Must be 0 for trial movement events';
  } else if (typeof rawType === 'string' && DELTA_EVENT_TYPES.has(rawType)) {
    if (mrrBeforeCents !== undefined && mrrAfterCents !== undefined) {
      if (mrrBeforeCents + deltaMrrCents !== mrrAfterCents) {
        errors['deltaMrrCents'] = 'Must equal mrrAfterCents minus mrrBeforeCents';
      }
    }
  }

  if (customerId !== undefined && !knownCustomerIds.has(customerId)) {
    errors['customerId'] = 'Must reference a customer in this snapshot';
  }

  const rawPreviousTier = value['previousTier'];
  let previousTier: SubscriptionTier | null = null;
  if (rawPreviousTier !== null) {
    const previousTierResult = validateTier(rawPreviousTier);
    if (!previousTierResult.valid) {
      Object.assign(errors, previousTierResult.errors);
    } else {
      previousTier = previousTierResult.data as SubscriptionTier;
    }
  }

  const currentTier = collect(validateTier(readString(value, 'currentTier')));

  if (
    Object.keys(errors).length > 0 ||
    id === undefined ||
    customerId === undefined ||
    organizationName === undefined ||
    tier === undefined ||
    channel === undefined ||
    mrrBeforeCents === undefined ||
    mrrAfterCents === undefined ||
    occurredAt === undefined ||
    createdAt === undefined ||
    currentTier === undefined ||
    typeof deltaMrrCents !== 'number'
  ) {
    return { valid: false, errors };
  }

  return validationOk({
    id,
    customerId,
    organizationName,
    tier,
    channel,
    type: rawType as RevenueMovementEvent['type'],
    mrrBeforeCents,
    mrrAfterCents,
    deltaMrrCents,
    previousTier,
    currentTier,
    occurredAt,
    createdAt,
  });
}