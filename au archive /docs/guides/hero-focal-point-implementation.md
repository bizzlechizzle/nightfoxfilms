# Hero Image Focal Point Implementation Guide

**Feature ID:** OPT-095
**Status:** Complete
**Last Updated:** 2025-12-07

---

## Overview

The hero focal point feature allows users to specify the visual center of interest for hero images. This ensures that when hero images are cropped (e.g., in cards, thumbnails, or responsive layouts), the most important part of the image remains visible.

### Visual Example

```
Without focal point (default center):        With focal point (top-left):
┌─────────────────────────────┐              ┌─────────────────────────────┐
│                             │              │                             │
│         ┌───────┐           │              │  ┌───────┐                  │
│         │ CROP  │           │              │  │ CROP  │                  │
│         │ HERE  │  ●<─focus │              │  │ HERE  │                  │
│         └───────┘           │              │  └───────┘                  │
│                             │              │  ●<─focus                   │
│                             │              │                             │
└─────────────────────────────┘              └─────────────────────────────┘
```

---

## Data Model

### Fields

| Field | Type | Range | Default | Description |
|-------|------|-------|---------|-------------|
| `hero_imghash` | TEXT | 16-char hex | null | BLAKE3 hash of the hero image |
| `hero_focal_x` | REAL | 0.0 - 1.0 | 0.5 | Horizontal focal point (0=left, 1=right) |
| `hero_focal_y` | REAL | 0.0 - 1.0 | 0.5 | Vertical focal point (0=top, 1=bottom) |

### Storage Locations

| Entity | Table | Columns |
|--------|-------|---------|
| Location | `locs` | `hero_imghash`, `hero_focal_x`, `hero_focal_y` |
| Sub-location | `slocs` | `hero_imghash`, `hero_focal_x`, `hero_focal_y` |

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UI LAYER (Svelte)                              │
│  MediaViewer.svelte ─────────────────────────────────────────────────── │
│  └─ Focal point editor with drag interaction                             │
│                                                                          │
│  LocationDetail.svelte ─────────────────────────────────────────────────│
│  └─ Passes callbacks and current focal values to MediaViewer             │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ Props + Callbacks
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         PRELOAD BRIDGE (CommonJS)                        │
│  preload.cjs ─────────────────────────────────────────────────────────── │
│  └─ locations.update(id, input) → ipcRenderer.invoke("location:update")  │
│  └─ sublocations.update(id, updates) → ipcRenderer.invoke(...)           │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ IPC Channel
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         IPC HANDLER LAYER                                │
│  locations.ts ──────────────────────────────────────────────────────────│
│  └─ Validates with LocationInputSchema.partial().parse(input)            │
│                                                                          │
│  sublocations.ts ───────────────────────────────────────────────────────│
│  └─ Validates with inline UpdateSchema (includes hero_focal_x/y)         │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ Validated Data
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         REPOSITORY LAYER                                 │
│  sqlite-location-repository.ts ─────────────────────────────────────────│
│  └─ update(): Maps input.hero_focal_x/y to database columns              │
│                                                                          │
│  sqlite-sublocation-repository.ts ──────────────────────────────────────│
│  └─ update(): Maps input.hero_focal_x/y to database columns              │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ SQL Operations
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATABASE (SQLite)                                │
│  locs table: hero_focal_x REAL DEFAULT 0.5                              │
│  slocs table: hero_focal_x REAL DEFAULT 0.5                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### 1. Database Schema (Migration)

The columns were added in Migration 28:

```sql
-- Migration 28: Hero focal point
ALTER TABLE locs ADD COLUMN hero_focal_x REAL DEFAULT 0.5;
ALTER TABLE locs ADD COLUMN hero_focal_y REAL DEFAULT 0.5;
ALTER TABLE slocs ADD COLUMN hero_focal_x REAL DEFAULT 0.5;
ALTER TABLE slocs ADD COLUMN hero_focal_y REAL DEFAULT 0.5;
```

