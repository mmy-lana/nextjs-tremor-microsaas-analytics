# Architectural Plan: Micro-SaaS Analytics Dashboard (`nextjs-tremor-microsaas-analytics`)

## 1. System Architecture & Aesthetic Foundation

### Package Ecosystem & Tooling Policy
- **Package Manager**: `pnpm` exclusively (never `npm` or `yarn`).
  - Phase 0 pins the resolved pnpm version in `package.json` via `"packageManager": "pnpm@<resolved>"` (Corepack) and commits `pnpm-lock.yaml`. No `package-lock.json` or `yarn.lock` may exist.
  - `.npmrc` contains `engine-strict=true` and `strict-peer-dependencies=false`.
  - CI and agent installs use `pnpm install --frozen-lockfile`.
  - pnpm's `node_modules` is strict (no phantom dependencies): every package that source or config files import must be declared in `package.json`.
- **Node Engine**: `"engines": { "node": "<minimum Node version required by the installed Next.js>" }`, resolved at Phase 0. Use the newest Node release the machine runs.
- **Bleeding-Edge Version Policy (personal project: newest of everything, stability is NOT a goal)**:
  - For every dependency, Phase 0 runs `pnpm view <pkg> dist-tags --json` and `pnpm view <pkg> versions --json`, then installs the HIGHEST version available across ALL dist-tags, including `canary`, `next`, `beta`, `alpha`, `rc`, and `experimental`. The `latest` dist-tag (the stable one) is NOT used when a higher prerelease exists.
  - Every resolved version is pinned EXACTLY in `package.json` (no `^`, `~`, or dist-tag strings), because prerelease versions change daily and an unpinned install is not reproducible. The resolved set is recorded in `README.md` and the committed `pnpm-lock.yaml`; this plan never hard-codes a version.
  - Applies to: `next`, `react`, `react-dom`, `react-is`, `typescript`, `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `tailwind-merge`, `clsx`, `recharts` (any major, including 3.x and newer), `lucide-react`, `eslint`, `eslint-config-next`, `vitest`, `@playwright/test`, `@types/*`, and pnpm itself.
  - **Pairing rules** (the only constraints on "newest"):
    - `react` and `react-dom` use the identical exact version, and it must be the version the installed `next` declares in its `peerDependencies` (a Next canary may require a specific React canary). `react-is` and `@types/react*` match that React version.
    - `tailwindcss` and `@tailwindcss/postcss` use the identical exact version; `tailwind-merge` uses the newest release that supports that Tailwind major.
    - `eslint-config-next` matches the installed Next version.
  - **Peer-range tolerance**: prerelease packages often fail peer ranges. `.npmrc` sets `strict-peer-dependencies=false`, and `package.json` may use `pnpm.peerDependencyRules` (`allowAny` / `allowedVersions`) for specific warnings. Each rule is listed in `README.md` with the reason.
  - **Breakage protocol**: if a Phase gate fails because of a prerelease, the agent first reads the installed package's own types and changelog and adapts the code. Only if that fails does it step ONE package down to the next-highest published version (older prerelease first, then stable), re-runs the gate, and records the downgrade in `README.md`. It never downgrades the whole stack or drops the bleeding-edge policy.
  - **Recharts 3.x and newer are allowed** (the in-house wrappers no longer depend on any Tremor code). The chart tap contract in Section 4 reads `activeTooltipIndex` from the chart `onClick` state; the agent confirms the field name and type against the installed Recharts typings and adjusts the wrapper if it moved.
- **React / Recharts compatibility**: `react-is` is a DIRECT dependency pinned to the same exact version as `react`, and forced through pnpm overrides: `"pnpm": { "overrides": { "react-is": "<exact react version>" } }` (the npm-style `"overrides"` key is not used). The agent verifies with `pnpm why react-is` that a single version resolves. If the installed Recharts no longer depends on `react-is`, the override is removed and the removal is noted in `README.md`.
- **pnpm build-script approvals**: pnpm 10 and later skip dependency install scripts unless approved. Phase 0 runs `pnpm approve-builds` (or sets `"pnpm": { "onlyBuiltDependencies": [...] }`) for exactly the packages that need native binaries or postinstall steps in this project (for example `sharp`, `@tailwindcss/oxide`, `esbuild`, `unrs-resolver`), and no others.
- **devDependencies**: `typescript`, `@types/react`, `@types/react-dom` (matching the installed React), `@types/node`, `eslint`, `eslint-config-next` (matching the installed Next), `vitest`, `@playwright/test`.
- **Scripts** (run with `pnpm <script>`):
  - `"dev": "next dev"`
  - `"build": "next build"`
  - `"start": "next start"`
  - `"lint": "eslint ."`
  - `"typecheck": "tsc --noEmit"`
  - `"test": "vitest run"`
  - `"e2e": "playwright test"`
- **Config Files**:
  - `vitest.config.ts`: `environment: 'node'`, alias `'@' -> './src'`, `include: ['src/**/*.test.ts']` (keeps Playwright specs out of vitest).
  - `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `"paths": { "@/*": ["./src/*"] }`, includes `.next/types/**/*.ts`.
  - `eslint.config.mjs`: flat config exported the way the installed `eslint-config-next` version documents; ignores `.next`, `node_modules`, `next-env.d.ts`, `playwright-report`, `test-results`. `pnpm lint` must exit 0.
  - `playwright.config.ts`: `webServer` runs `pnpm start` (after `pnpm build`), `testDir: 'e2e'`, Chromium only.
  - All unit tests import `describe`, `it`, `expect` explicitly from `'vitest'` (no globals).

### Typography, Deterministic Formatting & Flash-Free Theme
- **Typography**: System font stack only. `next/font/google` is NOT used (a production build fails when Google Fonts is unreachable). In `src/app/globals.css`:
  ```css
  @theme {
    --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  ```
- **Document root**: `<html lang="en" suppressHydrationWarning>`.
- **Viewport**: `src/app/layout.tsx` exports `viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }`.
- **Formatting Determinism**: every currency/number formatter in `src/lib/utils.ts` uses locale `'en-US'`; every date format uses `timeZone: 'UTC'`.
- **Theme Initialization**: preference lives only in `microsaas_v1_theme`. A synchronous inline `<script>` in the `<head>` of `layout.tsx` runs before paint:
  ```javascript
  try {
    var t = localStorage.getItem('microsaas_v1_theme');
    var dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    var q = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', q);
    document.documentElement.style.colorScheme = q ? 'dark' : 'light';
  }
  ```
- **Dark variant**: `@custom-variant dark (&:where(.dark, .dark *));` in `globals.css`.
- **Touch tooltips**: `<Tooltip>` stays mounted in every chart (so Recharts still populates `activeTooltipIndex`), but is hidden on touch devices:
  ```css
  @media (hover: none) {
    .recharts-tooltip-wrapper { display: none !important; }
  }
  ```
- **Smooth scroll**: `html { scroll-behavior: smooth; }` only inside `@media (prefers-reduced-motion: no-preference)`.
- **Tailwind v4 scanner rule**: all utility classes must appear as full static literals (lookup maps). String interpolation such as `` `bg-indigo-${n}` `` is forbidden.

### Client Boundary & Import Chain
- **Directives**:
  - Line 1 of every file in `src/hooks/`, `src/components/ui/`, `primitives/`, `molecules/`, `features/` is `"use client";`.
  - `src/app/layout.tsx` and `src/app/page.tsx` are Server Components (no directive).
  - Every file in `src/lib/` (including `chartUtils.ts`, `mutations.ts`, `calculations.ts`, `csv.ts`) has no directive and never references `window` or `document`. Only `src/lib/storage.ts` may touch `window`/`localStorage`/`navigator`, guarded by `typeof window !== 'undefined'`.
  - `src/lib/calculations.ts` and `src/lib/csv.ts` never call `new Date()` or `Date.now()`; every "now" is a parameter.
- **One-way import chain** (never import leftward):
  `types -> utils / validators / chartUtils -> seed -> mutations -> storage -> calculations / csv -> hooks -> components`.
  `calculations.ts` and `csv.ts` import only `types` and `utils` (never `storage`).

### Layout, Navigation & Mobile Rules
- **DOM shell** (`layout.tsx`): `<body><div id="app-root">{children}</div><div id="drawer-root" /></body>`.
- **Page sections** (each with `id` and `scroll-mt-20`): `overview` (KPI cards + stat strip), `revenue` (MRR composition chart + tier distribution), `cohorts`, `customers` (filter bar + ledger), `activity` (movement feed).
- **AppHeader** (one component, all breakpoints):
  - Left: product name; below 1024px also a hamburger (44px).
  - Right: "Add customer" (opens `NewSubscriptionModal`), "Export" menu (customers CSV, daily MRR CSV), `ThemeToggle`.
  - Uses `pt-[env(safe-area-inset-top)]`.
  - Below 1024px the hamburger opens a `SlideOverDrawer` containing the five anchor links and "Reset demo data".
  - At 1024px and up a fixed 240px left rail holds the five anchor links, with "Reset demo data" at its bottom.
- **Breakpoints**:
  - `360px`-`430px`: single column; ledger shown as card rows (`md:hidden`) with a 44px "Load more" button (20 per click); filters open in a drawer.
  - `768px`: 2-column KPI grid, inline sticky filter bar, desktop table.
  - `1024px`: 240px rail, 2-column KPI grid (only ~784px of canvas remains).
  - `1280px+` (`xl:`): 4-column KPI grid, 12-column analytics canvas.
- **KPI hierarchy**:
  - Primary 4 cards: Net MRR, ARR, NRR, Logo Churn.
  - Secondary stat strip: ARPU, LTV, Active Customers, Trial Conversion.
  - Compact currency uses CSS-only dual rendering (no JS media queries):
    `<span class="sm:hidden">compact</span><span class="hidden sm:inline">full</span>`.
- **Touch and overflow rules**:
  - Every interactive control (buttons, legend toggles, tabs, pagination, chips) is at least `min-h-11 min-w-11` (44px).
  - Every flex and grid child declares `min-w-0`.
  - Form inputs use `text-base` (>=16px) to prevent iOS focus zoom.
  - Every horizontally scrolling region uses `overflow-x-auto overscroll-x-contain`, `tabIndex={0}`, `role="region"`, an `aria-label`, and `focus-visible:ring-2 focus-visible:ring-zinc-500`.
  - Table classes: `hidden md:table border-separate border-spacing-0` on the `<table>`; `sticky left-0 z-10 bg-white dark:bg-zinc-950` on the pinned `<th>`/`<td>` cells.
  - `SlideOverDrawer`: renders through `createPortal` into `#drawer-root` and returns `null` until mounted; sets `inert` imperatively on `#app-root` (never on the drawer) with cleanup on unmount; locks and restores `document.body.style.overflow`; traps focus; closes on `Escape`; returns focus to the trigger.
  - Failures and confirmations are announced through a `role="status"` live region.

