# Anti-Patterns Guide

Visual examples and explanations of patterns that violate Braun/Ulm School Design principles.

## Color Anti-Patterns

### ❌ Colored Accent Buttons

**Violation:** Using colored backgrounds for primary actions.

```css
/* WRONG */
.btn-primary {
  background: #3B82F6; /* Blue */
  background: #F59E0B; /* Amber */
  background: #10B981; /* Green */
}

/* CORRECT */
.btn-primary {
  background: #1C1C1A; /* Near black */
}
```

**Why it violates:** Color should communicate function (success, error, warning), not decoration. Buttons are neutral actions.

---

### ❌ Gradient Overlays on Photography

**Violation:** Adding colored gradients over images.

```css
/* WRONG */
.hero-image::after {
  background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

/* CORRECT */
.hero-image {
  /* No overlay - let photography speak */
}
```

**Why it violates:** Photography should stand alone. The interface recedes, content speaks.

---

### ❌ Decorative Color

**Violation:** Using color for visual interest rather than function.

```css
/* WRONG */
.sidebar { border-left: 4px solid #3B82F6; }
.card-accent { background: linear-gradient(90deg, #F0FDFA, #FFFFFF); }
.tag { background: #EEF2FF; color: #4F46E5; }

/* CORRECT */
.sidebar { border-left: none; }
.card-accent { background: #FFFFFF; }
.tag { background: #F4F4F2; color: #5C5C58; }
```

**Why it violates:** Color = information only. Verified state, warning, error, etc.

---

## Shape Anti-Patterns

### ❌ Rounded Corners > 4px

**Violation:** Large border radii creating "pill" or "bubble" shapes.

```css
/* WRONG */
.card { border-radius: 12px; }
.btn { border-radius: 9999px; } /* Pill button */
.avatar { border-radius: 16px; }
.input { border-radius: 8px; }

/* CORRECT */
.card { border-radius: 4px; }
.btn { border-radius: 4px; }
.avatar { border-radius: 50%; } /* Full circle OK */
.input { border-radius: 4px; }
```

**Why it violates:** Braun design uses pure geometry—rectangles with minimal rounding, circles, straight lines. No expressive shapes.

---

### ❌ Arbitrary Curves

**Violation:** Organic, expressive, or "blob" shapes.

```css
/* WRONG */
.decoration {
  border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%;
}
.wave-divider {
  clip-path: url(#wave-path);
}

/* CORRECT */
/* No decorative shapes. If divider needed: */
.divider { border-bottom: 1px solid #E2E1DE; }
```

**Why it violates:** All curves must be mathematically derived. Circles, arcs from circles, nothing arbitrary.

---

## Shadow Anti-Patterns

### ❌ Decorative Shadows

**Violation:** Heavy shadows for visual effect.

```css
/* WRONG */
.card {
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 
              0 2px 4px -2px rgba(0, 0, 0, 0.1);
}

/* CORRECT (Light mode only) */
.card {
  border: 1px solid #E2E1DE;
  /* Shadows only for elevation if absolutely necessary */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
```

**Why it violates:** Shadows communicate elevation only, not decoration. In dark mode, use surface lightness instead.

---

### ❌ Decorative Glows

**Violation:** Colored glows or halos.

```css
/* WRONG */
.btn:hover {
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.5);
}
.input:focus {
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
}
.card-featured {
  box-shadow: 0 0 30px rgba(139, 92, 246, 0.3);
}

/* CORRECT */
.btn:hover {
  background: #333333; /* Simple state change */
}
.input:focus {
  border-color: #5C5C58; /* Border change only */
}
.card-featured {
  border: 1px solid #1C1C1A; /* Emphasis via border */
}
```

**Why it violates:** Glows are ornamental. State changes should be subtle and functional.

---

## Typography Anti-Patterns

### ❌ Multiple Font Families

**Violation:** Using different typefaces for different elements.

