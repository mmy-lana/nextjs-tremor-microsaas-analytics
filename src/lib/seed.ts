import type {
  AcquisitionChannel,
  BillingInterval,
  CustomerRecord,
  DashboardStateSnapshot,
  RevenueMovementEvent,
  RevenueMovementType,
  SubscriptionTier,
} from '@/types/analytics';
import { assertLedgerInvariant } from '@/lib/validators';
import { MS_PER_DAY, startOfUtcDay, toYearMonth } from '@/lib/utils';

/**
 * Deterministic demo-data generator.
 *
 * The seed is event-sourced: every customer is simulated forward from the day
 * they signed up, and each movement is appended to the event log and applied to
 * the running customer state by the same `applyMovement` helper. The ledger
 * invariant therefore holds *by construction* rather than by post-hoc repair,
 * and the `assertLedgerInvariant` call at the end of `generateSeed` is a real
 * assertion rather than a rubber stamp.
 *
 * Determinism: `generateSeed(now, seedConstant)` with the same two arguments
 * always produces byte-identical output. Ids come from the same PRNG stream as
 * every other random decision, so tests can assert on them.
 */

/** Day 0 is `asOf - 400 days`. `asOf` is day 400 and carries no events itself. */
const HISTORY_DAYS = 400;
const LAST_EVENT_DAY = HISTORY_DAYS - 1;
const CUSTOMER_COUNT = 65;
const TRIAL_DAYS = 14;
/** Guarantees the `all` growth baseline is non-zero (the plan requires >= 10). */
const DAY_ZERO_CUSTOMERS = 12;
/** Guarantees the `7d` window is never empty (the plan requires >= 3 events). */
const RECENT_DAY_START = HISTORY_DAYS - 7;
const RECENT_EVENT_FLOOR = 6;
const MAX_PAST_DUE = 5;
const ANNUAL_DISCOUNT = 0.8;
const TRIAL_SHARE = 0.25;
const TRIAL_CONVERSION_SHARE = 0.7;

/** Minimum MRR a contraction may leave behind, in cents. */
const CONTRACTION_FLOOR_CENTS = 1_000;

const TIER_MONTHLY_CENTS: Readonly<Record<SubscriptionTier, number>> = {
  starter: 2_900,
  pro: 9_900,
  scale: 29_900,
  enterprise: 120_000,
};

const TIER_ORDER: readonly SubscriptionTier[] = [
  'starter',
  'pro',
  'scale',
  'enterprise',
];

const TIER_WEIGHTS: ReadonlyArray<readonly [SubscriptionTier, number]> = [
  ['starter', 35],
  ['pro', 35],
  ['scale', 20],
  ['enterprise', 10],
];

const CHANNEL_WEIGHTS: ReadonlyArray<readonly [AcquisitionChannel, number]> = [
  ['organic_search', 34],
  ['direct', 26],
  ['referral', 18],
  ['x_social', 12],
  ['product_hunt', 10],
];

const ORG_HEADS: readonly string[] = [
  'Northwind', 'Lumen', 'Harbor', 'Vertex', 'Kestrel', 'Basalt', 'Orbit', 'Cobalt',
  'Juniper', 'Signal', 'Meridian', 'Quarry', 'Halcyon', 'Pinnacle', 'Aster',
  'Beacon', 'Cinder', 'Drift', 'Ember', 'Foundry', 'Granite', 'Hollow', 'Indigo',
  'Jetty', 'Keystone', 'Lantern', 'Mosaic', 'Nimbus', 'Onyx', 'Prism',
];

const ORG_TAILS: readonly string[] = [
  'Labs', 'Systems', 'Analytics', 'Robotics', 'Health', 'Logistics', 'Studio',
  'Works', 'Cloud', 'Data', 'Dynamics', 'Grid', 'Metrics', 'Stack', 'Signals',
];

const FIRST_NAMES: readonly string[] = [
  'Avery', 'Blake', 'Camila', 'Dmitri', 'Elena', 'Farid', 'Greta', 'Hana',
  'Ibrahim', 'Jonas', 'Keiko', 'Lucia', 'Mateo', 'Nadia', 'Omar', 'Priya',
  'Quinn', 'Rosa', 'Sven', 'Tomas', 'Ulrike', 'Viktor', 'Wren', 'Ximena',
  'Yusuf', 'Zara',
];

