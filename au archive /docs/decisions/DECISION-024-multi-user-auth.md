# DECISION-024: Multi-User Authentication System

**Status:** Implemented (All Phases Complete)
**Date:** 2024-11-27
**Migrations:** 24 (Authentication), 25 (Activity Tracking)

## Context

AU Archive needed a multi-user authentication system to:
1. Track who catalogs, imports, and modifies locations
2. Support multiple contributors working from a shared NAS
3. Provide optional PIN protection for user accounts
4. Distinguish between single-user (personal) and multi-user (team) deployments

## Decision

Implement a phased multi-user system with four phases:

### Phase 1: Authentication Foundation ✓
- Single vs Multi-user mode selection during setup
- Simple 4-6 digit PIN authentication (SHA256 hashed)
- User management in Settings page
- Login page with PIN keypad
- Auto-login for single-user mode or multi-user without PINs
- Optional "Require Login at Startup" toggle in Settings

### Phase 2: Activity Tracking ✓
- `modified_by_id`, `modified_by`, `modified_at` columns on locations
- `imported_by_id`, `imported_by`, `media_source` columns on all media tables
- Automatic user injection in all create/update IPC handlers
- Audit trail for all mutations

### Phase 3: Author Attribution ✓
- `location_authors` junction table for multi-user attribution
- Role hierarchy: creator > documenter > contributor
- Automatic tracking when users create, import to, or edit locations
- Repository methods for querying authorship

### Phase 4: Per-User Stats ✓
- Individual user contribution statistics
- Top contributors leaderboards by role
- Integration with Nerd Stats display
- All active users summary view

## Implementation Guide

### Database Schema (Migration 24 - Authentication)

The migration adds three columns to the `users` table:

```sql
ALTER TABLE users ADD COLUMN pin_hash TEXT;
ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN last_login TEXT;
```

### Database Schema (Migration 25 - Activity Tracking)

Activity tracking columns on `locs` table:

```sql
ALTER TABLE locs ADD COLUMN created_by_id TEXT REFERENCES users(user_id);
ALTER TABLE locs ADD COLUMN created_by TEXT;
ALTER TABLE locs ADD COLUMN modified_by_id TEXT REFERENCES users(user_id);
ALTER TABLE locs ADD COLUMN modified_by TEXT;
ALTER TABLE locs ADD COLUMN modified_at TEXT;
```

Activity tracking columns on media tables (imgs, vids, docs, maps):

```sql
ALTER TABLE imgs ADD COLUMN imported_by_id TEXT REFERENCES users(user_id);
ALTER TABLE imgs ADD COLUMN imported_by TEXT;
ALTER TABLE imgs ADD COLUMN media_source TEXT;
-- Same for vids, docs, maps tables
```

Location authors junction table:

```sql
CREATE TABLE location_authors (
  locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('creator', 'documenter', 'contributor')),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (locid, user_id, role)
);
CREATE INDEX idx_location_authors_user ON location_authors(user_id);
CREATE INDEX idx_location_authors_role ON location_authors(role);
```

**Settings Keys:**
- `app_mode`: `'single'` or `'multi'` - determines authentication behavior
- `require_login`: `'true'` or `'false'` - force login even without PINs

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         App.svelte                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ checkingSetup│───>│ Setup.svelte │───>│ checkAuthRequired│  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│         │                                         │              │
│         v                                         v              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   Loading    │    │ Login.svelte │───>│   Main App       │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files

#### Phase 1: Authentication
| File | Purpose |
|------|---------|
| `electron/main/database.ts` | Migration 24 - adds PIN columns |
| `electron/main/database.types.ts` | TypeScript types for users table |
| `electron/repositories/sqlite-users-repository.ts` | User CRUD + auth methods |
| `electron/main/ipc-handlers/users.ts` | IPC handlers for user operations |
| `electron/preload/preload.cjs` | Preload bridge (CommonJS) |
| `electron/preload/index.ts` | Preload bridge (TypeScript types) |
| `src/pages/Login.svelte` | PIN entry UI with keypad |
| `src/pages/Setup.svelte` | 4-step wizard with mode selection |
| `src/pages/Settings.svelte` | User management UI |
| `src/App.svelte` | Auth flow orchestration |

#### Phase 2: Activity Tracking
| File | Purpose |
|------|---------|
| `electron/main/database.ts` | Migration 25 - adds activity columns |
| `electron/main/ipc-handlers/locations.ts` | Injects current user on create/update |
| `electron/main/ipc-handlers/media-import.ts` | Injects importer on media import |
| `electron/services/file-import-service.ts` | Passes user context through import pipeline |
| `electron/repositories/sqlite-location-repository.ts` | Activity tracking in mutations |
| `electron/repositories/sqlite-media-repository.ts` | Media activity tracking |

