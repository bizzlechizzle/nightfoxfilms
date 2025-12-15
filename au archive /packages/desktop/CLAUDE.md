# packages/desktop

Electron main process, preload bridge, and Svelte renderer.

## Critical: Preload Bundling

- Project is native ES Modules but preload MUST ship as CommonJS `.cjs`
- Build preload via Vite rollup override
- Set `webPreferences.preload = ../preload/index.cjs`
- Only `require('electron')` inside preload — any `import` will fail at runtime

## Structure

- `electron/main/` — App lifecycle, window creation, repository wiring, capability detection
- `electron/preload/` — CommonJS bridge exposing typed APIs to renderer
- `src/pages/` — Dashboard, Locations, Atlas, Imports, Settings
- `src/components/` — Forms, galleries, map overlays
- `src/stores/` — GPS state, filters, import queue status

## Services Location

All services are in `electron/services/`:
- `address-normalizer.ts`, `address-service.ts` — Address normalization and geocoding
- `crypto-service.ts` — BLAKE3 hashing (16-char hex)
- `exiftool-service.ts`, `ffmpeg-service.ts` — Metadata extraction
- `file-import-service.ts` — Import pipeline orchestration
- `geocoding-service.ts` — Reverse/forward geocoding with cache
- `health-monitor.ts`, `integrity-checker.ts` — System health and data integrity
- `media-path-service.ts` — Archive folder structure management
- `monitoring/` — Metrics, tracing, and alerting (see @docs/contracts/monitoring.md)
  - `metrics-collector.ts` — Counters, gauges, histograms, timers
  - `tracer.ts` — Distributed tracing with spans
  - `alert-manager.ts` — Rule-based alerting with cooldowns
- And many more...

**Note:** Originally planned for `packages/core/src/services/` but kept in desktop due to Electron/native module dependencies.

## IPC Rules

- **Channel naming**: `domain:action` (e.g., `location:create`, `media:import`)
- Renderer never calls `ipcRenderer` directly
- Preload exposes only typed APIs defined in `packages/core`
- Main wraps errors with context + actionable message

## Context Bridge Contract

Preload exposes only typed APIs defined in `packages/core`. Renderer never calls `ipcRenderer` directly.

## Security

- `contextIsolation: true`
- `sandbox: false` (needed for drag-drop path helpers)
- No remote module
- No nodeIntegration in renderer

## Renderer Stack

- Svelte 5 + Vite 5 + Tailwind + Skeleton UI
- Vitest for component tests

## Main Process

- Electron 35+
- better-sqlite3 for storage
- ExifTool/FFmpeg/sharp for media
- Kysely for typed SQL

## Mapping Stack

- Leaflet 1.9
- Supercluster for clustering
- OSM/ESRI/Carto tiles
- Optional libpostal-backed layers for offline search

## Media Stack

- exiftool-vendored
- FFmpeg via fluent-ffmpeg
- `sharp` for thumbnails
- Node `crypto` for SHA256

All orchestrated through services in `packages/core`.

## Testing

- Integration harness under `electron/`
- Focus: Capability detection, preload wiring, IPC channels
- Component tests: Form validation, store updates, map controls
