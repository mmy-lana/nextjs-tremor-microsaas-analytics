'use client';

import { useMemo } from 'react';

import { DonutChart, type DonutSlice } from '@/components/ui/DonutChart';
import { BarList, type BarListItem } from '@/components/ui/BarList';
import { CHANNEL_LABEL, CHANNEL_TONE, TIER_LABEL, TIER_TONE } from '@/lib/chartUtils';
import { filterCustomerIds, mrrByChannel, mrrByTier } from '@/lib/calculations';
import {
  formatCompactCurrencyFromCents,
  formatCurrencyFromCents,
  formatInteger,
} from '@/lib/utils';
import type { DashboardFilterState, DashboardStateSnapshot } from '@/types/analytics';

/**
 * Where the MRR sits.
 *
 * A donut for tier and a bar list for channel, side by side: tier is a part-to-
 * whole question with four fixed buckets, while channel has five and reads
 * better as ranked bars than as slices of a ring.
 */

export interface TierDistributionCardProps {
  snapshot: DashboardStateSnapshot;
  filters: DashboardFilterState;
}

export function TierDistributionCard({ snapshot, filters }: TierDistributionCardProps) {
  const customerIds = useMemo(() => filterCustomerIds(snapshot, filters), [filters, snapshot]);

  const { slices, totalCents, payingAccounts } = useMemo(() => {
    const rows = mrrByTier(snapshot, customerIds, TIER_LABEL);
    const total = rows.reduce((acc, row) => acc + row.valueCents, 0);
    const built: DonutSlice[] = rows.map((row) => ({
      id: row.id,
      label: row.label,
      value: row.valueCents,
      tone: TIER_TONE[row.id as keyof typeof TIER_TONE],
      formattedValue: formatCompactCurrencyFromCents(row.valueCents),
      sharePercent: total === 0 ? 0 : (row.valueCents / total) * 100,
    }));
    const accounts = rows.reduce((acc, row) => acc + row.customers, 0);
    return { slices: built, totalCents: total, payingAccounts: accounts };
  }, [customerIds, snapshot]);

  const channelItems: BarListItem[] = useMemo(() => {
    const rows = mrrByChannel(snapshot, customerIds, CHANNEL_LABEL);
    const ranked = [...rows].sort((a, b) => b.valueCents - a.valueCents);
    return ranked.map((row) => ({
      id: row.id,
      label: row.label,
      value: row.valueCents,
      tone: CHANNEL_TONE[row.id as keyof typeof CHANNEL_TONE],
      formattedValue: formatCompactCurrencyFromCents(row.valueCents),
    }));
  }, [customerIds, snapshot]);

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <section
        aria-labelledby="tier-distribution-heading"
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <header className="min-w-0">
          <h3
            id="tier-distribution-heading"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
          >
            MRR by tier
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {payingAccounts > 0
              ? `${formatInteger(payingAccounts)} paying accounts`
              : 'No paying accounts in this filter'}
          </p>
        </header>
        <DonutChart
          slices={slices}
          centerValue={formatCompactCurrencyFromCents(totalCents)}
          centerLabel="total MRR"
          ariaLabel={`MRR split by tier: ${slices
            .map((slice) => `${slice.label} ${slice.formattedValue}`)
            .join(', ')}`}
          summary={`Total MRR ${formatCurrencyFromCents(totalCents)} across ${slices.length} tiers.`}
        />
      </section>

      <section
        aria-labelledby="channel-distribution-heading"
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <header className="min-w-0">
          <h3
            id="channel-distribution-heading"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
          >
            MRR by channel
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Ranked by current MRR.
          </p>
        </header>
        <BarList
          items={channelItems}
          ariaLabel="MRR by acquisition channel"
          emptyLabel="No revenue in this filter"
        />
      </section>
    </div>
  );
}

export default TierDistributionCard;