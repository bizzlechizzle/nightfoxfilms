# Braun/Rams Design System

**Version:** 1.0
**Implementation Date:** 2025-12-06
**Status:** Complete

---

## Overview

The AU Archive desktop application uses a Dieter Rams-inspired industrial design language based on the Braun design philosophy. This document serves as the authoritative reference for all design tokens, patterns, and component styling.

---

## Design Philosophy

Based on Dieter Rams' Ten Principles of Good Design:

| Principle | Application |
|-----------|-------------|
| Good design is innovative | GPS confidence communicated through form, not decoration |
| Good design makes a product useful | Data density prioritized; every pixel serves research |
| Good design is aesthetic | Beauty emerges from precision, not embellishment |
| Good design is unobtrusive | UI recedes; content (photos, maps, metadata) dominates |
| Good design is honest | No faux depth (shadows), no simulated materials |
| Good design is long-lasting | Neutral palette ages gracefully across decades |
| Good design is thorough | Every detail considered; no random values |
| Good design is environmentally friendly | Minimal visual pollution; restful on eyes |
| Good design is as little design as possible | Remove until it breaks, then add one thing back |

---

## Color System

### Braun Neutral Scale

| Token | Hex | Usage |
|-------|-----|-------|
| `braun-50` | `#FAFAF8` | Page backgrounds, subtle fills |
| `braun-100` | `#F4F4F2` | Secondary backgrounds, hover states |
| `braun-200` | `#EEEEED` | Borders (muted), dividers |
| `braun-300` | `#E2E1DE` | Primary borders, card outlines |
| `braun-400` | `#C0BFBC` | Muted icons, disabled text |
| `braun-500` | `#8A8A86` | Secondary text, labels |
| `braun-600` | `#5C5C58` | Body text, secondary buttons |
| `braun-700` | `#454540` | Strong secondary text |
| `braun-900` | `#1C1C1A` | Primary text, primary buttons |

### Functional Colors (Color = Information)

GPS confidence and status colors are the ONLY place color is used for meaning:

| Purpose | Token | Hex | Usage |
|---------|-------|-----|-------|
| GPS Verified | `verified` | `#286736` | Map-confirmed coordinates |
| GPS High | `high` | `#3B82F6` | EXIF with <10m accuracy |
| GPS Medium | `medium` | `#D97706` | Reverse-geocoded |
| GPS Low | `low` | `#DC2626` | Manual/estimate |
| GPS None | `none` | `#6B7280` | No coordinates |
| Success | `success` | `#286736` | Import complete, save success |
| Error | `error` | `#AE1C09` | Validation errors, failures |
| Warning | `warning` | `#D97706` | Duplicate detection, GPS mismatch |

### Key Principle

**No accent color**. The gold accent (`#B9975C`) has been completely eliminated. Primary actions use `braun-900` (near-black). Links and interactive text use underlines, not color differentiation.

---

## Typography

### Font Family

**Braun Linear** geometric sans-serif for all text.

### Type Scale

| Element | Class | Notes |
|---------|-------|-------|
| Page Title | `text-xl font-semibold text-braun-900` | Main headings |
| Section Title | `text-lg font-semibold text-braun-900` | Card/section headers |
| Section Label | `text-xs font-semibold uppercase tracking-wider text-braun-400` | ALL CAPS labels |
| Body | `text-sm text-braun-900` | Default text |
| Secondary | `text-sm text-braun-600` | Less prominent text |
| Muted | `text-sm text-braun-400` | Placeholder, hints |
| Small | `text-xs` | Badges, timestamps |

---

## Spacing System

**Base Unit:** 8px grid (Tailwind default)

| Element | Spacing |
|---------|---------|
| Card padding | `p-6` (24px) |
| Section gap | `space-y-6` (24px) |
| Input padding | `px-3 py-2` (12px / 8px) |
| Button padding | `px-4 py-2` (16px / 8px) |
| Modal padding | `p-6` (24px) |

---

## Border & Radius System

### Maximum Border Radius: 4px

| Element | Class |
|---------|-------|
| Cards | `rounded` (4px) |
| Buttons | `rounded` (4px) |
| Inputs | `rounded` (4px) |
| Badges | `rounded` or `rounded-sm` (2px) |
| Modals | `rounded` (4px) |

**Never use:** `rounded-lg`, `rounded-xl`, `rounded-full` (except for circular avatars)

### Border Colors

| State | Class |
|-------|-------|
| Default | `border-braun-300` |
| Muted | `border-braun-200` |
| Hover | `border-braun-500` |
| Focus | `border-braun-600` |

---

## Shadow System

**All decorative shadows eliminated.**

| Element | Old Pattern | New Pattern |
|---------|-------------|-------------|
| Cards | `shadow-md` | `border border-braun-300` |
| Modals | `shadow-xl` | `border border-braun-300` |
| Dropdowns | `shadow-lg` | `border border-braun-300` |
| Hover states | `shadow-md` | `border-color transition` |

---

## Component Patterns

### Primary Button

```html
<button class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50">
  Action
</button>
```

### Secondary Button

```html
<button class="px-4 py-2 bg-braun-100 text-braun-700 rounded hover:bg-braun-200 transition">
  Secondary
</button>
```

### Ghost Button

```html
<button class="text-sm text-braun-900 hover:underline">
  Text Action
</button>
```

### Danger Button

