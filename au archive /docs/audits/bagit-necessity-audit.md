# BagIt Necessity Audit

**Date:** 2025-12-04
**Context:** SHA-256 to BLAKE3 migration planning
**Status:** Complete

---

## 1. Executive Summary

**Recommendation: Option E — Hybrid (BLAKE3 internal, RFC-compliant export)**

BagIt serves a legitimate purpose for this multi-user research archive, but the current implementation is tightly coupled to SHA-256 in ways that complicate migration. The hybrid approach provides:

- **Day-to-day operations:** BLAKE3 everywhere (faster, consistent)
- **Archive sharing/export:** Generate RFC-compliant SHA-256 manifests on demand
- **Best of both:** Performance gains internally, standards compliance externally

This preserves the 35-year archival goal while enabling modern hashing.

---

## 2. Current State

### 2.1 Implementation Scope

| Metric | Value |
|--------|-------|
| **bagit-service.ts** | 556 LOC (fully implemented) |
| **bagit-integrity-service.ts** | 482 LOC (fully implemented) |
| **bagit IPC handlers** | 326 LOC (fully wired) |
| **Total BagIt code** | ~1,364 LOC |
| **Database columns** | 3 (`bag_status`, `bag_last_verified`, `bag_last_error`) |
| **Unit tests** | **0** (none found) |

### 2.2 What bagit-service.ts Actually Does

The service is **fully implemented**, not stubbed:

```typescript
// Core operations implemented:
- initializeBag(location)       // Creates all 4 BagIt files
- updateBagInfo(location, files) // Updates metadata
- updateManifest(location, files) // Updates checksums
- regenerateBag(location, files)  // Full rebuild
- validateBag(location, files)    // Full SHA-256 verification
- quickValidate(location, files)  // Payload-Oxum check only
```

### 2.3 Trigger Points (When BagIt Updates)

| Event | Method Called | Blocking? |
|-------|--------------|-----------|
| Location created | `initializeBag()` | No (async, non-blocking) |
| Location metadata edited | `updateBagInfo()` | No |
| Media imported | `updateManifest()` | No |
| App startup (weekly) | `validateAllBags()` | No (background) |
| Manual regenerate | `regenerateBag()` | Yes (user-initiated) |

All automatic BagIt operations are wrapped in try/catch with "non-fatal" logging:
```typescript
} catch (e) { console.warn('[media:import] Failed to update BagIt manifest (non-fatal):', e); }
```

### 2.4 Usage Evidence

| Signal | Evidence |
|--------|----------|
| **Imports use it** | Yes - `media-import.ts:405-422` updates manifest after imports |
| **Location create uses it** | Yes - `locations.ts:81-113` initializes bag |
| **Location update uses it** | Yes - `locations.ts:148-180` updates bag-info |
| **UI exposes it** | Yes - `LocationNerdStats.svelte`, `Settings.svelte` show bag status |
| **Tests exist** | **No** - Zero test files for BagIt functionality |
| **Validation scheduled** | Yes - Weekly background check on app launch |

---

## 3. Multi-User Analysis

### 3.1 Current Multi-User Features (Implemented)

From `DECISION-024-multi-user-auth.md`:

| Feature | Status | Database Evidence |
|---------|--------|-------------------|
| Multi-user mode | Implemented | `app_mode = 'single' | 'multi'` setting |
| User accounts | Implemented | `users` table with PIN auth |
| Activity tracking | Implemented | `imported_by`, `modified_by`, `created_by` columns |
| Author attribution | Implemented | `location_authors` junction table |
| Per-user stats | Implemented | Stats IPC handlers |

### 3.2 How Archives Flow Between Users

**Current state:** Archives are shared via **filesystem** (shared NAS or folder copy):

```
User A's machine                    Shared NAS
┌─────────────┐                    ┌─────────────┐
│ SQLite DB   │ ───sync via───────>│ SQLite DB   │
│ Archive/    │    filesystem      │ Archive/    │
│  locations/ │                    │  locations/ │
└─────────────┘                    └─────────────┘
                                         │
                                         ▼
                                   ┌─────────────┐
                                   │ User B      │
                                   │ (reads same │
                                   │  files)     │
                                   └─────────────┘
```

**There is no:**
- Central server
- API-based sync
- Peer-to-peer protocol
- Export/import package format

### 3.3 BagIt's Role in Multi-User Scenario

| Scenario | BagIt Benefit | Actually Used? |
|----------|---------------|----------------|
| User A shares folder to User B | Validates integrity during copy | **Potentially** (if User B runs validation) |
| Database corruption | Metadata survives in bag-info.txt | **Yes** (designed for this) |
| USB drive transfer | Self-documenting bundle | **Potentially** |
| Institution accepts archive | RFC standard format | **Not currently** |

### 3.4 Audit Trail Interaction

BagIt and audit logging are **separate systems** that don't integrate:

```
Audit Trail (SQLite)          BagIt (Filesystem)
─────────────────────         ─────────────────────
imported_by: "jsmith"    ←─X─→  bag-info.txt
modified_by: "mjones"          (no user info)
created_by: "alee"
```

**Gap:** `bag-info.txt` does NOT include who created/modified the location. If database is lost, authorship history is lost too.

---

## 4. Fit Analysis

### 4.1 What Problem Does BagIt Solve Here?

| Purpose | Solves It? | Evidence |
|---------|------------|----------|
| **Data integrity verification** | Yes | `manifest-sha256.txt` checksums |
| **Export/sharing packages** | Partially | Structure exists but no dedicated export workflow |
| **Audit trail / provenance** | No | Authorship not in bag-info.txt |
| **Long-term preservation** | Yes | 35-year goal explicitly stated |
| **Institutional interop** | Aspirational | No current institutional partners |
| **Database independence** | Yes | Can reconstruct metadata from bag-info.txt |

### 4.2 BagIt Fit Assessment Table

| Factor | BagIt Strength | This Project's Need | Match |
|--------|----------------|---------------------|-------|
| User-to-user sharing | High (standard format) | Medium (NAS-based, not packages) | Partial |
| Institutional interop | High (RFC 8493) | Low-Medium (aspirational) | Partial |
| Self-contained packages | High | Medium (archives stay on disk) | Partial |
| Integrity verification | Medium (SHA-256) | High | Good |
| Audit/provenance | Low (no user tracking) | High (has audit system) | Gap |
| Complexity cost | Medium (~1400 LOC) | Low preference ("Keep It Simple") | Tension |

### 4.3 Is BagIt Actively Used or Aspirational?

**Verdict: Actively used, but primarily for internal integrity**

Evidence of active use:
- Automatic manifest updates on every import
- Weekly background validation
- UI shows bag status
- Location creation triggers bag initialization

Evidence of aspirational elements:
- No export-to-BagIt workflow
- No import-from-BagIt workflow
- No tests verifying RFC compliance
- No institutional sharing happening yet

---

## 5. Alternatives Comparison

### 5.1 Options Matrix