---

## 2. Data Schema & TypeScript Interfaces

### File Target: `src/types/analytics.ts`

```typescript
export type SubscriptionTier = 'starter' | 'pro' | 'scale' | 'enterprise';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';
export type BillingInterval = 'monthly' | 'annual';
export type DateRangePreset = '7d' | '30d' | '90d' | '12m' | 'all';
export type AcquisitionChannel = 'organic_search' | 'product_hunt' | 'x_social' | 'direct' | 'referral';
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
  version: number; // starts at 1; +1 on every mutation of this customer
  organizationName: string;
  email: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  mrrCents: number; // normalized integer cents; annual = Math.round(annualCents / 12); trialing = 0
  previousMrrCents: number; // MRR immediately before the latest churn or contraction (0 until one occurs)
  channel: AcquisitionChannel;
  countryCode: string; // ISO 3166-1 alpha-2, uppercase
  seatCount: number;
  apiCalls30d: number;
  cohortMonth: string; // UTC YYYY-MM, equals UTC YYYY-MM of createdAt
  createdAt: string; // UTC ISO-8601
  updatedAt: string; // UTC ISO-8601
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  convertedAt: string | null;
  canceledAt: string | null;
}

export interface RevenueMovementEvent {
  id: string; // append-only: events have no version
  customerId: string;
  organizationName: string;
  tier: SubscriptionTier; // tier at event time (display only; filters use the customer's CURRENT tier)
  channel: AcquisitionChannel;
  type: RevenueMovementType;
  mrrBeforeCents: number;
  mrrAfterCents: number;
  deltaMrrCents: number; // signed; non-zero ONLY for new_business, reactivation, expansion, contraction, churn
  previousTier: SubscriptionTier | null;
  currentTier: SubscriptionTier;
  occurredAt: string; // UTC ISO-8601
  createdAt: string; // UTC ISO-8601
}

export interface CohortRetentionRow {
  id: string;
  cohortMonth: string; // UTC YYYY-MM
  initialCustomers: number;
  initialMrrCents: number;
  retentionByMonth: (number | null)[]; // M0..M5 logo retention %; M0 = 100; null = unelapsed
  netDollarRetentionPercent: number | null; // null when initialMrrCents is 0
}

export interface DerivedDailyMetric {
  date: string; // UTC YYYY-MM-DD (bucket start when weekly)
  grossMrrCents: number;
  newMrrCents: number; // new_business + reactivation deltas
  expansionMrrCents: number;
  contractionMrrCents: number; // positive magnitude
  churnedMrrCents: number; // positive magnitude
  netDeltaMrrCents: number;
  activeSubscribers: number;
}

export interface DashboardStateSnapshot {
  schemaVersion: 1;
  revision: number;
  asOf: string; // UTC ISO-8601 at 00:00:00.000Z of the snapshot's anchor day
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
  mrrGrowthPercent: number | null; // null when baseline is 0
  arrCents: number;
  netRevenueRetentionPercent: number | null;
  logoChurnRatePercent: number;
  arpuCents: number;
  estimatedLtvCents: number;
  activeCustomersCount: number;
  trialConversionRatePercent: number | null; // null when no trials ended in window
}

export interface KpiResult {
  current: KpiSummary;
  previous: KpiSummary | null; // null for 'all' or when the previous window precedes the data
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
  billingInterval: BillingInterval;
  status: 'active' | 'trialing';
  mrrCents: number; // already normalized to monthly cents (0 when trialing)
  channel: AcquisitionChannel;
  countryCode: string;
  seatCount: number;
  apiCalls30d: number;
}

export interface MutationContext {
  now: Date;
  nextId: () => string; // injected id source keeps reducers pure
}

export type StoreState = {
  status: 'loading' | 'ready' | 'error';
  snapshot: DashboardStateSnapshot | null;
  error: string | null;
};

export type MutationResult =
  | { ok: true; snapshot: DashboardStateSnapshot }
  | { ok: false; error: string };
```

