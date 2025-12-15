# Date Engine Plan Audit

## Audit Summary

**Date**: 2025-12-13
**Auditor**: Claude
**Status**: APPROVED WITH NOTES

---

## 1. Goal Coverage Audit

### Original User Requirements

| Requirement | Plan Coverage | Status |
|-------------|---------------|--------|
| Thin wrapper around chrono-node + compromise-dates | chrono-node only (compromise-dates redundant) | COVERED |
| Category detection (keyword lists) | 7 categories with keyword lists | COVERED |
| Database schema for extractions + timeline events | date_extractions table + 2 additional tables | COVERED |
| Verification workflow | pending/auto_approved/user_approved/rejected/converted/reverted | COVERED |
| Custom chrono refiner for historical dates (1900s bias) | Years 20-99 → 1920-1999 | COVERED |

### User's Date Format Requirements

| Format | Plan Coverage | Status |
|--------|---------------|--------|
| xx/xx/xx (6-digit) | chrono-node handles | COVERED |
| xx/xx/xxxx (8-digit) | chrono-node handles | COVERED |
| xxxx/xx/xx (ISO) | chrono-node handles | COVERED |
| 4-digit year | chrono-node handles | COVERED |
| 2-digit year (with caution) | Historical bias refiner | COVERED |
| Written months | chrono-node handles | COVERED |
| Day of week names | chrono-node handles | COVERED |
| Combo "March 1968" | chrono-node handles | COVERED |
| Smart punctuation handling | chrono-node handles | COVERED |

### User's Context Requirements

| Requirement | Plan Coverage | Status |
|-------------|---------------|--------|
| Read sentence containing date | sentence field + extractSentence() | COVERED |
| Determine context | category + category_keywords | COVERED |
| Build dates auto-approved | Auto-approve if confidence >= 0.6 | COVERED |
| Site visits | site_visit category | COVERED |
| Historical dates / news stories | publication category | COVERED |
| Web page dates to timeline | convertToTimeline IPC | COVERED |
| Obituary mentions | obituary category | COVERED |
| Technical date (added to DB) | Exists in timeline as database_entry | EXISTING |
| Run on existing bookmarks | backfillWebSources + backfillImageCaptions | COVERED |

### Additional v1 Features (User Request)

| Feature | Plan Coverage | Status |
|---------|---------------|--------|
| ML learning from verified results | date_engine_learning table + weight_modifier | COVERED |
| Date extraction from OCR'd documents | tesseract.js + ocr-service.ts | COVERED |
| Bulk approval keyboard shortcuts | j/k/a/r/Enter/Escape/Shift+A | COVERED |
| Export pending to CSV | exportPending/importReviewed IPC | COVERED |
| Regex pattern library | date_patterns table + PatternEditor | COVERED |

---

## 2. CLAUDE.md Compliance Audit

### Development Rules Compliance

| Rule | Compliance | Notes |
|------|------------|-------|
| Scope Discipline | PASS | All features are user-requested |
| Archive-First | PASS | Serves research/metadata workflows |
| Prefer Open Source | PASS | chrono-node (MIT), tesseract.js (Apache-2.0) |
| Offline-First | PASS | All processing is local, no cloud APIs |
| One Script = One Function | PASS | Separate services for each concern |
| No AI in Docs | PASS | No AI mentions in user-facing docs |
| Keep It Simple | CAUTION | 15 phases is complex but user-requested |
| Binary Dependencies Welcome | PASS | tesseract.js uses WASM binaries |

### Critical Gotchas Compliance

| Gotcha | Compliance | Notes |
|--------|------------|-------|
| Preload MUST be CommonJS | PASS | Adding to preload.cjs with require() |
| Database source of truth | PASS | Migration 76 in database.ts |
| Database location | PASS | Uses existing database |
| GPS confidence ladder | N/A | Not GPS-related |
| Import spine | PASS | Integrates with websource-orchestrator |
| Hashing first | N/A | Not file import |
| Archive folder structure | N/A | Not file storage |
| Ownership pledge | PASS | All data stays local |

