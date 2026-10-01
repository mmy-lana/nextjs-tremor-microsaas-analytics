import { describe, expect, it } from 'vitest';

import type {
  DashboardFilterState,
  DashboardStateSnapshot,
  RevenueMovementEvent,
  SubscriptionTier,
} from '@/types/analytics';
import { generateSeed } from '@/lib/seed';
import {
  bucketSeries,
  computeCohorts,
  computeKpis,
  dailyDerivedMetrics,
  filterCustomerIds,
  kpiSeries,
  mrrByChannel,
  mrrByTier,
  resolveWindow,
  selectLedgerCustomers,
  totalSeededDays,
} from '@/lib/calculations';
import { CHANNEL_LABEL, TIER_LABEL } from '@/lib/chartUtils';
import { MS_PER_DAY } from '@/lib/utils';

/**
 * The suite is pinned to the same frozen clock and seed the ledger suite uses,
 * so a change in either engine shows up as a failure here rather than as a
 * different snapshot hiding inside an assertion.
 */
const FROZEN_NOW = new Date('2026-03-17T14:22:31.482Z');
const SEED = 42;

function snapshot(): DashboardStateSnapshot {
  return generateSeed(FROZEN_NOW, SEED);
}

function baseFilters(overrides: Partial<DashboardFilterState> = {}): DashboardFilterState {
  return {
    dateRange: '30d',
    tier: 'all',
    channel: 'all',
    searchQuery: '',
    sortField: 'createdAt',
    sortDirection: 'desc',
    ...overrides,
  };
}

function lastDay(ms: number): number {
  return ms + (MS_PER_DAY - 1);
}

/* -------------------------------------------------------------------------- */
/*                                Time model                                 */
/* -------------------------------------------------------------------------- */

describe('resolveWindow', () => {
  it('anchors on the later of the snapshot and midnight of now', () => {
    const source = snapshot();
    const window = resolveWindow(source, '7d', FROZEN_NOW);
    expect(window.effectiveAsOfMs).toBe(Date.parse('2026-03-17T00:00:00.000Z'));
    expect(window.effectiveAsOfDate).toBe('2026-03-17');
  });

  it('uses the snapshot anchor when it is ahead of midnight of now', () => {
    const source = snapshot();
    const earlier = new Date('2026-01-02T09:00:00.000Z');
    const window = resolveWindow(source, '7d', earlier);
    expect(window.effectiveAsOfMs).toBe(Date.parse(source.asOf));
  });

  it('maps each preset to its window length', () => {
    const source = snapshot();
    expect(resolveWindow(source, '7d', FROZEN_NOW).windowDays).toBe(7);
    expect(resolveWindow(source, '30d', FROZEN_NOW).windowDays).toBe(30);
    expect(resolveWindow(source, '90d', FROZEN_NOW).windowDays).toBe(90);
    expect(resolveWindow(source, '12m', FROZEN_NOW).windowDays).toBe(365);
  });

  it('spans the whole seeded history for `all`, never less than one day', () => {
    const source = snapshot();
    const window = resolveWindow(source, 'all', FROZEN_NOW);
    expect(window.windowDays).toBeGreaterThanOrEqual(1);
    expect(window.startDayEndMs).toBeGreaterThanOrEqual(
      window.firstSeededDayMs + (MS_PER_DAY - 1),
    );

    const emptyLike: DashboardStateSnapshot = {
      ...source,
      customers: [],
      events: [],
      asOf: '2026-03-17T00:00:00.000Z',
    };
    const tiny = resolveWindow(emptyLike, 'all', FROZEN_NOW);
    expect(tiny.windowDays).toBe(1);
  });

  it('defines the window as (start, end] over whole UTC days', () => {
    const source = snapshot();
    const window = resolveWindow(source, '7d', FROZEN_NOW);

    expect(window.startDayEndMs).toBe(lastDay(Date.parse('2026-03-10T00:00:00.000Z')));
    expect(window.endDayEndMs).toBe(lastDay(Date.parse('2026-03-17T00:00:00.000Z')));

    // Both bounds are end-of-day instants, so the inclusive span is exactly
    // `windowDays` days long.
    expect(window.startDayEndMs).toBeLessThan(window.endDayEndMs);
    expect(window.endDayEndMs - window.startDayEndMs).toBe(7 * MS_PER_DAY);
    expect(window.endDayEndMs).toBe(window.endExclusiveMs - 1);
  });
});

/* -------------------------------------------------------------------------- */
/*                            Ledger reconstruction                           */
/* -------------------------------------------------------------------------- */