### Validation & Guard Rules (`src/lib/validators.ts`)
- **Indexed access rule (`noUncheckedIndexedAccess`)**: never index without a guard. Use `?.`, `.at()`, `?? fallback`, or an explicit bounds check. `arr[i].field` is forbidden.
- **Field validators** (each returns `ValidationResult<T>`):
  - `id`: `/^[a-z0-9_-]{6,36}$/i`, unique across customers.
  - `email`: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, lowercased, case-insensitive unique among customers.
  - `organizationName`: trimmed, 1 to 80 characters.
  - `tier`, `status`, `channel`, `billingInterval`: must be members of their unions.
  - `countryCode`: `/^[A-Z]{2}$/`.
  - `mrrCents`, `previousMrrCents`: integers 0 to 50_000_000; `mrrCents === 0` when `status === 'trialing'`.
  - `seatCount`: integer 1 to 10_000. `apiCalls30d`: integer >= 0.
  - Timestamps: valid UTC ISO-8601; `updatedAt >= createdAt`; `trialEndsAt >= trialStartedAt` when both present.
  - `cohortMonth`: `/^\d{4}-(0[1-9]|1[0-2])$/` and equals the UTC `YYYY-MM` of `createdAt`.
- **Lifecycle rules**: `past_due` customers may exist in seed data; no UI mutation moves a customer into or out of `past_due`.
- **Ledger invariant** (event-sourced guarantee, used by seed, every reducer, and tests):
  ```typescript
  export function assertLedgerInvariant(snapshot: DashboardStateSnapshot): void {
    for (const customer of snapshot.customers) {
      const sum = snapshot.events
        .filter(e => e.customerId === customer.id)
        .reduce((acc, e) => acc + e.deltaMrrCents, 0);
      if (sum !== customer.mrrCents) {
        throw new Error(`Ledger invariant broken for ${customer.id}: sum=${sum}, mrr=${customer.mrrCents}`);
      }
    }
  }
  ```

