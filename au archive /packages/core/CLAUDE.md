# packages/core

Domain models, services, and repository contracts.

## Structure

- `src/domain/` — Location, sub-location, media entities, and enums
- `src/repositories/` — Repository interfaces (implementations in packages/desktop)

**Note:** Services are located in `packages/desktop/electron/services/` (not in core). Core contains only domain models and repository contracts to remain framework-agnostic.

## Rules

- Pure domain logic — no Electron or UI dependencies
- All DTOs validated with Zod before repository calls
- Repository interfaces defined here, implementations in desktop

## Testing

- Run with Vitest: `pnpm test`
- Focus: Hashing, GPS math, address normalization, repository logic

## Service Contracts (Implemented in Desktop Package)

Services are located in `packages/desktop/electron/services/` and include:
- Import service: SHA256 computation, file organization, copy to archive
- Metadata service: ExifTool/FFmpeg/sharp wrappers, normalization
- GPS service: Confidence tier enforcement, coordinate validation
- Address service: Normalization pipeline, provider integration
- Hash service: Stream-based SHA256, collision detection

Core package defines domain models that services operate on, but services themselves live in the desktop package due to Electron dependencies.

## Repository Patterns

All repositories follow the same contract:
- Primary key is SHA256 for media, UUID for locations
- Methods return domain entities, not raw database rows
- Upserts are idempotent
- Deletions soft-delete (mark inactive, don't remove bytes)