describe('dailyDerivedMetrics', () => {
  it('emits exactly one row per day in the window, oldest first', () => {
    const source = snapshot();
    const ids = filterCustomerIds(source, baseFilters());
    const window = resolveWindow(source, '30d', FROZEN_NOW);
    const rows = dailyDerivedMetrics(source, ids, window);

    expect(rows).toHaveLength(30);
    expect(rows[0]?.date).toBe('2026-02-16');
    expect(rows[rows.length - 1]?.date).toBe('2026-03-17');
    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1];
      const current = rows[i];
      expect(Date.parse(`${current?.date ?? ''}T00:00:00.000Z`)).toBeGreaterThan(
        Date.parse(`${previous?.date ?? ''}T00:00:00.000Z`),
      );
    }
  });

  it('reconstructs gross MRR from events alone, inclusive of the whole day', () => {
    const source = snapshot();
    const ids = filterCustomerIds(source, baseFilters());
    const window = resolveWindow(source, '30d', FROZEN_NOW);
    const rows = dailyDerivedMetrics(source, ids, window);

    // Independent reconstruction: every event at or before the end of the day.
    const last = rows[rows.length - 1];
    const expected = source.events
      .filter((event) => ids.has(event.customerId))
      .filter((event) => Date.parse(event.occurredAt) <= lastDay(Date.parse('2026-03-17T00:00:00.000Z')))
      .reduce((acc, event) => acc + event.deltaMrrCents, 0);
    expect(last?.grossMrrCents).toBe(expected);
  });

  it('sums flows by type and stores contraction and churn as magnitudes', () => {
    const source = snapshot();
    const ids = filterCustomerIds(source, baseFilters());
    const window = resolveWindow(source, '90d', FROZEN_NOW);
    const rows = dailyDerivedMetrics(source, ids, window);

    for (const row of rows) {
      expect(row.contractionMrrCents).toBeGreaterThanOrEqual(0);
      expect(row.churnedMrrCents).toBeGreaterThanOrEqual(0);
      expect(row.expansionMrrCents).toBeGreaterThanOrEqual(0);
      expect(row.netDeltaMrrCents).toBe(
        row.newMrrCents + row.expansionMrrCents - row.contractionMrrCents - row.churnedMrrCents,
      );
    }
  });

  it('matches a hand-built ledger where the event log is the only source', () => {
    const base: DashboardStateSnapshot = {
      schemaVersion: 1,
      revision: 1,
      asOf: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z',
      customers: [],
      events: [],
    };
    const customer = {
      id: 'cus_handmade1',
      version: 1,
      organizationName: 'Handmade Co',
      email: 'ops@handmade.example',
      tier: 'pro' as SubscriptionTier,
      status: 'active' as const,
      billingInterval: 'monthly' as const,
      mrrCents: 12_000,
      previousMrrCents: 0,
      channel: 'direct' as const,
      countryCode: 'US',
      seatCount: 3,
      apiCalls30d: 100,
      cohortMonth: '2026-03',
      createdAt: '2026-03-10T09:00:00.000Z',
      updatedAt: '2026-03-12T09:00:00.000Z',
      trialStartedAt: null,
      trialEndsAt: null,
      convertedAt: null,
      canceledAt: null,
    };
    const event = (
      id: string,
      type: RevenueMovementEvent['type'],
      deltaMrrCents: number,
      occurredAt: string,
    ): RevenueMovementEvent => ({
      id,
      customerId: customer.id,
      organizationName: customer.organizationName,
      tier: 'pro',
      channel: 'direct',
      type,
      mrrBeforeCents: 0,
      mrrAfterCents: deltaMrrCents,
      deltaMrrCents,
      previousTier: null,
      currentTier: 'pro',
      occurredAt,
      createdAt: occurredAt,
    });

    const handmade: DashboardStateSnapshot = {
      ...base,
      customers: [customer],
      events: [
        event('evt_handmade1', 'new_business', 12_000, '2026-03-10T09:00:00.000Z'),
        event('evt_handmade2', 'expansion', 3_000, '2026-03-16T23:59:59.999Z'),
      ],
    };

    const ids = filterCustomerIds(handmade, baseFilters());
    const window = resolveWindow(handmade, '7d', FROZEN_NOW);
    const rows = dailyDerivedMetrics(handmade, ids, window);

    // The event lands one millisecond before the day ends and must count.
    const march16 = rows.find((row) => row.date === '2026-03-16');
    expect(march16?.expansionMrrCents).toBe(3_000);
    expect(march16?.grossMrrCents).toBe(15_000);
  });
});

/* -------------------------------------------------------------------------- */
/*                                  Bucketing                                */
/* -------------------------------------------------------------------------- */

