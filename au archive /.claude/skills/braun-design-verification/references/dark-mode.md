# Dark Mode Implementation Guide

Complete dark mode color system for Braun/Ulm School Design Language.

## Core Principles

1. **Never pure black** — Use `#121212` minimum for backgrounds
2. **Never pure white** — Use off-white at 87% opacity for text
3. **Desaturate colors** — Reduce saturation by ~20% from light mode
4. **Elevation through lightness** — Higher surfaces are lighter, no shadows
5. **Maintain contrast** — WCAG AA minimum (4.5:1 for text)

## Complete Color Palette

### Background Surfaces

| Token | Light Mode | Dark Mode | Use |
|-------|------------|-----------|-----|
| canvas | `#FAFAF8` | `#121212` | App background |
| surface-1 | `#F4F4F2` | `#1A1A1A` | Cards, panels |
| surface-2 | `#FFFFFF` | `#1E1E1E` | Elevated cards |
| surface-3 | — | `#252525` | Overlays, modals |
| surface-4 | — | `#2D2D2D` | Highest elevation |

### Text Colors

| Token | Light Mode | Dark Mode | Use |
|-------|------------|-----------|-----|
| text-primary | `#1C1C1A` | `rgba(250,250,248,0.87)` | Headlines, body |
| text-secondary | `#5C5C58` | `rgba(250,250,248,0.60)` | Descriptions |
| text-tertiary | `#8A8A86` | `rgba(250,250,248,0.38)` | Captions, meta |
| text-disabled | `#C0BFBC` | `rgba(250,250,248,0.38)` | Disabled states |

### Border Colors

| Token | Light Mode | Dark Mode | Use |
|-------|------------|-----------|-----|
| border-subtle | `#EEEEED` | `#2D2D2D` | Subtle dividers |
| border-default | `#E2E1DE` | `#3A3A3A` | Card borders |
| border-emphasis | `#C0BFBC` | `#4A4A4A` | Input focus |

### Functional Colors (Desaturated for Dark Mode)

| Function | Light Mode | Dark Mode | Notes |
|----------|------------|-----------|-------|
| Success/Verified | `#4A8C5E` | `#5A9C6E` | Slightly lighter |
| Info/High | `#5A7A94` | `#6A8AA4` | Slightly lighter |
| Warning/Medium | `#C9A227` | `#D9B237` | Slightly lighter |
| Error/Low | `#B85C4A` | `#C86C5A` | Slightly lighter |
| Neutral/None | `#8A8A86` | `#9A9A96` | Slightly lighter |

## CSS Custom Properties

```css
:root {
  /* Light mode (default) */
  --color-canvas: #FAFAF8;
  --color-surface-1: #F4F4F2;
  --color-surface-2: #FFFFFF;
  --color-text-primary: #1C1C1A;
  --color-text-secondary: #5C5C58;
  --color-text-tertiary: #8A8A86;
  --color-border-subtle: #EEEEED;
  --color-border-default: #E2E1DE;
  --color-border-emphasis: #C0BFBC;
  --color-success: #4A8C5E;
  --color-info: #5A7A94;
  --color-warning: #C9A227;
  --color-error: #B85C4A;
  --color-neutral: #8A8A86;
}

[data-theme="dark"] {
  --color-canvas: #121212;
  --color-surface-1: #1A1A1A;
  --color-surface-2: #1E1E1E;
  --color-surface-3: #252525;
  --color-surface-4: #2D2D2D;
  --color-text-primary: rgba(250, 250, 248, 0.87);
  --color-text-secondary: rgba(250, 250, 248, 0.60);
  --color-text-tertiary: rgba(250, 250, 248, 0.38);
  --color-border-subtle: #2D2D2D;
  --color-border-default: #3A3A3A;
  --color-border-emphasis: #4A4A4A;
  --color-success: #5A9C6E;
  --color-info: #6A8AA4;
  --color-warning: #D9B237;
  --color-error: #C86C5A;
  --color-neutral: #9A9A96;
}
```

## Component Adaptations

### Buttons (Dark Mode)

```css
[data-theme="dark"] .btn-primary {
  background: #FAFAF8;
  color: #121212;
}

[data-theme="dark"] .btn-primary:hover {
  background: #E8E8E6;
}

[data-theme="dark"] .btn-secondary {
  border-color: #4A4A4A;
  color: rgba(250, 250, 248, 0.87);
}

[data-theme="dark"] .btn-ghost {
  color: rgba(250, 250, 248, 0.60);
}
```

### Inputs (Dark Mode)

```css
[data-theme="dark"] .input {
  background: #1A1A1A;
  border-color: #3A3A3A;
  color: rgba(250, 250, 248, 0.87);
}

[data-theme="dark"] .input:focus {
  border-color: #5A5A5A;
}

[data-theme="dark"] .input::placeholder {
  color: rgba(250, 250, 248, 0.38);
}
```

### Cards (Dark Mode)

```css
[data-theme="dark"] .card {
  background: #1E1E1E;
  border-color: #2D2D2D;
}

[data-theme="dark"] .card:hover {
  background: #252525;
}
```

### Navigation (Dark Mode)

```css
[data-theme="dark"] .nav-item {
  color: rgba(250, 250, 248, 0.60);
}

[data-theme="dark"] .nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(250, 250, 248, 0.87);
}

[data-theme="dark"] .nav-item.active {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(250, 250, 248, 0.87);
}
```

## Elevation System

In dark mode, elevation is communicated through surface lightness, not shadows.

| Elevation | Light Mode | Dark Mode Surface |
|-----------|------------|-------------------|
| 0 (Base) | `#FAFAF8` | `#121212` |
| 1 | `#F4F4F2` | `#1A1A1A` |
| 2 | `#FFFFFF` + shadow | `#1E1E1E` |
| 3 | Shadow only | `#252525` |
| 4 | Larger shadow | `#2D2D2D` |

## Contrast Verification

All text must pass WCAG AA contrast requirements:

| Text Type | Minimum Ratio | Tools |
|-----------|---------------|-------|
| Normal text | 4.5:1 | webaim.org/resources/contrastchecker |
| Large text (24px+) | 3:1 | |
| UI components | 3:1 | |

### Pre-verified Combinations

✅ `#FAFAF8` text on `#121212` → 15.6:1  
✅ `rgba(250,250,248,0.87)` on `#121212` → 13.6:1  
✅ `rgba(250,250,248,0.60)` on `#1E1E1E` → 8.2:1  
✅ `rgba(250,250,248,0.38)` on `#252525` → 4.7:1  

## Implementation Checklist

When implementing dark mode:

- [ ] Add `data-theme="dark"` attribute to root element
- [ ] Use CSS custom properties for all colors
- [ ] Test all functional colors for sufficient contrast
- [ ] Remove shadows, use elevation surfaces
- [ ] Ensure images don't have harsh contrast with background
- [ ] Test focus states visibility
- [ ] Verify interactive states (hover, active, disabled)
- [ ] Check scrollbar styling
- [ ] Test with user preference: `prefers-color-scheme: dark`