---

## 3. Storage, Concurrency & Reactive State

### Storage Topology
- `microsaas_v1_state`: `DashboardStateSnapshot` (business data only).
- `microsaas_v1_theme`: `'light' | 'dark'`.
- `microsaas_v1_ui_prefs`: `DashboardFilterState` (device-level, managed by `useUiPrefs`).

### Deterministic Seed Engine (`src/lib/seed.ts`)
- Signature: `generateSeed(now: Date, seedConstant = 42): DashboardStateSnapshot`. PRNG: Mulberry32 seeded by `seedConstant`. Ids come from the PRNG (`cus_xxxxxxxx`, `evt_xxxxxxxx`). Tests pass a frozen `now`.
- `asOf` = UTC midnight of `now`. History spans 400 days backward from `asOf`.
- 65 B2B customers with `createdAt` spread across the 400 days. Every customer's history is simulated forward event by event, so the ledger invariant holds by construction.
- Lifecycle mix (approximate): 25% trial-originated (about 70% of those convert; the rest end as `trial_canceled` or remain `trialing`); about 15% of paying customers churn; 20% expand; 8% contract; 3% reactivate. A few customers are `past_due` (status only, no event).
- Guarantees (each covered by a test):
  - At least 10 active customers have `createdAt` on day 0 (`asOf` minus 400 days) so the `all` growth baseline is non-zero.
  - Every preset window, including `7d`, contains at least 3 events.
  - `assertLedgerInvariant` passes before the snapshot is returned.

### Pure Mutation Reducers (`src/lib/mutations.ts`)
Every reducer has the signature `(snapshot, args, ctx: MutationContext) => MutationResult`. No `window`, no `localStorage`, no `Date.now()`. Unit-testable in Node.
- **Common rules**:
  - Customer mutations (everything except add) take `expectedVersion`. If `customer.version !== expectedVersion` return `{ ok: false, error: 'Concurrency conflict: customer version mismatch' }`.
  - Every successful customer mutation sets `customer.updatedAt = now` and `customer.version += 1`.
  - Every reducer ends with `assertLedgerInvariant` inside try/catch, returning `{ ok: false, error }` on failure.
  - A no-op returns `{ ok: true, snapshot }` with the SAME snapshot reference (storage uses reference equality to skip the write and the revision bump).
  - Ids for new customers and events come from `ctx.nextId()`.
- **`addCustomerSubscription(snapshot, payload: AddCustomerPayload, ctx)`**: runs the validators (including email uniqueness); derives `cohortMonth`, `createdAt`, `updatedAt` from `ctx.now`; `version = 1`; `previousMrrCents = 0`. Status `trialing`: `trialStartedAt = now`, `trialEndsAt = now + 14 days`, emits `trial_started` (delta 0). Status `active`: emits `new_business` (delta = `mrrCents`).
- **`updateCustomerTier(snapshot, { customerId, newTier, newMrrCents, expectedVersion }, ctx)`**: rejects `canceled` and `trialing`. Same tier and same MRR is a no-op. Otherwise emits `expansion` (delta > 0) or `contraction` (delta < 0); a contraction sets `previousMrrCents` to the pre-change MRR. A tier change with delta 0 and a different tier updates the tier and emits no event.
- **`cancelSubscription(snapshot, { customerId, expectedVersion }, ctx)`**: already `canceled` is a no-op. Otherwise emits `churn` (delta = `-mrrCents`), sets `previousMrrCents = mrrCents`, `mrrCents = 0`, `status = 'canceled'`, `canceledAt = now`.
- **`convertTrial(snapshot, { customerId, newTier, newMrrCents, expectedVersion }, ctx)`**: only from `trialing`. Emits `trial_converted` (delta 0, before = after = 0) then `new_business` (delta = `newMrrCents`). Sets `status = 'active'`, `tier = newTier`, `mrrCents = newMrrCents`, `convertedAt = now`.
- **`cancelTrial(snapshot, { customerId, expectedVersion }, ctx)`**: only from `trialing`. Emits `trial_canceled` (delta 0). Sets `status = 'canceled'`, `canceledAt = now`.
- **`reactivateSubscription(snapshot, { customerId, newTier, newMrrCents, expectedVersion }, ctx)`**: only from `canceled`. Emits `reactivation` (delta = `newMrrCents`). Sets `status = 'active'`, `tier = newTier`, `mrrCents = newMrrCents`, `canceledAt = null`.
- **`resetSnapshot`** is not a reducer: `storage.ts` builds it via `generateSeed`.