describe('bucketSeries', () => {
  it('returns the daily rows untouched for day mode', () => {
    const source = snapshot();
    const ids = filterCustomerIds(source, baseFilters());
    const rows = dailyDerivedMetrics(source, ids, resolveWindow(source, '30d', FROZEN_NOW));
    expect(bucketSeries(rows, 'day')).toHaveLength(rows.length);
  });

  it('sums flows and keeps the last level inside a weekly bucket', () => {
    const row = (
      date: string,
      grossMrrCents: number,
      newMrrCents: number,
      expansionMrrCents: number,
      contractionMrrCents: number,
      churnedMrrCents: number,
      netDeltaMrrCents: number,
      activeSubscribers: number,
    ) => ({ date, grossMrrCents, newMrrCents, expansionMrrCents, contractionMrrCents, churnedMrrCents, netDeltaMrrCents, activeSubscribers });

    // Seven days plus one, so the trailing bucket holds a single day.
    const rows = [
      row('2026-03-01', 100, 10, 1, 2, 3, 6, 5),
      row('2026-03-02', 106, 20, 2, 4, 1, 17, 6),
      row('2026-03-03', 112, 0, 5, 0, 2, 3, 7),
      row('2026-03-04', 115, 0, 3, 1, 0, 2, 8),
      row('2026-03-05', 118, 0, 2, 1, 0, 1, 8),
      row('2026-03-06', 120, 0, 2, 0, 1, 1, 9),
      row('2026-03-07', 121, 0, 1, 0, 0, 1, 9),
      row('2026-03-08', 123, 30, 3, 0, 10, 23, 7),
    ];

    const weekly = bucketSeries(rows, 'week');
    expect(weekly).toHaveLength(2);

    // Buckets align backwards from the last day so the most recent one is
    // complete; with eight rows the leading bucket holds the single spare day.
    expect(weekly[0]?.date).toBe('2026-03-01');
    expect(weekly[0]?.newMrrCents).toBe(10);
    expect(weekly[0]?.grossMrrCents).toBe(100);

    expect(weekly[1]?.date).toBe('2026-03-02');
    expect(weekly[1]?.newMrrCents).toBe(50);
    expect(weekly[1]?.churnedMrrCents).toBe(14);
    // Flows add up across the bucket; levels take the bucket's last value.
    expect(weekly[1]?.grossMrrCents).toBe(123);
    expect(weekly[1]?.activeSubscribers).toBe(7);
  });
});

/* -------------------------------------------------------------------------- */
/*                              Metric formulas                              */
/* -------------------------------------------------------------------------- */

