'use client';

import { useMemo } from 'react';

import { COHORT_MONTHS, computeCohorts } from '@/lib/calculations';
import { HEAT_EMPTY_LABEL, heatCellClass } from '@/lib/chartUtils';
import {
  cn,
  formatCompactCurrencyFromCents,
  formatInteger,
  formatMonthShort,
  formatMonthYear,
  formatPercent,
} from '@/lib/utils';
import type { DashboardFilterState, DashboardStateSnapshot } from '@/types/analytics';

/**
 * Logo and dollar retention by signup cohort.
 *
 * The matrix scrolls horizontally inside a labelled region rather than letting
 * the page scroll sideways, and the cohort column is pinned so the row label
 * stays visible while the months scroll. Every cell prints its percentage, so
 * the heat colour is a second cue rather than the only one, and an unelapsed
 * month shows a dash instead of a misleading zero.
 */

export interface CohortRetentionMatrixProps {
  snapshot: DashboardStateSnapshot;
  filters: DashboardFilterState;
  now: Date;
}

/**
 * Column headers for one cohort: `M0 Jan`, `M1 Feb`, and so on.
 *
 * Built from the cohort key rather than from the first row, so the headers stay
 * correct when the earliest cohort in the window is empty and therefore absent.
 */
function monthLabels(cohortMonth: string): string[] {
  const [year, month] = cohortMonth.split('-');
  const base = Number(year ?? '1970');
  const startIndex = Number(month ?? '1') - 1;
  return Array.from({ length: COHORT_MONTHS }, (_, offset) => {
    const date = new Date(Date.UTC(base, startIndex + offset, 1));
    return `M${offset} ${formatMonthShort(date)}`;
  });
}

export function CohortRetentionMatrix({ snapshot, filters, now }: CohortRetentionMatrixProps) {
  const rows = useMemo(
    () => computeCohorts(snapshot, filters, now),
    [filters, now, snapshot],
  );

  // One header row for the whole table. Derived from the newest cohort so the
  // labels stay correct even when the earliest cohort has no members, and
  // memoised because they only change when the cohorts do.
  const headers = useMemo(
    () => monthLabels(rows[rows.length - 1]?.cohortMonth ?? ''),
    [rows],
  );

  const totalAccounts = rows.reduce((acc, row) => acc + row.initialCustomers, 0);

  return (
    <section
      id="cohorts"
      aria-labelledby="cohorts-heading"
      className="flex min-w-0 scroll-mt-20 flex-col gap-3"
    >
      <header className="min-w-0">
        <h2 id="cohorts-heading" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Cohort retention
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Logo retention by month since signup, with net dollar retention at the
          right. {formatInteger(totalAccounts)} accounts across the last six cohorts.
        </p>
      </header>

      <div
        role="region"
        aria-label="Cohort retention matrix"
        tabIndex={0}
        className={cn(
          // `relative` matters: it makes this the containing block for the
          // absolutely positioned `sr-only` spans in the cells, so they are
          // clipped here instead of stretching the document.
          'relative min-w-0 overflow-x-auto overscroll-x-contain rounded-xl border border-zinc-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
          'dark:border-zinc-800',
        )}
      >
        <table className="w-full min-w-[520px] border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Logo retention for the last six signup cohorts. Each cell shows the
            percentage of the cohort still active in that month.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 border-b border-r border-zinc-200 bg-white px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
              >
                Cohort
              </th>
              {headers.map((label, offset) => (
                <th
                  key={offset}
                  scope="col"
                  className="border-b border-zinc-200 px-2 py-2 text-center text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
                >
                  {label}
                </th>
              ))}
              <th
                scope="col"
                className="border-b border-zinc-200 px-3 py-2 text-right text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
              >
                NDR
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-r border-zinc-200 bg-white px-3 py-2 text-left font-normal dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {formatMonthYear(row.cohortMonth)}
                  </span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {formatInteger(row.initialCustomers)} accounts ·{' '}
                    {formatCompactCurrencyFromCents(row.initialMrrCents)}
                  </span>
                </th>

                {row.retentionByMonth.map((value, index) => (
                  <td
                    key={`${row.id}-m${index}`}
                    className="border-b border-zinc-200 p-1 text-center tabular-nums dark:border-zinc-800"
                  >
                    <span
                      className={cn(
                        'block rounded-md px-2 py-1.5 text-xs font-medium',
                        heatCellClass(value),
                      )}
                    >
                      {value === null ? HEAT_EMPTY_LABEL : formatPercent(value, 0)}
                      {value === null && (
                        <span className="sr-only">month not yet elapsed</span>
                      )}
                    </span>
                  </td>
                ))}

                <td className="border-b border-zinc-200 px-3 py-2 text-right text-xs font-medium tabular-nums text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">
                  {row.netDollarRetentionPercent === null
                    ? HEAT_EMPTY_LABEL
                    : formatPercent(row.netDollarRetentionPercent, 0)}
                  {row.netDollarRetentionPercent === null && (
                    <span className="sr-only">no opening MRR for this cohort</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Opening MRR counts each account&apos;s first new-business value, so a
        converted trial contributes what it actually converted to.
      </p>
    </section>
  );
}

export default CohortRetentionMatrix;