### Locking & Persistence (`src/lib/storage.ts`)
- **Lock wrapper**:
  ```typescript
  let memoryLockQueue: Promise<unknown> = Promise.resolve();

  export async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request('microsaas_state_lock', async () => fn());
    }
    const result = memoryLockQueue.then(() => fn());
    memoryLockQueue = result.then(() => undefined, () => undefined);
    return result;
  }
  ```
- **Id source**: `makeId(prefix)` returns `prefix + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)` (matches the id regex), with a counter-based fallback.
- **Mutation flow** (`runMutation(reducer, args)`), entirely inside `withStateLock`:
  1. Read and parse `microsaas_v1_state`, then validate its shape (`schemaVersion === 1`, arrays present, ledger invariant).
  2. Call the pure reducer with `{ now: new Date(), nextId }`.
  3. If the reducer returned `ok: false`, return it unchanged.
  4. If the returned snapshot is the same reference as the input (no-op), return it without writing.
  5. Otherwise set `asOf` to the current UTC midnight, `revision = revision + 1`, `updatedAt = now`, and serialize.
  6. Wrap `setItem` in try/catch. On `QuotaExceededError` return `{ ok: false, error: 'Storage quota exceeded' }`, leave storage untouched, and let the store surface the error state.
  7. Notify module-level subscribers and return `{ ok: true, snapshot }`.
- **`initStore()`**: inside `withStateLock`, re-check that the snapshot key is still missing, then write `generateSeed(new Date())` at `revision: 1`. If the key exists but fails validation, do NOT overwrite; set the store to `error`.
- **`resetDemoDataset()`**: inside `withStateLock`, write `generateSeed(new Date())` with `revision = (lastKnownRevision ?? 0) + 1`, then notify subscribers.

### Reactive Store (`src/hooks/useAnalyticsStore.ts`)
- Built on `useSyncExternalStore` with a module-level `Set<() => void>` of listeners. Same-tab mutations notify it directly (the `storage` event only fires in OTHER tabs).
- `SERVER_SKELETON_STATE = { status: 'loading', snapshot: null, error: null }` is a frozen constant and is also the `getServerSnapshot`.
- `getSnapshot()` returns a cached `StoreState` reference that changes only when a verified storage read or a mutation produces a new state. It never parses JSON on every call and never writes storage.
- `initStore()` runs from a `useEffect` in `DashboardClient`.
- **Cross-tab listener**: on `storage` events for `microsaas_v1_state`:
  - `e.key === null` (storage cleared) or `e.newValue === null`: re-run `initStore()` inside the lock.
  - Otherwise parse and validate `e.newValue`; apply only if `incoming.revision > current.revision` (equal or lower revisions are ignored). A parse or validation failure sets `status: 'error'` without overwriting data.
- **Actions API**: `useAnalyticsStore()` returns `{ state, actions }`. Every action returns `Promise<MutationResult>`; when `state.status !== 'ready'` it returns `{ ok: false, error: 'Store not ready' }`. Actions: `addCustomer`, `updateTier`, `cancelSubscription`, `convertTrial`, `cancelTrial`, `reactivate`, `resetDemo`.
- On a version-conflict error the hook reloads the snapshot from storage; the UI announces "This record changed in another tab. Refreshed, please retry." in the live region.

### UI Preferences Store (`src/hooks/useUiPrefs.ts`)
- Persists `DashboardFilterState` to `microsaas_v1_ui_prefs` inside try/catch, falling back to in-memory state.
- Same external-store pattern with module-level listeners, so filter changes never bump the business `revision`.
- Defaults: `dateRange: '30d'`, tier and channel `'all'`, empty search, sort `createdAt` descending.

### Destructive Actions
- "Reset demo data" and "Repair local state" both destroy user-added data and therefore require a two-step confirmation dialog (confirm button 44px, focus on the cancel button by default).

---

## 4. UI Primitives, Charts & Components

### Hooks
- `usePrefersReducedMotion.ts`: `useSyncExternalStore` over `matchMedia('(prefers-reduced-motion: reduce)')`, server snapshot `false`. Charts pass `isAnimationActive={!reduced}`.

