# Architecture

## Pattern

Clean architecture with three rings (presentation, infrastructure, core domain) inside a pnpm monorepo.

## Layout

- `packages/core` holds domain entities, services, and repository interfaces
- `packages/desktop` contains Electron main, preload bridge, and Svelte renderer

## Stack Snapshot

| Area | Technologies |
| --- | --- |
| Desktop shell | Electron 35+, Electron Builder |
| Renderer | Svelte 5, Vite 5, Tailwind CSS, Skeleton UI |
| Language | TypeScript 5.3+, ECMAScript modules |
| Data | SQLite via better-sqlite3, Kysely migrations |
| Validation | Zod schemas |
| Mapping | Leaflet 1.9, Supercluster, OSM/ESRI/Carto tiles |
| Media | exiftool-vendored, fluent-ffmpeg, sharp |
| Testing | Vitest + Testing Library, Playwright (future) |
| Package manager | pnpm 8+ |

## Monorepo Layout

- `packages/core/src/domain` — Location, sub-location, media entities, and enums
- `packages/core/src/services` — Import, metadata extraction, GPS normalization, hashing, and address normalization services
- `packages/desktop/electron/services` — BagIt archive (RFC 8493), backup scheduler, database archive export, geocoding, health monitoring
- `packages/core/src/repositories` — Interfaces shared by SQLite implementations
- `packages/desktop/electron/main` — App lifecycle, window creation, repository wiring, capability detection
- `packages/desktop/electron/preload` — CommonJS bridge exposing typed APIs to renderer
- `packages/desktop/src/pages` — Primary navigation views (Dashboard, Locations, Atlas, Imports, Settings)
- `packages/desktop/src/components` — Svelte components for forms, galleries, map overlays
- `packages/desktop/src/stores` — Writable stores for GPS state, filters, import queue status
- `resources/` — Icons, MBTiles, libpostal bundle, and binary helpers
- `scripts/` — Build and utility scripts (documented in `lilbits.md`)

## IPC and Module Conventions

- **Channel Naming**: `domain:action` (e.g., `location:create`, `media:import`). Only preload registers handlers; renderer imports typed wrappers from `packages/core`.
- **Payload Types**: Defined in shared `packages/core` DTOs. Validate with Zod before hitting repositories.
- **Error Handling**: Main process wraps errors with context name + actionable message before returning to renderer.
- **Streaming**: Long-running jobs (imports) emit progress events through dedicated channels; renderer subscribes via stores.
- **Preload Output**: Vite build emits `.cjs` preload artifacts and writes TypeScript declaration files for renderer consumption.

## Testing Surface

| Layer | Tooling | Focus |
| --- | --- | --- |
| Core services | Vitest (run in `packages/core`) | Hashing, GPS math, address normalization, repository logic |
| Renderer components | Vitest + Testing Library | Form validation, store updates, map controls |
| Electron main | Integration harness under `packages/desktop/electron` | Capability detection, preload wiring, IPC channels |
| End-to-end (future) | Playwright smoke flows | Import → map pin → detail view, offline/online switching |

## High-Risk Areas

- **Preload bundling (.cjs) mismatch** will crash before UI loads
- **GPS verification states** drive marker colors; any mismatch confuses researchers
- **Hash collisions or skipped hashing** violate data ownership guarantees
- **Dual edition mis-detection** can spam online APIs or hide offline features

## Performance Targets

- **App launch**: under 3 seconds
- **Queries**: under 100 ms for 10k locations (indexed columns must exist)
- **Map interactions**: near 60 fps with clustering
- **Import feedback**: near real-time with progress indicators

## Security Defaults

- `contextIsolation: true`
- `sandbox: false` (needed for drag-drop path helpers)
- No remote module
- No nodeIntegration in the renderer

## Access Patterns

- No direct disk writes from renderer; main handles FS through services
- All user-selected folders validated before writing
- Watch for long paths when bundling MBTiles/libpostal

## Tooling

pnpm workspaces, ESLint, Prettier, Husky (optional) manage linting and formatting.
