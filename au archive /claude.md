# Abandoned Archive

Document every abandoned place with verifiable, local-first evidence.

## Three-Doc Stack

This project uses three core instruction files. Read them in order before any task:

| File | Purpose | Modify? |
|------|---------|---------|
| **CLAUDE.md** (this file) | Project rules, architecture, constraints, reference index | ❌ Never |
| **@techguide.md** | Implementation details, build setup, environment config, deep troubleshooting | ❌ Never |
| **@lilbits.md** | Script registry — every utility script with purpose, usage, line count | ❌ Never |

These three files are the complete instruction set. All other docs are reference material consulted on-demand.

**If any of these files are missing, empty, or unreadable: STOP and report to human. Do not proceed.**

## Quick Context

- **Mission**: Curate abandoned places with metadata, media, and GPS truth that historians can trust offline
- **Current**: Desktop release v0.1.0 (Electron + Svelte)
- **Target**: Research-ready archive browser with import, map, and ownership guarantees
- **Persona**: Solo explorer cataloging locations; metadata first, glamor second
- **Runtime**: Node >=20, pnpm >=10, Electron 35+

## Boot Sequence

1. Read this file (CLAUDE.md) completely
2. Read @techguide.md for implementation details
3. Read @lilbits.md for script registry
4. Read the task request
5. **Then** touch code — not before

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Run desktop app in dev mode
pnpm build            # Build all packages for production
pnpm -r test          # Run tests in all packages
pnpm -r lint          # Lint all packages
pnpm format           # Format code with Prettier
pnpm --filter core build      # Build only core package
pnpm --filter desktop rebuild # Rebuild native modules (better-sqlite3, sharp)
pnpm reinstall        # Clean and reinstall (fixes native module issues)
```

> **Note**: Verify these commands match `package.json` scripts before relying on them.

## Development Rules

1. **Scope Discipline** — Only implement what the current request describes; no surprise features
2. **Archive-First** — Every change must serve research, metadata interaction, or indexing workflows
3. **Prefer Open Source + Verify Licenses** — Default to open tools, avoid Google services, log every dependency license
4. **Offline-First** — Assume zero connectivity; add graceful fallbacks when online helpers exist
5. **One Script = One Function** — Keep each script focused, under ~300 lines, recorded in lilbits.md
6. **No AI in Docs** — Never mention Claude, ChatGPT, Codex, or similar in user-facing docs or UI
7. **Keep It Simple** — Favor obvious code, minimal abstraction, fewer files
8. **Binary Dependencies Welcome** — App size is not a concern; freely add binaries (dcraw_emu, ffmpeg, exiftool, libpostal) when they solve problems better than pure-JS alternatives
9. **Real-Time UI Updates** — Any operation that modifies data (imports, saves, deletes, external sources like browser extension) must trigger automatic UI refresh. Never require manual page refresh to see changes. Use IPC events from main process to notify renderer when data changes externally.
10. **Verify Build Before Done** — After any implementation work, run `pnpm build` and `pnpm dev` to confirm the app compiles and boots without errors. Monitor console output for crashes, native module failures, or import errors. A feature is not complete until the app runs.

## Do Not

- Invent new features, pages, or data models beyond what the task or referenced docs authorize
- Bypass the hashing contract when importing media or linking files to locations
- Remove or rename migration files; schema edits go through new migrations only
- Leak or transmit local archive data outside the user's machine
- Add third-party SDKs or services without logging licenses and confirming they function offline
- Mention AI assistants in UI, user docs, exports, or metadata
- Leave TODOs or unexplained generated code in production branches
- **Modify or remove core instruction files** — CLAUDE.md, techguide.md, and lilbits.md are protected; flag issues for human review instead of auto-fixing
- **Assume when uncertain** — If a task is ambiguous or conflicts with these rules, stop and ask

## Stop and Ask When

- Task requires modifying CLAUDE.md, techguide.md, or lilbits.md
- Task conflicts with a rule in this file
- Referenced file or path doesn't exist
- Task scope is unclear or seems to exceed "one feature"
- You're about to delete code without understanding why it exists
- Schema change is needed but not explicitly authorized

## Critical Gotchas

| Gotcha | Details |
|--------|---------|
| **Preload MUST be CommonJS** | Static `.cjs` file copied via custom Vite plugin (NOT bundled). Use `require('electron')` only, never `import`. ES module syntax crashes at runtime before UI loads. See `vite.config.ts` `copyPreloadPlugin()`. |
| **Database source of truth** | `migrations/` only. Never edit schema inline in docs or ad-hoc SQL files. |
| **Database location** | `./data/au-archive.db` (project-relative). Foreign keys always enabled via PRAGMA on connection. |
| **GPS confidence ladder** | Map-confirmed > EXIF (<10m accuracy) > Reverse-geocode > Manual guess |
| **Import spine** | Watcher scans drop zone → hashes every file → copies into archive folder → links via BLAKE3 primary keys → then metadata extraction |
| **Hashing first** | BLAKE3 computed before any metadata extraction or file moves |
| **Archive folder structure** | `[base]/locations/[STATE]/[LOCID]/data/org-{img,vid,doc,map}/` (ADR-046) |
| **Ownership pledge** | All assets stay on disk. No telemetry, no cloud sync, no auto-updates. |
| **Source file responsibility** | User's source files are THEIR responsibility. We make a complete, verified copy. Done. |
| **pnpm v10+ native modules** | Project pre-configures `onlyBuiltDependencies` for better-sqlite3, electron, sharp, esbuild. If "Ignored build scripts" warnings appear, run `pnpm reinstall`. |
| **Native modules in Vite** | Native modules with platform-specific binaries (better-sqlite3, sharp, blake3, onnxruntime-node) MUST be in `vite.config.ts` external array. Bundling them causes "Could not dynamically require" crashes at runtime. |

## Architecture (Quick)

- **Pattern**: Clean architecture (presentation → infrastructure → core domain) in pnpm monorepo
- **Layout**: `packages/core` = domain models, repository contracts; `packages/desktop` = Electron main + renderer + services
- **IPC flow**: Renderer → Preload bridge → Main → Desktop services
- **IPC naming**: `domain:action` format (e.g., `location:create`, `media:import`)
- **Security**: `contextIsolation: true`, `sandbox: false` (for drag-drop), no nodeIntegration in renderer
- **Testing priority**: Unit focus on GPS parsing, hashing pipeline, preload bridge

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Svelte components | PascalCase | `LocationCard.svelte` |
| Services/utilities | kebab-case | `hash-service.ts` |
| Domain models | PascalCase | `Location.ts` |
| IPC handlers | kebab-case with domain prefix | `location-handlers.ts` |
| Migrations | timestamp prefix | `001_initial_schema.sql` |

## Dual Edition Awareness

App detects Light (online helpers) vs Offline Beast (bundled tiles + libpostal) at runtime with zero user toggle. Detection is file-based only:
- Check `resources/maps/*.mbtiles` for offline tiles
- Check `resources/libpostal/` for address parsing

Prefer graceful degradation (disabled buttons + tooltips) over throwing when resources are missing.

## Change Protocols

| Change Type | Required Steps |
|-------------|----------------|
| UI copy/layout | Update `docs/ui-spec.md` + summary in `docs/decisions/` |
| Schema change | New migration file only; never edit existing migrations |
| New dependency | Log license in commit message; verify offline functionality |
| Deviation from spec | Document in `docs/decisions/` with decision ID; reference in commit |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Ignored build scripts" warning | Run `pnpm reinstall` |
| Preload crashes silently | Check for ES module syntax in `.cjs` file; must use `require()` |
| Database locked errors | Ensure only one Electron instance running |
| Native module mismatch | Run `pnpm --filter desktop rebuild` |
| Types out of sync | Run `pnpm --filter core build` first |

## Package-Level Guides

Read these when working in specific packages:

- @packages/core/CLAUDE.md
- @packages/desktop/CLAUDE.md

## On-Demand References

Read these when the task touches the relevant area:

**Architecture & Data:**
- @docs/ARCHITECTURE.md
- @docs/DATA_FLOW.md

**Contracts:**
- @docs/contracts/gps.md
- @docs/contracts/hashing.md
- @docs/contracts/addressing.md
- @docs/contracts/dual-edition.md
- @docs/contracts/data-ownership.md
- @docs/contracts/monitoring.md — Metrics, tracing, alerts for Import v2 pipeline

**Workflows:**
- @docs/workflows/gps.md — GPS-first workflows, confidence states, UI copy
- @docs/workflows/import.md — File import queue, hashing, folder organization
- @docs/workflows/mapping.md — Map interactions, clustering, filter logic
- @docs/workflows/addressing.md — Address lookup, normalization, manual overrides
- @docs/workflows/export.md — Export packaging and verification

## Authoritative Sources

| Source | Purpose |
|--------|---------|
| `migrations/` | Database schema, constraints, seed data. Single source of truth for DB structure. |
| `docs/ui-spec.md` | Page layouts, navigation order, typography, component states |
| `docs/schema.md` | Field descriptions, enums, JSON schema contracts |
| `docs/decisions/*.md` | ADR-style reasoning for deviations; reference IDs in commits |

## Contact Surface

All prompts funnel through this CLAUDE.md. Do not copy instructions elsewhere.