### In-House Chart Primitives (`src/components/ui/*`)
Self-contained Recharts wrappers with no copy-paste library dependencies. Color maps live in `src/lib/chartUtils.ts` (static class literals, tick and domain helpers).
- `Legend.tsx`: series toggles as native `<button type="button" aria-pressed>` (44px).
- `SparkAreaChart.tsx`: non-interactive sparkline, fixed container size.
- `AreaChart.tsx`: multi-series area chart in a fixed-height container (`h-64` or `h-72`).
- `BarChart.tsx`: stacked or grouped bars.
- `BarList.tsx`: div-based horizontal bars with explicit numeric labels (not color alone).
- `DonutChart.tsx`: ring chart with a centered value.
- **Chart rules**:
  - Every chart has an `aria-label` and an `sr-only` summary line.
  - Tap contract: the chart-level `onClick` (for BarChart too, never `<Bar onClick>`) reads `activeTooltipIndex`, coerces with `Number()`, guards against `NaN` or `undefined`, and lifts the index to the feature component. A tap outside the chart clears it.
  - Windows longer than 120 days (`12m`, `all`) render weekly buckets (see `bucketSeries`).

### Atomic Primitives (`src/components/primitives/*`)
- `ThemeToggle.tsx`: 44px; writes `microsaas_v1_theme` in try/catch; toggles `.dark` and `color-scheme`.
- `MetricBadge.tsx`: shows an arrow and the number, never color alone. Supports inverse semantics (for churn, an increase is bad).
- `SegmentedControl.tsx`: `role="tablist"`, Left/Right/Home/End keyboard navigation, `min-h-11`.
- `SlideOverDrawer.tsx`: behavior as specified in Section 1.
- `EmptyStateCard.tsx`: zero-result card with a 44px "Reset filters" button.
- `ConfirmDialog.tsx`: two-step confirmation used by cancel subscription, reset demo data, and repair local state.

### Molecules (`src/components/molecules/*`)
- `AppHeader.tsx`: as specified in Section 1.
- `KpiBentoCard.tsx`: a single `<button type="button" aria-pressed={selected}>` (`min-h-11`) with NO nested interactive elements; value in `text-2xl sm:text-3xl font-semibold min-w-0 truncate`; CSS-only compact/full formatting; sparkline; `MetricBadge` delta (hidden when `previous` is null).
- `InteractiveChartInspector.tsx`: pinned readout bar above the charts. Shows the selected KPI's value and delta, plus the composition values for the selected chart point when one is set.
- `NewSubscriptionModal.tsx`: validated dialog (live field errors, submit disabled while in flight); for annual billing the form takes the annual price and the modal normalizes with `Math.round(annualCents / 12)`; supports `active` and `trialing`.
- `FilterControlBar.tsx`: desktop inline bar (date range, tier, channel, search, sort); mobile "Filters" button opening a `SlideOverDrawer` with the same controls and a sticky footer of 44px "Apply" and "Reset" buttons.

### Features (`src/components/features/*`)
- `DashboardClient.tsx`: root client component. Owns `selectedKpi: KpiMetricKey` (default `'netMrr'`) and `selectedPoint: { index: number; date: string } | null`; calls `initStore()` in `useEffect`; renders skeleton, error banner, or content by `StoreState.status`; hosts the live region and modals.
- `MrrCompositionChart.tsx`: composition series (new, expansion, contraction, churn, gross) with `Area`/`Bar` toggle and legend toggles. Always plots composition; KPI selection only affects the inspector.
- `TierDistributionCard.tsx`: `DonutChart` (MRR by tier) plus `BarList` (MRR by channel).
- `CohortRetentionMatrix.tsx`: scroll region with `min-w-[520px]` table, sticky cohort label column, heat cells showing the percentage text, "—" for null.
- `RevenueMovementFeed.tsx`: recent events with before/after MRR; trial events display without a dollar delta.
- `CustomerLedgerTable.tsx`:
  - Desktop (`>=768px`): sortable header buttons with `aria-sort`; 10 rows per page; numbered Prev/Next controls (44px) and "Page X of Y".
  - Mobile (`<768px`): card rows; "Load more" (20 per click).
  - Row actions open a bottom-sheet (`SlideOverDrawer`): change tier, convert trial, cancel trial, reactivate, cancel subscription (two-step `ConfirmDialog`). Every action passes the row's `version` as `expectedVersion`.
  - `searchQuery` filters only this table and the customers CSV.

### Application States
- **Loading** (`status === 'loading'`): skeleton with fixed card and chart heights (CLS = 0).
- **Empty** (`status === 'ready'` and filtered customers === 0): `EmptyStateCard` with "Reset filters".
- **Error** (`status === 'error'`): non-blocking banner (corrupt JSON, failed validation, quota exceeded) with a "Repair local state" action behind a `ConfirmDialog`.

---

## 5. Domain Calculations & SaaS Metrics (`src/lib/calculations.ts`, `src/lib/csv.ts`)

