import type {
  AcquisitionChannel,
  CohortRetentionRow,
  DashboardFilterState,
  DashboardStateSnapshot,
  DateRangePreset,
  DerivedDailyMetric,
  KpiMetricKey,
  KpiResult,
  KpiSummary,
  SubscriptionTier,
} from '@/types/analytics';
import {
  MS_PER_DAY,
  addYearMonths,
  parseYearMonth,
  toDateKey,
  toYearMonth,
  utcDayDiff,
} from '@/lib/utils';

/**
 * Domain calculations.
 *
 * Every function takes `now` explicitly and never reads the clock, so a window
 * is reproducible in a test and identical on the server and the client. Nothing
 * here writes to storage either: the module reads a snapshot and derives.
 *
 * Time model, defined once and used by every metric:
 *  - `effectiveAsOf = max(snapshot.asOf, UTC midnight of now)`, in memory only
 *  - the window is `(start, end]`, where `end` is the last millisecond of the
 *    effective as-of day and `start` is the last millisecond of the day
 *    `windowDays` earlier
 *  - a customer's MRR at the end of a day is the sum of that customer's event
 *    deltas with `occurredAt` at or before that day's final millisecond
 */

export type { DateRangePreset };

/* -------------------------------------------------------------------------- */
/*                                Time window                                */
/* -------------------------------------------------------------------------- */

export interface ResolvedWindow {
  /** UTC midnight the dashboard is anchored to. */
  effectiveAsOfMs: number;
  /** `YYYY-MM-DD` of the effective as-of day. */
  effectiveAsOfDate: string;
  windowDays: number;
  /** Last millisecond of the day `windowDays` before the as-of day. */
  startDayEndMs: number;
  /** Last millisecond of the as-of day. */
  endDayEndMs: number;
  /** Start of the as-of day's successor: the exclusive upper bound. */
  endExclusiveMs: number;
  firstSeededDayMs: number;
  firstSeededDayDate: string;
  /** Start of the as-of day, minus `offset` days. */
  dayStartMs: (offset: number) => number;
  /** Last millisecond of the as-of day, minus `offset` days. */
  dayEndMs: (offset: number) => number;
}

function earliestEventMs(snapshot: DashboardStateSnapshot): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const event of snapshot.events) {
    const at = Date.parse(event.occurredAt);
    if (Number.isFinite(at) && at < earliest) {
      earliest = at;
    }
  }
  for (const customer of snapshot.customers) {
    const at = Date.parse(customer.createdAt);
    if (Number.isFinite(at) && at < earliest) {
      earliest = at;
    }
  }
  return earliest;
}

function resolvedWindowDays(dateRange: DateRangePreset, firstSeededDayMs: number, effectiveAsOfMs: number): number {
  switch (dateRange) {
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
    case '12m':
      return 365;
    case 'all':
      return Math.max(1, Math.round((effectiveAsOfMs - firstSeededDayMs) / MS_PER_DAY));
    default:
      return 30;
  }
}

/**
 * Anchors a filter preset onto the snapshot.
 *
 * `effectiveAsOf` takes the later of the snapshot's own anchor and UTC midnight
 * of `now`, so a snapshot written yesterday still reports today as the last
 * complete day rather than looking a day stale.
 */