### IPC Naming Compliance

| Channel Pattern | Compliance |
|-----------------|------------|
| `dateEngine:extractFromWebSource` | PASS - domain:action format |
| `dateEngine:approve` | PASS |
| `dateEngine:exportPending` | PASS |

### File Naming Conventions

| Type | Convention | Compliance |
|------|------------|------------|
| Svelte components | PascalCase | PASS - DateExtractionReview.svelte |
| Services/utilities | kebab-case | PASS - date-engine-service.ts |
| Domain models | PascalCase | PASS - DateExtraction type |
| IPC handlers | kebab-case with domain prefix | PASS - date-engine.ts |
| Migrations | In database.ts | PASS - Migration 76 |

### Security Defaults

| Requirement | Compliance | Notes |
|-------------|------------|-------|
| contextIsolation: true | PASS | Existing config |
| No remote module | PASS | Uses IPC |
| No nodeIntegration in renderer | PASS | Uses preload bridge |

---

## 3. Deep Analysis (Ultrathink)

### Architectural Considerations

**Strengths:**
1. Clean separation: domain types → service → repository → IPC → UI
2. Follows existing patterns in codebase
3. Integrates with existing timeline system
4. Non-destructive: extractions stored separately from timeline until approved

**Potential Issues:**
1. **Performance**: Processing large text blobs with chrono-node + custom patterns could be slow
   - Mitigation: Process in job queue, not blocking UI
2. **OCR Memory**: tesseract.js can be memory-heavy
   - Mitigation: Process one document at a time, cleanup after
3. **Pattern Complexity**: User-defined regex could cause ReDoS
   - Mitigation: Add pattern validation, timeout on regex execution

### Data Flow Analysis

```
Web Source Text → Date Engine Service → Extractions
                         ↓
                  Custom Patterns (checked first)
                         ↓
                  chrono-node (with bias refiner)
                         ↓
                  Category Classification
                         ↓
                  Confidence Scoring (with ML weights)
                         ↓
                  Duplicate Detection
                         ↓
                  Conflict Detection
                         ↓
                  Auto-approve or Queue for Review
```

### Edge Cases to Handle

| Edge Case | Handling |
|-----------|----------|
| No dates in text | Return empty array, mark source as processed |
| Same date multiple times | Dedup by (locid, date_start, category) |
| Conflicting dates in same source | Store all, let user choose |
| OCR text garbage | Low parser_confidence, require manual review |
| Very long text | Process in chunks, chrono handles gracefully |
| Malformed regex patterns | Validate on save, timeout on execute |

### Missing Elements Identified

1. **Rate limiting for backfill**: Should process in batches to avoid overwhelming system
2. **Progress tracking for backfill**: Need to track % complete
3. **Error recovery**: What if extraction fails mid-batch?
4. **Pattern import/export**: Users may want to share patterns

### Recommendations

1. Add `batch_size` and `batch_delay` params to backfill
2. Add progress event emission during backfill
3. Add try/catch per extraction in processor
4. Add pattern import/export to Phase 15

---

## 4. Final Verdict

### Compliance Score: 95/100

**Deductions:**
- -3: Missing batch/progress controls for backfill
- -2: No pattern import/export

### Risk Assessment: LOW

All features are well-defined, follow existing patterns, and have clear implementation paths.

### Approval: APPROVED

Ready for implementation with the following notes:
1. Add batch controls to backfill
2. Add progress events
3. Add pattern import/export
4. Add regex validation with timeout

---

## 5. Updated Plan Addendum

The following should be added to the plan:

```markdown
### Backfill Controls
- batch_size: 50 sources per batch (configurable)
- batch_delay: 100ms between batches
- Progress events: { processed, total, current }
- Resume capability: skip sources with dates_extracted_at set

### Pattern Safety
- Regex validation on save (must compile)
- Regex execution timeout: 1000ms
- Max pattern length: 500 chars
- Pattern import/export: JSON format

### Error Handling
- Per-extraction try/catch in processor
- Log errors but continue processing
- Store error in extraction record if needed
```