### Time Model (defined once, used by every metric)
- `now` is always a parameter. `effectiveAsOf = max(snapshot.asOf, UTC midnight of now)`, computed in memory only (never written).
- `windowDays`: `7d` = 7, `30d` = 30, `90d` = 90, `12m` = 365, `all` = whole days between the first seeded day and `effectiveAsOf` (minimum 1).
- The window is `(start, end]` where `end` is the end of the `effectiveAsOf` UTC day and `start` is the end of the UTC day `windowDays` before it.
- **Ledger reconstruction**: customer MRR at the end of day T is the sum of `deltaMrrCents` of that customer's events with `occurredAt < T + 1 day` (inclusive end of day).
- `activeSubscribers(T)` = number of filtered customers whose reconstructed MRR at the end of T is > 0.
- **Filter semantics**: tier and channel filters resolve against the customer's CURRENT tier and channel via `customerId`, and apply to KPIs, charts, cohorts, feed, ledger, and CSV. `searchQuery` applies ONLY to the ledger table and the customers CSV.
- Historical daily series come from `snapshot.events` only.

### Metric Formulas
1. **Net MRR** = sum of `mrrCents` over `active` and `past_due` customers (trialing and canceled contribute 0).
2. **ARR** = Net MRR x 12.
3. **MRR Growth %** = (current Net MRR - baseline MRR) / baseline MRR x 100, where baseline is the reconstructed MRR at the end of `start` (for `all`, the MRR at the end of the first seeded day). If baseline is 0, return `null` and the UI renders a single em dash "—".
4. **Logo Churn %** = `churn` events in window / max(1, `activeSubscribers(start)` + New Customers in Window) x 100. New Customers in Window = distinct customers with a `new_business` event in the window (reactivations excluded). `trial_canceled` is never counted.
5. **Trial Conversion %** = `trial_converted` events / (`trial_converted` + `trial_canceled` events) x 100 in the window; `null` when the denominator is 0.
6. **NRR %**: the cohort is customers with reconstructed MRR > 0 at the end of `start`. Cohort Start MRR is their summed MRR at that moment. Over the window, only events from cohort customers count: `expansion` adds, `contraction` and `churn` subtract; `reactivation` and `new_business` are excluded. NRR = (Start + Expansion - Contraction - Churn) / Start x 100; `null` when Start is 0.
7. **ARPU** = `Math.round(Net MRR / max(1, active + past_due customers))`.
8. **LTV**: `c = churn% / 100`; `monthlyChurn = max(0.008, 1 - (1 - min(0.99, c)) ^ (30 / windowDays))`; LTV = `Math.round(ARPU / monthlyChurn)`.

### Cohorts (derived at runtime, never stored)
- Group customers by UTC month of `createdAt`; show the last 6 UTC calendar months including the current one.
- `initialCustomers` = all customers in the cohort. `initialMrrCents` = sum of each cohort customer's FIRST `new_business` delta, regardless of its date (so converted trials count).
- Logo retention for month k = share of cohort customers not canceled at the end of month k (canceled = latest event of type `churn` or `trial_canceled` up to that time). M0 = 100%. Month k is `null` when cohortMonth + k lies after the current UTC month.
- `netDollarRetentionPercent` = current cohort MRR / `initialMrrCents` x 100; `null` when `initialMrrCents` is 0.

### KPI Results, Series & Bucketing
- `computeKpis(snapshot, filters, now): KpiResult`. `previous` evaluates the same formulas over the equal-length preceding window (end = `start`); it is `null` for `all` or when that window starts before the first seeded day.
- `kpiSeries(snapshot, filters, now, metric)` feeds the sparklines:
  - `netMrr`: daily gross MRR.
  - `arr`: daily gross MRR x 12.
  - `nrr`: weekly samples of trailing-30-day NRR across the window (at least 4 points).
  - `logoChurn`: weekly churn-event counts.
- `bucketSeries(series, 'day' | 'week')`: flows (new, expansion, contraction, churned, netDelta) are summed in the bucket; levels (gross MRR, activeSubscribers) take the last value. Windows over 120 days render weekly; the daily CSV stays daily.
- `MetricBadge` uses inverse semantics for churn and shows no delta when `previous` is `null`.

### CSV Exporter (`src/lib/csv.ts`)
- **Formula-injection guard**: in TEXT columns only (`organizationName`, `email`, `countryCode`, `tier`, `channel`, `status`), a cell starting with `=`, `+`, `-`, `@`, a tab, or a carriage return is prefixed with `'`. Numeric columns (including negative deltas) are written as raw numbers.
- **RFC 4180**: cells containing commas, quotes, or newlines are wrapped in double quotes with `"` escaped as `""`; rows end with `\r\n`.
- **Encoding and names**: UTF-8 BOM prepended. Files: `customers_asof_YYYY-MM-DD.csv` (filtered ledger) and `daily_mrr_asof_YYYY-MM-DD.csv` (daily derived series), dated by `effectiveAsOf`.
- `useCsvExport` downloads via `URL.createObjectURL` and revokes the URL afterward.

---

## 6. Six-Phase Sequential Implementation Plan

