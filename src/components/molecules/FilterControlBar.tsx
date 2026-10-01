'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, SlidersHorizontal, X } from 'lucide-react';

import { SegmentedControl, type SegmentedOption } from '@/components/primitives/SegmentedControl';
import { SlideOverDrawer } from '@/components/primitives/SlideOverDrawer';
import {
  CHANNEL_LABEL,
  DATE_RANGE_SHORT_LABEL,
  TIER_LABEL,
} from '@/lib/chartUtils';
import { cn } from '@/lib/utils';
import type {
  AcquisitionChannel,
  DashboardFilterState,
  DateRangePreset,
  SubscriptionTier,
} from '@/types/analytics';

/**
 * Filter bar for the ledger and every derived view.
 *
 * Above `md` the controls sit inline in a sticky bar. Below it they collapse
 * behind a single button and open in a drawer with a sticky Apply/Reset footer,
 * because a five-control row cannot fit inside 360px without either wrapping
 * into an unreadable stack or shrinking every target below the touch minimum.
 *
 * The mobile drawer stages edits locally and only commits on Apply, so a user
 * who opens it by accident does not silently reset the view.
 */

export interface FilterControlBarProps {
  filters: DashboardFilterState;
  onChange: (patch: Partial<DashboardFilterState>) => void;
  onReset: () => void;
}

const DATE_OPTIONS: readonly SegmentedOption<DateRangePreset>[] = (
  ['7d', '30d', '90d', '12m', 'all'] as const
).map((value) => ({
  value,
  label: value === 'all' ? 'All time' : `Last ${DATE_RANGE_SHORT_LABEL[value]}`,
  shortLabel: DATE_RANGE_SHORT_LABEL[value],
}));

const SORT_LABEL: Readonly<Record<DashboardFilterState['sortField'], string>> = {
  organizationName: 'Organization',
  mrrCents: 'MRR',
  createdAt: 'Joined',
  status: 'Status',
};

const selectClass =
  'mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ' +
  'dark:border-zinc-700 dark:bg-zinc-900';

const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-200';