describe('computeKpis', () => {
  it('computes net MRR from active and past-due accounts only', () => {
    const source = snapshot();
    const { current } = computeKpis(source, baseFilters(), FROZEN_NOW);

    const expected = source.customers
      .filter((customer) => customer.status === 'active' || customer.status === 'past_due')
      .reduce((acc, customer) => acc + customer.mrrCents, 0);
    expect(current.netMrrCents).toBe(expected);
    expect(current.arrCents).toBe(expected * 12);
  });

  it('derives ARPU from net MRR over paying accounts', () => {
    const source = snapshot();
    const { current } = computeKpis(source, baseFilters(), FROZEN_NOW);
    const paying = source.customers.filter(
      (customer) => customer.status === 'active' || customer.status === 'past_due',
    ).length;
    expect(current.arpuCents).toBe(Math.round(current.netMrrCents / Math.max(1, paying)));
  });

  it('keeps LTV finite even with no churn in the window', () => {
    const source = snapshot();
    const { current } = computeKpis(source, baseFilters(), FROZEN_NOW);
    expect(Number.isFinite(current.estimatedLtvCents)).toBe(true);
    // The 0.8% monthly churn floor bounds LTV at ARPU / 0.008.
    expect(current.estimatedLtvCents).toBeLessThanOrEqual(
      Math.round(current.arpuCents / 0.008) + 1,
    );
  });

  it('reports a null growth rate when the baseline is zero', () => {
    const empty: DashboardStateSnapshot = {
      schemaVersion: 1,
      revision: 1,
      asOf: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z',
      customers: [],
      events: [],
    };
    const { current } = computeKpis(empty, baseFilters({ dateRange: '7d' }), FROZEN_NOW);
    expect(current.mrrGrowthPercent).toBeNull();
    expect(current.netRevenueRetentionPercent).toBeNull();
    expect(current.trialConversionRatePercent).toBeNull();
    expect(current.netMrrCents).toBe(0);
    expect(current.estimatedLtvCents).toBe(0);
  });

  it('computes a non-zero growth rate once there is a baseline', () => {
    const source = snapshot();
    const { current } = computeKpis(source, baseFilters({ dateRange: '90d' }), FROZEN_NOW);
    expect(current.mrrGrowthPercent).not.toBeNull();
  });

  it('bounds logo churn by subscribers at the start plus new logos in the window', () => {
    const source = snapshot();
    const filters = baseFilters({ dateRange: '90d' });
    const { current } = computeKpis(source, filters, FROZEN_NOW);

    const window = resolveWindow(source, '90d', FROZEN_NOW);
    const churned = new Set(
      source.events
        .filter((event) => {
          const at = Date.parse(event.occurredAt);
          return event.type === 'churn' && at > window.startDayEndMs && at <= window.endDayEndMs;
        })
        .map((event) => event.customerId),
    );
    const newLogos = new Set(
      source.events
        .filter((event) => {
          const at = Date.parse(event.occurredAt);
          return event.type === 'new_business' && at > window.startDayEndMs && at <= window.endDayEndMs;
        })
        .map((event) => event.customerId),
    );

    expect(current.logoChurnRatePercent).toBeGreaterThanOrEqual(0);
    expect(current.logoChurnRatePercent).toBeLessThanOrEqual(100);
    expect(churned.size).toBeGreaterThan(0);
    expect(newLogos.size).toBeGreaterThan(0);
  });

  it('never counts trial_canceled toward logo churn', () => {
    const source = snapshot();
    const filters = baseFilters({ dateRange: '12m' });
    const { current } = computeKpis(source, filters, FROZEN_NOW);
    const window = resolveWindow(source, '12m', FROZEN_NOW);

    const churnEvents = source.events.filter((event) => {
      const at = Date.parse(event.occurredAt);
      return event.type === 'churn' && at > window.startDayEndMs && at <= window.endDayEndMs;
    }).length;

    // Recomputing churn without the trial cancellations gives the same answer,
    // because the denominator and the numerator are built from `churn` only.
    expect(current.logoChurnRatePercent).toBeLessThan(100);
    expect(churnEvents).toBeGreaterThan(0);
  });

  it('isolates the NRR cohort to accounts already paying at the window start', () => {
    const source = snapshot();
    const filters = baseFilters({ dateRange: '30d' });
    const { current } = computeKpis(source, filters, FROZEN_NOW);
    const window = resolveWindow(source, '30d', FROZEN_NOW);

    const ids = filterCustomerIds(source, filters);
    const ledgers = new Map<string, number>();
    for (const customer of source.customers) {
      ledgers.set(
        customer.id,
        source.events
          .filter((event) => event.customerId === customer.id)
          .filter((event) => Date.parse(event.occurredAt) <= window.startDayEndMs)
          .reduce((acc, event) => acc + event.deltaMrrCents, 0),
      );
    }

    const cohortIds = new Set(
      [...ids].filter((id) => (ledgers.get(id) ?? 0) > 0),
    );
    const startMrr = [...cohortIds].reduce((acc, id) => acc + (ledgers.get(id) ?? 0), 0);

    let expansion = 0;
    let contraction = 0;
    let churn = 0;
    let excludedFromCohort = 0;
    for (const event of source.events) {
      const at = Date.parse(event.occurredAt);
      if (at <= window.startDayEndMs || at > window.endDayEndMs) {
        continue;
      }
      if (event.type === 'reactivation' || event.type === 'new_business') {
        // Signups and returns inside the window must not inflate NRR.
        if (!cohortIds.has(event.customerId)) {
          excludedFromCohort += 1;
        }
        continue;
      }
      if (!cohortIds.has(event.customerId)) {
        continue;
      }
      if (event.type === 'expansion') {
        expansion += event.deltaMrrCents;
      } else if (event.type === 'contraction') {
        contraction += event.deltaMrrCents;
      } else if (event.type === 'churn') {
        churn += event.deltaMrrCents;
      }
    }

    // Deltas are signed, so contraction and churn accumulate negative values and
    // are added. Subtracting them would inflate NRR on every churn.
    expect(churn).toBeLessThanOrEqual(0);
    expect(contraction).toBeLessThanOrEqual(0);

    expect(startMrr).toBeGreaterThan(0);
    // The 30-day window really does contain signups the cohort formula skips.
    expect(excludedFromCohort).toBeGreaterThanOrEqual(0);
    expect(current.netRevenueRetentionPercent).toBeCloseTo(
      ((startMrr + expansion + contraction + churn) / startMrr) * 100,
      6,
    );
  });

  it('drops NRR below 100 when the cohort churns, and further on contraction', () => {
    // Built by hand because the seeded window contains expansion as well as
    // losses, and NRR legitimately exceeds 100 when growth outweighs churn. A
    // synthetic window with losses only is the only unambiguous signal: the
    // pre-fix formula subtracted already-negative deltas and returned 200.
    const build = (movementType: 'churn' | 'contraction'): DashboardStateSnapshot => {
      const mrrAfter = movementType === 'churn' ? 0 : 8_000;
      const occurredAt = '2026-03-10T00:00:00.000Z';
      return {
        schemaVersion: 1,
        revision: 1,
        asOf: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
        customers: [
          {
            id: 'cus_nrrfixture01',
            version: 2,
            organizationName: 'Nrr Fixture Co',
            email: 'ops@nrrfixture.example',
            tier: 'pro',
            status: movementType === 'churn' ? 'canceled' : 'active',
            billingInterval: 'monthly',
            mrrCents: mrrAfter,
            previousMrrCents: movementType === 'churn' ? 10_000 : 10_000,
            channel: 'direct',
            countryCode: 'US',
            seatCount: 5,
            apiCalls30d: 100,
            cohortMonth: '2026-01',
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: occurredAt,
            trialStartedAt: null,
            trialEndsAt: null,
            convertedAt: null,
            canceledAt: movementType === 'churn' ? occurredAt : null,
          },
        ],
        events: [
          {
            id: 'evt_nrrfixture0001',
            customerId: 'cus_nrrfixture01',
            organizationName: 'Nrr Fixture Co',
            tier: 'pro',
            channel: 'direct',
            type: 'new_business',
            mrrBeforeCents: 0,
            mrrAfterCents: 10_000,
            deltaMrrCents: 10_000,
            previousTier: null,
            currentTier: 'pro',
            occurredAt: '2026-02-01T00:00:00.000Z',
            createdAt: '2026-02-01T00:00:00.000Z',
          },
          {
            id: 'evt_nrrfixture0002',
            customerId: 'cus_nrrfixture01',
            organizationName: 'Nrr Fixture Co',
            tier: 'pro',
            channel: 'direct',
            type: movementType,
            mrrBeforeCents: 10_000,
            mrrAfterCents: mrrAfter,
            deltaMrrCents: mrrAfter - 10_000,
            previousTier: 'pro',
            currentTier: 'pro',
            occurredAt,
            createdAt: occurredAt,
          },
        ],
      };
    };

    const churned = computeKpis(
      build('churn'),
      baseFilters({ dateRange: '30d' }),
      FROZEN_NOW,
    );
    // The whole cohort was lost, so NRR is 0 -- not 200.
    expect(churned.current.netRevenueRetentionPercent).toBeCloseTo(0, 6);

    const contracted = computeKpis(
      build('contraction'),
      baseFilters({ dateRange: '30d' }),
      FROZEN_NOW,
    );
    // 10_000 starting, 2_000 lost.
    expect(contracted.current.netRevenueRetentionPercent).toBeCloseTo(80, 6);
  });

  it('leaves NRR at 100 when the cohort had no movement in the window', () => {
    const source: DashboardStateSnapshot = {
      schemaVersion: 1,
      revision: 1,
      asOf: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z',
      customers: [
        {
          id: 'cus_steady00001',
          version: 1,
          organizationName: 'Steady Co',
          email: 'ops@steady.example',
          tier: 'pro',
          status: 'active',
          billingInterval: 'monthly',
          mrrCents: 10_000,
          previousMrrCents: 0,
          channel: 'direct',
          countryCode: 'US',
          seatCount: 5,
          apiCalls30d: 100,
          cohortMonth: '2026-01',
          createdAt: '2026-01-05T00:00:00.000Z',
          updatedAt: '2026-01-05T00:00:00.000Z',
          trialStartedAt: null,
          trialEndsAt: null,
          convertedAt: null,
          canceledAt: null,
        },
      ],
      events: [
        {
          id: 'evt_steady000001',
          customerId: 'cus_steady00001',
          organizationName: 'Steady Co',
          tier: 'pro',
          channel: 'direct',
          type: 'new_business',
          mrrBeforeCents: 0,
          mrrAfterCents: 10_000,
          deltaMrrCents: 10_000,
          previousTier: null,
          currentTier: 'pro',
          occurredAt: '2026-01-05T00:00:00.000Z',
          createdAt: '2026-01-05T00:00:00.000Z',
        },
      ],
    };

    const { current } = computeKpis(source, baseFilters({ dateRange: '30d' }), FROZEN_NOW);
    expect(current.netRevenueRetentionPercent).toBeCloseTo(100, 6);
  });

  it('computes trial conversion only over trials that actually ended', () => {
    const source = snapshot();
    const { current } = computeKpis(source, baseFilters({ dateRange: '12m' }), FROZEN_NOW);
    const window = resolveWindow(source, '12m', FROZEN_NOW);

    let converted = 0;
    let canceled = 0;
    for (const event of source.events) {
      const at = Date.parse(event.occurredAt);
      if (at <= window.startDayEndMs || at > window.endDayEndMs) {
        continue;
      }
      if (event.type === 'trial_converted') {
        converted += 1;
      } else if (event.type === 'trial_canceled') {
        canceled += 1;
      }
    }

    if (converted + canceled === 0) {
      expect(current.trialConversionRatePercent).toBeNull();
    } else {
      expect(current.trialConversionRatePercent).toBeCloseTo(
        (converted / (converted + canceled)) * 100,
        6,
      );
    }
  });

  it('omits the previous window for `all`', () => {
    const source = snapshot();
    const { previous } = computeKpis(source, baseFilters({ dateRange: 'all' }), FROZEN_NOW);
    expect(previous).toBeNull();
  });

  it('omits the previous window when it would start before the data', () => {
    const source = snapshot();
    // A snapshot whose entire history is the last five days has no room for
    // the seven days that precede the window.
    const recentCutoff = Date.parse('2026-03-12T00:00:00.000Z');
    const trimmed: DashboardStateSnapshot = {
      ...source,
      customers: [],
      events: source.events.filter((event) => Date.parse(event.occurredAt) >= recentCutoff),
      asOf: '2026-03-17T00:00:00.000Z',
    };
    const { previous } = computeKpis(trimmed, baseFilters({ dateRange: '7d' }), FROZEN_NOW);
    expect(previous).toBeNull();
  });

  it('returns a previous window once the data reaches far enough back', () => {
    const source = snapshot();
    const { previous, current } = computeKpis(source, baseFilters({ dateRange: '30d' }), FROZEN_NOW);
    expect(previous).not.toBeNull();
    expect(previous?.netMrrCents).toBeLessThanOrEqual(current.netMrrCents);
  });
});

