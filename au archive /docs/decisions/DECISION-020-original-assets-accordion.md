# DECISION-020: Original Assets Accordion Refactor

## Goal
Rework the "Images and Videos" section on LocationDetail into a collapsible "Original Assets" accordion with sub-accordions for Images, Videos, and Documents. Enable video playback in MediaViewer.

## Current State
- `LocationGallery.svelte`: 2x4 image grid, limit 6, no accordion
- `LocationVideos.svelte`: List format, limit 3, opens in system viewer
- `LocationDocuments.svelte`: List format, limit 3, opens in system viewer
- `MediaViewer.svelte`: Supports images + videos (via `<video>` tag)
- `LocationDetail.svelte`: Three components in single white box

## Target State
```
Original Assets                              [accordion - collapsed by default]
├── Images (count)                           [sub-accordion - expanded by default]
│   └── [4x2 Thumbnail Grid]
│   └── [Show More button if >8]
├── Videos (count)                           [sub-accordion - expanded by default]
│   └── [4x2 Thumbnail Grid with poster frames]
│   └── [Show More button if >8]
│   └── Click → MediaViewer (not system viewer)
└── Documents (count)                        [sub-accordion - expanded by default]
    └── [List format]
    └── [Show More button if >3]
    └── Click → System Viewer (best tool for job)
```

## Files to Modify/Create

### New Files
1. `packages/desktop/src/components/location/LocationOriginalAssets.svelte`
   - Outer accordion wrapper
   - Contains Images, Videos, Documents sub-components
   - Props: images, videos, documents, heroImgsha, callbacks

### Modified Files
2. `packages/desktop/src/components/location/LocationGallery.svelte`
   - Add accordion toggle (expanded by default when parent open)
   - Change limit from 6 to 8 (4x2 grid)
   - Keep existing thumbnail grid and hero selection

3. `packages/desktop/src/components/location/LocationVideos.svelte`
   - Add accordion toggle
   - Change from list to 4x2 thumbnail grid
   - Use poster frame thumbnails (thumb_path_sm)
   - Change limit from 3 to 8
   - Change onClick to open MediaViewer (not system viewer)

4. `packages/desktop/src/components/location/LocationDocuments.svelte`
   - Add accordion toggle
   - Keep list format
   - Keep limit at 3
   - Keep system viewer opening (correct behavior)

5. `packages/desktop/src/pages/LocationDetail.svelte`
   - Replace three separate components with LocationOriginalAssets
   - Update mediaViewerList to include videos
   - Rename selectedImageIndex → selectedMediaIndex
   - Pass video click handler to open MediaViewer

## Video Format Strategy

### Phase 1: Test Native Support
Test Electron 28's `<video>` tag with common archive formats:
- MP4 (H.264) - expected: works
- WebM (VP9) - expected: works
- MKV (H.264) - expected: may work
- AVI - expected: unlikely
- MOV (H.264) - expected: may work

### Phase 2: Implementation Decision
- If most formats work → use native `<video>` + "Open in System Viewer" fallback
- If most fail → evaluate mpv.js integration (separate decision)

## Accordion Pattern

Consistent pattern across all accordions:
```svelte
<script>
  let isOpen = $state(true); // expanded by default for sub-accordions
</script>

<div class="border-b border-gray-100 last:border-b-0">
  <button
    onclick={() => isOpen = !isOpen}
    aria-expanded={isOpen}
    class="w-full py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
  >
    <h3 class="text-sm font-medium text-gray-700">{title} ({count})</h3>
    <svg class="w-4 h-4 text-gray-400 transition-transform {isOpen ? 'rotate-180' : ''}">
      <path d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if isOpen}
    <div class="pb-4">
      <!-- Content -->
    </div>
  {/if}
</div>
```

## Implementation Order

1. Test video formats in Electron 28
2. Create LocationOriginalAssets.svelte wrapper
3. Update LocationGallery.svelte (accordion + 8 limit)
4. Update LocationVideos.svelte (accordion + thumbnail grid + MediaViewer)
5. Update LocationDocuments.svelte (accordion)
6. Update LocationDetail.svelte (integration)
7. Test all functionality

## Success Criteria

- [ ] Original Assets collapses/expands
- [ ] Each sub-section collapses/expands independently
- [ ] Images display as 4x2 grid with hero selection
- [ ] Videos display as 4x2 grid with poster thumbnails
- [ ] Documents display as list
- [ ] Image click → MediaViewer
- [ ] Video click → MediaViewer (plays if format supported)
- [ ] Document click → System viewer
- [ ] "Show More" works for each section
- [ ] Counts display correctly in headers

## claude.md Compliance

- **Scope Discipline**: Only implementing requested accordion structure
- **Keep It Simple**: Using existing patterns (accordion from NerdStats)
- **Archive-First**: Improves media organization and browsing
- **No AI References**: No AI mentioned in UI
- **Offline-First**: No network dependencies added

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Video format incompatibility | Fallback to "Open in System Viewer" button |
| Missing poster thumbnails | Show video icon placeholder |
| Performance with many items | Already have pagination (show more) |