| Option | Internal Hash | Export Hash | RFC Compliant | Complexity | Migration Effort |
|--------|---------------|-------------|---------------|------------|------------------|
| **A: BagIt strict** | SHA-256 | SHA-256 | Yes | High | Impossible (can't use BLAKE3) |
| **B: BagIt + BLAKE3** | BLAKE3 | BLAKE3 | **No** | High | Medium |
| **C: Simple manifest** | BLAKE3 | BLAKE3 | No | Low | Low |
| **D: SQLite as manifest** | BLAKE3 | N/A | No | Low | Low |
| **E: Hybrid** | BLAKE3 | SHA-256 (on export) | Yes | Medium | Medium |

### 5.2 Weighted Scoring (1-5 scale)

| Criterion | Weight | A | B | C | D | E |
|-----------|--------|---|---|---|---|---|
| Multi-user sharing | 25% | 5 | 2 | 2 | 1 | 4 |
| Audit/logging integration | 20% | 2 | 2 | 3 | 5 | 3 |
| Future institutional | 15% | 5 | 1 | 1 | 1 | 4 |
| Low complexity | 15% | 2 | 2 | 5 | 5 | 3 |
| BLAKE3 migration ease | 15% | 1 | 4 | 5 | 5 | 4 |
| "Keep It Simple" | 10% | 2 | 2 | 5 | 4 | 3 |
| **Weighted Total** | 100% | **2.95** | **2.20** | **3.10** | **3.35** | **3.55** |

### 5.3 Option Details

#### Option A: BagIt RFC 8493 (strict compliance)
- **Pros:** Industry standard, institutional ready, external tool validation
- **Cons:** Locked to SHA-256, blocks BLAKE3 migration entirely
- **Verdict:** Not viable if BLAKE3 migration is a goal

#### Option B: BagIt structure, BLAKE3 manifests
- **Pros:** Familiar layout, faster hashing, internal consistency
- **Cons:** `manifest-blake3.txt` is non-standard, tools won't validate, confusing for archivists
- **Verdict:** Worst of both worlds — complexity without standards compliance

#### Option C: Simple checksum manifest
```
checksums.blake3.txt:
abc123def456...  locations/NY-Mill/org-img-abc123/file.jpg
def789abc012...  locations/NY-Mill/org-vid-abc123/video.mp4
```
- **Pros:** Trivial to implement, trivial to verify, no format lock-in
- **Cons:** No metadata bag, less self-documenting, not recognizable format
- **Verdict:** Good for internal use, poor for sharing

#### Option D: SQLite as the manifest
- **Pros:** Already implemented (DB has all hashes), no additional code
- **Cons:** Requires app to verify, not human-readable, defeats "survive 35 years" goal
- **Verdict:** Already exists (database export), but doesn't replace file-level verification

#### Option E: Hybrid (BLAKE3 internal, RFC export)
```
Day-to-day:
  - All media PKs: BLAKE3 (16 hex chars)
  - Thumbnails: bucketed by BLAKE3
  - Import: compute BLAKE3
  - Internal integrity: BLAKE3

On export/share:
  - Generate manifest-sha256.txt (recompute or store both hashes)
  - Generate bag-info.txt (standard format)
  - RFC-compliant package for recipients
```
- **Pros:** Performance internally, standards externally, deferred complexity
- **Cons:** Two hash computations (can cache SHA-256 on import), export code path
- **Verdict:** Best balance of goals

---

## 6. Recommendation

### Primary Recommendation: Option E — Hybrid

**Rationale:**

1. **Multi-user reality:** Archives are shared via filesystem, not packages. BagIt's package format isn't being used for transport today.

2. **Audit integration gap:** Current BagIt doesn't include authorship. The audit trail in SQLite is more complete. A hybrid approach lets us consider integrating audit data into exports.

3. **35-year goal is valid:** The "survive without database" requirement is legitimate for a research archive. But it can be satisfied by **export-time** generation rather than continuous maintenance.

4. **BLAKE3 benefits are real:** 3x faster hashing improves import UX. Current ~1400 LOC of BagIt code can be simplified.

5. **Keep It Simple principle:** Maintaining SHA-256 manifests on every file change is overhead. Export-time generation is simpler.

### Implementation Path

#### Phase 1: BLAKE3 Migration (Internal)
1. Replace SHA-256 with BLAKE3 in `crypto-service.ts`
2. Add `blake3` npm dependency
3. Migrate database PKs (new database, no existing data to migrate)
4. Update all hash references to use 16-char BLAKE3
5. Remove continuous BagIt manifest updates from import/update hooks

#### Phase 2: Simplify Internal Integrity
1. Create `integrity-service.ts` (replaces `bagit-integrity-service.ts`)
2. Use simple BLAKE3 verification against database
3. Remove `bag_status`, `bag_last_verified`, `bag_last_error` columns
4. Weekly check: verify file hashes match database PKs

#### Phase 3: Export-Time BagIt Generation
1. Create `bagit-export-service.ts` (~200 LOC)
2. On export:
   - Compute SHA-256 for files (or use cached if stored)
   - Generate `manifest-sha256.txt`
   - Generate `bag-info.txt` with full metadata + authorship
   - Generate `tagmanifest-sha256.txt`
3. Add "Export as BagIt Package" option to export workflow

#### Phase 4: Enhanced bag-info.txt
Include authorship in exports:
```
Created-By: jsmith (2024-03-15)
Documented-By: mjones (2024-03-20)
Modified-By: alee (2024-04-01)
```

### Migration Effort Estimate

| Phase | Files Changed | LOC Added | LOC Removed |
|-------|---------------|-----------|-------------|
| 1: BLAKE3 internal | 8 | ~50 | ~20 |
| 2: Simplify integrity | 4 | ~100 | ~500 |
| 3: Export BagIt | 3 | ~200 | 0 |
| 4: Enhanced bag-info | 1 | ~30 | 0 |
| **Total** | 16 | ~380 | ~520 |

**Net result:** ~140 fewer lines of code, simpler architecture, standards-compliant exports

---

## 7. Appendix: Code Locations

### Current BagIt Implementation

| File | LOC | Purpose |
|------|-----|---------|
| `electron/services/bagit-service.ts` | 556 | Core BagIt file generation |
| `electron/services/bagit-integrity-service.ts` | 482 | Background validation |
| `electron/main/ipc-handlers/bagit.ts` | 326 | IPC bridge |
| `electron/preload/preload.cjs` | ~50 | Preload exposure (bagit section) |
| `src/types/electron.d.ts` | ~30 | Type definitions |
| **Total** | ~1,444 | |

### Files Referencing BagIt

```
packages/desktop/electron/main/ipc-handlers/media-import.ts  # Updates manifest
packages/desktop/electron/main/ipc-handlers/locations.ts     # Init/update bag
packages/desktop/electron/main/ipc-handlers/index.ts         # Registers handlers
packages/desktop/electron/main/database.ts                   # Migration 40
packages/desktop/src/pages/Settings.svelte                   # Validation UI
packages/desktop/src/components/location/LocationNerdStats.svelte  # Status display
```

---

## 8. Decision Log

| Question | Answer | Rationale |
|----------|--------|-----------|
| Keep BagIt? | Yes, but refactor | 35-year goal is valid for research archive |
| When to generate? | Export-time only | Reduces complexity, maintains standards |
| What hash internally? | BLAKE3 | 3x faster, consistent with migration goal |
| What hash for export? | SHA-256 | RFC 8493 compliance for sharing |
| Store both hashes? | Optional | Can compute SHA-256 at export if needed |
| Include authorship? | Yes | Fills current gap, enhances bag-info.txt |

---

**End of Audit**