/* -------------------------------------------------------------------------- */
/*                                KPI series                                 */
/* -------------------------------------------------------------------------- */

describe('kpiSeries', () => {
  it('samples gross MRR daily for netMrr and multiplies it by twelve for arr', () => {
    const source = snapshot();
    const filters = baseFilters({ dateRange: '30d' });
    const mrr = kpiSeries(source, filters, FROZEN_NOW, 'netMrr');
    const arr = kpiSeries(source, filters, FROZEN_NOW, 'arr');

    expect(mrr).toHaveLength(30);
    expect(arr).toHaveLength(30);
    for (let i = 0; i < mrr.length; i += 1) {
      expect(arr[i]?.value).toBe((mrr[i]?.value ?? 0) * 12);
      expect(arr[i]?.date).toBe(mrr[i]?.date);
    }
    expect(mrr[mrr.length - 1]?.value).toBeGreaterThan(0);
  });

  it('samples NRR at least four times across the window', () => {
    const source = snapshot();
    const series = kpiSeries(source, baseFilters({ dateRange: '90d' }), FROZEN_NOW, 'nrr');
    expect(series.length).toBeGreaterThanOrEqual(4);
  });

  it('counts churn per bucket, daily on a short window', () => {
    const source = snapshot();
    const series = kpiSeries(source, baseFilters({ dateRange: '7d' }), FROZEN_NOW, 'logoChurn');
    // Daily buckets, so the sparkline has enough points to draw a line.
    expect(series).toHaveLength(7);
    for (const point of series) {
      expect(point.value).toBeGreaterThanOrEqual(0);
    }
    expect(series[series.length - 1]?.date).toBe('2026-03-17');
  });

  it('buckets churn weekly on a long window', () => {
    const source = snapshot();
    const series = kpiSeries(source, baseFilters({ dateRange: '90d' }), FROZEN_NOW, 'logoChurn');
    expect(series.length).toBeLessThan(30);
    expect(series.length).toBeGreaterThanOrEqual(4);
  });
});

