/**
 * Every domain contract for the analytics dashboard.
 *
 * This module is the root of the import chain:
 * `types -> utils / validators / chartUtils -> seed -> mutations -> storage ->
 *  calculations / csv -> hooks -> components`.
 * Nothing here imports from anywhere else in `src`.
 */

export type SubscriptionTier = 'starter' | 'pro' | 'scale' | 'enterprise';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export type BillingInterval = 'monthly' | 'annual';

export type DateRangePreset = '7d' | '30d' | '90d' | '12m' | 'all';

export type AcquisitionChannel =
  | 'organic_search'
  | 'product_hunt'
  | 'x_social'
  | 'direct'
  | 'referral';

export type KpiMetricKey = 'netMrr' | 'arr' | 'nrr' | 'logoChurn';

export type RevenueMovementType =
  | 'new_business'
  | 'expansion'
  | 'contraction'
  | 'churn'
  | 'reactivation'
  | 'trial_started'
  | 'trial_converted'
  | 'trial_canceled';

export interface CustomerRecord {
  id: string;
  /** Starts at 1; incremented by every successful mutation of this customer. */
  version: number;
  organizationName: string;
  email: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  /** Normalized integer cents; annual = Math.round(annualCents / 12); trialing = 0. */
  mrrCents: number;
  /** MRR immediately before the latest churn or contraction (0 until one occurs). */
  previousMrrCents: number;
  channel: AcquisitionChannel;
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode: string;
  seatCount: number;
  apiCalls30d: number;
  /** UTC YYYY-MM; equals the UTC YYYY-MM of `createdAt`. */
  cohortMonth: string;
  /** UTC ISO-8601. */
  createdAt: string;
  /** UTC ISO-8601. */
  updatedAt: string;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  convertedAt: string | null;
  canceledAt: string | null;
}

export interface RevenueMovementEvent {
  /** Append-only: events carry no version. */
  id: string;
  customerId: string;
  organizationName: string;
  /** Tier at event time. Display only; filters use the customer's CURRENT tier. */
  tier: SubscriptionTier;
  channel: AcquisitionChannel;
  type: RevenueMovementType;
  mrrBeforeCents: number;
  mrrAfterCents: number;
  /** Signed; non-zero ONLY for new_business, reactivation, expansion, contraction, churn. */
  deltaMrrCents: number;
  previousTier: SubscriptionTier | null;
  currentTier: SubscriptionTier;
  /** UTC ISO-8601. */
  occurredAt: string;
  /** UTC ISO-8601. */
  createdAt: string;
}

export interface CohortRetentionRow {
  id: string;
  /** UTC YYYY-MM. */
  cohortMonth: string;
  initialCustomers: number;
  initialMrrCents: number;
  /** M0..M5 logo retention percentages; M0 is always 100; null means unelapsed. */
  retentionByMonth: (number | null)[];
  /** null when `initialMrrCents` is 0. */
  netDollarRetentionPercent: number | null;
}

export interface DerivedDailyMetric {
  /** UTC YYYY-MM-DD (bucket start when weekly). */
  date: string;
  grossMrrCents: number;
  /** new_business + reactivation deltas. */
  newMrrCents: number;
  expansionMrrCents: number;
  /** Positive magnitude. */
  contractionMrrCents: number;
  /** Positive magnitude. */
  churnedMrrCents: number;
  netDeltaMrrCents: number;
  activeSubscribers: number;
}

export interface DashboardStateSnapshot {
  schemaVersion: 1;
  revision: number;
  /** UTC ISO-8601 at 00:00:00.000Z of the snapshot's anchor day. */
  asOf: string;
  updatedAt: string;
  customers: CustomerRecord[];
  events: RevenueMovementEvent[];
}

export interface DashboardFilterState {
  dateRange: DateRangePreset;
  tier: SubscriptionTier | 'all';
  channel: AcquisitionChannel | 'all';
  searchQuery: string;
  sortField: 'organizationName' | 'mrrCents' | 'createdAt' | 'status';
  sortDirection: 'asc' | 'desc';
}

export interface KpiSummary {
  netMrrCents: number;
  /** null when the baseline is 0. */
  mrrGrowthPercent: number | null;
  arrCents: number;
  netRevenueRetentionPercent: number | null;
  logoChurnRatePercent: number;
  arpuCents: number;
  estimatedLtvCents: number;
  activeCustomersCount: number;
  /** null when no trials ended in the window. */
  trialConversionRatePercent: number | null;
}

export interface KpiResult {
  current: KpiSummary;
  /** null for `all`, or when the previous window precedes the data. */
  previous: KpiSummary | null;
}

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors: Record<string, string>;
}

export interface AddCustomerPayload {
  organizationName: string;
  email: string;
  tier: SubscriptionTier;
  status: 'active' | 'trialing';
  billingInterval: BillingInterval;
  /** Already normalized to monthly cents; 0 when trialing. */
  mrrCents: number;
  channel: AcquisitionChannel;
  countryCode: string;
  seatCount: number;
  apiCalls30d: number;
}

export interface MutationContext {
  now: Date;
  /** Injected id source keeps the reducers pure and deterministic under test. */
  nextId: () => string;
}

export type StoreState = {
  status: 'loading' | 'ready' | 'error';
  snapshot: DashboardStateSnapshot | null;
  error: string | null;
};

export type MutationResult =
  | { ok: true; snapshot: DashboardStateSnapshot }
  | { ok: false; error: string };