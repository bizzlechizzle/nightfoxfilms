# Focal Point Editor Improvements - Implementation Plan

## Audit Summary

**Current Implementation:** `MediaViewer.svelte:468-608`

### Current Focal Point Editor Behavior

```
Location: Inside metadata sidebar (w-96 = 384px wide)
Preview size: ~384px wide × ~163px tall (2.35:1 aspect)
Interaction: Click OR drag to set position
Pin: 24px circle (w-6 h-6) showing current focal point
```

### Current Code Flow

```javascript
// Lines 244-257: Event handlers
handleFocalMouseDown(e) → isDraggingFocal = true, updateFocalFromEvent(e)
handleFocalMouseMove(e) → only updates if isDraggingFocal
handleFocalMouseUp() → isDraggingFocal = false
```

### Issues Identified

| Issue | Problem | Impact |
|-------|---------|--------|
| **Drag feel** | Must click to start drag, can't grab pin directly | Feels like click-to-set, not smooth sliding |
| **Preview too small** | 384px wide inside sidebar | Hard to precisely position focal point |
| **Preview mismatch** | No max-height constraint vs hero's `max-h-[40vh]` | Preview may show different crop than actual hero |

---

## Visual Comparison

**Current Preview (sidebar):**
```
┌────────────────────────────────────────────────────┐
│  Lightbox Image                        │ Sidebar  │
│                                        │          │
│                                        │ [tiny    │
│                                        │  preview]│
│                                        │ Cancel   │
│                                        │ Save     │
└────────────────────────────────────────────────────┘
```

**Target (larger modal overlay):**
```
┌────────────────────────────────────────────────────┐
│                                                    │
│        ┌─────────────────────────────┐            │
│        │    LARGE PREVIEW (70vw)     │            │
│        │    ◉ ← draggable pin        │            │
│        │    (matches hero crop)      │            │
│        └─────────────────────────────┘            │
│               [Cancel]  [Save]                     │
└────────────────────────────────────────────────────┘
```

---

## Solution

### 1. Smooth Pin Dragging
Add dedicated pin element with its own drag handlers:
- Pin can be grabbed directly (no click-on-preview first)
- Pin has hover state showing it's draggable (cursor: grab)
- During drag: cursor changes to grabbing

### 2. Larger Preview Box
Move focal editor from sidebar to centered modal overlay:
- Width: `max-w-4xl` (896px) or `70vw`
- Aspect ratio: 2.35:1 (matches hero)
- Centered over the lightbox with semi-transparent backdrop

### 3. Fix Preview Accuracy
Match LocationHero constraints exactly:
- Add `max-h-[40vh]` to preview container
- Use identical gradient overlay positioning
- Ensure object-fit: cover with same positioning

---

## Implementation Steps

### Step 1: Add dedicated pin drag handlers

**File:** `MediaViewer.svelte`

Add new handler to let user drag the pin directly:
```javascript
// New: Pin-specific drag handlers
function handlePinMouseDown(e: MouseEvent) {
  e.stopPropagation(); // Don't trigger preview click
  isDraggingFocal = true;
}
```

Update pin element to be draggable:
```svelte
<div
  class="absolute w-8 h-8 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10"
  style="left: {pendingFocalX * 100}%; top: {pendingFocalY * 100}%;"
  onmousedown={handlePinMouseDown}
  role="slider"
>
```

### Step 2: Create larger modal overlay for focal editor

Replace inline preview with modal:
```svelte
{#if isEditingFocal}
  <!-- Focal Editor Modal - centered overlay -->
  <div class="fixed inset-0 bg-black/80 z-60 flex items-center justify-center p-8">
    <div class="bg-white rounded-xl shadow-2xl max-w-4xl w-full">
      <div class="p-4 border-b">
        <h3>Set Hero Focal Point</h3>
        <p>Drag the pin to set the center of the hero crop</p>
      </div>

      <!-- Large preview with hero constraints -->
      <div class="p-4">
        <div
          bind:this={focalPreviewEl}
          class="relative w-full max-h-[40vh] rounded-lg overflow-hidden cursor-crosshair"
          style="aspect-ratio: 2.35 / 1;"
          ...handlers
        >
          <!-- Preview image + gradient + pin -->
        </div>
      </div>

      <div class="p-4 border-t flex justify-end gap-3">
        <button>Cancel</button>
        <button>Save</button>
      </div>
    </div>
  </div>
{/if}
```

### Step 3: Match preview to actual hero rendering

Ensure preview uses same constraints as `LocationHero.svelte:76-84`:
```svelte
<div
  class="relative w-full max-h-[40vh] mx-auto overflow-hidden"
  style="aspect-ratio: 2.35 / 1;"
>
  <img
    class="absolute inset-0 w-full h-full object-cover"
    style="object-position: {pendingFocalX * 100}% {pendingFocalY * 100}%;"
  />
  <!-- Identical gradient from LocationHero lines 128-142 -->
</div>
```

---

## Files Changed

| File | Change |
|------|--------|
| `MediaViewer.svelte` | Replace inline focal editor with modal overlay, add pin drag handlers |

---

## Testing Checklist

- [ ] Pin can be grabbed and dragged smoothly (no click-first required)
- [ ] Pin shows grab cursor on hover, grabbing cursor while dragging
- [ ] Preview is larger (fills modal, respects max-h-[40vh])
- [ ] Preview matches actual hero crop exactly
- [ ] Cancel closes modal without saving
- [ ] Save updates hero and closes modal
- [ ] Escape key closes modal
- [ ] Works for both "Building Hero" and "Campus Hero" options

---

## Visual Target

```
┌────────────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│ ░░░░░░┌─────────────────────────────────┐░░░░░░░░░│
│ ░░░░░░│  Set Hero Focal Point           │░░░░░░░░░│
│ ░░░░░░│  Drag the pin to adjust         │░░░░░░░░░│
│ ░░░░░░├─────────────────────────────────┤░░░░░░░░░│
│ ░░░░░░│                                 │░░░░░░░░░│
│ ░░░░░░│      [LARGE HERO PREVIEW]       │░░░░░░░░░│
│ ░░░░░░│           ◉ ← pin               │░░░░░░░░░│
│ ░░░░░░│      ░░░ gradient fade ░░░      │░░░░░░░░░│
│ ░░░░░░│                                 │░░░░░░░░░│
│ ░░░░░░├─────────────────────────────────┤░░░░░░░░░│
│ ░░░░░░│              [Cancel] [Save]    │░░░░░░░░░│
│ ░░░░░░└─────────────────────────────────┘░░░░░░░░░│
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└────────────────────────────────────────────────────┘
```