export function resolveWindow(
  snapshot: DashboardStateSnapshot,
  dateRange: DateRangePreset,
  now: Date,
): ResolvedWindow {
  const snapshotAsOfMs = Date.parse(snapshot.asOf);
  const nowMidnight = now.getTime() - (((now.getTime() % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY);
  const effectiveAsOfMs = Number.isFinite(snapshotAsOfMs)
    ? Math.max(snapshotAsOfMs, nowMidnight)
    : nowMidnight;

  const earliest = earliestEventMs(snapshot);
  const firstSeededDayMs = Number.isFinite(earliest)
    ? earliest - (((earliest % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY)
    : effectiveAsOfMs;

  const windowDays = resolvedWindowDays(dateRange, firstSeededDayMs, effectiveAsOfMs);

  return {
    effectiveAsOfMs,
    effectiveAsOfDate: toDateKey(effectiveAsOfMs),
    windowDays,
    startDayEndMs: effectiveAsOfMs - windowDays * MS_PER_DAY + (MS_PER_DAY - 1),
    endDayEndMs: effectiveAsOfMs + (MS_PER_DAY - 1),
    endExclusiveMs: effectiveAsOfMs + MS_PER_DAY,
    firstSeededDayMs,
    firstSeededDayDate: toDateKey(firstSeededDayMs),
    dayStartMs: (offset) => effectiveAsOfMs - offset * MS_PER_DAY,
    dayEndMs: (offset) => effectiveAsOfMs - offset * MS_PER_DAY + (MS_PER_DAY - 1),
  };
}

/* -------------------------------------------------------------------------- */
/*                                   Filters                                 */
/* -------------------------------------------------------------------------- */

/**
 * Customers in scope for every metric, chart, cohort row and feed item.
 *
 * Tier and channel resolve against the customer's *current* values, which is why
 * historical events are attributed through `customerId` rather than through the
 * tier or channel recorded on the event.
 *
 * `searchQuery` is deliberately absent: it narrows the ledger and the customers
 * CSV only, never a KPI.
 */
export function filterCustomerIds(
  snapshot: DashboardStateSnapshot,
  filters: Pick<DashboardFilterState, 'tier' | 'channel'>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const customer of snapshot.customers) {
    if (filters.tier !== 'all' && customer.tier !== filters.tier) {
      continue;
    }
    if (filters.channel !== 'all' && customer.channel !== filters.channel) {
      continue;
    }
    ids.add(customer.id);
  }
  return ids;
}

/** Applies the ledger-only search term. */
export function matchesSearchQuery(
  customer: DashboardStateSnapshot['customers'][number],
  searchQuery: string,
): boolean {
  const query = searchQuery.trim().toLowerCase();
  if (query === '') {
    return true;
  }
  return (
    customer.organizationName.toLowerCase().includes(query) ||
    customer.email.toLowerCase().includes(query)
  );
}

/* -------------------------------------------------------------------------- */
/*                            Ledger reconstruction                           */
/* -------------------------------------------------------------------------- */

interface CustomerLedger {
  /** Ascending `(dayEndMs, mrr)` checkpoints; the last one at or before a day wins. */
  checkpoints: { at: number; mrr: number }[];
}

function buildLedgers(snapshot: DashboardStateSnapshot): Map<string, CustomerLedger> {
  const ledgers = new Map<string, CustomerLedger>();
  for (const customer of snapshot.customers) {
    ledgers.set(customer.id, { checkpoints: [] });
  }

  const running = new Map<string, number>();
  for (const customer of snapshot.customers) {
    running.set(customer.id, 0);
  }

  // Events arrive in chronological order in practice, but sorting keeps the
  // checkpoint list correct for any persisted ordering.
  const ordered = [...snapshot.events].sort((a, b) =>
    Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  );

  for (const event of ordered) {
    const ledger = ledgers.get(event.customerId);
    if (ledger === undefined) {
      // A snapshot whose events reference an unknown customer cannot be
      // reconstructed; validation rejects such payloads before we get here.
      continue;
    }
    const next = (running.get(event.customerId) ?? 0) + event.deltaMrrCents;
    running.set(event.customerId, next);

    const at = Date.parse(event.occurredAt);
    const last = ledger.checkpoints[ledger.checkpoints.length - 1];
    if (last !== undefined && last.at === at) {
      last.mrr = next;
    } else {
      ledger.checkpoints.push({ at, mrr: next });
    }
  }

  return ledgers;
}

/** MRR for `customerId` at the end of whichever day ends at `dayEndMs`. */
function mrrAt(
  ledgers: ReadonlyMap<string, CustomerLedger>,
  customerId: string,
  dayEndMs: number,
): number {
  const ledger = ledgers.get(customerId);
  if (ledger === undefined) {
    return 0;
  }
  let low = 0;
  let high = ledger.checkpoints.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const checkpoint = ledger.checkpoints[mid];
    if (checkpoint === undefined) {
      break;
    }
    if (checkpoint.at <= dayEndMs) {
      found = checkpoint.mrr;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** Summed MRR across `customerIds` at the end of the day ending `dayEndMs`. */
function totalMrrAt(
  ledgers: ReadonlyMap<string, CustomerLedger>,
  customerIds: Iterable<string>,
  dayEndMs: number,
): number {
  let total = 0;
  for (const id of customerIds) {
    total += mrrAt(ledgers, id, dayEndMs);
  }
  return total;
}

function activeCountAt(
  ledgers: ReadonlyMap<string, CustomerLedger>,
  customerIds: Iterable<string>,
  dayEndMs: number,
): number {
  let count = 0;
  for (const id of customerIds) {
    if (mrrAt(ledgers, id, dayEndMs) > 0) {
      count += 1;
    }
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/*                                 Daily series                              */
/* -------------------------------------------------------------------------- */

/**
 * One row per day in the window, derived from the event log alone.
 *
 * Contraction and churn are stored as positive magnitudes so every column reads
 * as "how much moved"; `netDeltaMrrCents` carries the signed arithmetic.
 */
export function dailyDerivedMetrics(
  snapshot: DashboardStateSnapshot,
  customerIds: ReadonlySet<string>,
  window: ResolvedWindow,
): DerivedDailyMetric[] {
  const ledgers = buildLedgers(snapshot);

  const flowsByDay = new Map<number, Omit<DerivedDailyMetric, 'date' | 'grossMrrCents' | 'activeSubscribers'>>();

  const bucketFor = (atMs: number): number => Math.floor(atMs / MS_PER_DAY);

  for (const event of snapshot.events) {
    if (!customerIds.has(event.customerId)) {
      continue;
    }
    const at = Date.parse(event.occurredAt);
    if (!Number.isFinite(at) || at <= window.startDayEndMs || at > window.endDayEndMs) {
      continue;
    }
    const key = bucketFor(at);
    let flow = flowsByDay.get(key);
    if (flow === undefined) {
      flow = {
        newMrrCents: 0,
        expansionMrrCents: 0,
        contractionMrrCents: 0,
        churnedMrrCents: 0,
        netDeltaMrrCents: 0,
      };
      flowsByDay.set(key, flow);
    }

    switch (event.type) {
      case 'new_business':
      case 'reactivation':
        flow.newMrrCents += event.deltaMrrCents;
        break;
      case 'expansion':
        flow.expansionMrrCents += event.deltaMrrCents;
        break;
      case 'contraction':
        flow.contractionMrrCents += Math.abs(event.deltaMrrCents);
        break;
      case 'churn':
        flow.churnedMrrCents += Math.abs(event.deltaMrrCents);
        break;
      default:
        // Trial movements carry no dollar delta by contract.
        break;
    }
    flow.netDeltaMrrCents += event.deltaMrrCents;
  }

  const rows: DerivedDailyMetric[] = [];
  for (let offset = window.windowDays - 1; offset >= 0; offset -= 1) {
    const dayEnd = window.dayEndMs(offset);
    const flow = flowsByDay.get(bucketFor(dayEnd)) ?? {
      newMrrCents: 0,
      expansionMrrCents: 0,
      contractionMrrCents: 0,
      churnedMrrCents: 0,
      netDeltaMrrCents: 0,
    };
    rows.push({
      date: toDateKey(dayEnd),
      grossMrrCents: totalMrrAt(ledgers, customerIds, dayEnd),
      ...flow,
      activeSubscribers: activeCountAt(ledgers, customerIds, dayEnd),
    });
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/*                                  Bucketing                                */
/* -------------------------------------------------------------------------- */

export type BucketMode = 'day' | 'week';

/**
 * Collapses a daily series into buckets.
 *
 * Flows add up inside a bucket; levels take the bucket's final value, because a
 * week's MRR is the MRR at the end of that week, not the sum of its days.
 * Buckets are aligned backwards from the last day so the most recent bucket is
 * complete.
 */
export function bucketSeries(
  series: readonly DerivedDailyMetric[],
  mode: BucketMode,
): DerivedDailyMetric[] {
  if (mode === 'day' || series.length === 0) {
    return [...series];
  }

  const size = 7;
  const buckets: DerivedDailyMetric[] = [];

  for (let end = series.length - 1; end >= 0; end -= size) {
    const start = Math.max(0, end - size + 1);
    const slice = series.slice(start, end + 1);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (first === undefined || last === undefined) {
      continue;
    }
    buckets.unshift({
      date: first.date,
      grossMrrCents: last.grossMrrCents,
      newMrrCents: slice.reduce((acc, row) => acc + row.newMrrCents, 0),
      expansionMrrCents: slice.reduce((acc, row) => acc + row.expansionMrrCents, 0),
      contractionMrrCents: slice.reduce((acc, row) => acc + row.contractionMrrCents, 0),
      churnedMrrCents: slice.reduce((acc, row) => acc + row.churnedMrrCents, 0),
      netDeltaMrrCents: slice.reduce((acc, row) => acc + row.netDeltaMrrCents, 0),
      activeSubscribers: last.activeSubscribers,
    });
  }

  return buckets;
}

/* -------------------------------------------------------------------------- */
/*                                KPI summaries                              */
/* -------------------------------------------------------------------------- */

interface WindowSummaryInput {
  snapshot: DashboardStateSnapshot;
  customerIds: ReadonlySet<string>;
  ledgers: ReadonlyMap<string, CustomerLedger>;
  /** Last millisecond of the window's first day. */
  startDayEndMs: number;
  /** Last millisecond of the window's final day. */
  endDayEndMs: number;
}

function netMrrNow(snapshot: DashboardStateSnapshot, customerIds: ReadonlySet<string>): number {
  let total = 0;
  for (const customer of snapshot.customers) {
    if (!customerIds.has(customer.id)) {
      continue;
    }
    if (customer.status === 'active' || customer.status === 'past_due') {
      total += customer.mrrCents;
    }
  }
  return total;
}

function payingCustomerCount(
  snapshot: DashboardStateSnapshot,
  customerIds: ReadonlySet<string>,
): number {
  let count = 0;
  for (const customer of snapshot.customers) {
    if (customerIds.has(customer.id) && (customer.status === 'active' || customer.status === 'past_due')) {
      count += 1;
    }
  }
  return count;
}

/**
 * NRR over `(startDayEndMs, endDayEndMs]`.
 *
 * The cohort is fixed at the *start* of the window: only accounts that were
 * already paying then are eligible, and only expansion, contraction and churn
 * move the number. A reactivation or a brand-new signup inside the window is
 * deliberately excluded — otherwise a busy acquisition month would flatter NRR.
 */
function netRevenueRetention(input: WindowSummaryInput): number | null {
  const { customerIds, ledgers, startDayEndMs, endDayEndMs } = input;

  let startMrr = 0;
  const cohort: string[] = [];
  for (const id of customerIds) {
    const value = mrrAt(ledgers, id, startDayEndMs);
    if (value > 0) {
      cohort.push(id);
      startMrr += value;
    }
  }
  if (startMrr === 0) {
    return null;
  }
  const cohortSet = new Set(cohort);

  let expansion = 0;
  let contraction = 0;
  let churn = 0;
  for (const event of input.snapshot.events) {
    if (!cohortSet.has(event.customerId)) {
      continue;
    }
    const at = Date.parse(event.occurredAt);
    if (!Number.isFinite(at) || at <= startDayEndMs || at > endDayEndMs) {
      continue;
    }
    switch (event.type) {
      case 'expansion':
        expansion += event.deltaMrrCents;
        break;
      case 'contraction':
        contraction += event.deltaMrrCents;
        break;
      case 'churn':
        churn += event.deltaMrrCents;
        break;
      default:
        break;
    }
  }

  return ((startMrr + expansion - contraction - churn) / startMrr) * 100;
}

function trialConversionRate(input: WindowSummaryInput): number | null {
  let converted = 0;
  let canceled = 0;
  for (const event of input.snapshot.events) {
    if (!input.customerIds.has(event.customerId)) {
      continue;
    }
    const at = Date.parse(event.occurredAt);
    if (!Number.isFinite(at) || at <= input.startDayEndMs || at > input.endDayEndMs) {
      continue;
    }
    if (event.type === 'trial_converted') {
      converted += 1;
    } else if (event.type === 'trial_canceled') {
      canceled += 1;
    }
  }
  const denominator = converted + canceled;
  return denominator === 0 ? null : (converted / denominator) * 100;
}

function logoChurnRate(input: WindowSummaryInput): { rate: number; churned: number } {
  const churnedCustomers = new Set<string>();
  const newCustomers = new Set<string>();

  for (const event of input.snapshot.events) {
    if (!input.customerIds.has(event.customerId)) {
      continue;
    }
    const at = Date.parse(event.occurredAt);
    if (!Number.isFinite(at) || at <= input.startDayEndMs || at > input.endDayEndMs) {
      continue;
    }
    if (event.type === 'churn') {
      churnedCustomers.add(event.customerId);
    } else if (event.type === 'new_business') {
      newCustomers.add(event.customerId);
    }
  }

  const subscribersAtStart = activeCountAt(
    input.ledgers,
    input.customerIds,
    input.startDayEndMs,
  );
  const denominator = Math.max(1, subscribersAtStart + newCustomers.size);
  return { rate: (churnedCustomers.size / denominator) * 100, churned: churnedCustomers.size };
}

function computeSummary(
  input: WindowSummaryInput,
  windowDays: number,
  baselineMrrCents: number,
): KpiSummary {
  const { snapshot, customerIds } = input;

  const netMrrCents = netMrrNow(snapshot, customerIds);
  const arrCents = netMrrCents * 12;
  const churn = logoChurnRate(input);
  const arpuCents = Math.round(netMrrCents / Math.max(1, payingCustomerCount(snapshot, customerIds)));

  // Monthly churn is implied from the window's logo churn, with a floor so a
  // churn-free window does not produce an infinite LTV.
  const monthlyRate = Math.min(0.99, churn.rate / 100);
  const monthlyChurn = Math.max(0.008, 1 - (1 - monthlyRate) ** (30 / Math.max(1, windowDays)));
  const estimatedLtvCents = Math.round(arpuCents / monthlyChurn);

  return {
    netMrrCents,
    mrrGrowthPercent:
      baselineMrrCents === 0 ? null : ((netMrrCents - baselineMrrCents) / baselineMrrCents) * 100,
    arrCents,
    netRevenueRetentionPercent: netRevenueRetention(input),
    logoChurnRatePercent: churn.rate,
    arpuCents,
    estimatedLtvCents,
    activeCustomersCount: activeCountAt(input.ledgers, customerIds, input.endDayEndMs),
    trialConversionRatePercent: trialConversionRate(input),
  };
}

/**
 * Current and previous KPI values for a filter state.
 *
 * The previous window is the equal-length span immediately before the current
 * one. It is absent for `all` — where "the previous 400 days" is mostly outside
 * the data — and whenever it would begin before the first seeded day.
 */
export function computeKpis(
  snapshot: DashboardStateSnapshot,
  filters: DashboardFilterState,
  now: Date,
): KpiResult {
  const customerIds = filterCustomerIds(snapshot, filters);
  const window = resolveWindow(snapshot, filters.dateRange, now);
  const ledgers = buildLedgers(snapshot);

  const baselineMrrCents = totalMrrAt(ledgers, customerIds, window.startDayEndMs);

  const current = computeSummary(
    {
      snapshot,
      customerIds,
      ledgers,
      startDayEndMs: window.startDayEndMs,
      endDayEndMs: window.endDayEndMs,
    },
    window.windowDays,
    baselineMrrCents,
  );

  if (filters.dateRange === 'all') {
    return { current, previous: null };
  }

  const previousFirstDayOffset = window.windowDays * 2 - 1;
  const previousStartDayEndMs = window.dayEndMs(previousFirstDayOffset);
  if (previousStartDayEndMs < window.firstSeededDayMs + (MS_PER_DAY - 1)) {
    return { current, previous: null };
  }

  const previous = computeSummary(
    {
      snapshot,
      customerIds,
      ledgers,
      startDayEndMs: previousStartDayEndMs,
      endDayEndMs: window.startDayEndMs,
    },
    window.windowDays,
    totalMrrAt(ledgers, customerIds, previousStartDayEndMs),
  );

  return { current, previous };
}

/* -------------------------------------------------------------------------- */
/*                                KPI series                                */
/* -------------------------------------------------------------------------- */

export interface SeriesPoint {
  /** UTC `YYYY-MM-DD` bucket key. */
  date: string;
  value: number;
}

/**
 * Sparkline series for a KPI card.
 *
 * Level metrics (MRR, ARR) sample the reconstructed ledger daily; rate metrics
 * need a window of their own to be meaningful, so they sample on a coarser
 * cadence. Churn buckets weekly on a long window and daily on a short one —
 * a 7-day window bucketed weekly would leave the sparkline with a single point.
 */
export function kpiSeries(
  snapshot: DashboardStateSnapshot,
  filters: DashboardFilterState,
  now: Date,
  metric: KpiMetricKey,
): SeriesPoint[] {
  const customerIds = filterCustomerIds(snapshot, filters);
  const window = resolveWindow(snapshot, filters.dateRange, now);

  if (metric === 'netMrr' || metric === 'arr') {
    const multiplier = metric === 'arr' ? 12 : 1;
    return dailyDerivedMetrics(snapshot, customerIds, window).map((row) => ({
      date: row.date,
      value: row.grossMrrCents * multiplier,
    }));
  }

  if (metric === 'logoChurn') {
    const step = window.windowDays <= 30 ? 1 : 7;
    const points: SeriesPoint[] = [];
    for (let offset = window.windowDays - 1; offset >= 0; offset -= step) {
      const endMs = window.dayEndMs(offset);
      const startMs = offset - step + 1 >= 0 ? window.dayEndMs(offset - step + 1) : window.firstSeededDayMs - 1;
      let churned = 0;
      for (const event of snapshot.events) {
        if (!customerIds.has(event.customerId) || event.type !== 'churn') {
          continue;
        }
        const at = Date.parse(event.occurredAt);
        if (Number.isFinite(at) && at > startMs && at <= endMs) {
          churned += 1;
        }
      }
      points.push({ date: toDateKey(endMs), value: churned });
    }
    return points;
  }

  // NRR is only defined over a window, so the series samples trailing 30-day
  // NRR on a weekly cadence, with at least four points to draw a line.
  const targetPoints = Math.max(4, Math.ceil(window.windowDays / 7));
  const step = Math.max(1, Math.floor(window.windowDays / targetPoints));
  const ledgers = buildLedgers(snapshot);
  const points: SeriesPoint[] = [];

  for (let offset = window.windowDays - 1; offset >= 0; offset -= step) {
    const endMs = window.dayEndMs(offset);
    const startMs =
      offset >= 30 ? window.dayEndMs(offset - 30) : window.firstSeededDayMs - 1;
    if (startMs >= endMs) {
      continue;
    }
    const value = netRevenueRetention({
      snapshot,
      customerIds,
      ledgers,
      startDayEndMs: startMs,
      endDayEndMs: endMs,
    });
    points.push({ date: toDateKey(endMs), value: value ?? 0 });
  }

  return points;
}

/* -------------------------------------------------------------------------- */
/*                                   Cohorts                                 */
/* -------------------------------------------------------------------------- */

/** Number of retention columns: M0 through M5. */
export const COHORT_MONTHS = 6;

function monthEndMs(yearMonth: string): number {
  const start = parseYearMonth(yearMonth);
  if (start === null) {
    return 0;
  }
  return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) - 1;
}

/**
 * Logo retention for the last six UTC calendar months, including the current one.
 *
 * `initialMrrCents` sums each cohort member's *first* `new_business` delta
 * wherever it happened, so a trial that converted is counted at the value it
 * actually converted to rather than being written off as a trial.
 */
export function computeCohorts(
  snapshot: DashboardStateSnapshot,
  filters: Pick<DashboardFilterState, 'tier' | 'channel'>,
  now: Date,
): CohortRetentionRow[] {
  const customerIds = filterCustomerIds(snapshot, filters);
  const window = resolveWindow(snapshot, 'all', now);
  const currentMonth = toYearMonth(window.effectiveAsOfMs);

  const months: string[] = [];
  for (let k = COHORT_MONTHS - 1; k >= 0; k -= 1) {
    months.push(addYearMonths(currentMonth, -k));
  }

  const firstNewBusiness = new Map<string, number>();
  for (const event of snapshot.events) {
    if (event.type !== 'new_business') {
      continue;
    }
    if (!firstNewBusiness.has(event.customerId)) {
      firstNewBusiness.set(event.customerId, event.deltaMrrCents);
    }
  }

  const eventsByCustomer = new Map<string, { churnedAt: number }[]>();
  for (const event of snapshot.events) {
    if (event.type !== 'churn' && event.type !== 'trial_canceled') {
      continue;
    }
    const list = eventsByCustomer.get(event.customerId);
    const at = Date.parse(event.occurredAt);
    if (list === undefined) {
      eventsByCustomer.set(event.customerId, [{ churnedAt: at }]);
    } else {
      list.push({ churnedAt: at });
    }
  }

  const cohorts = new Map<string, string[]>();
  for (const customer of snapshot.customers) {
    if (!customerIds.has(customer.id)) {
      continue;
    }
    const month = toYearMonth(customer.createdAt);
    const list = cohorts.get(month);
    if (list === undefined) {
      cohorts.set(month, [customer.id]);
    } else {
      list.push(customer.id);
    }
  }

  const idByCustomer = new Map(snapshot.customers.map((customer) => [customer.id, customer]));

  return months.map((cohortMonth) => {
    const members = cohorts.get(cohortMonth) ?? [];
    const initialMrrCents = members.reduce(
      (acc, id) => acc + (firstNewBusiness.get(id) ?? 0),
      0,
    );
    const currentMrrCents = members.reduce(
      (acc, id) => acc + (idByCustomer.get(id)?.mrrCents ?? 0),
      0,
    );

    const retentionByMonth: (number | null)[] = [];

    for (let column = 0; column < COHORT_MONTHS; column += 1) {
      if (column === 0) {
        // M0 is the cohort as it was signed: every member is retained by
        // definition, whatever happens later in the same calendar month.
        retentionByMonth.push(100);
        continue;
      }

      const targetMonth = addYearMonths(cohortMonth, column);
      if (targetMonth > currentMonth) {
        // The month has not finished yet, so there is nothing to measure.
        retentionByMonth.push(null);
        continue;
      }

      const boundary = monthEndMs(targetMonth);
      let retained = 0;
      for (const id of members) {
        const history = eventsByCustomer.get(id);
        const churnedAt =
          history === undefined
            ? Number.NEGATIVE_INFINITY
            : history.reduce(
                (latest, entry) => (entry.churnedAt > latest ? entry.churnedAt : latest),
                Number.NEGATIVE_INFINITY,
              );
        if (churnedAt > boundary) {
          retained += 1;
        }
      }
      retentionByMonth.push(members.length === 0 ? 0 : (retained / members.length) * 100);
    }

    return {
      id: `cohort_${cohortMonth}`,
      cohortMonth,
      initialCustomers: members.length,
      initialMrrCents,
      retentionByMonth,
      netDollarRetentionPercent:
        initialMrrCents === 0 ? null : (currentMrrCents / initialMrrCents) * 100,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                              Distribution rollups                         */
/* -------------------------------------------------------------------------- */

export interface DistributionSlice {
  id: string;
  label: string;
  valueCents: number;
  customers: number;
}

export function mrrByTier(
  snapshot: DashboardStateSnapshot,
  customerIds: ReadonlySet<string>,
  labels: Readonly<Record<SubscriptionTier, string>>,
): DistributionSlice[] {
  const totals = new Map<SubscriptionTier, { cents: number; customers: number }>();
  for (const tier of Object.keys(labels) as SubscriptionTier[]) {
    totals.set(tier, { cents: 0, customers: 0 });
  }
  for (const customer of snapshot.customers) {
    if (!customerIds.has(customer.id)) {
      continue;
    }
    if (customer.status !== 'active' && customer.status !== 'past_due') {
      continue;
    }
    const entry = totals.get(customer.tier);
    if (entry === undefined) {
      continue;
    }
    entry.cents += customer.mrrCents;
    entry.customers += 1;
  }
  return [...totals.entries()].map(([tier, entry]) => ({
    id: tier,
    label: labels[tier],
    valueCents: entry.cents,
    customers: entry.customers,
  }));
}

export function mrrByChannel(
  snapshot: DashboardStateSnapshot,
  customerIds: ReadonlySet<string>,
  labels: Readonly<Record<AcquisitionChannel, string>>,
): DistributionSlice[] {
  const totals = new Map<AcquisitionChannel, { cents: number; customers: number }>();
  for (const channel of Object.keys(labels) as AcquisitionChannel[]) {
    totals.set(channel, { cents: 0, customers: 0 });
  }
  for (const customer of snapshot.customers) {
    if (!customerIds.has(customer.id)) {
      continue;
    }
    if (customer.status !== 'active' && customer.status !== 'past_due') {
      continue;
    }
    const entry = totals.get(customer.channel);
    if (entry === undefined) {
      continue;
    }
    entry.cents += customer.mrrCents;
    entry.customers += 1;
  }
  return [...totals.entries()].map(([channel, entry]) => ({
    id: channel,
    label: labels[channel],
    valueCents: entry.cents,
    customers: entry.customers,
  }));
}

/* -------------------------------------------------------------------------- */
/*                            Ledger sorting + search                        */
/* -------------------------------------------------------------------------- */

export type SortField = DashboardFilterState['sortField'];
export type SortDirection = DashboardFilterState['sortDirection'];

/**
 * Sorts and searches the customer ledger.
 *
 * Sorting falls back to the customer id so the order is total: two accounts with
 * the same MRR must not swap places between renders.
 */
export function selectLedgerCustomers(
  snapshot: DashboardStateSnapshot,
  filters: DashboardFilterState,
): DashboardStateSnapshot['customers'] {
  const customerIds = filterCustomerIds(snapshot, filters);
  const direction = filters.sortDirection === 'asc' ? 1 : -1;

  const rows = snapshot.customers.filter(
    (customer) => customerIds.has(customer.id) && matchesSearchQuery(customer, filters.searchQuery),
  );

  rows.sort((a, b) => {
    let delta = 0;
    switch (filters.sortField) {
      case 'organizationName':
        delta = a.organizationName.localeCompare(b.organizationName);
        break;
      case 'mrrCents':
        delta = a.mrrCents - b.mrrCents;
        break;
      case 'createdAt':
        delta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
        break;
      case 'status':
        delta = a.status.localeCompare(b.status);
        break;
      default:
        delta = 0;
    }
    if (delta === 0) {
      return a.id.localeCompare(b.id);
    }
    return delta * direction;
  });

  return rows;
}

/* -------------------------------------------------------------------------- */
/*                                  Utilities                                */
/* -------------------------------------------------------------------------- */

/** Whole days between the first seeded day and the effective as-of day. */
export function totalSeededDays(snapshot: DashboardStateSnapshot, now: Date): number {
  const window = resolveWindow(snapshot, 'all', now);
  return Math.max(1, utcDayDiff(window.firstSeededDayMs, window.effectiveAsOfMs));
}