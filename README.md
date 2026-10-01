# nextjs-tremor-microsaas-analytics

Micro-SaaS Analytics Dashboard built with Next.js App Router, Tailwind CSS v4, and self-contained Recharts primitives.

## Scripts
- `pnpm dev`: Start Next.js development server
- `pnpm build`: Create production build
- `pnpm start`: Start production server
- `pnpm lint`: Run ESLint checks
- `pnpm typecheck`: Run TypeScript compiler checks
- `pnpm test`: Run Vitest unit tests
- `pnpm e2e`: Run Playwright end-to-end tests

## Architecture
- Single snapshot state management with `navigator.locks` concurrency safety.
- Zero external copy-paste visualization dependencies; in-house Recharts 2.x wrappers.
- Event-sourced ledger invariant validation.
- Responsive design tailored for mobile-first viewports (360px+) to desktop.
