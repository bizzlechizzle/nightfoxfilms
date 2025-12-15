# Component Specifications

Detailed specifications for all UI components following Braun/Ulm School Design Language.

## Button Specifications

### Primary Button

```css
.btn-primary {
  /* Dimensions */
  min-height: 44px;
  padding: 12px 24px;
  
  /* Typography */
  font-family: 'Braun Linear', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.43;
  text-transform: none;
  
  /* Colors (Light) */
  background-color: #1C1C1A;
  color: #FFFFFF;
  border: none;
  
  /* Shape */
  border-radius: 4px;
  
  /* Interaction */
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.btn-primary:hover {
  background-color: #333333;
}

.btn-primary:active {
  background-color: #1C1C1A;
}

.btn-primary:disabled {
  background-color: #E2E1DE;
  color: #8A8A86;
  cursor: not-allowed;
}

.btn-primary:focus-visible {
  outline: 2px solid #5C5C58;
  outline-offset: 2px;
}
```

### Secondary Button

```css
.btn-secondary {
  /* Dimensions */
  min-height: 44px;
  padding: 11px 23px; /* -1px for border */
  
  /* Typography */
  font-family: 'Braun Linear', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.43;
  
  /* Colors (Light) */
  background-color: transparent;
  color: #1C1C1A;
  border: 1px solid #C0BFBC;
  
  /* Shape */
  border-radius: 4px;
  
  /* Interaction */
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.btn-secondary:hover {
  border-color: #8A8A86;
}

.btn-secondary:disabled {
  border-color: #EEEEED;
  color: #C0BFBC;
  cursor: not-allowed;
}
```

### Ghost Button

```css
.btn-ghost {
  /* Dimensions */
  min-height: 44px;
  padding: 12px 24px;
  
  /* Typography */
  font-family: 'Braun Linear', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.43;
  
  /* Colors (Light) */
  background-color: transparent;
  color: #5C5C58;
  border: none;
  
  /* Interaction */
  cursor: pointer;
  transition: color 0.15s ease;
}

.btn-ghost:hover {
  color: #1C1C1A;
}
```

### Button Sizes

| Size | Height | Padding | Font Size |
|------|--------|---------|-----------|
| Small | 32px | 8px 16px | 13px |
| Medium (default) | 44px | 12px 24px | 14px |
| Large | 52px | 16px 32px | 15px |

## Input Specifications

### Text Input

```css
.input {
  /* Dimensions */
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  
  /* Typography */
  font-family: 'Braun Linear', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.43;
  
  /* Colors (Light) */
  background-color: #FFFFFF;
  color: #1C1C1A;
  border: 1px solid #C0BFBC;
  
  /* Shape */
  border-radius: 4px;
  
  /* Interaction */
  transition: border-color 0.15s ease;
}

.input::placeholder {
  color: #C0BFBC;
}

.input:hover {
  border-color: #8A8A86;
}

.input:focus {
  outline: none;
  border-color: #5C5C58;
}

.input:disabled {
  background-color: #F4F4F2;
  color: #8A8A86;
  cursor: not-allowed;
}

.input.error {
  border-color: #B85C4A;
}
```

### Input Label

```css
.input-label {
  display: block;
  margin-bottom: 8px;
  
  /* Typography */
  font-family: 'Braun Linear', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  
  /* Colors */
  color: #5C5C58;
}
```

### Input Helper Text

```css
.input-helper {
  margin-top: 4px;
  
  /* Typography */
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
  
  /* Colors */
  color: #8A8A86;
}

.input-helper.error {
  color: #B85C4A;
}
```

## Card Specifications

### Base Card

```css
.card {
  /* Layout */
  display: flex;
  flex-direction: column;
  
  /* Colors (Light) */
  background-color: #FFFFFF;
  border: 1px solid #E2E1DE;
  
  /* Shape */
  border-radius: 4px;
  overflow: hidden;
  
  /* Interaction */
  transition: border-color 0.15s ease;
}

.card:hover {
  border-color: #C0BFBC;
}
```

### Card Padding Variants

```css
.card-padding-sm { padding: 12px; }
.card-padding-md { padding: 16px; }
.card-padding-lg { padding: 24px; }
```

### Card with Image

```css
.card-image {
  width: 100%;
  aspect-ratio: 16 / 9;
  background-color: #F4F4F2;
  object-fit: cover;
}

.card-content {
  padding: 16px;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #1C1C1A;
  margin-bottom: 4px;
}

.card-meta {
  font-size: 13px;
  color: #8A8A86;
}
```

## Navigation Specifications

### Sidebar Navigation

```css
.sidebar {
  width: 240px;
  padding: 24px 16px;
  background-color: #FAFAF8;
  border-right: 1px solid #E2E1DE;
}

.sidebar-brand {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  line-height: 1.3;
  color: #1C1C1A;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #E2E1DE;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  
  /* Typography */
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  
  /* Colors */
  color: #5C5C58;
  
  /* Shape */
  border-radius: 4px;
  
  /* Interaction */
  transition: background-color 0.15s ease, color 0.15s ease;
}

.sidebar-nav-item:hover {
  background-color: rgba(0, 0, 0, 0.03);
  color: #1C1C1A;
}

.sidebar-nav-item.active {
  background-color: rgba(0, 0, 0, 0.05);
  color: #1C1C1A;
}
```

### Navigation Icons

```css
.nav-icon {
  width: 20px;
  height: 20px;
  color: currentColor;
  flex-shrink: 0;
}
```

## Typography Scale

### Heading Styles

```css
.h1 {
  font-size: 36px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: #1C1C1A;
}

.h2 {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: #1C1C1A;
}

.h3 {
  font-size: 17px;
  font-weight: 500;
  line-height: 1.35;
  color: #1C1C1A;
}
```

### Body Styles

```css
.body-lg {
  font-size: 15px;
  font-weight: 400;
  line-height: 1.6;
  color: #5C5C58;
}

.body-md {
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  color: #5C5C58;
}

.body-sm {
  font-size: 13px;
  font-weight: 400;
  line-height: 1.5;
  color: #8A8A86;
}
```

### Label Style

```css
.label {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #8A8A86;
}
```

## Spacing System (8pt Grid)

### Spacing Tokens

```css
:root {
  --space-1: 4px;   /* Half-step for fine adjustments */
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 32px;
  --space-6: 40px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 80px;
  --space-10: 96px;
}
```

### Common Usage

| Context | Value | Token |
|---------|-------|-------|
| Icon margin | 4px | --space-1 |
| Tight grouping | 8px | --space-2 |
| Component padding | 16px | --space-3 |
| Section spacing | 24px | --space-4 |
| Card spacing | 32px | --space-5 |
| Group separation | 48px | --space-7 |
| Page sections | 64px | --space-8 |

## Icon System

### Icon Sizes

| Size | Dimensions | Line Weight |
|------|------------|-------------|
| Small | 16×16 | 1.5px |
| Medium | 20×20 | 2px |
| Large | 24×24 | 2px |
| XL | 32×32 | 2.5px |

### Icon Guidelines

- Stroke-based, not filled
- Single consistent stroke weight per size
- Centered in bounding box
- Pure geometric construction
- No decorative elements
