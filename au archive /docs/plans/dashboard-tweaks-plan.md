# Dashboard UI Tweaks Plan

## Overview
Update Dashboard page background and card shadows per user request.

## Current State Analysis

**File**: `packages/desktop/src/pages/Dashboard.svelte`

### Background
- **Current**: `<div class="p-8">` - No explicit background color set (inherits from parent/body)
- **Target**: `#FFFFFF` (pure white)

### Card Shadow Classes
All cards currently use: `bg-white rounded-lg shadow p-6`

The `shadow` class in Tailwind is: `box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)`

**Cards identified** (7 total):
1. **Active Import Status** (line 147): `bg-white rounded-lg shadow p-6 border-l-4 border-accent`
2. **Recent Background Imports** (line 181): `bg-white rounded-lg shadow p-6`
3. **Projects Card** (line 210): `bg-white rounded-lg shadow p-6`
4. **Recent Locations Card** (line 271): `bg-white rounded-lg shadow p-6`
5. **Recent Imports Card** (line 305): `bg-white rounded-lg shadow p-6`
6. **Top Type Card** (line 345): `bg-white rounded-lg shadow p-6`
7. **Top State Card** (line 370): `bg-white rounded-lg shadow p-6`

## Proposed Changes

### 1. Background Color
**Line 136**: Change from:
```html
<div class="p-8">
```
To:
```html
<div class="p-8 bg-[#FFFFFF]">
```

### 2. Increase Drop Shadow
Replace `shadow` with `shadow-lg` on all 7 cards.

Tailwind `shadow-lg`: `box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`

**Alternative**: `shadow-xl` for even more pronounced shadow:
`box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)`

| Card | Line | Current | Proposed |
|------|------|---------|----------|
| Active Import Status | 147 | `shadow` | `shadow-xl` |
| Recent Background Imports | 181 | `shadow` | `shadow-xl` |
| Projects | 210 | `shadow` | `shadow-xl` |
| Recent Locations | 271 | `shadow` | `shadow-xl` |
| Recent Imports | 305 | `shadow` | `shadow-xl` |
| Top Type | 345 | `shadow` | `shadow-xl` |
| Top State | 370 | `shadow` | `shadow-xl` |

## User Decisions

- **Shadow intensity**: `shadow-xl` (more dramatic)
- **Scope**: All 7 cards

## Files Modified
- `packages/desktop/src/pages/Dashboard.svelte`

## Testing
- Visual inspection of Dashboard after changes
- Verify shadow renders correctly on all cards
- Confirm background is pure white (#FFFFFF)
