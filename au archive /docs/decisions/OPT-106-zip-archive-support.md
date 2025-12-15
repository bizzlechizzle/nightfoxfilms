# OPT-106: ZIP Archive Import Support

**Status**: Accepted
**Date**: 2025-12-08
**Category**: Import Pipeline

## Context

Users reported that ZIP files were silently skipped during import. Investigation revealed:

1. Import v2 scanner (`scanner.ts`) did not include archive extensions in any supported set
2. Files with `unknown` mediaType were marked `shouldSkip: true`
3. Additionally, v2 had a bug: `.psd` was in both `SKIP_EXTENSIONS` and the image set
4. v2 had ~50% fewer supported formats than the legacy v1 system

## Decision

1. Add archive formats (`.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.tgz`, `.bz2`, `.xz`) to document extensions
2. Remove `.psd` from image set (it belongs only in `SKIP_EXTENSIONS`)
3. Port all missing format support from v1 to v2 for parity

## Consequences

### Positive
- ZIP files now import as documents (stored as-is, not extracted)
- Format support increased: images 35→63, videos 26→55, documents 20→31, maps 7→14
- `.psd` files correctly skipped (no longer conflicting logic)

### Negative
- None identified

## Files Changed

- `packages/desktop/electron/services/import/scanner.ts` - Extended `SUPPORTED_EXTENSIONS`

## Skip Extensions (unchanged)

These are always skipped, never imported:
- `.aae` - Apple photo adjustments (useless without original)
- `.psd` - Photoshop document (large project files)
- `.psb` - Photoshop large document
- `.acr` - Adobe Camera Raw settings
