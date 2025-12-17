# ADR-045: BLAKE3 Migration

**Status:** Accepted
**Date:** 2025-12-04
**Context:** SHA-256 to BLAKE3 migration for internal hashing

---

## Context

The Abandoned Archive application uses cryptographic hashes as primary keys for all media files (images, videos, documents, maps). The original implementation used SHA-256 (64 hex characters) throughout the codebase.

A comprehensive audit was conducted to evaluate:
1. Performance implications of SHA-256
2. BagIt RFC 8493 compliance requirements
3. Multi-user archive sharing scenarios
4. Long-term archival integrity needs

Key findings from the audit:
- SHA-256 is ~3x slower than BLAKE3 for large file hashing
- BagIt RFC 8493 requires SHA-256/SHA-512 for standards compliance
- Current BagIt implementation (~1,400 LOC) maintains continuous manifests but is primarily used for internal integrity, not external sharing
- Multi-user scenarios involve filesystem sharing, not BagIt package exchange

---

## Decision

### 1. Internal Hashing: BLAKE3

All internal hashing operations will use BLAKE3 with 64-bit (16 hex character) output:

- **Algorithm:** BLAKE3
- **Output:** 64 bits → 16 lowercase hex characters
- **Example:** `a7f3b2c1e9d4f086`

Rationale:
- ~3x faster than SHA-256
- Simpler, modern design
- 64 bits provides adequate collision resistance for a local archive (<1M files)
- Shorter hashes improve readability in URLs, logs, and file names

### 2. Column Naming: `*sha` → `*hash`

All database columns and code references will be renamed:

| Old | New |
|-----|-----|
| imgsha | imghash |
| vidsha | vidhash |
| docsha | dochash |
| mapsha | maphash |
| hero_imgsha | hero_imghash |

Rationale:
- Algorithm-agnostic naming prevents future migration confusion
- Cleaner semantics (it's a "hash", not specifically "SHA")

### 3. BagIt: Export-Only, RFC Compliant

BagIt package generation will be simplified to export-only:

**Before:**
- Continuous manifest updates on every file change
- Weekly background validation
- ~1,400 LOC across 3 services
- SHA-256 throughout

**After:**
- Generate RFC 8493 compliant packages on-demand (export)
- No continuous manifest maintenance
- ~200 LOC in single export service
- SHA-256 computed only at export time (RFC compliance)

Rationale:
- BagIt's primary value is for external sharing/archival
- Current usage is primarily internal integrity checking
- Internal integrity can be done more simply with BLAKE3
- RFC 8493 compliance preserved for institutional interoperability

### 4. Fresh Start

This migration requires a fresh database:

- All existing test data will be discarded
- No migration path from SHA-256 hashes
- Clean schema with new column names

Rationale:
- Project is in pre-release with test data only
- Migration complexity not justified for test data
- Clean start avoids dual-hash complexity

---

## Consequences

### Positive

1. **Performance:** ~3x faster import hashing
2. **Simplicity:** Shorter hashes, cleaner code
3. **Reduced complexity:** ~1,200 fewer LOC (BagIt simplification)
4. **Future-proof:** Algorithm-agnostic naming
5. **Standards compliance:** RFC 8493 preserved for exports

### Negative

1. **Breaking change:** Existing databases incompatible
2. **Two hash algorithms:** BLAKE3 internal, SHA-256 for export
3. **Testing burden:** All hash-related tests need updates

### Neutral

1. **Collision probability:** 64-bit hash provides 1 in 34 million collision chance at 1M files — acceptable for local archive
2. **External tool compatibility:** BagIt packages remain RFC compliant

---

## Alternatives Considered

### A. Keep SHA-256 Everywhere
- **Rejected:** Slower performance, longer hashes
- No compelling reason to maintain SHA-256 for internal use

### B. BLAKE3 with Non-Standard BagIt
- **Rejected:** Would use `manifest-blake3.txt` which external tools can't validate
- Defeats purpose of BagIt for institutional sharing

### C. Store Both Hashes
- **Rejected:** Added complexity, storage overhead
- Computing SHA-256 on export is fast enough

### D. Full BLAKE3 (256-bit)
- **Rejected:** Same 64 hex chars as SHA-256, no readability benefit
- 64-bit provides sufficient collision resistance for use case

---

## Implementation

See: `/docs/plans/blake3-migration-plan.md`

Key steps:
1. Add `blake3` npm dependency
2. Rewrite crypto-service.ts
3. Update database schema (fresh start)
4. Rename all column references
5. Simplify BagIt to export-only
6. Create new integrity-service.ts
7. Update all tests and documentation

---

## References

- [BagIt Necessity Audit](/docs/audits/bagit-necessity-audit.md)
- [BLAKE3 Specification](https://github.com/BLAKE3-team/BLAKE3-specs)
- [RFC 8493 - BagIt File Packaging Format](https://datatracker.ietf.org/doc/html/rfc8493)
- [CLAUDE.md - Project Rules](/CLAUDE.md)

---

## Decision Log

| Question | Answer |
|----------|--------|
| What algorithm internally? | BLAKE3 |
| What hash length? | 64 bits (16 hex chars) |
| What for BagIt export? | SHA-256 (RFC 8493) |
| Column naming? | `*hash` (algorithm-agnostic) |
| Migration path? | Fresh start (no migration) |
| BagIt approach? | Export-only |

---

**Approved by:** Project Owner
**Implementation:** Pending