### Phase 0: Baseline Shell, Tooling & Tailwind v4
- [ ] `package.json`: bleeding-edge exact versions (highest across all dist-tags, per the Section 1 policy) resolved via `pnpm view`, `packageManager`, `pnpm.overrides` (`react-is`), `pnpm.onlyBuiltDependencies` if needed, `engines`, scripts (Section 1); `.npmrc` (`engine-strict=true`, `strict-peer-dependencies=false`); commit `pnpm-lock.yaml`.
- [ ] Playwright browser install: `pnpm exec playwright install chromium` (documented in `README.md`).
- [ ] `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json` (Section 1).
- [ ] `postcss.config.mjs` (`@tailwindcss/postcss`), `next.config.ts`, `.gitignore`, `README.md` (resolved-version table).
- [ ] `src/app/globals.css`: `@import "tailwindcss";`, system `--font-sans` token, `@custom-variant dark`, tooltip-suppression rule, reduced-motion-safe smooth scroll.
- [ ] `src/app/layout.tsx`: `viewport` export, `<html lang="en" suppressHydrationWarning>`, blocking theme script, `#app-root` and `#drawer-root`.
- [ ] Minimal placeholder `src/app/page.tsx`.
- **Gate**: `pnpm build && pnpm typecheck && pnpm lint` exits 0.

### Phase 1: Types, Validators, Seed, Reducers, Storage & Ledger Tests
- [ ] `src/types/analytics.ts` (all contracts in Section 2).
- [ ] `src/lib/utils.ts`: `'en-US'` / UTC formatters, `cn`.
- [ ] `src/lib/validators.ts`: field validators, `ValidationResult`, `assertLedgerInvariant`.
- [ ] `src/lib/seed.ts`: `generateSeed(now, seedConstant)`.
- [ ] `src/lib/mutations.ts`: the six pure reducers with injected ids.
- [ ] `src/lib/storage.ts`: `withStateLock`, `runMutation`, `initStore`, `resetDemoDataset`, quota handling.
- [ ] `src/lib/__tests__/ledger.test.ts`: ledger invariant across all event types; deterministic seed with a frozen date; day-0 baseline (>= 10 active customers) and `7d` window (>= 3 events); every reducer and guard (canceled, trialing, version mismatch, no-op, idempotent cancel, duplicate email, invalid payload).
- **Gate**: `pnpm build && pnpm typecheck && pnpm test`.

### Phase 2: Chart Primitives & UI Atoms
- [ ] `src/lib/chartUtils.ts` (pure; static class literals).
- [ ] `src/hooks/usePrefersReducedMotion.ts`.
- [ ] `src/components/ui/`: `Legend`, `SparkAreaChart`, `AreaChart`, `BarChart`, `BarList`, `DonutChart`.
- [ ] `src/components/primitives/`: `ThemeToggle`, `MetricBadge`, `SegmentedControl`, `SlideOverDrawer`, `EmptyStateCard`, `ConfirmDialog`.
- **Gate**: `pnpm build && pnpm typecheck && pnpm test`.

### Phase 3: Molecules & Feature Components
- [ ] `AppHeader`, `KpiBentoCard`, `InteractiveChartInspector`, `NewSubscriptionModal`, `FilterControlBar`.
- [ ] `MrrCompositionChart`, `TierDistributionCard`, `CohortRetentionMatrix`, `RevenueMovementFeed`, `CustomerLedgerTable`.
- **Gate**: `pnpm build && pnpm typecheck && pnpm test`.

### Phase 4: Calculations, CSV, Stores & Their Tests
- [ ] `src/lib/calculations.ts`: time model, reconstruction, `computeKpis`, `kpiSeries`, `bucketSeries`, cohorts; all with a `now` parameter.
- [ ] `src/lib/csv.ts`.
- [ ] `src/hooks/useAnalyticsStore.ts`, `src/hooks/useUiPrefs.ts`, `src/hooks/useCsvExport.ts`.
- [ ] `src/lib/__tests__/calculations.test.ts`: formulas, zero-baseline and zero-customer edge cases, NRR cohort isolation, inclusive end-of-day reconstruction, window and `windowDays` mapping, trial-cohort `initialMrrCents`, cohort nulls, `previous` window, bucketing, filter semantics (tier by current customer tier, search excluded from KPIs).
- [ ] `src/lib/__tests__/csv.test.ts`: RFC 4180 quoting, text-only injection prefix (including tab and CR), negative numbers untouched, BOM, filenames.
- **Gate**: `pnpm build && pnpm typecheck && pnpm test`.

### Phase 5: Integration, Responsive Verification & Final Gate
- [ ] `src/app/page.tsx`: Server Component rendering `<DashboardClient />`; wire all sections, anchors, rail, header actions, drawers, live region.
- [ ] `e2e/responsive.spec.ts` for viewports 360, 390, 430, 768, 1024, 1280:
  - `document.documentElement.scrollWidth <= window.innerWidth`;
  - no console message containing "Hydration";
  - every visible `button` and `[role=tab]` has a bounding box of at least 44x44;
  - at 390px, tapping a chart updates `InteractiveChartInspector`.
  - If Playwright browsers cannot be downloaded, keep the specs and run them as a manual checklist.
- **Gate**: `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm e2e`. Zero warnings and zero hydration errors.