```html
<button class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition">
  Delete
</button>
```

### Text Input

```html
<input
  type="text"
  class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
  placeholder="Enter text..."
/>
```

### Select

```html
<select class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 bg-white">
  <option>Option</option>
</select>
```

### Checkbox

```html
<input
  type="checkbox"
  class="w-4 h-4 text-braun-900 rounded border-braun-300 focus:ring-braun-600"
/>
```

### Card

```html
<div class="bg-white rounded border border-braun-300 p-6">
  <h2 class="text-lg font-semibold text-braun-900 mb-4">Title</h2>
  <p class="text-sm text-braun-600">Content</p>
</div>
```

### Accordion

```html
<div class="bg-white rounded border border-braun-300 overflow-hidden">
  <button class="w-full p-6 flex items-center justify-between text-left hover:bg-braun-50 transition-colors">
    <h2 class="text-xl font-semibold text-braun-900">Title</h2>
    <svg class="w-5 h-5 text-braun-400 transition-transform duration-200">
      <!-- chevron -->
    </svg>
  </button>
  <div class="px-6 pb-6">
    <!-- Content -->
  </div>
</div>
```

### Modal

```html
<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div class="bg-white rounded border border-braun-300 max-w-md w-full mx-4 p-6">
    <h3 class="text-lg font-semibold text-braun-900 mb-4">Title</h3>
    <!-- Content -->
    <div class="flex justify-end gap-3 mt-6">
      <button class="px-4 py-2 bg-braun-100 text-braun-700 rounded hover:bg-braun-200 transition">
        Cancel
      </button>
      <button class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition">
        Confirm
      </button>
    </div>
  </div>
</div>
```

### Section Label

```html
<p class="text-xs font-semibold text-braun-400 uppercase tracking-wider mb-2">
  SECTION TITLE
</p>
```

### Badge

```html
<span class="px-2 py-0.5 bg-braun-100 text-braun-600 rounded text-xs">
  Label
</span>
```

### Table

```html
<table class="min-w-full divide-y divide-braun-200">
  <thead class="bg-braun-50">
    <tr>
      <th class="px-6 py-3 text-left text-xs font-medium text-braun-500 uppercase tracking-wider">
        Column
      </th>
    </tr>
  </thead>
  <tbody class="bg-white divide-y divide-braun-200">
    <tr class="hover:bg-braun-50">
      <td class="px-6 py-4 text-sm text-braun-900">Cell</td>
    </tr>
  </tbody>
</table>
```

### Loading Spinner

```html
<div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-braun-900"></div>
```

### Progress Bar

```html
<div class="h-2 bg-braun-200 rounded-full overflow-hidden">
  <div class="h-full bg-braun-900 transition-all duration-300" style="width: 75%"></div>
</div>
```

---

## Interactive States

### Hover

| Element | Pattern |
|---------|---------|
| Primary button | `hover:bg-braun-600` |
| Secondary button | `hover:bg-braun-200` |
| Text link | `hover:underline` |
| Card | `hover:border-braun-500` or `hover:bg-braun-50` |
| Table row | `hover:bg-braun-50` |

### Focus

| Element | Pattern |
|---------|---------|
| Inputs | `focus:outline-none focus:border-braun-600` |
| Buttons | Default outline OK, or custom focus ring |
| Checkboxes | `focus:ring-braun-600` |

### Disabled

```html
disabled:opacity-50
```

---

## GPS Marker Colors

Map markers use functional colors based on GPS confidence tier:

| Tier | Color | Hex |
|------|-------|-----|
| Verified (map-confirmed) | Green | `#286736` |
| High (EXIF <10m) | Blue | `#3B82F6` |
| Medium (reverse-geocode) | Amber | `#D97706` |
| Low (manual) | Red | `#DC2626` |
| None | Gray | `#6B7280` |

---

## Migration Reference

### Eliminated Patterns

| Old Pattern | Replacement |
|-------------|-------------|
| `bg-gray-*` | `bg-braun-*` |
| `text-gray-*` | `text-braun-*` |
| `border-gray-*` | `border-braun-*` |
| `divide-gray-*` | `divide-braun-*` |
| `bg-accent` | `bg-braun-900` |
| `text-accent` | `text-braun-900` |
| `border-accent` | `border-braun-400` |
| `ring-accent` | `ring-braun-600` |
| `rounded-lg` | `rounded` |
| `shadow-md/lg/xl` | `border border-braun-300` |
| `hover:opacity-90` | `hover:bg-braun-600` |
| `focus:ring-2 focus:ring-accent` | `focus:border-braun-600` |

---

## File Locations

| Item | Path |
|------|------|
| Tailwind config | `packages/desktop/tailwind.config.js` |
| Global CSS | `packages/desktop/src/app.css` |
| Font files | `packages/desktop/resources/fonts/` |
| Components | `packages/desktop/src/components/` |
| Pages | `packages/desktop/src/pages/` |

---

## Maintenance

When adding new components:

1. Use only `braun-*` colors (never gray-* or accent)
2. Maximum `rounded` (4px) for all elements
3. No decorative shadows - use borders only
4. Primary buttons: `bg-braun-900 hover:bg-braun-600`
5. Secondary buttons: `bg-braun-100 hover:bg-braun-200`
6. Focus states: `focus:border-braun-600` (no ring)
7. Preserve GPS functional colors for information hierarchy

---

*End of Design System Documentation*