const LAST_NAMES: readonly string[] = [
  'Achebe', 'Bergman', 'Costa', 'Duarte', 'Eriksen', 'Fontaine', 'Grimaldi',
  'Haddad', 'Ibarra', 'Jansen', 'Kowalski', 'Lindqvist', 'Moreau', 'Nakamura',
  'Okonkwo', 'Petrov', 'Quintero', 'Rasmussen', 'Silva', 'Takahashi', 'Ueda',
  'Vasquez', 'Whitfield', 'Yamada',
];

const COUNTRY_CODES: readonly string[] = [
  'US', 'GB', 'DE', 'FR', 'CA', 'AU', 'NL', 'SE', 'PL', 'ES', 'IE', 'PT',
  'NO', 'FI', 'DK', 'CH', 'AT', 'BE', 'NZ', 'SG',
];

/* -------------------------------------------------------------------------- */
/*                                   PRNG                                    */
/* -------------------------------------------------------------------------- */

export type Random = () => number;

/** Mulberry32: small, fast, and stable across engines. */
export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const HEX_DIGITS = '0123456789abcdef';

/** Ids must match `/^[a-z0-9_-]{6,36}$/i`, so they are prefix + 8 hex chars. */
function drawId(random: Random, prefix: string, used: Set<string>): string {
  for (;;) {
    let id = prefix;
    for (let i = 0; i < 8; i += 1) {
      id += HEX_DIGITS.charAt(Math.floor(random() * 16));
    }
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
}

function pick<T>(random: Random, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) {
    throw new Error('pick requires a non-empty list');
  }
  return value;
}

function weightedPick<T>(
  random: Random,
  entries: ReadonlyArray<readonly [T, number]>,
): T {
  const total = entries.reduce((acc, entry) => acc + entry[1], 0);
  let roll = random() * total;
  let fallback: T | undefined;
  for (const [value, weight] of entries) {
    fallback = value;
    roll -= weight;
    if (roll < 0) {
      return value;
    }
  }
  if (fallback === undefined) {
    throw new Error('weightedPick requires a non-empty list');
  }
  return fallback;
}

function intBetween(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function shuffled<T>(random: Random, values: readonly T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a !== undefined && b !== undefined) {
      copy[i] = b;
      copy[j] = a;
    }
  }
  return copy;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);
}

/* -------------------------------------------------------------------------- */
/*                              Customer timeline                             */
/* -------------------------------------------------------------------------- */

type TrialOutcome = 'convert' | 'cancel' | 'pending';

type LifecycleRole = 'churn' | 'reactivate' | 'expansion' | 'contraction' | 'stable';

interface Timeline {
  customer: CustomerRecord;
  events: RevenueMovementEvent[];
  random: Random;
  nextEventId: () => string;
  emitted: number;
}

interface MovementOptions {
  /** Tier AFTER the movement. Defaults to the tier before it. */
  tier?: SubscriptionTier;
  /** MRR AFTER the movement, in cents. Defaults to the MRR before it. */
  mrrAfterCents?: number;
}

/**
 * Appends one movement to the event log and applies it to the running customer
 * state. Every MRR change in the generated dataset funnels through here, which
 * is why the ledger invariant cannot drift.
 */
function applyMovement(
  timeline: Timeline,
  type: RevenueMovementType,
  occurredAt: Date,
  options: MovementOptions = {},
): void {
  const { customer, random } = timeline;
  const mrrBeforeCents = customer.mrrCents;
  const mrrAfterCents = options.mrrAfterCents ?? mrrBeforeCents;
  const tierBefore = customer.tier;
  const currentTier = options.tier ?? tierBefore;
  const timestamp = occurredAt.toISOString();
  const deltaMrrCents = mrrAfterCents - mrrBeforeCents;

  timeline.events.push({
    id: timeline.nextEventId(),
    customerId: customer.id,
    organizationName: customer.organizationName,
    tier: currentTier,
    channel: customer.channel,
    type,
    mrrBeforeCents,
    mrrAfterCents,
    deltaMrrCents,
    previousTier: timeline.emitted === 0 ? null : tierBefore,
    currentTier,
    occurredAt: timestamp,
    createdAt: timestamp,
  });

  customer.tier = currentTier;
  customer.mrrCents = mrrAfterCents;
  customer.updatedAt = timestamp;

  switch (type) {
    case 'contraction':
      customer.previousMrrCents = mrrBeforeCents;
      break;
    case 'churn':
    case 'trial_canceled':
      customer.previousMrrCents = mrrBeforeCents;
      customer.status = 'canceled';
      customer.canceledAt = timestamp;
      break;
    case 'reactivation':
      customer.status = 'active';
      customer.canceledAt = null;
      break;
    case 'new_business':
      customer.status = 'active';
      break;
    default:
      break;
  }

  // Usage telemetry drifts forward alongside billing activity.
  customer.apiCalls30d = Math.max(0, customer.apiCalls30d + intBetween(random, -40, 400));
  timeline.emitted += 1;
}

