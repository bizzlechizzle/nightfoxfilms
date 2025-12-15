# Sub-Location Page Fixes - Implementation Plan

## Full Audit

### Current State on Sub-Location Pages

#### Issue 1: "Building GPS" header
**File:** `LocationMapSection.svelte:242-244`
```html
<h2 class="text-2xl font-semibold text-foreground leading-none">
  {subLocation ? 'Building GPS' : 'Location'}
</h2>
```
- **Problem:** Shows "Building GPS" when viewing sub-location
- **User wants:** "Location" (matches other page types)

#### Issue 2: Pill label in import box
**File:** `LocationImportZone.svelte:43-47`
```html
{#if scopeLabel}
  <span class="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
    {scopeLabel}
  </span>
{/if}
```
- **Problem:** Shows blue pill badge with sub-location name
- **User wants:** Remove the pill entirely

#### Issue 3: Import box text
**File:** `LocationImportZone.svelte:127-130`
```html
<p class="text-sm text-gray-500">
  {isDragging ? 'Drop files or folders here' : 'Drag & drop files or folders to import'}
</p>
<p class="text-xs text-gray-400 mt-1">Supports images, videos, and documents</p>
```
- **Problem:** Generic text, no sub-location context
- **User wants:** Include sub-location name in the text

---

## Solution

### Fix 1: Change "Building GPS" to "Location"

**File:** `LocationMapSection.svelte:242-244`
```diff
- <h2 class="text-2xl font-semibold text-foreground leading-none">
-   {subLocation ? 'Building GPS' : 'Location'}
- </h2>
+ <h2 class="text-2xl font-semibold text-foreground leading-none">Location</h2>
```

### Fix 2: Remove pill label from import box

**File:** `LocationImportZone.svelte:40-48`
```diff
  <div class="flex items-center justify-between mb-3">
-   <div class="flex items-center gap-2">
-     <h2 class="text-xl font-semibold text-foreground">Import</h2>
-     {#if scopeLabel}
-       <span class="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
-         {scopeLabel}
-       </span>
-     {/if}
-   </div>
+   <h2 class="text-xl font-semibold text-foreground">Import</h2>
    <div class="flex items-center gap-2">
```

### Fix 3: Add sub-location name to import text

**File:** `LocationImportZone.svelte:127-130`
```diff
  <p class="text-sm text-gray-500">
-   {isDragging ? 'Drop files or folders here' : 'Drag & drop files or folders to import'}
+   {isDragging
+     ? 'Drop files or folders here'
+     : scopeLabel
+       ? `Drag & drop files to import to ${scopeLabel}`
+       : 'Drag & drop files or folders to import'}
  </p>
```

---

## Files Changed

| File | Line | Change |
|------|------|--------|
| `LocationMapSection.svelte` | 242-244 | Remove conditional, always show "Location" |
| `LocationImportZone.svelte` | 40-48 | Remove pill label wrapper and badge |
| `LocationImportZone.svelte` | 127-128 | Add scopeLabel to drag/drop text |

---

## Visual Before/After

### Location Box Header
```
Before (sub-location):    After (sub-location):
┌───────────────────┐     ┌───────────────────┐
│ Building GPS edit │     │ Location     edit │
└───────────────────┘     └───────────────────┘
```

### Import Box
```
Before (sub-location):
┌─────────────────────────────────────────┐
│ Import [Schoolhouse]  ← pill badge      │
│                                         │
│ Drag & drop files or folders to import  │
└─────────────────────────────────────────┘

After (sub-location):
┌─────────────────────────────────────────┐
│ Import                ← no pill         │
│                                         │
│ Drag & drop files to import to Schoolhouse │
└─────────────────────────────────────────┘
```

---

## Testing Checklist

- [ ] Sub-location page: Header shows "Location" (not "Building GPS")
- [ ] Sub-location page: No pill badge next to "Import"
- [ ] Sub-location page: Import text includes sub-location name
- [ ] Host-location page: No regression (shows "Location", no pill)
- [ ] Standard location page: No regression (shows "Location", no pill)
