---
name: braun-design-verification
description: Verify front-end UI changes against Braun/Ulm School Design Language (Functional Minimalism) principles. Use when reviewing UI components, pages, or design systems for compliance with Dieter Rams' 10 principles, checking color usage, typography, spacing, geometry, and avoiding anti-patterns. Supports both light mode and dark mode verification. Trigger for design reviews, UI audits, component checks, pull request reviews of front-end changes, or when ensuring adherence to functional minimalism principles.
---

# Braun/Ulm School Design Verification

Verify front-end UI against Braun/Ulm School Design Language: Functional Minimalism.

## Core Philosophy

**"Weniger, aber besser"** — Less, but better.

The interface must recede so content speaks. Every element must justify its existence through function.

## Quick Verification Checklist

Run through these checks for any UI change:

### 1. Color Verification

**Light Mode Palette:**
- Canvas/Background: `#FAFAF8` (warm white)
- Surface/Cards: `#F4F4F2` or `#FFFFFF`
- Primary Text: `#1C1C1A` (near-black)
- Secondary Text: `#5C5C58`
- Tertiary/Meta: `#8A8A86`
- Borders: `#E2E1DE` (standard), `#EEEEED` (subtle), `#C0BFBC` (emphasis)

**Dark Mode Palette:**
- Canvas/Background: `#121212` or `#1A1A1A` (never pure black)
- Surface/Cards: `#1E1E1E` to `#252525`
- Primary Text: `#FAFAF8` (never pure white, use 87% opacity)
- Secondary Text: `#A0A0A0`
- Tertiary/Meta: `#6B6B6B`
- Borders: `#2D2D2D` (standard), `#3A3A3A` (emphasis)

**Functional Colors Only (both modes):**
- Verified/Success: `#4A8C5E`
- High/Info: `#5A7A94`
- Medium/Warning: `#C9A227`
- Low/Error: `#B85C4A`
- Neutral/None: `#8A8A86`

### 2. Typography Verification

**Font:** Braun Linear (fallback: system sans-serif)

**Scale (in pixels):**
| Size | Weight | Use | Letter Spacing |
|------|--------|-----|----------------|
| 36px | 700 Bold | Hero titles | -0.02em |
| 24px | 600 Semi | Section heads | -0.01em |
| 17px | 500 Medium | Subsections | 0 |
| 15px | 400 Regular | Body text | 0 |
| 13px | 400 Regular | Captions/meta | 0 |
| 11px | 600 Semi | Labels (UPPERCASE) | 0.1em |

### 3. Spacing Verification (8pt Grid)

All spacing must be multiples of 8px: `8, 16, 24, 32, 40, 48, 56, 64...`

Fine adjustments use 4px half-step for icons/text alignment.

**Common Values:**
- Component gap: 16px
- Section gap: 64px
- Card padding: 16px or 24px
- Button padding: 12px vertical, 24px horizontal
- Input padding: 10-12px

### 4. Geometry Verification

**ALLOWED:**
- Rectangles
- Circles (for avatars, icons)
- Straight lines
- Single radii (consistent `4px` border-radius)
- Mathematically proportional curves

**FORBIDDEN:**
- Arbitrary curves
- Expressive/organic shapes
- Border-radius > 4px (except full circles)
- Inconsistent radii within component

### 5. Anti-Pattern Check

**REJECT if present:**
- [ ] Colored accent buttons (amber, blue, purple, etc.)
- [ ] Gradient overlays on imagery
- [ ] Decorative shadows (shadows communicate elevation only)
- [ ] Decorative glows or halos
- [ ] Rounded corners > 4px
- [ ] Animated loading skeletons
- [ ] Text shadows on titles
- [ ] Color used for decoration (not function)
- [ ] Ornamental icons/illustrations
- [ ] Multiple font families
- [ ] Non-grid-aligned spacing

## Rams' 10 Principles Verification

For comprehensive design reviews, verify against all 10 principles:

1. **Innovative** — Solves real problems, not innovation for novelty
2. **Useful** — Every element serves user task completion
3. **Aesthetic** — Clean, harmonious, mathematically proportioned
4. **Understandable** — Self-explanatory interface, minimal instruction needed
5. **Unobtrusive** — Interface recedes, content speaks
6. **Honest** — No deceptive patterns, states what it does
7. **Long-lasting** — Avoids trends, timeless design
8. **Thorough** — Every detail considered, nothing arbitrary
9. **Environmentally conscious** — Efficient, minimal resource use
10. **Minimal** — "Less, but better" — only essential elements

## Component Standards

### Buttons
```css
.btn {
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 4px;
  transition: all 0.15s ease;
}
.btn-primary { background: #1C1C1A; color: #FFFFFF; }
.btn-secondary { background: transparent; border: 1px solid #C0BFBC; }
.btn-ghost { background: transparent; color: #5C5C58; }
```

### Inputs
```css
.input {
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid #C0BFBC;
  border-radius: 4px;
}
.input:focus { border-color: #5C5C58; outline: none; }
```

### Cards
```css
.card {
  background: #FFFFFF;
  border: 1px solid #E2E1DE;
  border-radius: 4px;
  padding: 16px;
}
```

### Navigation
```css
.nav-item {
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 500;
  color: #5C5C58;
  border-radius: 4px;
}
.nav-item:hover { background: rgba(0,0,0,0.03); color: #1C1C1A; }
.nav-item.active { background: rgba(0,0,0,0.05); color: #1C1C1A; }
```

## Dark Mode Guidelines

See `references/dark-mode.md` for complete dark mode implementation guide.

**Key principles:**
- Never use pure black (`#000000`) — use `#121212` or darker grays
- Never use pure white (`#FFFFFF`) — use `#FAFAF8` at 87% opacity
- Desaturate functional colors by ~20%
- Use surface elevation (lighter = closer) instead of shadows
- Maintain 4.5:1 minimum contrast ratio (WCAG AA)

## Verification Workflow

1. **Extract** current styles from component/page
2. **Compare** against design system values
3. **Check** for anti-patterns
4. **Verify** grid alignment (8pt system)
5. **Validate** color contrast (WCAG)
6. **Confirm** typography scale adherence
7. **Report** findings with specific remediation

## Additional References

- `references/dark-mode.md` — Complete dark mode color system
- `references/component-specs.md` — Detailed component specifications
- `references/anti-patterns.md` — Expanded anti-pattern examples

## Scope (User Application)

**Navigation:**
- Dashboard
- Locations
- Research
- Atlas
- Search Page
- Settings Page

**Location Pages:**
- Location Page
- Host-Location Page
- Sub-Location Page