**File:** `packages/desktop/electron/main/database.ts`

### 2. Domain Schema (Zod Validation)

Location input schema includes focal point fields:

```typescript
// packages/core/src/domain/location.ts
export const LocationInputSchema = z.object({
  // ... other fields ...
  hero_imghash: z.string().length(16).regex(/^[a-f0-9]+$/).optional(),
  hero_focal_x: z.number().min(0).max(1).optional(),  // OPT-095
  hero_focal_y: z.number().min(0).max(1).optional(),  // OPT-095
});
```

### 3. IPC Handler - Locations

The location update handler uses partial schema parsing:

```typescript
// packages/desktop/electron/main/ipc-handlers/locations.ts
ipcMain.handle('location:update', async (_event, locid: unknown, input: unknown) => {
  const validatedId = z.string().uuid().parse(locid);
  const validatedInput = LocationInputSchema.partial().parse(input);
  return await locRepo.update(validatedId, validatedInput);
});
```

**Key Point:** `LocationInputSchema.partial()` makes all fields optional, allowing updates of individual fields without requiring the full object.

### 4. IPC Handler - Sublocations

The sublocation handler uses an inline schema:

```typescript
// packages/desktop/electron/main/ipc-handlers/sublocations.ts
ipcMain.handle('sublocation:update', async (_event, subid: unknown, updates: unknown) => {
  const validatedId = z.string().uuid().parse(subid);
  const UpdateSchema = z.object({
    // ... other fields ...
    hero_imghash: z.string().nullable().optional(),
    hero_focal_x: z.number().min(0).max(1).optional(),  // OPT-095
    hero_focal_y: z.number().min(0).max(1).optional(),  // OPT-095
  });
  const validatedUpdates = UpdateSchema.parse(updates);
  return await sublocRepo.update(validatedId, validatedUpdates);
});
```

### 5. Repository - Location Update

```typescript
// packages/desktop/electron/repositories/sqlite-location-repository.ts
async update(locid: string, input: LocationInput): Promise<Location | null> {
  const updates: Partial<LocsTable> = {};

  // ... other field mappings ...

  if (input.hero_imghash !== undefined) updates.hero_imghash = input.hero_imghash;
  if (input.hero_focal_x !== undefined) updates.hero_focal_x = input.hero_focal_x;
  if (input.hero_focal_y !== undefined) updates.hero_focal_y = input.hero_focal_y;

  await this.db.updateTable('locs')
    .set(updates)
    .where('locid', '=', locid)
    .execute();

  return this.findById(locid);
}
```

**Key Point:** Uses `!== undefined` check to allow setting values to `0` (which is falsy but valid).

### 6. Repository - Sublocation Update

```typescript
// packages/desktop/electron/repositories/sqlite-sublocation-repository.ts
async update(subid: string, input: Partial<SubLocation>): Promise<SubLocation | null> {
  const updateValues: Partial<SlocsTable> = {};

  // ... other field mappings ...

  if (input.hero_imghash !== undefined) updateValues.hero_imghash = input.hero_imghash;
  if (input.hero_focal_x !== undefined) updateValues.hero_focal_x = input.hero_focal_x;
  if (input.hero_focal_y !== undefined) updateValues.hero_focal_y = input.hero_focal_y;

  await this.db.updateTable('slocs')
    .set(updateValues)
    .where('subid', '=', subid)
    .execute();

  return this.findById(subid);
}
```

### 7. Preload Bridge

The preload script exposes the update functions:

```javascript
// packages/desktop/electron/preload/preload.cjs
contextBridge.exposeInMainWorld('electronAPI', {
  locations: {
    update: (id, input) => invokeAuto("location:update")(id, input),
    // ...
  },
  sublocations: {
    update: (subid, updates) => invokeAuto("sublocation:update")(subid, updates),
    // ...
  },
});
```

### 8. UI Component - LocationDetail.svelte