#### Phase 3: Author Attribution
| File | Purpose |
|------|---------|
| `electron/repositories/sqlite-location-authors-repository.ts` | Author tracking repository (NEW) |
| `electron/main/ipc-handlers/location-authors.ts` | Location authors IPC handlers (NEW) |
| `electron/main/ipc-handlers/index.ts` | Registers author handlers |
| `packages/core/src/domain/location.ts` | Author types and interfaces |

#### Phase 4: Per-User Stats
| File | Purpose |
|------|---------|
| `electron/main/ipc-handlers/stats-settings.ts` | User contribution stats handlers |
| `electron/preload/index.ts` | Stats API bridge extensions |

### Authentication Flow

```
1. App Launch
   │
   ├─> Setup not complete? → Show Setup.svelte
   │   └─> Step 1: Welcome
   │   └─> Step 2: Single/Multi mode selection
   │   └─> Step 3: User info (+ PIN for multi-user)
   │   └─> Step 4: Archive folder selection
   │
   └─> Setup complete?
       │
       ├─> Check app_mode setting
       │   │
       │   ├─> single mode → Auto-login, show Dashboard
       │   │
       │   └─> multi mode → Check require_login setting
       │       │
       │       ├─> require_login = true → Show Login.svelte
       │       │
       │       └─> require_login = false → Check anyUserHasPin()
       │           │
       │           ├─> No PINs → Auto-login, show Dashboard
       │           │
       │           └─> Has PINs → Show Login.svelte
       │               └─> User selects account
       │               └─> Enter PIN (if has_pin = true)
       │               └─> Verify → Show Dashboard
```

### PIN Security

- **Hashing:** SHA256 (sufficient for local desktop protection)
- **Storage:** `pin_hash` column in users table (null = no PIN)
- **Validation:** 4-6 digits only, numeric characters
- **Verification:** Compare SHA256(input) with stored hash

```typescript
// From sqlite-users-repository.ts
function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex');
}

async verifyPin(user_id: string, pin: string): Promise<boolean> {
  const row = await this.db
    .selectFrom('users')
    .select(['pin_hash'])
    .where('user_id', '=', user_id)
    .where('is_active', '=', 1)
    .executeTakeFirst();

  if (!row || !row.pin_hash) return false;
  return row.pin_hash === hashPin(pin);
}
```

### IPC Channels

#### Phase 1: User Authentication
| Channel | Purpose |
|---------|---------|
| `users:create` | Create user (with optional PIN) |
| `users:findAll` | List active users |
| `users:findById` | Get user by ID |
| `users:findByUsername` | Get user by username |
| `users:update` | Update username/display_name |
| `users:delete` | Soft delete (is_active = 0) |
| `users:verifyPin` | Verify PIN for login |
| `users:setPin` | Set/change user PIN |
| `users:clearPin` | Remove PIN requirement |
| `users:hasPin` | Check if user has PIN |
| `users:anyUserHasPin` | Check if login required |
| `users:updateLastLogin` | Update last_login timestamp |

#### Phase 3: Location Authors
| Channel | Purpose |
|---------|---------|
| `location-authors:add` | Add author to location |
| `location-authors:remove` | Remove author from location |
| `location-authors:findByLocation` | Get all authors for location |
| `location-authors:findByUser` | Get all locations by user |
| `location-authors:findCreator` | Get creator of location |
| `location-authors:countByUserAndRole` | Count contributions by role |
| `location-authors:countByLocation` | Count authors on location |
| `location-authors:trackContribution` | Auto-track user contribution |

#### Phase 4: Per-User Stats
| Channel | Purpose |
|---------|---------|
| `stats:userContributions` | Get contribution stats for user |
| `stats:topContributors` | Get top contributors by role |
| `stats:allUserStats` | Get all users with stats summary |

### Settings Storage

| Key | Values | Purpose |
|-----|--------|---------|
| `app_mode` | `'single'` / `'multi'` | Determines auth behavior |
| `require_login` | `'true'` / `'false'` | Force login even without PINs |
| `current_user_id` | UUID | Currently logged in user |
| `current_user` | string | Current user's username |
| `setup_complete` | `'true'` / `'false'` | First-run detection |

### UI Components

#### Login.svelte
- User dropdown selector
- PIN keypad (0-9, Clear, Backspace)
- Visual PIN indicator (dots)
- Keyboard support for PIN entry
- Auto-submit when PIN length reached

