import { describe, expect, it } from 'vitest';

import type {
  DashboardFilterState,
  DashboardStateSnapshot,
  DerivedDailyMetric,
} from '@/types/analytics';
import { generateSeed } from '@/lib/seed';
import { resolveWindow } from '@/lib/calculations';
import {
  buildCustomersCsv,
  buildDailyMrrCsv,
  customersFilename,
  dailyMrrFilename,
} from '@/lib/csv';

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

const BOM = '\uFEFF';

function dataRows(csv: string): string[] {
  return csv.replace(BOM, '').split('\r\n').filter((line) => line.length > 0);
}

/* -------------------------------------------------------------------------- */
/*                                   RFC 4180                                */
/* -------------------------------------------------------------------------- */

describe('RFC 4180 formatting', () => {
  it('starts with a UTF-8 BOM and terminates every row with CRLF', () => {
    const csv = buildCustomersCsv(snapshot(), baseFilters());
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.includes('\n\n')).toBe(false);
    // No bare LF: every newline belongs to a CRLF pair.
    expect(csv.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('emits one header row plus one row per customer', () => {
    const source = snapshot();
    const csv = buildCustomersCsv(source, baseFilters());
    // The dataset has no organization name containing a newline, so rows map
    // one-to-one onto customers.
    expect(dataRows(csv)).toHaveLength(source.customers.length + 1);
    expect(dataRows(csv)[0]).toContain('Organization');
  });

  it('quotes cells containing a comma and escapes embedded quotes by doubling them', () => {
    const base = snapshot();
    const injected = {
      ...base,
      customers: base.customers.map((customer, index) =>
        index === 0
          ? { ...customer, organizationName: 'Smith, Jones & "Co"' }
          : customer,
      ),
    };

    const csv = buildCustomersCsv(injected, baseFilters());
    const header = dataRows(csv)[0] ?? '';
    const firstRow = dataRows(csv)[1] ?? '';
    expect(header.startsWith('Organization')).toBe(true);
    // The raw form is quoted, and the inner quote is doubled.
    expect(firstRow).toContain('"Smith, Jones & ""Co"""');
  });

  it('leaves a plain cell unquoted', () => {
    const source = snapshot();
    const csv = buildCustomersCsv(source, baseFilters());
    const rows = dataRows(csv);
    const emailColumn = 1;
    for (const row of rows.slice(1)) {
      const cells = splitCsvLine(row);
      const email = cells[emailColumn];
      expect(email).toBeDefined();
      expect(email?.includes(',')).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                           Formula injection guard                         */
/* -------------------------------------------------------------------------- */

describe('formula injection guard', () => {
  it('prefixes a text cell that starts with a spreadsheet trigger', () => {
    const base = snapshot();
    const triggers = ['=cmd', '+cmd', '-cmd', '@cmd', '\tcmd', '\rcmd'];

    const hostile = {
      ...base,
      customers: base.customers.map((customer, index) =>
        index < triggers.length ? { ...customer, organizationName: triggers[index] ?? 'x' } : customer,
      ),
    };

    const rows = dataRows(buildCustomersCsv(hostile, baseFilters())).slice(1);
    const names = rows.map((row) => splitCsvLine(row)[0]);

    for (const trigger of triggers) {
      // The value survives verbatim behind an apostrophe, so a spreadsheet
      // renders it as text instead of evaluating it.
      expect(names, `trigger ${JSON.stringify(trigger)}`).toContain(`'${trigger}`);
    }
  });

  it('leaves the email column alone for a value that needs no escape', () => {
    const csv = buildCustomersCsv(snapshot(), baseFilters());
    const rows = dataRows(csv).slice(1);
    for (const row of rows) {
      expect(splitCsvLine(row)[1]?.startsWith("'")).toBe(false);
    }
  });

  it('leaves an ordinary name alone', () => {
    const csv = buildCustomersCsv(snapshot(), baseFilters());
    expect(csv).not.toContain(`"'`);
  });

  it('does not escape numeric columns, including negative values', () => {
    const series: DerivedDailyMetric[] = [
      {
        date: '2026-03-17',
        grossMrrCents: 100_00,
        newMrrCents: 0,
        expansionMrrCents: 0,
        // A negative net delta starts with '-', which the guard would mangle if
        // it were applied to numbers.
        contractionMrrCents: 0,
        churnedMrrCents: 0,
        netDeltaMrrCents: -250_50,
        activeSubscribers: 3,
      },
    ];

    const rows = dataRows(buildDailyMrrCsv(series));
    const cells = splitCsvLine(rows[1] ?? '');
    expect(cells[6]).toBe('-250.50');
    expect(cells[6]?.startsWith("'-")).toBe(false);
  });

  it('leaves an unsigned numeric cell alone', () => {
    const series: DerivedDailyMetric[] = [
      {
        date: '2026-03-17',
        grossMrrCents: 1_234_56,
        newMrrCents: 10_00,
        expansionMrrCents: 0,
        contractionMrrCents: 0,
        churnedMrrCents: 0,
        netDeltaMrrCents: 10_00,
        activeSubscribers: 42,
      },
    ];
    const cells = splitCsvLine(dataRows(buildDailyMrrCsv(series))[1] ?? '');
    expect(cells[1]).toBe('1234.56');
    expect(cells[7]).toBe('42');
  });
});

/* -------------------------------------------------------------------------- */
/*                                  Contents                                 */
/* -------------------------------------------------------------------------- */

describe('customers export', () => {
  it('writes money as a plain decimal string', () => {
    const source = snapshot();
    const rows = dataRows(buildCustomersCsv(source, baseFilters())).slice(1);
    const first = source.customers[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    const cells = splitCsvLine(rows[0] ?? '');
    expect(cells[7]).toBe((first.mrrCents / 100).toFixed(2));
    expect(cells[8]).toBe((first.previousMrrCents / 100).toFixed(2));
  });

  it('narrows rows by the search term', () => {
    const source = snapshot();
    const target = source.customers[0];
    expect(target).toBeDefined();
    if (target === undefined) {
      return;
    }
    const csv = buildCustomersCsv(source, baseFilters({ searchQuery: target.organizationName }));
    expect(dataRows(csv)).toHaveLength(2);
  });

  it('narrows rows by tier and channel', () => {
    const source = snapshot();
    const csv = buildCustomersCsv(source, baseFilters({ tier: 'enterprise' }));
    const rows = dataRows(csv).slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(source.customers.length);
    for (const row of rows) {
      expect(splitCsvLine(row)[2]).toBe('Enterprise');
    }
  });

  it('writes only the header when nothing matches', () => {
    const csv = buildCustomersCsv(snapshot(), baseFilters({ searchQuery: 'nothing matches' }));
    expect(dataRows(csv)).toHaveLength(1);
  });
});

describe('daily MRR export', () => {
  it('writes one row per day of the window, never bucketed', () => {
    const source = snapshot();
    const window = resolveWindow(source, '12m', FROZEN_NOW);
    const series = Array.from({ length: window.windowDays }, (_, index) => ({
      date: new Date(window.dayEndMs(index)).toISOString().slice(0, 10),
      grossMrrCents: 1_000,
      newMrrCents: 0,
      expansionMrrCents: 0,
      contractionMrrCents: 0,
      churnedMrrCents: 0,
      netDeltaMrrCents: 0,
      activeSubscribers: 1,
    }));

    const csv = buildDailyMrrCsv(series);
    expect(dataRows(csv)).toHaveLength(series.length + 1);
  });

  it('emits only a header for an empty series', () => {
    expect(dataRows(buildDailyMrrCsv([]))).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/*                                 Filenames                                 */
/* -------------------------------------------------------------------------- */

describe('filenames', () => {
  it('dates both exports by the effective as-of day', () => {
    const asOf = Date.parse('2026-03-17T00:00:00.000Z');
    expect(customersFilename(asOf)).toBe('customers_asof_2026-03-17.csv');
    expect(dailyMrrFilename(asOf)).toBe('daily_mrr_asof_2026-03-17.csv');
  });

  it('does not reuse the previous day when now crosses midnight', () => {
    const asOf = Date.parse('2026-01-01T00:00:00.000Z');
    expect(customersFilename(asOf)).toBe('customers_asof_2026-01-01.csv');
    expect(dailyMrrFilename(asOf)).toBe('daily_mrr_asof_2026-01-01.csv');
  });
});

/* -------------------------------------------------------------------------- */
/*                            Minimal CSV splitter                           */
/* -------------------------------------------------------------------------- */

/** Reference RFC 4180 reader used to assert on the writer's output. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line.charAt(i);
    if (inQuotes) {
      if (char === '"') {
        if (line.charAt(i + 1) === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
describe('percentage formatting precision', () => {
  it('supports zero, one and two decimal places', async () => {
    const { formatPercent } = await import('@/lib/utils');
    expect(formatPercent(100, 0)).toBe('100%');
    expect(formatPercent(100, 1)).toBe('100.0%');
    expect(formatPercent(100, 2)).toBe('100.00%');
    expect(formatPercent(42.56, 0)).toBe('43%');
    expect(formatPercent(42.56, 1)).toBe('42.6%');
    expect(formatPercent(null, 0)).toBe('—');
  });
});
