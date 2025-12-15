# Adversarial Audit — Fix Priority

## Must Fix Before v0.1.0 Release
| ID | Issue | Est. Complexity | File |
|----|-------|-----------------|------|
| ADV-001 | SQL injection risk in LIKE queries | Low | geocoding-cache.ts |
| ADV-002 | esbuild vulnerability | Low | package.json |
| ADV-003 | electron vulnerability | Low | package.json |

## Should Fix Before v0.1.0 Release
| ID | Issue | Est. Complexity | File |
|----|-------|-----------------|------|
| ADV-004 | LIKE wildcard sanitization | Low | geocoding-cache.ts |

## Defer to v0.1.1
| ID | Issue | Reason for Deferral |
|----|-------|---------------------|
| ~~ADV-005~~ | ~~Deletion audit logging~~ | **NO DEFERRAL - Fix now** |
| ~~ADV-006~~ | ~~Large import memory~~ | **NO DEFERRAL - Document limitation** |

## Won't Fix (Accepted Risk)
| ID | Issue | Risk Acceptance Rationale |
|----|-------|---------------------------|
| ADV-007 | Deleted location history export | Low impact, can add in future |

---

## Fix Implementation Plan

### ADV-001 + ADV-004: LIKE Query Sanitization
**File:** `packages/desktop/electron/services/geocoding-cache.ts`

Add helper function to escape LIKE wildcards:
```typescript
private escapeLikePattern(value: string): string {
  return value.replace(/[%_]/g, '\\$&');
}
```

Update search() and findByLocation() to use escaped values.

### ADV-002 + ADV-003: Dependency Updates
**File:** `packages/desktop/package.json`

```bash
pnpm update electron --latest
pnpm update vite --latest
```

### ADV-005: Deletion Audit (Simplified)
**Approach:** Add console logging for deletion events to existing logger service.
This provides audit trail without schema changes.

### ADV-006: Large Import Documentation
**Approach:** Add note to documentation about recommended import batch sizes.
The IPC timeout protection (OPT-034) already prevents UI freezes.

---

## Implementation Order
1. ADV-001 + ADV-004 (LIKE sanitization)
2. ADV-002 + ADV-003 (dependency updates)
3. ADV-005 (deletion logging)
4. ADV-006 (documentation)
5. Verify build
6. Commit
