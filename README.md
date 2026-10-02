# Micro-SaaS Analytics Dashboard

A high-performance, precision-engineered B2B Micro-SaaS analytics dashboard built with Next.js (App Router), Tailwind CSS v4, and self-contained Recharts data visualization primitives. Engineered to emulate the aesthetic and rigor of Tier-1 financial tools (Vercel, Stripe), featuring double-entry event-sourced ledger reconstruction, cross-tab atomic concurrency, and responsive mobile-first ergonomics.

- Repository: https://github.com/mmy-lana/nextjs-tremor-microsaas-analytics
- Live Application: https://nextjs-tremor-microsaas-analytics.vercel.app

---

## Key Features

- Event-Sourced Financial Ledger: Historical and current MRR values are never stored as mutable totals; they are reconstructed on-the-fly from an append-only timeline of signed delta events (`deltaMrrCents`).
- Deterministic Math & Zero Drift: Financial metrics are calculated in integer cents to eliminate IEEE 754 floating-point rounding drift.
- Concurrency & Multi-Tab Synchronization: State transitions execute within atomic transactions managed by the Web Locks API (`navigator.locks`) with in-memory Promise queue fallbacks and monotonic revision checking.
- Real-Time SaaS Performance Metrics:
  - Net MRR & ARR (Annual Run Rate)
  - Cohort-isolated Net Revenue Retention (NRR)
  - Normalized Logo Churn Rate & Customer Lifetime Value (LTV)
  - Average Revenue Per User (ARPU) & Trial Conversion Rate
  - M0–M5 Cohort Retention Heatmap (Logo Retention % and Net Dollar Retention %)
- Accessible, Hover-Free Visualizations: In-house Recharts wrappers providing tapped coordinate inspection (`InteractiveChartInspector`) that does not depend on desktop mouse hover states.
- RFC 4180 Compliant CSV Export: Client-side CSV generator with UTF-8 BOM and defensive formula injection mitigation (CWE-1236) protecting against spreadsheet DDE/macro exploits.
- Flash-Free Dark Mode: Synchronous layout bootstrap script evaluating localStorage and system preferences prior to first paint.
- Mobile-First Interface: Certified responsive layout down to 360px viewport width, enforcing 44x44px minimum touch targets and mobile card-row fallbacks.

---

## Financial Logic & SaaS Metric Engine

All domain calculations are pure functions isolated in `src/lib/calculations.ts`, taking an explicit `now` parameter to ensure consistency across server renders, client hydration, and automated unit tests.

### Mathematical Definitions

1. Net MRR:
   Net MRR = Sum of customer.mrrCents for all customers with status 'active' or 'past_due'. Customers with status 'trialing' or 'canceled' contribute 0 cents.

2. Annual Run Rate (ARR):
   ARR = Net MRR * 12

3. Net Revenue Retention (NRR %):
   Evaluated strictly over the cohort of customers active at the start of the window:
   NRR = ((Start MRR + Expansion MRR + Contraction MRR + Churned MRR) / Start MRR) * 100
   *Note: Contraction and Churn carry negative deltas. New business and reactivations inside the window are excluded to prevent cohort inflation.*

4. Logo Churn Rate (%):
   Logo Churn Rate = (Count of 'churn' events in window / max(1, Active Subscribers at Start + New Customers in Window)) * 100
   *Note: 'trial_canceled' events are excluded from logo churn.*

5. Normalized Lifetime Value (LTV):
   Normalizes the window-level churn rate to an equivalent 30-day monthly churn fraction:
   c = Logo Churn Rate / 100
   Monthly Churn = max(0.008, 1 - (1 - min(0.99, c)) ^ (30 / windowDays))
   Estimated LTV = Math.round(ARPU / Monthly Churn)

6. Cohort Retention & Net Dollar Retention (NDR %):
   - M0 Logo Retention is fixed at 100%.
   - Month k Logo Retention evaluates active accounts against unelapsed UTC calendar months.
   - NDR % evaluates current cohort MRR against the initial Month 0 opening new-business value.

---

## Architecture & Security Model

### Strict Dependency Chain
Dependencies flow in one direction to eliminate circular references and side-effects:
```
src/types/analytics.ts
  -> src/lib/utils.ts, src/lib/validators.ts, src/lib/chartUtils.ts
  -> src/lib/seed.ts
  -> src/lib/mutations.ts
  -> src/lib/storage.ts
  -> src/lib/calculations.ts, src/lib/csv.ts
  -> src/hooks/*
  -> src/components/*
```

### Storage Topology & State Isolation
- `microsaas_v1_state`: Core immutable snapshot containing `schemaVersion`, `revision`, `asOf`, customer records, and ledger events.
- `microsaas_v1_ui_prefs`: Device-isolated filter preferences (`dateRange`, `tier`, `channel`, `searchQuery`, `sortField`). Modifying UI filters does not bump business state revisions or trigger cross-tab conflicts.
- `microsaas_v1_theme`: Theme choice (`light` | `dark`), read by an inline script in `<head>` before stylesheet execution to eliminate theme flash.