#### Setup.svelte (Updated)
- Step 1: Welcome screen
- Step 2: Single/Multi mode cards
- Step 3: Username + optional PIN (for multi-user)
- Step 4: Archive folder selection

#### Settings.svelte (Updated)
- Mode toggle (Single ↔ Multi)
- User list with edit/PIN/delete actions
- Add user form with optional PIN
- Current user indicator

### Author Role Hierarchy

The system distinguishes three types of contributions:

| Role | Definition | Triggered By |
|------|------------|--------------|
| `creator` | First person to catalog the location | `location:create` |
| `documenter` | Person who imports media to location | `media:import` or `media:phaseImport` |
| `contributor` | Person who edits location metadata | `location:update` |

A user can have multiple roles on the same location. The `location_authors` table uses a composite primary key `(locid, user_id, role)` to track each unique contribution type.

### Automatic Contribution Tracking

The system automatically tracks contributions without user action:

```typescript
// In location IPC handlers
if (currentUser && location) {
  await authorsRepo.trackUserContribution(location.locid, currentUser.userId, 'create');
}

// In media import handlers
if (currentUser) {
  await authorsRepo.trackUserContribution(validatedInput.locid, currentUser.userId, 'import');
}

// In location update handlers
if (currentUser) {
  await authorsRepo.trackUserContribution(validatedId, currentUser.userId, 'edit');
}
```

### Per-User Stats Response Format

```typescript
// stats:userContributions response
{
  locationsCreated: number;
  locationsDocumented: number;
  locationsContributed: number;
  totalLocationsInvolved: number;
  imagesImported: number;
  videosImported: number;
  documentsImported: number;
  totalMediaImported: number;
}

// stats:topContributors response
{
  topCreators: Array<{ userId, username, displayName, count }>;
  topDocumenters: Array<{ userId, username, displayName, count }>;
  topImporters: Array<{ userId, username, displayName, count }>;
}
```

### Future Considerations

Potential enhancements beyond the current implementation:

1. **Activity Log Table** - Detailed audit trail with timestamps for all operations
2. **Media Source Tracking** - Track external sources (Facebook, Reddit, etc.) for imported media
3. **Contribution Visualization** - Timeline view of location history
4. **Permission Levels** - Read-only vs edit access per user

## Alternatives Considered

1. **Password-based auth** - Rejected as overkill for local desktop app
2. **Biometric auth** - Not available on all systems
3. **External auth service** - Violates offline-first principle
4. **No auth, just user selection** - Doesn't protect shared NAS deployments

## Consequences

### Positive
- Clear separation of single vs multi-user deployments
- Simple PIN protection without password complexity
- Complete activity tracking for all mutations
- Multi-user attribution without workflow overhead
- Per-user contribution statistics for team visibility
- Maintains offline-first principle
- All tracking is automatic and non-intrusive

### Negative
- PIN is less secure than passwords (but appropriate for use case)
- No account recovery if PIN forgotten (by design - local app)
- Multi-user mode requires all users to be pre-created
- Denormalized username fields require updates if usernames change

## Testing Checklist - All Phases

### Phase 1: Authentication
- [ ] Fresh install shows Setup wizard
- [ ] Single-user mode skips login
- [ ] Multi-user without PINs auto-logs in (when require_login = false)
- [ ] Multi-user with require_login = true shows Login page
- [ ] PIN validation (4-6 digits, numeric only)
- [ ] PIN mismatch shows error
- [ ] Correct PIN logs in and updates last_login
- [ ] Settings: Add/edit/delete users
- [ ] Settings: Change/remove PIN
- [ ] Settings: Toggle require_login setting

### Phase 2: Activity Tracking
- [ ] Location create records created_by_id/created_by
- [ ] Location update records modified_by_id/modified_by/modified_at
- [ ] Media import records imported_by_id/imported_by
- [ ] Activity columns display correctly in UI

### Phase 3: Author Attribution
- [ ] Creating location adds creator role to location_authors
- [ ] Importing media adds documenter role
- [ ] Editing location adds contributor role
- [ ] Location detail shows all contributors
- [ ] Users can have multiple roles on same location

### Phase 4: Per-User Stats
- [ ] User contributions show correct counts
- [ ] Top contributors display in Nerd Stats
- [ ] All users summary loads correctly
- [ ] Stats update after new contributions

## References

- Migration files: `electron/main/database.ts` (Migrations 24, 25)
- Related: DECISION-023 (Hidden Media) - previous migration
