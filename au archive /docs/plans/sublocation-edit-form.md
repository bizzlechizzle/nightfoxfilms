# Sub-Location Edit Form - Implementation Plan

## Full Audit

### Current State

**LocationInfo.svelte Edit Modal** - Currently edits HOST location fields:
- Location Name (locnam) + verification
- Hero Display Name (locnamShort, locnamUseThe)
- AKA (akanam) + verification
- Historical Name (historicalName) + verification
- Status (access)
- Type / Sub-Type (type, stype)
- Built / Abandoned
- Documentation checkboxes
- Flags (historic, favorite, project)
- Author
- Footer: "Convert to Host Location" link

**slocs table** - Current fields:
```
subnam, ssubname, type, status, hero_imgsha, is_primary, GPS fields
```

**Missing on slocs** - Fields that need migration:
```
akanam, historicalName
```

### User Request

When editing on a sub-location page:
1. Edit sub-location name (not host location name)
2. Keep AKA and Historical Name (add to slocs table)
3. Remove Type/Sub-Type, add Building Type
4. Everything else stays the same (edits host location)

---

## Solution

### Visual Target

**Sub-location edit form:**
```
┌─────────────────────────────────────────┐
│ Edit Information                    [X] │
├─────────────────────────────────────────┤
│ Building Name *                         │  ← subnam
│ [Schoolhouse                        ]   │
│                                         │
│ Short Name                              │  ← ssubname (simplified)
│ [                                   ]   │
│                                         │
│ Also Known As                           │  ← slocs.akanam (NEW)
│ [pill] [pill] [add input]               │
│                                         │
│ Historical Name                         │  ← slocs.historicalName (NEW)
│ [dropdown from AKA]                     │
│                                         │
│ Status          Building Type           │
│ [Abandoned ▼]   [Main Building    ]     │  ← slocs.status, slocs.type
│                                         │
│ [ ] Primary Building                    │  ← slocs.is_primary (NEW)
│     Set as main structure of campus     │
│                                         │
│ ─────────── Campus Info ─────────────── │
│                                         │
│ Built           Abandoned               │  ← host location fields
│ [Year ▼] [1920] [Year ▼] [2005   ]      │
│                                         │
│ Documentation                           │  ← host location fields
│ [x] Interior [x] Exterior [ ] Drone     │
│                                         │
│ Flags                                   │  ← host location fields
│ [ ] Project [ ] Favorite [ ] Historic   │
│                                         │
│ Author                                  │  ← host location fields
│ [Bryant                            ]    │
├─────────────────────────────────────────┤
│                    [Cancel] [Save]      │  ← No "Convert to Host"
└─────────────────────────────────────────┘
```

**Key differences from host location edit:**
- "Building Name" instead of "Location Name"
- "Short Name" only (no "Prepend The" toggle)
- No verification checkmarks (keep it simple)
- "Building Type" single field instead of Type/Sub-Type
- "Primary Building" checkbox added
- "Campus Info" divider separates building vs host fields
- No "Convert to Host Location" in footer

---

## Implementation

### Step 1: Database Migration - Add fields to slocs

**File:** `packages/desktop/electron/migrations/032_sublocation_aka_historical.ts`

```typescript
import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('slocs')
    .addColumn('akanam', 'text')
    .execute();

  await db.schema
    .alterTable('slocs')
    .addColumn('historicalName', 'text')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // SQLite doesn't support DROP COLUMN easily
  // Would need to recreate table
}
```

### Step 2: Update database types

**File:** `packages/desktop/electron/main/database.types.ts`

Add to SlocsTable interface:
```typescript
akanam: string | null;
historicalName: string | null;
```

### Step 3: Update sublocation repository

**File:** `packages/desktop/electron/repositories/sqlite-sublocation-repository.ts`

Update interfaces:
```typescript
// SubLocation entity - add fields
akanam: string | null;
historicalName: string | null;

// UpdateSubLocationInput - add fields
akanam?: string | null;
historicalName?: string | null;
```

Update `mapRowToSubLocation`:
```typescript
akanam: row.akanam || null,
historicalName: row.historicalName || null,
```

Update `update` method to handle new fields.

### Step 4: Update IPC handlers

**File:** `packages/desktop/electron/main/ipc-handlers.ts` (or wherever sublocation handlers are)

Ensure `sublocations:update` handler passes akanam/historicalName to repository.

### Step 5: Pass sub-location to LocationInfo