### Security Controls
- CSV Formula Injection Mitigation (CWE-1236): Text cells are trimmed and inspected for formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`). Vulnerable values are prefixed with a single quote (`'`), while numeric columns are preserved as raw numbers.
- Security Headers: Configured in `next.config.ts` (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`).
- Optimistic Concurrency: All customer mutations accept an `expectedVersion`. Concurrent writes from other tabs are rejected with concurrency conflict signals.

---

## Tech Stack

- Framework: Next.js (App Router)
- Language: TypeScript (Strict mode, `noUncheckedIndexedAccess: true`)
- Styling: Tailwind CSS v4 (`@tailwindcss/postcss`)
- Charts: In-house Recharts wrappers (`recharts`)
- Icons: Lucide React (`lucide-react`)
- Package Manager: pnpm
- Unit Testing: Vitest (`vitest`)
- End-to-End Testing: Playwright (`@playwright/test`)

---

## Project Structure

```text
├── e2e/                           # Playwright end-to-end responsive test suite
│   └── responsive.spec.ts
├── src/
│   ├── app/                       # Next.js App Router entry points & global styles
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── features/              # Complex domain feature assemblies
│   │   │   ├── CohortRetentionMatrix.tsx
│   │   │   ├── CustomerLedgerTable.tsx
│   │   │   ├── DashboardClient.tsx
│   │   │   ├── MrrCompositionChart.tsx
│   │   │   ├── RevenueMovementFeed.tsx
│   │   │   └── TierDistributionCard.tsx
│   │   ├── molecules/             # Composite UI components
│   │   │   ├── AppHeader.tsx
│   │   │   ├── FilterControlBar.tsx
│   │   │   ├── InteractiveChartInspector.tsx
│   │   │   ├── KpiBentoCard.tsx
│   │   │   └── NewSubscriptionModal.tsx
│   │   ├── primitives/            # Reusable atomic UI elements
│   │   │   ├── ConfirmDialog.tsx
│   │   │   ├── EmptyStateCard.tsx
│   │   │   ├── MetricBadge.tsx
│   │   │   ├── SegmentedControl.tsx
│   │   │   ├── SlideOverDrawer.tsx
│   │   │   └── ThemeToggle.tsx
│   │   └── ui/                    # In-house chart visualization components
│   │       ├── AreaChart.tsx
│   │       ├── BarChart.tsx
│   │       ├── BarList.tsx
│   │       ├── DonutChart.tsx
│   │       ├── Legend.tsx
│   │       └── SparkAreaChart.tsx
│   ├── hooks/                     # Custom reactive hooks & store bridges
│   │   ├── useAnalyticsStore.ts
│   │   ├── useCsvExport.ts
│   │   ├── useHydrated.ts
│   │   ├── usePrefersReducedMotion.ts
│   │   └── useUiPrefs.ts
│   ├── lib/                       # Pure utilities, reducers, seed & domain math
│   │   ├── __tests__/             # Unit test specifications
│   │   │   ├── calculations.test.ts
│   │   │   ├── csv.test.ts
│   │   │   └── ledger.test.ts
│   │   ├── calculations.ts
│   │   ├── chartUtils.ts
│   │   ├── csv.ts
│   │   ├── mutations.ts
│   │   ├── seed.ts
│   │   ├── storage.ts
│   │   ├── utils.ts
│   │   └── validators.ts
│   └── types/
│       └── analytics.ts           # Pure TypeScript contracts and interfaces
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── playwright.config.ts
├── pnpm-workspace.yaml
├── postcss.config.mjs
├── tsconfig.json
└── vitest.config.ts
```

---

## Getting Started

### Prerequisites

- Node.js `>=20.9.0`
- pnpm `>=10.0.0`

### Installation

1. Clone repository:
   ```bash
   git clone https://github.com/mmy-lana/nextjs-tremor-microsaas-analytics.git
   cd nextjs-tremor-microsaas-analytics
   ```

2. Install dependencies:
   ```bash
   pnpm install --frozen-lockfile
   ```

3. Install Playwright browser binaries (for e2e tests):
   ```bash
   pnpm exec playwright install chromium
   ```

### Development

Run the local development server:
```bash
pnpm dev
```
Open http://localhost:3000 in your browser.

---

## Verification & Quality Gates

The codebase enforces strict quality gates across compilation, linting, unit testing, and headless browser automation.

| Stage | Command | Target / Standard |
|---|---|---|
| Type Checking | `pnpm typecheck` | TypeScript 5.x strict mode with `noUncheckedIndexedAccess` |
| Linting | `pnpm lint` | ESLint flat config with Next.js core web vitals and TypeScript rules |
| Unit Tests | `pnpm test` | Vitest test runner covering ledger invariant, financial math, mutations, and CSV escaping |
| Production Build | `pnpm build` | Static and dynamic route compilation with zero hydration warnings |
| End-to-End Tests | `pnpm e2e` | Playwright headless Chromium testing across 360px, 390px, 430px, 768px, 1024px, and 1280px |

Execute the full quality audit chain:
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

---

## License

MIT License. Open-source for personal and commercial usage.
