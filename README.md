# nextjs-tremor-microsaas-analytics

Micro-SaaS Analytics Dashboard built with Next.js App Router, Tailwind CSS v4, and self-contained Recharts primitives.

## Requirements
- Node.js `>=20.9.0` (the floor declared by the installed Next.js)
- pnpm `11.22.0` (pinned through the `packageManager` field)

## Install
```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

## Scripts
- `pnpm dev`: Start Next.js development server
- `pnpm build`: Create production build
- `pnpm start`: Start production server
- `pnpm lint`: Run ESLint checks
- `pnpm typecheck`: Run TypeScript compiler checks
- `pnpm test`: Run Vitest unit tests
- `pnpm e2e`: Run Playwright end-to-end tests (Chromium only, runs against `pnpm start`)

## Architecture
- Single snapshot state management with `navigator.locks` concurrency safety.
- Zero external copy-paste visualization dependencies; in-house Recharts wrappers.
- Event-sourced ledger invariant validation.
- Responsive design tailored for mobile-first viewports (360px+) to desktop.

## Resolved dependency versions

Every dependency is pinned to an exact version. The stack is resolved from the
highest version published across **all** dist-tags (`latest`, `canary`, `next`,
`beta`, `alpha`, `rc`), never `latest` alone.

| Package | Version | Dist-tag resolved from |
| --- | --- | --- |
| `next` | 16.3.7 | `latest` |
| `react` / `react-dom` | 19.3.0 | `latest` |
| `react-is` | 19.3.0 | `latest` |
| `typescript` | 6.0.3 | `latest` — **downgraded, see below** |
| `tailwindcss` / `@tailwindcss/postcss` | 4.3.3 | `latest` |
| `tailwind-merge` | 3.7.0 | `latest` |
| `recharts` | 3.10.1 | `latest` |
| `lucide-react` | 1.49.0 | `latest` |
| `clsx` | 2.1.1 | `latest` |
| `postcss` | 8.5.28 | `latest` |
| `eslint` | 9.39.5 | `maintenance` — **downgraded, see below** |
| `eslint-config-next` | 16.3.7 | `latest` (matches Next) |
| `@types/react` / `@types/react-dom` | 19.3.0 | `latest` (matches React) |
| `@types/node` | 26.6.3 | `latest` |
| `vitest` | 5.0.2 | `latest` |
| `@playwright/test` | 1.63.0 | `latest` |

### Recorded downgrades

Two packages sit one step below the highest published version because the
bleeding-edge releases are not yet compatible with the rest of the toolchain.
Each is a single-package step down, recorded here as required by the version
policy.

1. **`typescript` 7.0.2 → 6.0.3.** Every TypeScript 7 release — including all
   `7.1.0-dev.*` nightlies — is rejected at load time by `typescript-eslint`,
   which hard-guards on `ts.versionMajor >= 7` (see
   typescript-eslint issue #10940). The guard is present verbatim in the newest
   published `typescript-eslint` (`8.71.1-alpha.2`) as well, so no version of
   that package can support TypeScript 7 today. `typescript` is the package
   that steps down, leaving every other package on its newest release.

2. **`eslint` 10.11.0 → 9.39.5.** `eslint-plugin-react@7.37.5` — the newest
   published release, and the one `eslint-config-next` depends on — still calls
   the `context.getFilename()` API that ESLint 10 removed, which crashes the
   lint run. The `next` dist-tag for `eslint-plugin-react` points at the older
   `7.8.0-rc.0` line, so there is no newer plugin to pair with ESLint 10.
   `eslint` is the package that steps down.

### Peer-dependency rules

`strictPeerDependencies` is disabled in `pnpm-workspace.yaml`. The
`react-is` override forces a single `react-is@19.3.0` across the tree, verified
with `pnpm why react-is`; the only other consumer is `prop-types` under
`eslint-plugin-react`, which is a lint-only dependency and never reaches the
browser bundle.

`unrs-resolver` is the only package approved to run install scripts
(`allowBuilds` in `pnpm-workspace.yaml`).