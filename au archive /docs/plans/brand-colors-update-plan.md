# Brand Colors Update Plan

## Objective

Update all colors in the codebase to use the official Abandoned Archive color palette. Reference pins on imported maps should be the **only** Blue (#49696E) in use.

## Official Color Palette

### Gray/Black
| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Gunmetal** | #454545 | Main foreground/text |
| **Grey** | #7A7A7A | Light variant |
| **Carbon Black** | #1F1F1F | Dark variant |

### White
| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Porcelain** | #FFFBF7 | Main background |
| **White** | #FFFFFF | Light variant |
| **Antique White** | #FFEBD6 | Dark variant |

### Gold (Main Accent)
| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Camel** | #B9975C | Main accent |
| **Pale Oak** | #D4BF9B | Light variant |
| **Olive Bark** | #725A31 | Dark variant |

### Red (Error/Danger)
| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Oxidized Iron** | #AE1C09 | Main error/danger |
| **Tomato** | #F5533D | Light variant |
| **Molten Lava** | #741306 | Dark variant |

### Green (Success/Verified)
| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Dark Emerald** | #286736 | Main success/verified |
| **Sea Green** | #39934D | Light variant |
| **Deep Forest** | #173B1F | Dark variant |

### Blue (Reference Pins ONLY)
| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Blue Slate** | #49696E | Reference pins only |
| **Cool Steel** | #91B1B6 | Light variant |
| **Dark Slate Gray** | #314649 | Dark variant |

---

## Audit Summary

### Current Color Usage Found

| Current Color | Location | Current Use | Action |
|---------------|----------|-------------|--------|
| `#b9975c` | multiple | Accent (Gold) | KEEP - already correct |
| `#fffbf7` | multiple | Background | KEEP - already correct |
| `#454545` | multiple | Foreground | KEEP - already correct |
| `#2563eb` | tailwind.config.js:15 | `primary` color | CHANGE to `#B9975C` (Gold) |
| `#64748b` | tailwind.config.js:16 | `secondary` color | CHANGE to `#454545` (Gunmetal) |
| `#99221E` | tailwind.config.js:18,22 | `danger`/`error` | CHANGE to `#AE1C09` (Oxidized Iron) |
| `#19612E` | tailwind.config.js:19,20 | `success`/`verified` | CHANGE to `#286736` (Dark Emerald) |
| `#9ca3af` | tailwind.config.js:21 | `unverified` | KEEP - gray is acceptable |
| `#22c55e` | Map.svelte:665 | "Link Location" button | CHANGE to `#286736` (Dark Emerald) |
| `#dcfce7` | Map.svelte:670 | Linked status background | CHANGE to light green variant |
| `#166534` | Map.svelte:670 | Linked status text | CHANGE to `#173B1F` (Deep Forest) |
| `#356C6E` | Map.svelte:984 | Reference point marker | CHANGE to `#49696E` (Blue Slate) |
| `#a68550` | Map.svelte:1001 | Cluster hover | CHANGE to `#725A31` (Olive Bark) |
| `#e5e5e5` | Map.svelte:1006 | Disabled state | KEEP - neutral gray acceptable |
| `#dc3545` | Map.svelte:1017 | Error/delete button | CHANGE to `#AE1C09` (Oxidized Iron) |

---

## Implementation Plan

### Step 1: Update Tailwind Configuration
**File:** `packages/desktop/tailwind.config.js`

Replace existing colors with full brand palette:

```js
colors: {
  // Base colors
  accent: '#B9975C',      // Camel (Gold main)
  background: '#FFFBF7',  // Porcelain
  foreground: '#454545',  // Gunmetal

  // Semantic aliases
  primary: '#B9975C',     // Camel (was generic blue)
  secondary: '#7A7A7A',   // Grey (light gunmetal)
  danger: '#AE1C09',      // Oxidized Iron
  success: '#286736',     // Dark Emerald
  verified: '#286736',    // Dark Emerald
  unverified: '#7A7A7A',  // Grey
  error: '#AE1C09',       // Oxidized Iron

  // Full brand palette with variants
  gray: {
    DEFAULT: '#454545',   // Gunmetal
    light: '#7A7A7A',     // Grey
    dark: '#1F1F1F',      // Carbon Black
  },
  white: {
    DEFAULT: '#FFFBF7',   // Porcelain
    light: '#FFFFFF',     // White
    dark: '#FFEBD6',      // Antique White
  },
  gold: {
    DEFAULT: '#B9975C',   // Camel
    light: '#D4BF9B',     // Pale Oak
    dark: '#725A31',      // Olive Bark
  },
  red: {
    DEFAULT: '#AE1C09',   // Oxidized Iron
    light: '#F5533D',     // Tomato
    dark: '#741306',      // Molten Lava
  },
  green: {
    DEFAULT: '#286736',   // Dark Emerald
    light: '#39934D',     // Sea Green
    dark: '#173B1F',      // Deep Forest
  },
  blue: {
    DEFAULT: '#49696E',   // Blue Slate (REFERENCE PINS ONLY)
    light: '#91B1B6',     // Cool Steel
    dark: '#314649',      // Dark Slate Gray
  },
}
```

### Step 2: Update Constants
**File:** `packages/desktop/src/lib/constants.ts`

No changes needed - THEME.ACCENT, BACKGROUND, FOREGROUND already correct.

### Step 3: Update Map.svelte Inline Colors
**File:** `packages/desktop/src/components/Map.svelte`

| Line | Current | New |
|------|---------|-----|
| 665 | `#22c55e` | `#286736` (Dark Emerald) |
| 670 | `#dcfce7` | `#D4E8D6` (light green tint) |
| 670 | `#166534` | `#173B1F` (Deep Forest) |
| 984 | `#356C6E` | `#49696E` (Blue Slate) |
| 1001 | `#a68550` | `#725A31` (Olive Bark) |
| 1017 | `#dc3545` | `#AE1C09` (Oxidized Iron) |

### Step 4: Verify No Other Blue Usage
Confirm that `#49696E` (Blue Slate) is ONLY used for reference map pins.

---

## Files to Modify

1. `packages/desktop/tailwind.config.js` - Tailwind color definitions
2. `packages/desktop/src/components/Map.svelte` - Inline map colors

---

## Verification

After implementation:
1. Run `pnpm dev` and visually inspect:
   - Location pins use Gold accent
   - Reference map pins use Blue Slate
   - Success states use Dark Emerald
   - Error states use Oxidized Iron
2. Search codebase for any remaining off-palette colors
3. Confirm no blue appears except on reference pins

---

## Compliance Check

| Rule | Status |
|------|--------|
| Scope Discipline - only implement what's requested | PASS - color updates only |
| Archive-First - serves research workflows | PASS - visual consistency aids researchers |
| Keep It Simple - minimal abstraction | PASS - updating existing color definitions |
| No AI in Docs - no AI mentions | PASS - no UI text changes |
| Referenced file paths exist | PASS - all files verified |

---

## Estimated Changes

- **tailwind.config.js**: ~12 line changes
- **Map.svelte**: ~6 inline style changes
- **Total**: ~18 line changes