function tierBelow(tier: SubscriptionTier, random: Random): SubscriptionTier {
  const index = TIER_ORDER.indexOf(tier);
  if (index <= 0) {
    return 'starter';
  }
  // Usually one tier down; two when the cut is severe.
  const steps = random() < 0.25 ? 2 : 1;
  return TIER_ORDER[Math.max(0, index - steps)] ?? 'starter';
}

function tierAbove(tier: SubscriptionTier): SubscriptionTier {
  const index = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, index + 1)] ?? tier;
}

function baseMrrForPlan(
  random: Random,
  tier: SubscriptionTier,
  billingInterval: BillingInterval,
): number {
  const monthlyCents = TIER_MONTHLY_CENTS[tier];
  const seatMultiplier = tier === 'starter' || tier === 'pro' ? 1 : intBetween(random, 1, 4);
  const undiscounted = monthlyCents * seatMultiplier;
  if (billingInterval === 'monthly') {
    return undiscounted;
  }
  const annualCents = Math.round(undiscounted * 12 * ANNUAL_DISCOUNT);
  return Math.round(annualCents / 12);
}

function seatCountForTier(random: Random, tier: SubscriptionTier): number {
  const ranges: Readonly<Record<SubscriptionTier, readonly [number, number]>> = {
    starter: [1, 8],
    pro: [4, 40],
    scale: [15, 180],
    enterprise: [60, 900],
  };
  const range = ranges[tier];
  return intBetween(random, range[0], range[1]);
}

/**
 * Plays one non-terminal step in a customer's life: seat growth or seat loss.
 * A large enough move in either direction also shifts the customer one tier.
 */
function playMovement(
  timeline: Timeline,
  dayTime: (day: number) => Date,
  day: number,
  bias: 'up' | 'down' | 'either',
): void {
  const { random } = timeline;
  const current = timeline.customer.mrrCents;
  if (current <= CONTRACTION_FLOOR_CENTS) {
    return;
  }

  const direction = bias === 'either' ? (random() < 0.6 ? 'up' : 'down') : bias;

  if (direction === 'up') {
    const growth = Math.max(1, Math.round(current * (0.08 + random() * 0.27)));
    const ratio = growth / current;
    applyMovement(timeline, 'expansion', dayTime(day), {
      mrrAfterCents: current + growth,
      tier: ratio > 0.2 ? tierAbove(timeline.customer.tier) : timeline.customer.tier,
    });
    return;
  }

  const shrink = Math.max(1, Math.round(current * (0.08 + random() * 0.22)));
  const after = Math.max(CONTRACTION_FLOOR_CENTS, current - shrink);
  if (after >= current) {
    return;
  }
  const ratio = shrink / current;
  applyMovement(timeline, 'contraction', dayTime(day), {
    mrrAfterCents: after,
    tier: ratio > 0.2 ? tierBelow(timeline.customer.tier, random) : timeline.customer.tier,
  });
}

/* -------------------------------------------------------------------------- */
/*                             Lifecycle scheduling                           */
/* -------------------------------------------------------------------------- */

