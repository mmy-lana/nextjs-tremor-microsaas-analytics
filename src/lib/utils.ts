import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Deterministic formatting and UTC date helpers.
 *
 * Every formatter in this module is locale-pinned to `en-US` and every date
 * formatter is pinned to `timeZone: 'UTC'`, so the server render and the client
 * hydration always agree regardless of the machine's locale or offset.
 *
 * This module is pure: it never reads the clock implicitly. Nothing here calls
 * `Date.now()` or a zero-argument `new Date()`.
 */

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const EM_DASH = '\u2014';

export const MS_PER_DAY = 86_400_000;

/* -------------------------------------------------------------------------- */
/*                              Intl singletons                              */
/* -------------------------------------------------------------------------- */

const currencyFull = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const currencyCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const integer = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

const percentOneDecimal = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const percentTwoDecimals = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFull = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const dateShort = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});

const monthYear = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
});

const monthShort = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
});

const dateTimeUtc = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

/* -------------------------------------------------------------------------- */
/*                                Money format                               */
/* -------------------------------------------------------------------------- */

/** `$12,345.67`. Negative cents render as `-$12,345.67`. */
export function formatCurrencyFromCents(cents: number): string {
  return currencyFull.format(cents / 100);
}

/** `$12,346` — for dense stat strips where the cents are noise. */
export function formatCurrencyWholeFromCents(cents: number): string {
  return currencyWhole.format(cents / 100);
}

/** `$12.3K` / `$1.2M` — for cards that must stay narrow at 360px. */
export function formatCompactCurrencyFromCents(cents: number): string {
  return currencyCompact.format(cents / 100);
}

/** `+$1,200.00` / `-$400.00`. */
export function formatSignedCurrencyFromCents(cents: number): string {
  if (cents === 0) {
    return currencyFull.format(0);
  }
  const sign = cents > 0 ? '+' : '-';
  return `${sign}${currencyFull.format(Math.abs(cents) / 100)}`;
}

/** `+$1.2K` / `-$400`. */
export function formatSignedCompactCurrencyFromCents(cents: number): string {
  if (cents === 0) {
    return currencyCompact.format(0);
  }
  const sign = cents > 0 ? '+' : '-';
  return `${sign}${currencyCompact.format(Math.abs(cents) / 100)}`;
}

/* -------------------------------------------------------------------------- */
/*                               Number formats                               */
/* -------------------------------------------------------------------------- */

export function formatInteger(value: number): string {
  return integer.format(value);
}

/** `12.3%`. A `null` value is a real "not computable" state, rendered as an em dash. */
export function formatPercent(value: number | null, fractionDigits: 1 | 2 = 1): string {
  if (value === null || !Number.isFinite(value)) {
    return EM_DASH;
  }
  const formatter = fractionDigits === 2 ? percentTwoDecimals : percentOneDecimal;
  return `${formatter.format(value)}%`;
}

/** `+4.2%` / `-1.1%` / `0.0%`. */
export function formatSignedPercent(
  value: number | null,
  fractionDigits: 1 | 2 = 1,
): string {
  if (value === null || !Number.isFinite(value)) {
    return EM_DASH;
  }
  if (value === 0) {
    return formatPercent(0, fractionDigits);
  }
  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatPercent(Math.abs(value), fractionDigits)}`;
}

/* -------------------------------------------------------------------------- */
/*                                Date formats                               */
/* -------------------------------------------------------------------------- */

function toValidDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `Jan 5, 2026`. Invalid input renders as an em dash rather than `Invalid Date`. */
export function formatDate(value: string | number | Date): string {
  const date = toValidDate(value);
  return date === null ? EM_DASH : dateFull.format(date);
}

/** `Jan 5`. */
export function formatDateShort(value: string | number | Date): string {
  const date = toValidDate(value);
  return date === null ? EM_DASH : dateShort.format(date);
}

/** `Jan 2026` from a UTC `YYYY-MM` string, a `Date`, or a `YYYY-MM-DD` string. */
export function formatMonthYear(value: string | number | Date): string {
  const date = toValidDate(value);
  return date === null ? EM_DASH : monthYear.format(date);
}

/** `Jan` — the compact axis label for a UTC `YYYY-MM` cohort key. */
export function formatMonthShort(value: string | number | Date): string {
  const date = toValidDate(value);
  return date === null ? EM_DASH : monthShort.format(date);
}

/** `Jan 5, 2026, 14:03 UTC`. */
export function formatDateTimeUtc(value: string | number | Date): string {
  const date = toValidDate(value);
  return date === null ? EM_DASH : dateTimeUtc.format(date);
}

/* -------------------------------------------------------------------------- */
/*                            UTC date arithmetic                            */
/* -------------------------------------------------------------------------- */

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** True when the string is a canonical UTC ISO-8601 instant. */
export function isUtcIsoString(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_UTC_RE.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const YEAR_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `YYYY-MM-DD` in UTC. */
export function toDateKey(value: string | number | Date): string {
  const date = toValidDate(value);
  return date === null ? '' : date.toISOString().slice(0, 10);
}

/** `YYYY-MM` in UTC — the cohort key of a `createdAt` instant. */
export function toYearMonth(value: string | number | Date): string {
  const date = toValidDate(value);
  return date === null ? '' : date.toISOString().slice(0, 7);
}

/** Parses a `YYYY-MM-DD` key as UTC midnight. Returns `null` for a malformed key. */
export function parseDateKey(dateKey: string): Date | null {
  const match = DATE_KEY_RE.exec(dateKey);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible civil dates such as 2026-02-31, which Date.UTC rolls over.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/** Parses a `YYYY-MM` key as UTC midnight on the first of the month. */
export function parseYearMonth(yearMonth: string): Date | null {
  if (!YEAR_MONTH_RE.test(yearMonth)) {
    return null;
  }
  return parseDateKey(`${yearMonth}-01`);
}

/** Midnight UTC of the day containing `value`. */
export function startOfUtcDay(value: string | number | Date): Date {
  const date = toValidDate(value);
  if (date === null) {
    throw new RangeError('startOfUtcDay received an unparseable date');
  }
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** `value` shifted by whole UTC days; the time-of-day component is preserved. */
export function addUtcDays(value: string | number | Date, days: number): Date {
  const date = toValidDate(value);
  if (date === null) {
    throw new RangeError('addUtcDays received an unparseable date');
  }
  return new Date(date.getTime() + Math.trunc(days) * MS_PER_DAY);
}

/** Shifts a `YYYY-MM` key by whole months, clamping to a valid day-of-month. */
export function addYearMonths(yearMonth: string, months: number): string {
  const parsed = parseYearMonth(yearMonth);
  if (parsed === null) {
    throw new RangeError(`addYearMonths received an invalid YYYY-MM key: ${yearMonth}`);
  }
  const shifted = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + Math.trunc(months), 1),
  );
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Whole UTC days between two instants, floored. */
export function utcDayDiff(from: string | number | Date, to: string | number | Date): number {
  const fromDate = startOfUtcDay(from);
  const toDate = startOfUtcDay(to);
  return Math.round((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY);
}

/** ISO-8601 UTC instant with millisecond precision. */
export function toIsoUtc(value: Date): string {
  return value.toISOString();
}