```css
/* WRONG */
h1 { font-family: 'Playfair Display', serif; }
body { font-family: 'Inter', sans-serif; }
code { font-family: 'Fira Code', monospace; }

/* CORRECT */
* { font-family: 'Braun Linear', system-ui, sans-serif; }
code { font-family: 'SF Mono', Monaco, monospace; } /* Monospace exception OK */
```

**Why it violates:** Typography is a tool, not decoration. One typeface family.

---

### ❌ Text Shadows

**Violation:** Shadows on text for style.

```css
/* WRONG */
.hero-title {
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
}
.card-title {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* CORRECT */
.hero-title {
  color: #1C1C1A;
  /* No shadow */
}
```

**Why it violates:** Text must be purely readable. Shadows are decorative.

---

### ❌ Decorative Text Styling

**Violation:** Gradient text, text strokes, excessive styling.

```css
/* WRONG */
.fancy-title {
  background: linear-gradient(90deg, #667eea, #764ba2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.outlined-title {
  -webkit-text-stroke: 1px #1C1C1A;
}

/* CORRECT */
.title {
  color: #1C1C1A;
  font-weight: 700;
}
```

---

## Animation Anti-Patterns

### ❌ Animated Loading Skeletons

**Violation:** Shimmer/pulse animations on placeholders.

```css
/* WRONG */
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  animation: shimmer 1.5s infinite;
}

/* CORRECT */
.loading-placeholder {
  background: #F4F4F2;
  /* Static gray - no animation */
}
```

**Why it violates:** Animation for decoration. Loading states should be simple and static.

---

### ❌ Decorative Animations

**Violation:** Bounces, pulses, and attention-seeking motion.

```css
/* WRONG */
.notification-badge {
  animation: pulse 2s infinite;
}
.cta-button {
  animation: bounce 1s infinite;
}

/* CORRECT */
/* No decorative animations */
/* If needed, subtle opacity/position transitions only: */
.element {
  transition: opacity 0.15s ease;
}
```

---

## Spacing Anti-Patterns

### ❌ Non-Grid Spacing

**Violation:** Arbitrary spacing values not on the 8pt grid.

```css
/* WRONG */
.card { padding: 18px; }
.section { margin-bottom: 50px; }
.button { padding: 10px 22px; }
.gap { gap: 15px; }

/* CORRECT */
.card { padding: 16px; }        /* 8pt grid */
.section { margin-bottom: 48px; } /* 8pt grid */
.button { padding: 12px 24px; }  /* 8pt grid */
.gap { gap: 16px; }              /* 8pt grid */
```

**Allowed values:** 4, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96...

---

## Icon Anti-Patterns

### ❌ Ornamental Icons

**Violation:** Decorative icons that don't serve function.

```css
/* WRONG */
.feature-icon {
  /* Decorative blob/squiggle icon */
}
.section::before {
  content: '★'; /* Decorative star */
}

/* CORRECT */
/* Icons only when they communicate function */
/* Dashboard icon for Dashboard nav item */
/* Search icon for search input */
```

---

### ❌ Filled/Styled Icons

**Violation:** Icons with fills, gradients, or multiple colors.

```css
/* WRONG */
.icon {
  fill: linear-gradient(#667eea, #764ba2);
}
.icon {
  fill: #3B82F6;
}

/* CORRECT */
.icon {
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
}
```

---

## Quick Reference: Verification Questions

For any UI element, ask:

1. **Is there color?** → Does it communicate function? (success/error/warning)
2. **Is there a shadow?** → Does it communicate elevation?
3. **Is there animation?** → Is it functional feedback?
4. **Is there decoration?** → Can it be removed without losing information?
5. **Is spacing on grid?** → Is it a multiple of 8?
6. **Is border-radius > 4px?** → Is it a full circle (50%)?
7. **Does typography vary?** → Is it from the type scale?

If any answer is "no" for questions 1-4, or "yes" for 5-6, the element violates the design language.
