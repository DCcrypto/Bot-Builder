# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── discord-bot/        # MANE NFT Discord bot (Cronos blockchain listener)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `artifacts/discord-bot` (`@workspace/discord-bot`)

Discord bot for the MANE NFT marketplace (manenft.com) on the Cronos blockchain. Polls the MANE NFT REST API for new listings and posts rich embeds to a configured Discord channel.

**Architecture decisions (intentional):**
- The marketplace contract (`0x03F70dc894ae3b7d8d188BB5446633B5fda1B80F`) emits only a `Sold` event — there is no on-chain `Listed` event. New listings are therefore detected by polling `https://manenft.com/api/listings`, which returns full metadata (name, image, price). The ABI and `buildSaleEmbed` are preserved for future re-enablement.
- Sale notifications are **temporarily disabled** at the user's request. The on-chain polling code (`pollSalesOnChain`, `ethers` provider, `lookupListingBySellerAndContract`) has been removed from `listener.ts` but `buildSaleEmbed` and `src/abi/marketplace.json` are kept intact for restoration.
- The "View Listing" link field in embeds is **temporarily commented out** at the user's request (one-line uncomment to restore).

**Key files:**
- `src/index.ts` → `src/bot.ts` — Discord client startup, channel resolution, slash command registration
- `src/listener.ts` — polls `manenft.com/api/listings` every 30 s; seeds existing IDs on startup to avoid re-announcing; persists seen IDs to `data/seen-listings.json` immediately after each post
- `src/commands.ts` — `/settings` slash command (listings channel + collection management)
- `src/settings.ts` — persists `data/settings.json` (channelListingsId, channelSalesId, trackedCollections)
- `src/seenListings.ts` — disk persistence for announced listing IDs (30-day TTL)
- `src/embeds.ts` — `buildListingEmbed` (active) and `buildSaleEmbed` (saved, not called)
- `src/abi/marketplace.json` — verified ABI: single `Sold(address buyer, address seller, address nftContract, uint256 listingId, uint256 tokenAmount, uint256 croAmount, uint256 timestamp)` event
- `data/settings.json` — persisted channel and collection settings
- `data/seen-listings.json` — persisted announced listing IDs

**Required secrets:** `DISCORD_BOT_TOKEN`

**Slash commands (admin/ManageGuild only):**
- `/settings status` — show current configuration
- `/settings channel listings #channel` — set the listings announcement channel
- `/settings collection add 0x...` — add an NFT collection to track
- `/settings collection remove 0x...` — remove a tracked collection
- `/settings collection list` — list all tracked collections

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