**File:** `LocationDetail.svelte`

```svelte
<LocationInfo
  ...
  currentSubLocation={isViewingSubLocation ? currentSubLocation : null}
  onSubLocationSave={isViewingSubLocation ? handleSubLocationSave : undefined}
/>
```

Add handler:
```typescript
async function handleSubLocationSave(subUpdates: SubLocationUpdates, locUpdates: Partial<LocationInput>) {
  if (currentSubLocation) {
    // Save sub-location fields
    await window.electronAPI.sublocations.update(currentSubLocation.subid, subUpdates);
    // Save host location fields
    await window.electronAPI.locations.update(locationId, locUpdates);
    // Reload
    await loadLocation();
  }
}
```

### Step 6: Conditional edit form in LocationInfo

**File:** `LocationInfo.svelte`

Add props:
```typescript
interface Props {
  // ... existing
  currentSubLocation?: SubLocation | null;
  onSubLocationSave?: (subUpdates, locUpdates) => Promise<void>;
}
```

In edit modal, conditionally render:
- Building Name vs Location Name
- Short Name only (no "Prepend The") for sub-locations
- Building Type (single) vs Type/Sub-Type
- Primary Building checkbox for sub-locations
- Hide verification checkmarks for sub-locations
- "Campus Info" divider for sub-locations
- Hide "Convert to Host" button for sub-locations

Dual save logic:
```typescript
async function handleSave() {
  if (currentSubLocation && onSubLocationSave) {
    // Sub-location mode: split fields
    const subUpdates = { subnam, ssubname, type, status, is_primary, akanam, historicalName };
    const locUpdates = { builtYear, abandonedYear, docInterior, ..., auth_imp };
    await onSubLocationSave(subUpdates, locUpdates);
  } else if (onSave) {
    // Host/regular location mode
    await onSave({ ... });
  }
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `migrations/032_sublocation_aka_historical.ts` | New migration for akanam, historicalName |
| `database.types.ts` | Add akanam, historicalName to SlocsTable |
| `sqlite-sublocation-repository.ts` | Handle new fields in interfaces and CRUD |
| IPC handlers | Ensure update accepts new fields |
| `LocationDetail.svelte` | Pass currentSubLocation, add dual save handler |
| `LocationInfo.svelte` | Conditional form fields, dual save logic |

---

## Field Mapping (Sub-Location Edit)

| Form Field | Sub-Location Mode | Host Location Mode |
|------------|-------------------|-------------------|
| Name | `subnam` | `locnam` |
| Name Verified | Hidden | `locnamVerified` |
| Short Name | `ssubname` | `locnamShort` |
| Prepend "The" | Hidden | `locnamUseThe` |
| AKA | `slocs.akanam` | `locs.akanam` |
| AKA Verified | Hidden | `akanamVerified` |
| Historical | `slocs.historicalName` | `locs.historicalName` |
| Historical Verified | Hidden | `historicalNameVerified` |
| Status | `slocs.status` | `locs.access` |
| Type | `slocs.type` (Building Type) | `locs.type` |
| Sub-Type | Hidden | `locs.stype` |
| Primary Building | `slocs.is_primary` | Hidden |
| Built/Abandoned | `locs.*` (host) | `locs.*` |
| Documentation | `locs.*` (host) | `locs.*` |
| Flags | `locs.*` (host) | `locs.*` |
| Author | `locs.*` (host) | `locs.*` |
| Convert to Host | Hidden | Show (if applicable) |

---

## Testing Checklist

- [ ] Migration runs successfully, adds columns to slocs table
- [ ] Host location page: Edit form unchanged (all fields, verification checkmarks, Convert to Host)
- [ ] Sub-location page: "Building Name" instead of "Location Name"
- [ ] Sub-location page: "Short Name" only (no Prepend The toggle)
- [ ] Sub-location page: No verification checkmarks
- [ ] Sub-location page: Building Type field (single) instead of Type/Sub-Type
- [ ] Sub-location page: "Primary Building" checkbox works
- [ ] Sub-location page: "Campus Info" divider visible
- [ ] Sub-location page: No "Convert to Host" button
- [ ] Sub-location page: AKA and Historical Name save to sub-location
- [ ] Sub-location page: Built/Abandoned/Documentation/Flags/Author save to host
- [ ] Sub-location page: Changes to Building Name reflect in title
- [ ] Setting Primary Building updates host location's sub12 field
