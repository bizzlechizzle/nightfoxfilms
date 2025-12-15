# Implementation Plan: Duplicate Detection Overhaul

**Status:** In Progress
**Created:** 2025-12-11
**Priority:** HIGH
**ADR Reference:** Follows from MAP-AUDIT-001

---

## Executive Summary

Complete overhaul of duplicate detection to fix:
1. Token Set Ratio for word-order independent matching
2. Blocking word detection (North/South/Building A/B)
3. Generic name handling
4. Cross-map import duplicate detection
5. Merge audit trail
6. MAP-AUDIT-001 linking bug fix

---

## Problem Analysis (From Actual Map Data)

| Metric | Value |
|--------|-------|
| Total locations analyzed | 3,077 |
| GPS duplicate groups | 614 |
| Cross-map duplicates | 609 |
| Generic-only names | 171 |
| Different names at same GPS | 281 |

**Critical Case:** "Union Station - Lockport" vs "Lockport Union Train Station"
- Current Jaro-Winkler: 63.1% (FAILS at 85% threshold)
- Token Set Ratio: ~100% (MATCHES correctly)
- GPS variance: 19.6m (missed by 10m threshold, caught by 150m)

---

## Implementation Phases

### Phase 1: Token Set Ratio Service

**New File:** `packages/desktop/electron/services/token-set-service.ts`

Creates word-order independent matching:
- `tokenSetRatio(s1, s2)` - Main algorithm
- `tokenSortRatio(s1, s2)` - Simpler sorted comparison
- `combinedNameScore(s1, s2)` - Uses both JW and TSR

**Dependencies:** jaro-winkler-service.ts

### Phase 2: Blocking Word Detection

**Update File:** `packages/desktop/electron/services/token-set-service.ts`

Add blocking word detection:
- Direction words: north/south/east/west
- Building identifiers: Building A, Unit 1, Ward B
- Temporal words: old/new/former/current

**Function:** `hasBlockingConflict(name1, name2): boolean`

### Phase 3: Generic Name Handling

**Update File:** `packages/desktop/electron/services/token-set-service.ts`

Add generic name detection:
- Generic names: house, church, school, factory, etc.
- Require exact GPS (25m) for generic matches
- Flag for user review instead of auto-merge

**Function:** `isGenericName(name): boolean`

### Phase 4: Update Location Duplicate Service

**Update File:** `packages/desktop/electron/services/location-duplicate-service.ts`

Changes:
- Import and use `tokenSetRatio`
- Use `max(jaroWinkler, tokenSetRatio)` for similarity
- Add blocking word check before match
- Add generic name special handling
- Add uncertainty detection (names with "?")

### Phase 5: Update Ref Map Dedup Service

**Update File:** `packages/desktop/electron/services/ref-map-dedup-service.ts`

Changes:
- Use token set ratio for name matching
- Increase GPS precision from 10m to 150m for cross-table
- Add blocking word detection
- Add generic name handling
- Track match confidence type

### Phase 6: Fix MAP-AUDIT-001 Linking Bug

**Update File:** `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

Fix: After enrichment, mark ref_map_point as linked:
```typescript
await db.updateTable('ref_map_points')
  .set({ linked_locid: enrichment.existingLocId, linked_at: new Date().toISOString() })
  .where('point_id', '=', pointId)
  .execute();
```

### Phase 7: Add Merge Audit Log

**Update File:** `packages/desktop/electron/main/database.ts`

New migration (52) - `merge_audit_log` table:
- merge_id (PK)
- merged_at, merged_by
- survivor_locid, merged_locid, merged_point_id
- match_type, confidence scores
- fields_updated (JSON)

### Phase 8: Update UI Components

**Update File:** `packages/desktop/src/components/DuplicateWarningPanel.svelte`

Changes:
- Show match explanation (shared words, blocking words)
- Show confidence breakdown
- Better visual indicators

### Phase 9: Update Constants and Types

**Update Files:**
- `packages/desktop/src/lib/constants.ts`
- `packages/desktop/electron/main/database.types.ts`

Add:
- `GENERIC_NAMES` set
- `BLOCKING_WORDS` config
- `TOKEN_SET_THRESHOLD` (0.80)
- New type definitions

---

## File Modification Summary

| File | Action | Phase |
|------|--------|-------|
| `electron/services/token-set-service.ts` | CREATE | 1-3 |
| `electron/services/location-duplicate-service.ts` | UPDATE | 4 |
| `electron/services/ref-map-dedup-service.ts` | UPDATE | 5 |
| `electron/main/ipc-handlers/ref-maps.ts` | UPDATE | 6 |
| `electron/main/database.ts` | UPDATE | 7 |
| `src/components/DuplicateWarningPanel.svelte` | UPDATE | 8 |
| `src/lib/constants.ts` | UPDATE | 9 |
| `electron/main/database.types.ts` | UPDATE | 9 |

---

## Testing Checklist

- [ ] "Union Station - Lockport" matches "Lockport Union Train Station"
- [ ] "North Factory" does NOT match "South Factory"
- [ ] "Building A" does NOT match "Building B"
- [ ] "House" requires GPS match, not name-only
- [ ] Generic names flagged for review
- [ ] Enriched points marked as linked
- [ ] Merge audit log records all auto-merges
- [ ] Cross-map duplicates detected

---

## Rollback Plan

All changes are additive. If issues occur:
1. Revert to Jaro-Winkler only by setting `TOKEN_SET_WEIGHT: 0`
2. Migration 52 is non-destructive (adds table)
3. UI changes are display-only

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Word-order matching | 100% for "Union Station - Lockport" case |
| False positive prevention | Block direction/building ID conflicts |
| Generic name handling | Require GPS or user confirmation |
| Linking bug | 0 orphaned enriched points |
| Audit trail | 100% of auto-merges logged |

---

End of Implementation Plan
