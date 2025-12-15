# Dual-Edition Distribution

## Capability Matrix

| Capability | LIGHT (online-assisted) | OFFLINE BEAST (bundled) | Detection |
| --- | --- | --- | --- |
| Map tiles | Fetch OSM/ESRI/Carto over HTTPS | Load packaged MBTiles | Presence of `resources/maps/*.mbtiles` |
| Geocoding | Call public Nominatim API | Use local libpostal + offline gazetteer | Presence of `resources/libpostal/` |
| Size | ~200 MB install | 5–30 GB bundle with maps + binaries | Build target preset |
| Media helpers | Downloads extra codecs on demand | Ships FFmpeg/ExifTool binaries | `resources/bin/` bundle contents |
| Updates | Manual download from releases | Distributed as preloaded image/USB | Installer flavor |

## Deterministic Runtime Switch

On launch, check for `resources/maps/*.mbtiles` and `resources/libpostal/`. If either resource exists, enable Offline Beast mode; otherwise remain in Light mode. Never rely on environment variables or user toggles.

## Capability Flags

Store detection result in memory (e.g., `capabilities.offlineMaps`, `capabilities.offlineGeocoding`) and expose through preload for renderer gating.

## UI Behavior

Hide or disable controls that require unavailable capabilities (offline search, heavy map overlays, batch address normalization). Show tooltip text indicating why a feature is unavailable.

## Logging

Record detected edition + resources in a single startup log line for diagnostics (local log only, no telemetry).

## Packaging Notes

Offline Beast installer must include MBTiles, libpostal, and binary helpers under `resources/`. Light installer references online services only but still handles missing network gracefully.

## Detection Rule

App must detect Light (online helpers) vs Offline Beast (bundled tiles + libpostal) at runtime with zero user toggle. Feature flags: None. Runtime capability detection is file-based only.