Passes focal point values and callbacks to MediaViewer:

```svelte
<!-- packages/desktop/src/pages/LocationDetail.svelte -->
<MediaViewer
  focalX={currentSubLocation?.hero_focal_x ?? location?.hero_focal_x ?? 0.5}
  focalY={currentSubLocation?.hero_focal_y ?? location?.hero_focal_y ?? 0.5}
  onSetHeroImage={currentSubLocation
    ? async (imghash, focalX, focalY) => {
        await window.electronAPI.sublocations.update(
          currentSubLocation.subid,
          { hero_imghash: imghash, hero_focal_x: focalX, hero_focal_y: focalY }
        );
        await loadLocation();
      }
    : async (imghash, focalX, focalY) => {
        await window.electronAPI.locations.update(
          locationId,
          { hero_imghash: imghash, hero_focal_x: focalX, hero_focal_y: focalY }
        );
        await loadLocation();
      }}
/>
```

**Key Points:**
- Uses nullish coalescing (`??`) to provide default value of 0.5
- Different callbacks for sublocation vs location context
- Reloads location data after update to refresh UI

### 9. UI Component - MediaViewer.svelte

The focal point editor UI:

```svelte
<!-- packages/desktop/src/components/MediaViewer.svelte -->
<script lang="ts">
  // Props
  let {
    focalX = 0.5,
    focalY = 0.5,
    onSetHeroImage,
    // ...
  }: MediaViewerProps = $props();

  // State for editing
  let pendingFocalX = $state(focalX);
  let pendingFocalY = $state(focalY);
  let isEditingFocal = $state(false);
  let isDraggingFocal = $state(false);

  // Drag handler
  function handleFocalDrag(e: MouseEvent) {
    if (!isDraggingFocal || !focalImageRef) return;
    const rect = focalImageRef.getBoundingClientRect();
    pendingFocalX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    pendingFocalY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  }

  // Save handler
  function saveFocalEdit() {
    if (currentMedia) {
      if (settingHeroFor === 'campus' && onSetHostHeroImage) {
        onSetHostHeroImage(currentMedia.hash, pendingFocalX, pendingFocalY);
      } else if (onSetHeroImage) {
        onSetHeroImage(currentMedia.hash, pendingFocalX, pendingFocalY);
      }
    }
    settingHeroFor = null;
    isEditingFocal = false;
  }
</script>

<!-- Focal point editor overlay -->
{#if isEditingFocal}
  <div class="focal-editor"
       on:mousemove={handleFocalDrag}
       on:mouseup={() => isDraggingFocal = false}>
    <img bind:this={focalImageRef} src={currentMedia.previewPath} />
    <div class="focal-point"
         style="left: {pendingFocalX * 100}%; top: {pendingFocalY * 100}%"
         on:mousedown={() => isDraggingFocal = true} />
  </div>
{/if}
```

### 10. CSS Display

Hero images use `object-position` for proper cropping:

```svelte
<img
  src={heroImagePath}
  style="object-fit: cover; object-position: {focalX * 100}% {focalY * 100}%"
/>
```

---

## User Flow

1. **Open Location Detail** → View location with existing hero image
2. **Open Media Viewer** → Click on any image in the gallery
3. **Click "Show Info"** → Opens the info panel
4. **Scroll to Hero Image Section** → Shows "Set as Hero" button if viewing eligible image
5. **Click "Set as Hero"** → Opens focal point editor
6. **Drag Focal Point** → Position the red crosshair on the area of interest
7. **Click "Save"** → Saves hero_imghash + hero_focal_x + hero_focal_y to database
8. **UI Updates** → Location reloads, hero image displays with new focal point

---

## Testing Checklist

### Database Verification