function MobileFilterFields({
  filters,
  onChange,
}: {
  filters: DashboardFilterState;
  onChange: (patch: Partial<DashboardFilterState>) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="min-w-0">
        <span className={labelClass}>Date range</span>
        <SegmentedControl
          options={DATE_OPTIONS}
          value={filters.dateRange}
          onChange={(value) => onChange({ dateRange: value })}
          ariaLabel="Date range"
          alwaysShort
          className="mt-1 w-full"
        />
      </div>

      <div className="min-w-0">
        <label className={labelClass} htmlFor="drawer-tier">
          Tier
        </label>
        <select
          id="drawer-tier"
          value={filters.tier}
          onChange={(event) =>
            onChange({ tier: event.target.value as DashboardFilterState['tier'] })
          }
          className={selectClass}
        >
          <option value="all">All tiers</option>
          {(Object.keys(TIER_LABEL) as SubscriptionTier[]).map((tier) => (
            <option key={tier} value={tier}>
              {TIER_LABEL[tier]}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-0">
        <label className={labelClass} htmlFor="drawer-channel">
          Channel
        </label>
        <select
          id="drawer-channel"
          value={filters.channel}
          onChange={(event) =>
            onChange({ channel: event.target.value as DashboardFilterState['channel'] })
          }
          className={selectClass}
        >
          <option value="all">All channels</option>
          {(Object.keys(CHANNEL_LABEL) as AcquisitionChannel[]).map((channel) => (
            <option key={channel} value={channel}>
              {CHANNEL_LABEL[channel]}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-0">
        <label className={labelClass} htmlFor="drawer-search">
          Search
        </label>
        <input
          id="drawer-search"
          type="search"
          value={filters.searchQuery}
          placeholder="Organization or email"
          onChange={(event) => onChange({ searchQuery: event.target.value })}
          className={selectClass}
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Narrows the ledger and the customers CSV only, never the KPIs.
        </p>
      </div>

      <div className="min-w-0">
        <label className={labelClass} htmlFor="drawer-sort">
          Sort by
        </label>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <select
            id="drawer-sort"
            value={filters.sortField}
            onChange={(event) =>
              onChange({
                sortField: event.target.value as DashboardFilterState['sortField'],
              })
            }
            className={cn(selectClass, 'mt-0')}
          >
            {(Object.keys(SORT_LABEL) as DashboardFilterState['sortField'][]).map((field) => (
              <option key={field} value={field}>
                {SORT_LABEL[field]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              onChange({
                sortDirection: filters.sortDirection === 'asc' ? 'desc' : 'asc',
              })
            }
            aria-label={`Sort ${filters.sortDirection === 'asc' ? 'descending' : 'ascending'}`}
            data-testid="sort-direction"
            className={cn(
              'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300',
              'text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
              'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
            )}
          >
            {filters.sortDirection === 'asc' ? (
              <ArrowUp aria-hidden="true" className="h-4 w-4" />
            ) : (
              <ArrowDown aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FilterControlBar({ filters, onChange, onReset }: FilterControlBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardFilterState>(filters);

  const openDrawer = (): void => {
    setDraft(filters);
    setDrawerOpen(true);
  };

  const applyDraft = (): void => {
    onChange(draft);
    setDrawerOpen(false);
  };

  return (
    <div
      className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-20 -mx-3 mb-4 border-b border-zinc-200 bg-white/95 px-3 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 sm:-mx-4 sm:px-4"
    >
      <div className="hidden min-w-0 flex-wrap items-end gap-3 md:flex">
        <div className="w-56 shrink-0">
          <span className={labelClass}>Date range</span>
          <SegmentedControl
            options={DATE_OPTIONS}
            value={filters.dateRange}
            onChange={(value) => onChange({ dateRange: value })}
            ariaLabel="Date range"
            alwaysShort
            className="mt-1 w-full"
          />
        </div>

        <div className="w-36 shrink-0">
          <label className={labelClass} htmlFor="desktop-tier">
            Tier
          </label>
          <select
            id="desktop-tier"
            value={filters.tier}
            onChange={(event) =>
              onChange({ tier: event.target.value as DashboardFilterState['tier'] })
            }
            className={selectClass}
          >
            <option value="all">All tiers</option>
            {(Object.keys(TIER_LABEL) as SubscriptionTier[]).map((tier) => (
              <option key={tier} value={tier}>
                {TIER_LABEL[tier]}
              </option>
            ))}
          </select>
        </div>

        <div className="w-40 shrink-0">
          <label className={labelClass} htmlFor="desktop-channel">
            Channel
          </label>
          <select
            id="desktop-channel"
            value={filters.channel}
            onChange={(event) =>
              onChange({ channel: event.target.value as DashboardFilterState['channel'] })
            }
            className={selectClass}
          >
            <option value="all">All channels</option>
            {(Object.keys(CHANNEL_LABEL) as AcquisitionChannel[]).map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABEL[channel]}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-44 flex-1">
          <label className={labelClass} htmlFor="desktop-search">
            Search
          </label>
          <input
            id="desktop-search"
            type="search"
            value={filters.searchQuery}
            placeholder="Organization or email"
            onChange={(event) => onChange({ searchQuery: event.target.value })}
            className={selectClass}
          />
        </div>

        <div className="w-44 shrink-0">
          <label className={labelClass} htmlFor="desktop-sort">
            Sort by
          </label>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <select
              id="desktop-sort"
              value={filters.sortField}
              onChange={(event) =>
                onChange({
                  sortField: event.target.value as DashboardFilterState['sortField'],
                })
              }
              className={cn(selectClass, 'mt-0 flex-1')}
            >
              {(Object.keys(SORT_LABEL) as DashboardFilterState['sortField'][]).map((field) => (
                <option key={field} value={field}>
                  {SORT_LABEL[field]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                onChange({
                  sortDirection: filters.sortDirection === 'asc' ? 'desc' : 'asc',
                })
              }
              aria-label={`Sort ${filters.sortDirection === 'asc' ? 'descending' : 'ascending'}`}
              data-testid="sort-direction"
              className={cn(
                'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300',
                'text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
              )}
            >
              {filters.sortDirection === 'asc' ? (
                <ArrowUp aria-hidden="true" className="h-4 w-4" />
              ) : (
                <ArrowDown aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onReset}
          data-testid="reset-filters-inline"
          className={cn(
            'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3',
            'text-sm font-medium text-zinc-700 hover:bg-zinc-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
            'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
          )}
        >
          <X aria-hidden="true" className="h-4 w-4" />
          Reset
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-2 md:hidden">
        <button
          type="button"
          onClick={openDrawer}
          aria-expanded={drawerOpen}
          data-testid="open-filters"
          className={cn(
            'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3',
            'text-sm font-medium text-zinc-700 hover:bg-zinc-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
            'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
          )}
        >
          <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
          Filters
        </button>
        <button
          type="button"
          onClick={onReset}
          data-testid="reset-filters-mobile"
          className={cn(
            'inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300 px-3',
            'text-sm font-medium text-zinc-700 hover:bg-zinc-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
            'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
          )}
        >
          Reset
        </button>
      </div>

      <SlideOverDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        description="Apply to narrow the ledger and every metric."
        placement="bottom"
        footer={
          <div className="flex min-w-0 gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft({
                  ...draft,
                  dateRange: '30d',
                  tier: 'all',
                  channel: 'all',
                  searchQuery: '',
                  sortField: 'createdAt',
                  sortDirection: 'desc',
                });
              }}
              className={cn(
                'min-h-11 flex-1 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700',
                'hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
              )}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={applyDraft}
              data-testid="apply-filters"
              className={cn(
                'min-h-11 flex-1 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white',
                'hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                'dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white',
              )}
            >
              Apply
            </button>
          </div>
        }
      >
        <MobileFilterFields
          filters={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
      </SlideOverDrawer>
    </div>
  );
}

export default FilterControlBar;