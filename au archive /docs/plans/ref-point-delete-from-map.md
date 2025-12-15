# Plan: Delete Reference Point from Map Layer

## Goal
Add a "Delete" button to reference map point popups on the Atlas map. When clicked, show a confirmation dialog before permanently deleting the point from the database.

## Current State

### Existing Infrastructure
1. **Popup Structure** (`Map.svelte:819-834`):
   - Reference point popups show: name, description, category, and "Create Location" button
   - Button uses data attributes: `data-name`, `data-lat`, `data-lng`, `data-state`
   - Missing: `data-point-id` for delete operations

2. **Event Delegation** (`Map.svelte:504-519`):
   - `createFromRefClickHandler` listens for `.create-from-ref-btn` clicks
   - Extracts data attributes and calls `onCreateFromRefPoint` callback
   - Pattern works well for adding delete button

3. **Delete Service** (`ref-map-dedup-service.ts:333-342`):
   - `deleteRefPoints(pointIds: string[])` already exists
   - Deletes by array of point IDs
   - Returns count of deleted rows

4. **IPC Handlers** (`ref-maps.ts`):
   - `refMaps:delete` - deletes entire MAP (not individual points)
   - `refMaps:purgeCataloguedPoints` - bulk delete matched points
   - Missing: Single point delete handler

5. **Preload Bridge** (`preload.cjs`):
   - Has `delete(mapId)` for maps
   - Has `purgeCataloguedPoints()` for bulk
   - Missing: `deletePoint(pointId)` for individual points

## Changes Required

### 1. IPC Handler (ref-maps.ts)
Add new handler:
```typescript
ipcMain.handle('refMaps:deletePoint', async (_event, pointId: string) => {
  try {
    const deleted = await dedupService.deleteRefPoints([pointId]);
    return { success: true, deleted };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### 2. Preload Bridge (preload.cjs)
Add method:
```javascript
deletePoint: (pointId) => ipcRenderer.invoke("refMaps:deletePoint", pointId),
```

### 3. TypeScript Types (electron.d.ts)
Add to refMaps interface:
```typescript
deletePoint: (pointId: string) => Promise<{ success: boolean; deleted?: number; error?: string }>;
```

### 4. Map.svelte - Popup HTML
Update popup to include:
- `data-point-id` attribute on both buttons
- New delete button with distinct class

```html
<button class="create-from-ref-btn" data-point-id="${point.pointId}" ...>
  + Create Location
</button>
<button class="delete-ref-btn" data-point-id="${point.pointId}" data-name="${name}">
  × Delete
</button>
```

### 5. Map.svelte - Props
Add callback prop:
```typescript
onDeleteRefPoint?: (pointId: string, name: string) => Promise<boolean>;
```

### 6. Map.svelte - Event Handler
Add new click handler alongside existing `createFromRefClickHandler`:
```typescript
deleteRefClickHandler = async (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('delete-ref-btn')) {
    e.preventDefault();
    e.stopPropagation();
    const pointId = target.getAttribute('data-point-id');
    const name = target.getAttribute('data-name');
    if (onDeleteRefPoint && pointId) {
      const confirmed = await onDeleteRefPoint(pointId, name || 'Unnamed');
      // If deleted, layer refresh happens via parent
    }
  }
};
```

### 7. Atlas.svelte - Confirmation & Refresh
Add handler that:
1. Shows confirmation dialog
2. Calls delete API if confirmed
3. Refreshes reference points layer

```typescript
async function handleDeleteRefPoint(pointId: string, name: string): Promise<boolean> {
  const confirmed = confirm(`Delete reference point "${name}"?\n\nThis cannot be undone.`);
  if (!confirmed) return false;

  const result = await window.electronAPI.refMaps.deletePoint(pointId);
  if (result.success) {
    // Refresh reference points
    await loadRefMapPoints();
    return true;
  }
  return false;
}
```

## UI Design

### Button Placement
Inside popup, below "Create Location":
```
┌──────────────────────────────┐
│ Cadis Baptist Church         │
│ Small description...         │
│ Category: Church             │
│                              │
│ [+ Create Location]          │
│ [× Delete]                   │
└──────────────────────────────┘
```

### Button Styling
- Delete button: Subtle, not prominent
- Color: Muted red on hover (`#DB4436` from constants or similar)
- Smaller font than Create button
- Positioned below Create button

## Files to Modify

| File | Change |
|------|--------|
| `electron/main/ipc-handlers/ref-maps.ts` | Add `refMaps:deletePoint` handler |
| `electron/preload/preload.cjs` | Add `deletePoint` method |
| `src/types/electron.d.ts` | Add TypeScript type |
| `src/components/Map.svelte` | Add delete button, handler, prop |
| `src/pages/Atlas.svelte` | Add confirmation handler, pass callback |

## Validation Checklist
- [ ] Confirm dialog appears before delete
- [ ] Point disappears from map after delete
- [ ] Database row is actually deleted
- [ ] Other points remain unaffected
- [ ] Popup closes after delete
- [ ] No orphaned data in database

## Risk Assessment
- **Low Risk**: Simple feature with existing patterns
- **No data model changes**: Uses existing delete infrastructure
- **Reversible via import**: User can re-import the reference map if needed

## CLAUDE.md Compliance
- ✓ Follows existing IPC patterns
- ✓ Uses existing delete service
- ✓ No new dependencies
- ✓ Uses brand colors for styling
- ✓ Confirms before destructive action
- ✓ Simple, focused change