```sql
-- Check columns exist
PRAGMA table_info(locs);
PRAGMA table_info(slocs);

-- Verify data is saved
SELECT locnam, hero_imghash, hero_focal_x, hero_focal_y FROM locs WHERE hero_imghash IS NOT NULL;
SELECT subnam, hero_imghash, hero_focal_x, hero_focal_y FROM slocs WHERE hero_imghash IS NOT NULL;

-- Test update
UPDATE locs SET hero_focal_x = 0.25, hero_focal_y = 0.75 WHERE locnam = 'Test Location';
```

### Manual Testing Steps

1. **Set Hero Image:**
   - Navigate to a location with images
   - Open an image in the lightbox
   - Click "Show Info"
   - Scroll to "Hero Image" section
   - Click "Set as Hero"
   - Drag the focal point
   - Click "Save"
   - Verify the card thumbnail uses the focal point

2. **Update Focal Point:**
   - Open an existing hero image
   - Click "Show Info" → "Edit Focal Point"
   - Move the focal point
   - Save and verify

3. **Sublocation Hero:**
   - Select a sublocation
   - Repeat the hero setting process
   - Verify sublocation card shows correct focal point

---

## Common Issues

### Issue: Focal Point Not Saving

**Symptoms:** Focal point editor works but values aren't persisted.

**Checklist:**
1. Check browser DevTools console for errors
2. Verify IPC channel is being called:
   ```javascript
   // Add to LocationDetail.svelte callback temporarily
   console.log('Saving focal point:', { imghash, focalX, focalY });
   ```
3. Check Electron main process console for validation errors
4. Verify database columns exist with correct types

### Issue: Default Center Always Used

**Symptoms:** Hero images always crop to center.

**Checklist:**
1. Verify `focalX` and `focalY` props are passed to the image component
2. Check that the database is returning non-null values
3. Ensure CSS `object-position` is being applied

### Issue: Focal Editor Not Appearing

**Symptoms:** "Set as Hero" button exists but clicking does nothing.

**Checklist:**
1. Verify `canBeHero` prop is true
2. Check that `onSetHeroImage` callback is provided
3. Ensure image is an eligible type (images only, not videos/docs)

---

## TypeScript Types Reference

```typescript
// MediaViewer props
interface MediaViewerProps {
  focalX?: number;  // 0-1, default 0.5
  focalY?: number;  // 0-1, default 0.5
  onSetHeroImage?: (imghash: string, focalX: number, focalY: number) => void;
  onSetHostHeroImage?: (imghash: string, focalX: number, focalY: number) => void;
  canBeHero?: boolean;
  // ... other props
}

// Database table types
interface LocsTable {
  hero_imghash: string | null;
  hero_focal_x: number;  // Default 0.5
  hero_focal_y: number;  // Default 0.5
}

interface SlocsTable {
  hero_imghash: string | null;
  hero_focal_x: number;  // Default 0.5
  hero_focal_y: number;  // Default 0.5
}

// Zod schema
const focalSchema = z.number().min(0).max(1).optional();
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `packages/core/src/domain/location.ts` | LocationInputSchema with focal fields |
| `packages/desktop/electron/main/database.ts` | Schema creation and migrations |
| `packages/desktop/electron/main/database.types.ts` | TypeScript table interfaces |
| `packages/desktop/electron/main/ipc-handlers/locations.ts` | Location update handler |
| `packages/desktop/electron/main/ipc-handlers/sublocations.ts` | Sublocation update handler |
| `packages/desktop/electron/repositories/sqlite-location-repository.ts` | Location database operations |
| `packages/desktop/electron/repositories/sqlite-sublocation-repository.ts` | Sublocation database operations |
| `packages/desktop/electron/preload/preload.cjs` | IPC bridge |
| `packages/desktop/src/pages/LocationDetail.svelte` | Location detail page with callbacks |
| `packages/desktop/src/components/MediaViewer.svelte` | Focal point editor UI |

---

## Change Log

| Date | Change |
|------|--------|
| 2025-12-07 | Initial implementation documentation |
| 2025-12-07 | Full audit confirmed implementation complete |

---

End of Implementation Guide