function movementCountForRole(random: Random, role: LifecycleRole): number {
  switch (role) {
    case 'churn':
    case 'reactivate':
      return intBetween(random, 0, 2);
    case 'expansion':
      return intBetween(random, 1, 3);
    case 'contraction':
      return intBetween(random, 1, 2);
    case 'stable':
      return random() < 0.35 ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * Plays out a paying customer's life from `activationDay`.
 *
 * Churn-role accounts reserve the back half of their remaining span for the
 * churn event, which guarantees the role actually churns whenever the calendar
 * has room for it rather than silently degrading to "stable".
 */
function simulateLifecycle(
  timeline: Timeline,
  dayTime: (day: number) => Date,
  role: LifecycleRole,
  activationDay: number,
): void {
  const { random } = timeline;
  const span = LAST_EVENT_DAY - activationDay;
  if (span < 12) {
    return;
  }

  const churns = role === 'churn' || role === 'reactivate';
  const churnDay = activationDay + Math.floor(span * (0.45 + random() * 0.3));
  const growthCeiling = churns ? churnDay - 1 : LAST_EVENT_DAY;
  const bias: 'up' | 'down' | 'either' =
    role === 'expansion' ? 'up' : role === 'contraction' ? 'down' : 'either';

  let cursor = activationDay;
  const movementCount = movementCountForRole(random, role);
  for (let i = 0; i < movementCount; i += 1) {
    const day = cursor + intBetween(random, 18, 70);
    if (day > growthCeiling) {
      break;
    }
    playMovement(timeline, dayTime, day, bias);
    cursor = day;
  }

  if (!churns) {
    return;
  }

  const churnAt = Math.min(LAST_EVENT_DAY, churnDay + intBetween(random, 3, 30));
  if (churnAt < Math.max(cursor, activationDay)) {
    return;
  }
  applyMovement(timeline, 'churn', dayTime(churnAt), { mrrAfterCents: 0 });

  if (role !== 'reactivate') {
    return;
  }

  const returnDay = churnAt + intBetween(random, 12, 45);
  if (returnDay > LAST_EVENT_DAY) {
    return;
  }
  const floor = TIER_MONTHLY_CENTS[timeline.customer.tier];
  const restored = timeline.customer.previousMrrCents || floor;
  applyMovement(timeline, 'reactivation', dayTime(returnDay), {
    mrrAfterCents: Math.max(floor, Math.round(restored * (0.75 + random() * 0.45))),
  });
}

/* -------------------------------------------------------------------------- */
/*                                Seed assembly                              */
/* -------------------------------------------------------------------------- */

interface CustomerPlan {
  id: string;
  organizationName: string;
  email: string;
  tier: SubscriptionTier;
  billingInterval: BillingInterval;
  channel: AcquisitionChannel;
  countryCode: string;
  seatCount: number;
  apiCalls30d: number;
  createdDay: number;
  origin: 'direct' | 'trial';
  trialOutcome: TrialOutcome;
  role: LifecycleRole;
}

function uniqueOrganizationName(random: Random, used: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const name = `${pick(random, ORG_HEADS)} ${pick(random, ORG_TAILS)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // 450 name combinations against 65 customers, so this is unreachable; the
  // numeric suffix keeps the function total regardless.
  for (let suffix = 2; ; suffix += 1) {
    const name = `${pick(random, ORG_HEADS)} ${pick(random, ORG_TAILS)} ${suffix}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
}

function uniqueEmail(
  random: Random,
  organizationName: string,
  used: Set<string>,
): string {
  const domain = `${slugify(organizationName) || 'customer'}.example`;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate =
      `${pick(random, FIRST_NAMES)}.${pick(random, LAST_NAMES)}@${domain}`.toLowerCase();
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate =
      `${pick(random, FIRST_NAMES)}.${pick(random, LAST_NAMES)}${suffix}@${domain}`.toLowerCase();
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/**
 * Spreads the lifecycle mix across the paying book: ~15% churn (of which ~20%
 * come back), ~20% expansion, ~8% contraction, the remainder stable.
 *
 * Roles are assigned only to customers that reach a paying state, so the
 * percentages describe paying accounts rather than raw signups.
 */
function assignLifecycleRoles(random: Random, plans: readonly CustomerPlan[]): void {
  const paying = plans.filter(
    (plan) => plan.origin === 'direct' || plan.trialOutcome === 'convert',
  );
  const order = shuffled(random, paying);
  let cursor = 0;

  const assign = (fraction: number, role: LifecycleRole, limit?: number): void => {
    const count = Math.min(limit ?? order.length, Math.max(1, Math.round(order.length * fraction)));
    for (let i = 0; i < count && cursor < order.length; i += 1) {
      const plan = order[cursor];
      cursor += 1;
      if (plan !== undefined) {
        plan.role = role;
      }
    }
  };

  assign(0.15, 'reactivate', Math.max(1, Math.round(order.length * 0.03)));
  assign(0.15, 'churn', Math.max(1, Math.round(order.length * 0.15)));
  assign(0.2, 'expansion');
  assign(0.08, 'contraction');
  // Everything still unassigned stays 'stable'.
}

function buildPlans(random: Random): CustomerPlan[] {
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  const usedEmails = new Set<string>();

  // Day 0 is fully deterministic: the `all` growth baseline depends on it, and
  // these accounts must be paying at the end of the first seeded day.
  const dayZeroTiers: readonly SubscriptionTier[] = [
    'starter', 'pro', 'scale', 'enterprise', 'pro', 'starter',
    'scale', 'pro', 'starter', 'enterprise', 'pro', 'scale',
  ];

  // Roughly a quarter of the book arrives through a trial, chosen up front so
  // the selection is independent of the attribute draws below it.
  const postDayZero = shuffled(
    random,
    Array.from({ length: CUSTOMER_COUNT - DAY_ZERO_CUSTOMERS }, (_, i) => DAY_ZERO_CUSTOMERS + i),
  );
  const trialCount = Math.round((CUSTOMER_COUNT - DAY_ZERO_CUSTOMERS) * TRIAL_SHARE);
  const trialIndices = new Set(postDayZero.slice(0, trialCount));

  const plans: CustomerPlan[] = [];

  for (let index = 0; index < CUSTOMER_COUNT; index += 1) {
    const isDayZero = index < DAY_ZERO_CUSTOMERS;
    const createdDay = isDayZero ? 0 : intBetween(random, 1, LAST_EVENT_DAY - 1);

    const organizationName = uniqueOrganizationName(random, usedNames);
    const origin: 'direct' | 'trial' = isDayZero ? 'direct' : trialIndices.has(index) ? 'trial' : 'direct';

    let trialOutcome: TrialOutcome = 'pending';
    if (origin === 'trial') {
      const roll = random();
      trialOutcome =
        roll < TRIAL_CONVERSION_SHARE ? 'convert' : roll < TRIAL_CONVERSION_SHARE + 0.15 ? 'cancel' : 'pending';
    }

    const tier = isDayZero
      ? (dayZeroTiers[index] ?? 'pro')
      : weightedPick(random, TIER_WEIGHTS);

    plans.push({
      id: drawId(random, 'cus', usedIds),
      organizationName,
      email: uniqueEmail(random, organizationName, usedEmails),
      tier,
      billingInterval:
        random() < (tier === 'enterprise' ? 0.75 : 0.4) ? 'annual' : 'monthly',
      channel: weightedPick(random, CHANNEL_WEIGHTS),
      countryCode: pick(random, COUNTRY_CODES),
      seatCount: seatCountForTier(random, tier),
      apiCalls30d: intBetween(random, 0, 900_000),
      createdDay,
      origin,
      trialOutcome,
      role: 'stable',
    });
  }

  assignLifecycleRoles(random, plans);

  return plans;
}

function buildCustomer(plan: CustomerPlan, createdAt: string): CustomerRecord {
  return {
    id: plan.id,
    version: 1,
    organizationName: plan.organizationName,
    email: plan.email,
    tier: plan.tier,
    status: plan.origin === 'trial' ? 'trialing' : 'active',
    billingInterval: plan.billingInterval,
    mrrCents: 0,
    previousMrrCents: 0,
    channel: plan.channel,
    countryCode: plan.countryCode,
    seatCount: plan.seatCount,
    apiCalls30d: plan.apiCalls30d,
    cohortMonth: '',
    createdAt,
    updatedAt: createdAt,
    trialStartedAt: null,
    trialEndsAt: null,
    convertedAt: null,
    canceledAt: null,
  };
}

function simulateCustomer(
  plan: CustomerPlan,
  random: Random,
  dayTime: (day: number) => Date,
  dayStart: (day: number) => Date,
  nextEventId: () => string,
): Timeline {
  const customer = buildCustomer(plan, dayStart(plan.createdDay).toISOString());
  const timeline: Timeline = { customer, events: [], random, nextEventId, emitted: 0 };
  const mrrCents = baseMrrForPlan(random, plan.tier, plan.billingInterval);

  if (plan.origin === 'trial') {
    const startedAt = dayTime(plan.createdDay);
    const convertDay = plan.createdDay + TRIAL_DAYS;
    customer.trialStartedAt = startedAt.toISOString();
    customer.trialEndsAt = dayStart(convertDay).toISOString();
    applyMovement(timeline, 'trial_started', startedAt);

    if (plan.trialOutcome === 'pending' || convertDay > LAST_EVENT_DAY) {
      // Still inside (or beyond) the trial window on the as-of date.
      customer.updatedAt = startedAt.toISOString();
    } else if (plan.trialOutcome === 'cancel') {
      applyMovement(timeline, 'trial_canceled', dayTime(convertDay));
    } else {
      applyMovement(timeline, 'trial_converted', dayTime(convertDay));
      applyMovement(timeline, 'new_business', dayTime(convertDay), {
        mrrAfterCents: mrrCents,
        tier: plan.tier,
      });
      customer.convertedAt = timeline.events[timeline.events.length - 1]?.occurredAt ?? null;
      simulateLifecycle(timeline, dayTime, plan.role, convertDay);
    }
  } else {
    applyMovement(timeline, 'new_business', dayTime(plan.createdDay), {
      mrrAfterCents: mrrCents,
      tier: plan.tier,
    });
    simulateLifecycle(timeline, dayTime, plan.role, plan.createdDay);
  }

  const firstEvent = timeline.events[0];
  if (firstEvent !== undefined) {
    customer.createdAt = firstEvent.occurredAt;
  }
  customer.cohortMonth = toYearMonth(customer.createdAt);

  return timeline;
}

/**
 * Guarantees the trailing `7d` window carries real activity, so the shortest
 * preset never renders an empty chart or a zero churn rate.
 *
 * The threshold is the start of the first day fully inside the window, which
 * matches the `(start, end]` window definition used by the metrics layer.
 */
function ensureRecentActivity(
  customers: readonly CustomerRecord[],
  timelines: readonly Timeline[],
  dayStart: (day: number) => Date,
  dayTime: (day: number) => Date,
): void {
  const windowStart = dayStart(RECENT_DAY_START + 1).getTime();
  const countRecent = (): number =>
    timelines.reduce(
      (acc, timeline) =>
        acc + timeline.events.filter((event) => Date.parse(event.occurredAt) > windowStart).length,
      0,
    );

  if (countRecent() >= RECENT_EVENT_FLOOR) {
    return;
  }

  const movable = customers
    .map((customer, index) => ({ customer, index }))
    .filter(
      ({ customer }) =>
        customer.mrrCents > CONTRACTION_FLOOR_CENTS &&
        customer.status !== 'canceled' &&
        customer.status !== 'trialing',
    )
    .map(({ index }) => index);

  let slot = 0;
  let day = RECENT_DAY_START + 1;
  while (countRecent() < RECENT_EVENT_FLOOR && slot < movable.length) {
    const index = movable[slot];
    if (index === undefined) {
      break;
    }
    const timeline = timelines[index];
    if (timeline === undefined) {
      break;
    }
    if (day > LAST_EVENT_DAY) {
      day = RECENT_DAY_START + 1;
    }
    playMovement(timeline, dayTime, day, 'either');
    day += 1;
    slot += 1;
  }
}

/**
 * Marks a handful of healthy accounts as `past_due`. Status only: a past-due
 * account emits no event, so the ledger is untouched.
 */
function applyPastDueStatuses(customers: readonly CustomerRecord[]): void {
  let marked = 0;
  for (const customer of customers) {
    if (marked >= MAX_PAST_DUE) {
      return;
    }
    if (customer.status === 'active' && customer.mrrCents > 0) {
      customer.status = 'past_due';
      marked += 1;
    }
  }
}

/**
 * Builds a complete demo snapshot.
 *
 * @param now          Anchor instant; `asOf` becomes its UTC midnight.
 * @param seedConstant PRNG seed. The same pair always yields the same bytes.
 */
export function generateSeed(
  now: Date,
  seedConstant = 42,
): DashboardStateSnapshot {
  const random = mulberry32(seedConstant);
  const asOf = startOfUtcDay(now);
  const dayZeroTime = asOf.getTime() - HISTORY_DAYS * MS_PER_DAY;

  const dayStart = (day: number): Date => new Date(dayZeroTime + day * MS_PER_DAY);
  const dayTime = (day: number): Date =>
    new Date(dayStart(day).getTime() + Math.floor(random() * MS_PER_DAY));

  const usedEventIds = new Set<string>();
  const nextEventId = (): string => drawId(random, 'evt', usedEventIds);

  const timelines = buildPlans(random).map((plan) =>
    simulateCustomer(plan, random, dayTime, dayStart, nextEventId),
  );
  const customers = timelines.map((timeline) => timeline.customer);

  ensureRecentActivity(customers, timelines, dayStart, dayTime);
  applyPastDueStatuses(customers);

  const events = timelines
    .flatMap((timeline) => timeline.events)
    .sort((a, b) => {
      const delta = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    });

  customers.sort((a, b) => a.organizationName.localeCompare(b.organizationName));

  const snapshot: DashboardStateSnapshot = {
    schemaVersion: 1,
    revision: 1,
    asOf: asOf.toISOString(),
    updatedAt: now.toISOString(),
    customers,
    events,
  };

  assertLedgerInvariant(snapshot);

  return snapshot;
}