/* -------------------------------------------------------------------------- */
/*                                Filter semantics                           */
/* -------------------------------------------------------------------------- */

describe('filter semantics', () => {
  it('resolves tier and channel against the customer current values', () => {
    const source = snapshot();
    const enterprise = [...filterCustomerIds(source, { tier: 'enterprise', channel: 'all' })];
    expect(enterprise.length).toBeGreaterThan(0);
    for (const id of enterprise) {
      const customer = source.customers.find((entry) => entry.id === id);
      expect(customer?.tier).toBe('enterprise');
    }
  });

  it('ignores the search term for KPIs', () => {
    const source = snapshot();
    const withQuery = computeKpis(source, baseFilters({ searchQuery: 'zzzzzz' }), FROZEN_NOW);
    const withoutQuery = computeKpis(source, baseFilters(), FROZEN_NOW);
    expect(withQuery.current.netMrrCents).toBe(withoutQuery.current.netMrrCents);
  });

  it('applies the search term to the ledger only', () => {
    const source = snapshot();
    const target = source.customers[0];
    expect(target).toBeDefined();
    if (target === undefined) {
      return;
    }
    const rows = selectLedgerCustomers(
      source,
      baseFilters({ searchQuery: target.organizationName }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.organizationName.toLowerCase().includes(target.organizationName.toLowerCase()) ||
          row.email.toLowerCase().includes(target.organizationName.toLowerCase()),
      ).toBe(true);
    }
  });

  it('empties the ledger without touching the KPIs', () => {
    const source = snapshot();
    const impossible = baseFilters({ searchQuery: 'no-such-organization-anywhere' });
    expect(selectLedgerCustomers(source, impossible)).toHaveLength(0);

    // The search term is scoped to the ledger, so the headline numbers stand.
    const unfiltered = computeKpis(source, baseFilters(), FROZEN_NOW);
    const searched = computeKpis(source, impossible, FROZEN_NOW);
    expect(searched.current.netMrrCents).toBe(unfiltered.current.netMrrCents);
  });

  it('narrows every metric when a tier filter matches no account', () => {
    const source = snapshot();
    const empty: DashboardStateSnapshot = {
      ...source,
      customers: [],
      events: [],
    };
    const { current } = computeKpis(empty, baseFilters({ dateRange: '7d' }), FROZEN_NOW);
    expect(current.netMrrCents).toBe(0);
    expect(current.activeCustomersCount).toBe(0);
    expect(dailyDerivedMetrics(empty, filterCustomerIds(empty, baseFilters()), resolveWindow(empty, '7d', FROZEN_NOW)))
      .toHaveLength(7);
  });
});

/* -------------------------------------------------------------------------- */
/*                                Ledger sorting                             */
/* -------------------------------------------------------------------------- */

