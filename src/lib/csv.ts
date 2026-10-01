import type {
  AcquisitionChannel,
  DashboardFilterState,
  DashboardStateSnapshot,
  DerivedDailyMetric,
  SubscriptionTier,
} from '@/types/analytics';
import { filterCustomerIds, matchesSearchQuery } from '@/lib/calculations';
import { CHANNEL_LABEL, TIER_LABEL, toDateKey } from '@/lib/utils';

/**
 * RFC 4180 CSV export with a spreadsheet formula-injection guard.
 *
 * The guard is applied to *text* columns only. A cell starting with `=`, `+`,
 * `-`, `@`, a tab or a carriage return is prefixed with an apostrophe so a
 * spreadsheet treats it as text instead of evaluating it. Numeric columns are
 * deliberately left alone: a negative MRR delta is real data, and escaping it
 * would make the file useless for the obvious reason someone exported it.
 *
 * The module is pure. It builds a string; the download hook owns the Blob.
 */

const BOM = '\uFEFF';
const ROW_SEPARATOR = '\r\n';

/** Leading characters a spreadsheet would evaluate rather than display. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

function escapeCell(value: string, isText: boolean): string {
  let cell = value;
  if (isText && cell.length > 0) {
    // Two probes. The raw first character catches a trigger that *is* leading
    // whitespace -- a tab or a carriage return is itself a listed trigger. The
    // trimmed first character catches whitespace followed by `=`, `+`, `-` or
    // `@`, because spreadsheet importers skip that whitespace before deciding
    // whether a cell is a formula. The apostrophe goes at position zero, where
    // the importer actually treats it as "this is text".
    const probe = cell.trimStart();
    if (
      FORMULA_TRIGGERS.has(cell.charAt(0)) ||
      (probe.length > 0 && FORMULA_TRIGGERS.has(probe.charAt(0)))
    ) {
      cell = `'${cell}`;
    }
  }
  if (
    cell.includes(',') ||
    cell.includes('"') ||
    cell.includes('\n') ||
    cell.includes('\r')
  ) {
    return `"${cell.replaceAll('"', '""')}"`;
  }
  return cell;
}

export type CsvCell = string | number;

function renderRow(cells: readonly CsvCell[], textColumns: ReadonlySet<number>): string {
  return cells
    .map((cell, index) =>
      escapeCell(typeof cell === 'number' ? String(cell) : cell, textColumns.has(index)),
    )
    .join(',');
}

function renderDocument(
  header: readonly CsvCell[],
  rows: ReadonlyArray<readonly CsvCell[]>,
  textColumns: ReadonlySet<number>,
): string {
  const lines = [renderRow(header, textColumns), ...rows.map((row) => renderRow(row, textColumns))];
  return `${BOM}${lines.join(ROW_SEPARATOR)}${ROW_SEPARATOR}`;
}

/* -------------------------------------------------------------------------- */
/*                               Customers export                            */
/* -------------------------------------------------------------------------- */

const CUSTOMER_HEADER = [
  'Organization',
  'Email',
  'Tier',
  'Status',
  'Billing interval',
  'Channel',
  'Country',
  'MRR (USD)',
  'Previous MRR (USD)',
  'Seats',
  'API calls (30d)',
  'Cohort month',
  'Customer since',
  'Version',
] as const;

/** Columns holding free text that a spreadsheet could interpret as a formula. */
const CUSTOMER_TEXT_COLUMNS = new Set([0, 1, 2, 3, 4, 5, 6]);

/**
 * The filtered ledger.
 *
 * Tier and channel narrow the rows, and so does the search term — the plan
 * scopes `searchQuery` to the ledger and this CSV only, never to a KPI.
 */
export function buildCustomersCsv(
  snapshot: DashboardStateSnapshot,
  filters: DashboardFilterState,
): string {
  const inScope = filterCustomerIds(snapshot, filters);
  const rows = snapshot.customers.filter(
    (customer) => inScope.has(customer.id) && matchesSearchQuery(customer, filters.searchQuery),
  );

  return renderDocument(
    CUSTOMER_HEADER,
    rows.map((customer) => [
      customer.organizationName,
      customer.email,
      TIER_LABEL[customer.tier as SubscriptionTier],
      customer.status,
      customer.billingInterval,
      CHANNEL_LABEL[customer.channel as AcquisitionChannel],
      customer.countryCode,
      (customer.mrrCents / 100).toFixed(2),
      (customer.previousMrrCents / 100).toFixed(2),
      customer.seatCount,
      customer.apiCalls30d,
      customer.cohortMonth,
      customer.createdAt,
      customer.version,
    ]),
    CUSTOMER_TEXT_COLUMNS,
  );
}

/* -------------------------------------------------------------------------- */
/*                                Daily MRR export                           */
/* -------------------------------------------------------------------------- */

const DAILY_HEADER = [
  'Date',
  'Gross MRR (USD)',
  'New MRR (USD)',
  'Expansion MRR (USD)',
  'Contraction MRR (USD)',
  'Churned MRR (USD)',
  'Net delta MRR (USD)',
  'Active subscribers',
] as const;

/** Only the date is free text; every other column is numeric on purpose. */
const DAILY_TEXT_COLUMNS = new Set([0]);

/**
 * The daily derived series, always one row per UTC day.
 *
 * This export deliberately never buckets: a spreadsheet is exactly the place
 * where the raw daily numbers are wanted, even when the chart is showing weeks.
 */
export function buildDailyMrrCsv(series: readonly DerivedDailyMetric[]): string {
  return renderDocument(
    DAILY_HEADER,
    series.map((row) => [
      row.date,
      (row.grossMrrCents / 100).toFixed(2),
      (row.newMrrCents / 100).toFixed(2),
      (row.expansionMrrCents / 100).toFixed(2),
      (row.contractionMrrCents / 100).toFixed(2),
      (row.churnedMrrCents / 100).toFixed(2),
      (row.netDeltaMrrCents / 100).toFixed(2),
      row.activeSubscribers,
    ]),
    DAILY_TEXT_COLUMNS,
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Filenames                                 */
/* -------------------------------------------------------------------------- */

/** `customers_asof_2026-03-17.csv`, dated by the effective as-of day. */
export function customersFilename(effectiveAsOfMs: number): string {
  return `customers_asof_${toDateKey(effectiveAsOfMs)}.csv`;
}

/** `daily_mrr_asof_2026-03-17.csv`. */
export function dailyMrrFilename(effectiveAsOfMs: number): string {
  return `daily_mrr_asof_${toDateKey(effectiveAsOfMs)}.csv`;
}

/* -------------------------------------------------------------------------- */
/*                              Presentation helpers                          */
/* -------------------------------------------------------------------------- */

/** Announced in the live region after a successful download. */
export function describeExport(kind: 'customers' | 'daily', rowCount: number): string {
  const noun = kind === 'customers' ? 'customer' : 'daily MRR';
  const plural = rowCount === 1 ? noun : `${noun} rows`;
  return `Exported ${rowCount} ${plural}.`;
}