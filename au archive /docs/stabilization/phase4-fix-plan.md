# Fix Plan — v0.1.0 Stabilization

**Generated:** 2025-11-30
**Based on:** Phase 3 Audit Report

---

## Principles

- **Premium UX**: No user prompts, no rough edges
- **Offline-first**: Everything works without network
- **Data integrity**: All operations logged to database
- **No scope creep**: Fix issues, don't add features
- **Minimal changes**: Smallest fix that addresses the issue

---

## Fix Order

Fixes are ordered by dependency - what must be fixed first:

1. **FIX-001**: Remove unused S3 SDK (no dependencies)
2. **FIX-002**: Remove debug console.logs in Svelte components (no dependencies)
3. **FIX-003**: Add development check wrapper for remaining logs (depends on pattern decision)

Note: Full logger service implementation deferred to v0.1.1 due to scope.

---

## Fix Details

### FIX-001: Remove Unused @aws-sdk/client-s3

**Issue ID:** M-007
**File:** `packages/desktop/package.json`
**Severity:** Major (unused network dependency)

**Verification:**
```bash
grep -r "aws-sdk\|S3Client" packages/
# Result: Only in package.json, not used in any code
```

**Current Code:**
```json
"dependencies": {
  "@aws-sdk/client-s3": "^3.940.0",
```

**Fixed Code:**
```json
"dependencies": {
  // @aws-sdk/client-s3 REMOVED - not used in codebase
```

**Rationale:** Dependency declared but never imported. Removing reduces bundle size and eliminates network-required code.

**Testing:**
1. Run `pnpm install`
2. Run `pnpm build`
3. Run `pnpm dev` - verify app launches

**Risk:** Low - code doesn't use this package

---

### FIX-002: Remove Debug Console.logs in Svelte Components

**Issue ID:** C-002
**Files:** 5 Svelte component files
**Severity:** Critical

**Files to modify:**

#### LocationDetail.svelte (7 instances)

**Current Code (lines ~350-387):**
```typescript
console.log('[Kanye9] Loading location:', locid);
console.log('[Kanye9] Location data:', location);
// ... similar debug logs
```

**Fixed Code:**
```typescript
// Debug logs removed for production
```

#### Map.svelte (4 instances)

**Current Code (lines ~749, 806, 904, 910):**
```typescript
console.log('[Map] Adding marker:', location);
console.log('[Map] Cluster clicked:', cluster);
```

**Fixed Code:**
```typescript
// Debug logs removed for production
```

#### ImportModal.svelte (2 instances)

**Current Code (lines ~464, 519):**
```typescript
console.log('[ImportModal] Files selected:', files);
```

**Fixed Code:**
```typescript
// Debug logs removed for production
```

#### MediaViewer.svelte (1 instance)

**Current Code (line ~438):**
```typescript
console.log('[MediaViewer] Loading media:', media);
```

**Fixed Code:**
```typescript
// Debug logs removed for production
```

#### Imports.svelte (1 instance)

**Current Code (line ~129):**
```typescript
console.log('[Imports] Import progress:', progress);
```

**Fixed Code:**
```typescript
// Debug logs removed for production
```

**Rationale:** Debug logs visible in production; violates CLAUDE.md rules

**Testing:**
1. Run `pnpm dev`
2. Navigate to each affected page
3. Verify no console.log output in DevTools
4. Verify functionality still works

**Risk:** Low - removing logging doesn't affect functionality

---

### FIX-003: Wrap IPC Console.logs in Development Check (Optional)

**Issue ID:** C-001
**Files:** All IPC handler files
**Severity:** Critical (but larger scope)

**Approach:** Rather than removing all 116 instances, wrap in development check.

**Pattern to apply:**

**Current Code (example from locations.ts):**
```typescript
console.log('Creating location:', input.locnam);
```

**Fixed Code:**
```typescript
if (process.env.NODE_ENV === 'development') {
  console.log('Creating location:', input.locnam);
}
```

**Alternative (Minimal):** For v0.1.0, leave console.error() for actual errors and only remove console.log() debug statements.

**Rationale:** Full logger service would be ideal but adds scope. Development check is quick fix.

**Testing:**
1. Build production: `pnpm build`
2. Verify no console.log in production mode
3. Run dev: `pnpm dev`
4. Verify logs appear in development

**Risk:** Medium - touching many files

**Recommendation for v0.1.0:**
- Apply FIX-001 and FIX-002 (required)
- Defer FIX-003 to v0.1.1 (optional enhancement)

---

## Deferred to v0.1.1

### DEF-001: Implement Logger Service

**Issue ID:** C-001 (full solution)
**Rationale:** Proper structured logging requires:
- New service file
- Import changes in 20+ files
- Testing across all handlers
- Too much scope for stabilization

**Plan for v0.1.1:**
1. Create `packages/desktop/electron/services/logger-service.ts`
2. Implement log levels: error, warn, info, debug
3. Replace all console.* calls with logger.*
4. Add log rotation/persistence

---

### DEF-002: Consolidate Duplicate Scripts

**Issue ID:** M-002
**Rationale:** Both scripts work; removing one is a decision, not a fix

**Plan for v0.1.1:**
1. Decide canonical version (recommend Python)
2. Remove run-dedup.mjs
3. Update lilbits.md

---

### DEF-003: Consolidate Duplicate Functions

**Issue ID:** M-003
**Rationale:** Refactoring requires testing; low risk to leave as-is

**Plan for v0.1.1:**
1. Move normalizeName() to jaro-winkler-service
2. Export and import in location-duplicate-service
3. Test duplicate detection still works

---

### DEF-004: Add Missing Zod Validation

**Issue ID:** M-001
**Rationale:** Handlers work without validation; adding is enhancement

**Plan for v0.1.1:**
1. Add Zod schemas to database.ts
2. Add Zod schemas to ref-maps.ts
3. Add Zod schemas to research-browser.ts
4. Add Zod schemas to health.ts

---

## Risk Assessment

| Fix ID | Risk Level | Rollback Plan |
|--------|------------|---------------|
| FIX-001 | Low | Re-add package to dependencies |
| FIX-002 | Low | Restore console.log lines from git |
| FIX-003 | Medium | Revert file changes from git |

---

## Ultrathink Validation

### 1. CLAUDE.md Rules Compliance
- FIX-001: ✅ Removes unused dependency (offline-first principle)
- FIX-002: ✅ Removes production debug code (no console.log rule)
- FIX-003: ✅ Wraps remaining logs (development-only)

### 2. Scope Discipline
- ✅ Only fixing identified issues
- ✅ Not adding new features
- ✅ Deferring larger refactors to v0.1.1

### 3. Dependencies
- FIX-001: Independent
- FIX-002: Independent
- FIX-003: Depends on decision to proceed

### 4. Risk Assessment
- All fixes are low-to-medium risk
- All have clear rollback paths
- No database schema changes

### 5. Premium UX
- Fixes improve UX by removing debug noise
- No user-facing functionality changes

### 6. Data Integrity
- No changes to hashing, imports, or storage
- Logging changes don't affect data

### 7. Offline-First
- FIX-001 actively improves offline capability
- No network-dependent code added

---

## Implementation Checklist

Before implementing:
- [ ] Read each fix completely
- [ ] Verify current code matches documented code
- [ ] Back up any files before editing

After each fix:
- [ ] Run `pnpm lint`
- [ ] Run `pnpm build`
- [ ] Run `pnpm dev` and test affected feature
- [ ] Log result in implementation log

---

**PHASE 4 COMPLETE — 3 fixes planned (2 required, 1 optional). Ready for Phase 5**