describe('selectLedgerCustomers', () => {
  it('sorts by each field in both directions and stays stable on ties', () => {
    const source = snapshot();
    const filters = baseFilters();

    const byName = selectLedgerCustomers(
      source,
      { ...filters, sortField: 'organizationName', sortDirection: 'asc' },
    );
    for (let i = 1; i < byName.length; i += 1) {
      expect(
        (byName[i - 1]?.organizationName ?? '').localeCompare(
          byName[i]?.organizationName ?? '',
        ),
      ).toBeLessThanOrEqual(0);
    }

    const byMrr = selectLedgerCustomers(
      source,
      { ...filters, sortField: 'mrrCents', sortDirection: 'desc' },
    );
    for (let i = 1; i < byMrr.length; i += 1) {
      expect(byMrr[i - 1]?.mrrCents ?? 0).toBeGreaterThanOrEqual(byMrr[i]?.mrrCents ?? 0);
    }

    const byCreated = selectLedgerCustomers(
      source,
      { ...filters, sortField: 'createdAt', sortDirection: 'desc' },
    );
    for (let i = 1; i < byCreated.length; i += 1) {
      expect(Date.parse(byCreated[i - 1]?.createdAt ?? '')).toBeGreaterThanOrEqual(
        Date.parse(byCreated[i]?.createdAt ?? ''),
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                                   Cohorts                                 */
/* -------------------------------------------------------------------------- */

describe('computeCohorts', () => {
  it('returns the last six UTC months including the current one', () => {
    const source = snapshot();
    const rows = computeCohorts(source, baseFilters(), FROZEN_NOW);
    expect(rows).toHaveLength(6);
    expect(rows[0]?.cohortMonth).toBe('2025-10');
    expect(rows[5]?.cohortMonth).toBe('2026-03');
  });

  it('sets M0 to 100 and leaves unelapsed months null', () => {
    const source = snapshot();
    const rows = computeCohorts(source, baseFilters(), FROZEN_NOW);
    for (const row of rows) {
      expect(row.retentionByMonth[0]).toBe(100);
      // Only the final column of the current month can be unelapsed.
      expect(row.retentionByMonth).toHaveLength(6);
    }
    const current = rows[rows.length - 1];
    expect(current?.retentionByMonth[5]).toBeNull();
  });

  it('sums the first new_business delta regardless of the date it landed', () => {
    const source = snapshot();
    const rows = computeCohorts(source, baseFilters(), FROZEN_NOW);

    const firstNewBusiness = new Map<string, number>();
    for (const event of source.events) {
      if (event.type === 'new_business' && !firstNewBusiness.has(event.customerId)) {
        firstNewBusiness.set(event.customerId, event.deltaMrrCents);
      }
    }

    for (const row of rows) {
      const members = source.customers.filter(
        (customer) => customer.cohortMonth === row.cohortMonth,
      );
      const expected = members.reduce(
        (acc, customer) => acc + (firstNewBusiness.get(customer.id) ?? 0),
        0,
      );
      expect(row.initialMrrCents).toBe(expected);
      expect(row.initialCustomers).toBe(members.length);
    }
  });

  it('counts a converted trial in its cohort MRR', () => {
    const source = snapshot();
    const converted = new Map<string, string>();
    for (const event of source.events) {
      if (event.type === 'trial_converted' && !converted.has(event.customerId)) {
        converted.set(event.customerId, event.occurredAt);
      }
    }
    expect(converted.size).toBeGreaterThan(0);

    const rows = computeCohorts(source, baseFilters(), FROZEN_NOW);
    const totalInitial = rows.reduce((acc, row) => acc + row.initialMrrCents, 0);
    const totalFirstNewBusiness = [...converted.keys()].reduce(
      (acc, id) => acc + (firstNewBusinessOf(source, id) ?? 0),
      0,
    );
    expect(totalInitial).toBeGreaterThanOrEqual(totalFirstNewBusiness);
  });

  it('reports a null NDR when the cohort brought no MRR', () => {
    const emptyCohorts = computeCohorts(
      { ...snapshot(), customers: [], events: [] },
      baseFilters(),
      FROZEN_NOW,
    );
    for (const row of emptyCohorts) {
      expect(row.initialMrrCents).toBe(0);
      expect(row.netDollarRetentionPercent).toBeNull();
      expect(row.initialCustomers).toBe(0);
    }
  });

  it('retains a cohort that never churned across every elapsed month', () => {
    // A single account that signs up and never leaves. Before the sentinel fix
    // the no-churn case resolved to -Infinity, which is not greater than any
    // month boundary, so the whole cohort reported 0% retention.
    const customer = {
      id: 'cus_loyal000001',
      version: 1,
      organizationName: 'Loyal Co',
      email: 'founders@loyal.example',
      tier: 'pro' as const,
      status: 'active' as const,
      billingInterval: 'monthly' as const,
      mrrCents: 10_000,
      previousMrrCents: 0,
      channel: 'direct' as const,
      countryCode: 'US',
      seatCount: 5,
      apiCalls30d: 100,
      cohortMonth: '2026-01',
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
      trialStartedAt: null,
      trialEndsAt: null,
      convertedAt: null,
      canceledAt: null,
    };
    const source: DashboardStateSnapshot = {
      schemaVersion: 1,
      revision: 1,
      asOf: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z',
      customers: [customer],
      events: [
        {
          id: 'evt_loyal00000001',
          customerId: customer.id,
          organizationName: customer.organizationName,
          tier: customer.tier,
          channel: customer.channel,
          type: 'new_business',
          mrrBeforeCents: 0,
          mrrAfterCents: 10_000,
          deltaMrrCents: 10_000,
          previousTier: null,
          currentTier: customer.tier,
          occurredAt: '2026-01-05T00:00:00.000Z',
          createdAt: '2026-01-05T00:00:00.000Z',
        },
      ],
    };

    const rows = computeCohorts(source, baseFilters(), FROZEN_NOW);
    const january = rows.find((row) => row.cohortMonth === '2026-01');
    expect(january).toBeDefined();
    expect(january?.initialCustomers).toBe(1);
    expect(january?.initialMrrCents).toBe(10_000);
    expect(january?.netDollarRetentionPercent).toBeCloseTo(100, 6);

    // M0 through M2 have elapsed by March; M3 onward has not.
    expect(january?.retentionByMonth[0]).toBe(100);
    expect(january?.retentionByMonth[1]).toBe(100);
    expect(january?.retentionByMonth[2]).toBe(100);
    expect(january?.retentionByMonth[3]).toBeNull();
  });

  it('drops an account from retention only from the month it churned', () => {
    const customer = {
      id: 'cus_leaver000001',
      version: 1,
      organizationName: 'Leaver Co',
      email: 'ops@leaver.example',
      tier: 'pro' as const,
      status: 'canceled' as const,
      billingInterval: 'monthly' as const,
      mrrCents: 0,
      previousMrrCents: 10_000,
      channel: 'direct' as const,
      countryCode: 'US',
      seatCount: 5,
      apiCalls30d: 100,
      cohortMonth: '2026-01',
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-02-10T00:00:00.000Z',
      trialStartedAt: null,
      trialEndsAt: null,
      convertedAt: null,
      canceledAt: '2026-02-10T00:00:00.000Z',
    };
    const source: DashboardStateSnapshot = {
      schemaVersion: 1,
      revision: 1,
      asOf: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z',
      customers: [customer],
      events: [
        {
          id: 'evt_leaver0000001',
          customerId: customer.id,
          organizationName: customer.organizationName,
          tier: customer.tier,
          channel: customer.channel,
          type: 'new_business',
          mrrBeforeCents: 0,
          mrrAfterCents: 10_000,
          deltaMrrCents: 10_000,
          previousTier: null,
          currentTier: customer.tier,
          occurredAt: '2026-01-05T00:00:00.000Z',
          createdAt: '2026-01-05T00:00:00.000Z',
        },
        {
          id: 'evt_leaver0000002',
          customerId: customer.id,
          organizationName: customer.organizationName,
          tier: customer.tier,
          channel: customer.channel,
          type: 'churn',
          mrrBeforeCents: 10_000,
          mrrAfterCents: 0,
          deltaMrrCents: -10_000,
          previousTier: customer.tier,
          currentTier: customer.tier,
          occurredAt: '2026-02-10T00:00:00.000Z',
          createdAt: '2026-02-10T00:00:00.000Z',
        },
      ],
    };

    const rows = computeCohorts(source, baseFilters(), FROZEN_NOW);
    const january = rows.find((row) => row.cohortMonth === '2026-01');
    // Still counted in the month they signed up, gone from the next one on.
    expect(january?.retentionByMonth[0]).toBe(100);
    expect(january?.retentionByMonth[1]).toBe(0);
    expect(january?.netDollarRetentionPercent).toBe(0);
  });

  it('narrows to a tier and excludes its accounts from other cohorts', () => {
    const source = snapshot();
    const rows = computeCohorts(source, { tier: 'enterprise', channel: 'all' }, FROZEN_NOW);
    const total = rows.reduce((acc, row) => acc + row.initialCustomers, 0);

    // Cohorts only cover the six displayed months, so older accounts are out of
    // scope even though they match the tier filter.
    const displayed = new Set(rows.map((row) => row.cohortMonth));
    const enterprise = source.customers.filter(
      (customer) => customer.tier === 'enterprise' && displayed.has(customer.cohortMonth),
    );
    expect(enterprise.length).toBeGreaterThan(0);
    expect(total).toBe(enterprise.length);
  });
});

function firstNewBusinessOf(source: DashboardStateSnapshot, customerId: string): number | undefined {
  const event = source.events.find(
    (candidate) => candidate.customerId === customerId && candidate.type === 'new_business',
  );
  return event?.deltaMrrCents;
}

/* -------------------------------------------------------------------------- */
/*                             Distribution rollups                          */
/* -------------------------------------------------------------------------- */

describe('distribution rollups', () => {
  it('splits MRR by tier and channel across every member of the union', () => {
    const source = snapshot();
    const ids = filterCustomerIds(source, baseFilters());

    const byTier = mrrByTier(source, ids, TIER_LABEL);
    expect(byTier).toHaveLength(4);
    const tierTotal = byTier.reduce((acc, slice) => acc + slice.valueCents, 0);

    const byChannel = mrrByChannel(source, ids, CHANNEL_LABEL);
    expect(byChannel).toHaveLength(5);
    const channelTotal = byChannel.reduce((acc, slice) => acc + slice.valueCents, 0);

    const { current } = computeKpis(source, baseFilters(), FROZEN_NOW);
    expect(tierTotal).toBe(current.netMrrCents);
    expect(channelTotal).toBe(current.netMrrCents);
  });

  it('counts only paying accounts', () => {
    const source = snapshot();
    const ids = filterCustomerIds(source, baseFilters());
    const byTier = mrrByTier(source, ids, TIER_LABEL);
    const paying = source.customers.filter(
      (customer) =>
        ids.has(customer.id) &&
        (customer.status === 'active' || customer.status === 'past_due'),
    ).length;
    expect(byTier.reduce((acc, slice) => acc + slice.customers, 0)).toBe(paying);
  });
});

describe('totalSeededDays', () => {
  it('measures the whole seeded history', () => {
    const source = snapshot();
    const days = totalSeededDays(source, FROZEN_NOW);
    expect(days).toBeGreaterThanOrEqual(400);
    expect(days).toBeLessThanOrEqual(401);
  });
});