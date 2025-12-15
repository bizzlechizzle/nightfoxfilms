# Braun/Rams Design System Overhaul

**Version:** 1.0
**Created:** 2025-12-06
**Status:** PLANNING

---

## Executive Summary

This plan transforms the AU Archive desktop application from its current warm, editorial aesthetic (Lora serif + Roboto Mono, gold accent `#B9975C`, cream background `#FFFBF7`) to a Dieter Rams-inspired industrial design language characterized by:

- **Braun Linear** geometric sans-serif typography
- **Cool neutral palette** with functional-only color
- **Minimal ornamentation** (no decorative shadows, gradients, or glows)
- **4px maximum border radius** (subtle, not rounded)
- **Information hierarchy through typography weight**, not color

---

## Design Philosophy: The Ten Principles Applied

| Rams Principle | Application to AU Archive |
|----------------|---------------------------|
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

## Phase 1: Design System Foundation

### 1.1 Color Token Migration

**Current → Target Mapping:**

| Purpose | Current | Target | Token Name |
|---------|---------|--------|------------|
| Background | `#FFFBF7` (warm cream) | `#FAFAF8` (cool paper) | `--color-bg` |
| Background Alt | `#FFFFFF` | `#F4F4F2` (warm gray) | `--color-bg-alt` |
| Surface | `#FFFFFF` | `#FFFFFF` | `--color-surface` |
| Border | `#E5E5E5` | `#E2E1DE` | `--color-border` |
| Border Muted | `#F3F3F3` | `#EEEEED` | `--color-border-muted` |
| Text Primary | `#454545` (gunmetal) | `#1C1C1A` (near-black) | `--color-text` |
| Text Secondary | `#7A7A7A` | `#5C5C58` | `--color-text-secondary` |
| Text Muted | `#9CA3AF` | `#8A8A86` | `--color-text-muted` |
| Text Disabled | `#D1D5DB` | `#C0BFBC` | `--color-text-disabled` |
| Accent (REMOVED) | `#B9975C` (gold) | N/A - functional only | — |

**Functional Colors (Color = Information):**

| Purpose | Color | Hex | Usage |
|---------|-------|-----|-------|
| GPS Verified | Green | `#286736` | Map-confirmed coordinates |
| GPS High | Blue | `#3B82F6` | EXIF with <10m accuracy |
| GPS Medium | Amber | `#D97706` | Reverse-geocoded |
| GPS Low | Red | `#DC2626` | Manual/estimate |
| GPS None | Gray | `#6B7280` | No coordinates |
| Success | Green | `#286736` | Import complete, save success |
| Error | Red | `#AE1C09` | Validation errors, failures |
| Warning | Amber | `#D97706` | Duplicate detection, GPS mismatch |

**Key Change:** The gold accent (`#B9975C`) is **eliminated entirely**. Primary actions use `#1C1C1A` (near-black). Links and interactive text use underlines, not color differentiation.

### 1.2 Typography Migration

**Font Installation:**

```
resources/fonts/
├── BraunLinear-Thin.woff2      (weight: 100)
├── BraunLinear-Light.woff2     (weight: 300)
├── BraunLinear-Regular.woff2   (weight: 400)
├── BraunLinear-Medium.woff2    (weight: 500)
├── BraunLinear-Bold.woff2      (weight: 700)
```

**Typography Scale:**

| Element | Current | Target |
|---------|---------|--------|
| Hero Title | 128px Roboto Mono, gold shadow | 96px Braun Linear Bold, no shadow |
| Page Title | 30px Roboto Mono | 28px Braun Linear Medium |
| Section Title | 24px Roboto Mono | 11px Braun Linear Bold, ALL CAPS, 0.1em tracking |
| Body | 16px Lora serif | 14px Braun Linear Regular |
| Label | 14px mixed | 11px Braun Linear Medium, ALL CAPS, 0.1em tracking |
| Small | 12px | 13px Braun Linear Regular |

**Letter-Spacing System:**

| Context | Tracking |
|---------|----------|
| Hero/Display | `-0.02em` (tight) |
| Body text | `0` (normal) |
| Labels/Caps | `0.1em` (wide) |
| Wordmark | `0.05em` |

### 1.3 Spacing System

**Base Unit:** 8px grid (Tailwind default, preserved)

**Component Spacing:**

| Element | Current | Target |
|---------|---------|--------|
| Card padding | 16-24px varied | 32px uniform |
| Section gap | 24px | 32px |
| Input padding | 10px 12px | 12px 16px |
| Button padding | 12px 24px | 12px 24px (preserved) |
| Modal padding | 24px | 32px |

### 1.4 Border & Radius System

**Border Radius:** Maximum 4px everywhere (no 8px, no fully rounded)

| Element | Current | Target |
|---------|---------|--------|
| Cards | `rounded-lg` (8px) | `rounded` (4px) |
| Buttons | `rounded-lg` (8px) | `rounded` (4px) |
| Inputs | `rounded-lg` (8px) | `rounded` (4px) |
| Badges | `rounded` (4px) | `rounded-sm` (2px) |
| Avatars | `rounded-full` | `rounded` (4px) |

**Border Colors:**
- Default: `#E2E1DE`
- Hover: `#C0BFBC`
- Focus: `#5C5C58`

### 1.5 Shadow System

**Eliminated:** All decorative shadows removed.

| Element | Current | Target |
|---------|---------|--------|
| Cards | `shadow-md` | `border border-[#E2E1DE]` |
| Modals | `shadow-xl` | `border border-[#E2E1DE]` |
| Dropdowns | `shadow-lg` | `border border-[#E2E1DE]` |
| Buttons | none | none |
| Hover states | `shadow-md` | `border-color: #8A8A86` |

---

## Phase 2: Infrastructure Changes

### 2.1 Font Loading Setup

**File:** `packages/desktop/src/app.css`

```css
@font-face {
  font-family: 'Braun Linear';
  src: url('/fonts/BraunLinear-Thin.woff2') format('woff2');
  font-weight: 100;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Braun Linear';
  src: url('/fonts/BraunLinear-Light.woff2') format('woff2');
  font-weight: 300;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Braun Linear';
  src: url('/fonts/BraunLinear-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Braun Linear';
  src: url('/fonts/BraunLinear-Medium.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Braun Linear';
  src: url('/fonts/BraunLinear-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

### 2.2 Tailwind Configuration Update

**File:** `packages/desktop/tailwind.config.js`

```javascript
export default {
  content: [
    './index.html',
    './src/**/*.{svelte,js,ts}',
  ],
  theme: {
    extend: {
      colors: {
        // Braun neutral scale
        braun: {
          50: '#FAFAF8',   // Background
          100: '#F4F4F2',  // Background alt
          200: '#EEEEED',  // Border muted
          300: '#E2E1DE',  // Border
          400: '#C0BFBC',  // Text disabled
          500: '#8A8A86',  // Text muted
          600: '#5C5C58',  // Text secondary
          900: '#1C1C1A',  // Text primary
        },
        // Functional colors only
        gps: {
          verified: '#286736',
          high: '#3B82F6',
          medium: '#D97706',
          low: '#DC2626',
          none: '#6B7280',
        },
        // Status colors
        success: '#286736',
        error: '#AE1C09',
        warning: '#D97706',
      },
      fontFamily: {
        sans: ['Braun Linear', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '2px',
        md: '4px',  // Override md to match default
        lg: '4px',  // Override lg to match default
      },
      letterSpacing: {
        tighter: '-0.02em',
        wide: '0.05em',
        wider: '0.1em',
      },
    },
  },
  plugins: [],
};
```

### 2.3 CSS Variables Update

**File:** `packages/desktop/src/app.css`

```css
@layer base {
  :root {
    /* Braun color tokens */
    --color-bg: #FAFAF8;
    --color-bg-alt: #F4F4F2;
    --color-surface: #FFFFFF;
    --color-border: #E2E1DE;
    --color-border-muted: #EEEEED;
    --color-text: #1C1C1A;
    --color-text-secondary: #5C5C58;
    --color-text-muted: #8A8A86;
    --color-text-disabled: #C0BFBC;

    /* Typography */
    --font-sans: 'Braun Linear', system-ui, sans-serif;

    /* Removed: accent color, heading/body font distinction */
  }

  body {
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.5;
    color: var(--color-text);
    background-color: var(--color-bg);
    -webkit-font-smoothing: antialiased;
  }

  /* Headings - all same font, differentiated by weight/size */
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-sans);
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: -0.02em;
    margin: 0;
  }

  /* Selection - neutral, not branded */
  ::selection {
    background-color: rgba(28, 28, 26, 0.15);
    color: inherit;
  }
}
```

---

## Phase 3: Component Migration

### 3.1 Component Priority Matrix

**Tier 1 - Global Impact (Do First):**

| Component | Lines | Impact | Complexity |
|-----------|-------|--------|------------|
| `app.css` | 82 | 100% | Low |
| `tailwind.config.js` | 72 | 100% | Low |
| `Layout.svelte` | 34 | 100% | Low |
| `Navigation.svelte` | 100 | 100% | Medium |

**Tier 2 - High Visibility:**

| Component | Lines | Impact | Complexity |
|-----------|-------|--------|------------|
| `Dashboard.svelte` | 611 | High | Medium |
| `LocationDetail.svelte` | 1338 | High | High |
| `Locations.svelte` | 590 | High | Medium |
| `ImportModal.svelte` | 800+ | High | High |

**Tier 3 - Core Patterns:**

| Component | Lines | Impact | Complexity |
|-----------|-------|--------|------------|
| `LocationInfo.svelte` | 1155 | Medium | Medium |
| `LocationMapSection.svelte` | 500+ | Medium | Medium |
| `MediaViewer.svelte` | 500+ | Medium | High |
| `MediaGrid.svelte` | 97 | Medium | Low |

**Tier 4 - Supporting Components:**

All remaining ~35 components, addressed systematically.

### 3.2 Navigation Component Redesign

**Current State:**
- Gold accent on active state (`border-l-4 border-accent`)
- Warm background (`bg-background`)
- Mixed hover states

**Target State:**
```svelte
<nav class="w-64 h-screen bg-braun-50 text-braun-900 flex flex-col border-r border-braun-300">
  <!-- Wordmark -->
  <div class="p-6 border-b border-braun-300">
    <span class="text-[11px] font-bold tracking-wider uppercase text-braun-900">
      Abandoned<br/>Archive
    </span>
  </div>

  <!-- New Location button - primary action -->
  <div class="px-4 py-4">
    <button class="w-full px-4 py-3 bg-braun-900 text-white rounded text-sm font-medium hover:bg-braun-600 transition-colors">
      New Location
    </button>
  </div>

  <!-- Menu items -->
  <ul class="flex-1 py-2">
    {#each menuItems as item}
      <li>
        <button
          class="w-full px-6 py-2 text-left text-sm font-medium
                 {isActive(item.path)
                   ? 'bg-braun-100 text-braun-900'
                   : 'text-braun-600 hover:bg-braun-100 hover:text-braun-900'}
                 transition-colors"
        >
          {item.label}
        </button>
      </li>
    {/each}
  </ul>
</nav>
```

**Key Changes:**
- No colored accent bar on active state
- Active indicated by background only (`bg-braun-100`)
- Wordmark uses stacked layout with wide tracking
- Primary button is near-black, not gold

### 3.3 Card Component Pattern

**Current State:**
```svelte
<div class="bg-white rounded-lg shadow-md p-6">
```

**Target State:**
```svelte
<div class="bg-white border border-braun-300 rounded p-8">
```

**Changes:**
- `shadow-md` → `border border-braun-300`
- `rounded-lg` → `rounded` (4px)
- `p-6` → `p-8` (32px padding)

### 3.4 Button Component Patterns

**Primary Button:**
```svelte
<!-- Current -->
<button class="bg-accent text-white rounded-lg hover:opacity-90">

<!-- Target -->
<button class="bg-braun-900 text-white rounded text-sm font-medium
               hover:bg-braun-600 transition-colors">
```

**Secondary Button:**
```svelte
<!-- Current -->
<button class="border border-gray-300 hover:bg-gray-50">

<!-- Target -->
<button class="bg-transparent text-braun-900 border border-braun-400 rounded
               text-sm font-medium hover:border-braun-500 transition-colors">
```

**Ghost Button:**
```svelte
<!-- Current -->
<button class="text-accent hover:underline">

<!-- Target -->
<button class="text-braun-600 text-sm font-medium hover:text-braun-900
               transition-colors">
```

### 3.5 Input Component Pattern

**Current State:**
```svelte
<input class="w-full px-3 py-2 border border-gray-300 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-accent">
```

**Target State:**
```svelte
<input class="w-full px-4 py-3 bg-white border border-braun-400 rounded
              text-sm text-braun-900 placeholder:text-braun-400
              focus:outline-none focus:border-braun-600 transition-colors">
```

**Changes:**
- No focus ring (border color change only)
- Neutral placeholder color
- Slightly larger padding

### 3.6 Label Component Pattern

**Section Labels:**
```svelte
<!-- Current -->
<h3 class="text-lg font-semibold text-foreground">Information</h3>

<!-- Target -->
<h3 class="text-[11px] font-semibold uppercase tracking-wider text-braun-500 mb-4">
  Information
</h3>
```

**Form Labels:**
```svelte
<!-- Current -->
<label class="block text-sm font-medium text-gray-700 mb-2">Name</label>

<!-- Target -->
<label class="block text-[11px] font-semibold uppercase tracking-wider
              text-braun-600 mb-2">
  Name
</label>
```

### 3.7 Badge/Tag Component Pattern

**Current State:**
```svelte
<span class="px-2 py-0.5 bg-accent/10 text-accent rounded text-sm">
  Interior
</span>
```

**Target State:**
```svelte
<span class="px-2 py-1 bg-braun-100 text-braun-600 rounded-sm text-xs font-medium">
  Interior
</span>
```

### 3.8 Hero Image Treatment

**Current State:**
- Large hero with gradient overlay
- Gold text shadow on title
- Accent-colored stats

**Target State:**
- Clean hero, no gradient (or very subtle vignette)
- Title in near-black, no shadow
- Stats in muted gray, functional only

```svelte
<!-- Hero title - no shadow, no gold -->
<h1 class="text-[96px] font-bold uppercase tracking-tighter text-braun-900
           leading-none text-center">
  {heroDisplayName}
</h1>

<!-- Stats row - neutral, informational -->
<div class="flex justify-center gap-8 mt-4">
  <div class="text-center">
    <div class="text-2xl font-bold text-braun-900">{formatCount(totalLocations)}</div>
    <div class="text-[11px] uppercase tracking-wider text-braun-500">locations</div>
  </div>
</div>
```

### 3.9 GPS Confidence Markers

**Functional Color Returns:**

GPS markers are the ONE place where color carries meaning:

```javascript
const GPS_MARKER_COLORS = {
  verified: '#286736',  // Green - map confirmed
  high: '#3B82F6',      // Blue - EXIF high accuracy
  medium: '#D97706',    // Amber - reverse geocoded
  low: '#DC2626',       // Red - manual/estimate
  none: '#6B7280',      // Gray - no GPS
};
```

This is intentional deviation from "no color" principle because **color = information** here.

### 3.10 Modal Component Pattern

**Current State:**
```svelte
<div class="fixed inset-0 bg-black bg-opacity-50 z-50">
  <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6">
```

**Target State:**
```svelte
<div class="fixed inset-0 bg-black/40 z-50">
  <div class="bg-white border border-braun-300 rounded w-full max-w-2xl">
    <!-- Header with border -->
    <div class="px-8 py-6 border-b border-braun-200">
      <h2 class="text-lg font-medium text-braun-900">Modal Title</h2>
    </div>
    <!-- Content -->
    <div class="px-8 py-6">
      {content}
    </div>
    <!-- Footer with border -->
    <div class="px-8 py-4 border-t border-braun-200 bg-braun-50 flex justify-end gap-3">
      <button>Cancel</button>
      <button>Save</button>
    </div>
  </div>
</div>
```

---

## Phase 4: Page-by-Page Migration

### 4.1 Dashboard Migration

**Changes Required:**

1. **Hero Section:**
   - Remove gold text shadow from title
   - Change stats accent color to `braun-900`
   - Remove skeleton shimmer gold tint

2. **Card Sections:**
   - Replace `shadow` with `border border-braun-300`
   - Replace `rounded-lg` with `rounded`
   - Replace `text-accent` links with `text-braun-600 hover:text-braun-900`

3. **Section Headers:**
   - Convert to uppercase label style
   - Add `tracking-wider` letter-spacing

4. **Import Progress:**
   - Replace gold progress bar with `braun-900`
   - Replace gold pulse indicator with neutral

### 4.2 Locations Page Migration

**Changes Required:**

1. **Filter Bar:**
   - Input borders to `braun-400`
   - Focus states to border-only (no ring)
   - Dropdowns consistent with inputs

2. **Active Filters:**
   - Replace `bg-accent/10 text-accent` with `bg-braun-100 text-braun-600`

3. **Table:**
   - Header background to `braun-50`
   - Row hover to `braun-50` (not gray-50)
   - GPS badges remain functional colors

4. **Virtual Scroll:**
   - No visual changes needed (logic preserved)

### 4.3 LocationDetail Migration

**Changes Required:**

1. **Hero:**
   - Title loses gold shadow
   - Sub-location tagline becomes `braun-600`

2. **Information Panel:**
   - Section titles become uppercase labels
   - Badge colors to neutral
   - "edit" link becomes `text-braun-600 hover:text-braun-900`

3. **Map Section:**
   - GPS markers retain functional colors
   - Verify button becomes primary style

4. **Import Zone:**
   - Dashed border to `braun-400`
   - Drop highlight to `braun-100` background

5. **Modals:**
   - All internal modals follow modal pattern

### 4.4 Settings Page Migration

**Changes Required:**

1. **Section Accordions:**
   - Headers become uppercase labels
   - Expand/collapse icons in `braun-500`

2. **Form Controls:**
   - All inputs follow input pattern
   - Checkboxes: `accent-braun-900` (or custom checkbox)

3. **Danger Actions:**
   - Delete buttons retain red (`error`) color

---

## Phase 5: Testing & Validation

### 5.1 Visual Regression Checklist

- [ ] Navigation renders correctly at all viewport sizes
- [ ] Dashboard cards align to 8px grid
- [ ] All text is legible (contrast ratio ≥ 4.5:1)
- [ ] GPS markers display correct functional colors
- [ ] Modals center properly and close on Escape
- [ ] Hero titles scale correctly (1-line and 2-line)
- [ ] Skeleton loaders animate smoothly
- [ ] Toast notifications appear in correct position

### 5.2 Accessibility Validation

- [ ] Color contrast passes WCAG AA
- [ ] Focus states are visible (border change)
- [ ] Interactive elements have appropriate size (min 44px)
- [ ] Screen reader testing on key flows

### 5.3 Performance Validation

- [ ] Font files load efficiently (woff2 only)
- [ ] No layout shift during font load
- [ ] Virtual scroll still performs at 10K+ locations

---

## Phase 6: Implementation Order

### Step 1: Foundation (Day 1)
1. Copy font files to `resources/fonts/`
2. Update `app.css` with @font-face declarations
3. Update `tailwind.config.js` with new color/font tokens
4. Verify fonts load correctly

### Step 2: Shell Components (Day 1-2)
1. Migrate `Layout.svelte`
2. Migrate `Navigation.svelte`
3. Verify app shell renders correctly

### Step 3: Core Components (Day 2-3)
1. Create component pattern file (buttons, inputs, cards, labels)
2. Migrate `SkeletonLoader.svelte`
3. Migrate `ToastContainer.svelte`

### Step 4: Page Components (Day 3-5)
1. Migrate `Dashboard.svelte`
2. Migrate `Locations.svelte`
3. Migrate `LocationDetail.svelte`
4. Migrate `Settings.svelte`

### Step 5: Modal & Form Components (Day 5-7)
1. Migrate `ImportModal.svelte`
2. Migrate `LocationEditModal.svelte`
3. Migrate `MediaViewer.svelte`
4. Migrate all form components

### Step 6: Remaining Components (Day 7-10)
1. Systematically migrate all remaining ~30 components
2. Run visual regression tests
3. Fix edge cases

### Step 7: Polish & Documentation (Day 10-12)
1. Create `docs/design-system.md` with final tokens
2. Update `docs/ui-spec.md` if it exists
3. Final accessibility audit

---

## Risk Mitigation

### Risk: Font Licensing
**Mitigation:** Verify Braun Linear license permits embedding in Electron app. If not, identify fallback (e.g., Inter, DM Sans).

### Risk: Breaking Existing Functionality
**Mitigation:** Make only visual changes; never modify component logic. Test each component after migration.

### Risk: Map Marker Visibility
**Mitigation:** Test GPS markers against all map tile providers (satellite, street, topo) to ensure visibility.

### Risk: Accessibility Regression
**Mitigation:** Run axe-core on key pages before/after migration.

---

## Success Criteria

1. **No gold/accent color** remains anywhere in the app
2. **All text uses Braun Linear** font family
3. **No decorative shadows** on any element
4. **Maximum 4px border radius** on all elements
5. **GPS markers retain functional colors** for information hierarchy
6. **All interactive states** are clearly distinguishable
7. **Visual consistency** across all 50+ components

---

## Files to Modify (Complete List)

### Configuration (2 files)
- `packages/desktop/tailwind.config.js`
- `packages/desktop/src/app.css`

### Shell Components (3 files)
- `packages/desktop/src/App.svelte`
- `packages/desktop/src/components/Layout.svelte`
- `packages/desktop/src/components/Navigation.svelte`

### Page Components (14 files)
- `packages/desktop/src/pages/Dashboard.svelte`
- `packages/desktop/src/pages/Locations.svelte`
- `packages/desktop/src/pages/LocationDetail.svelte`
- `packages/desktop/src/pages/Atlas.svelte`
- `packages/desktop/src/pages/Settings.svelte`
- `packages/desktop/src/pages/Search.svelte`
- `packages/desktop/src/pages/Imports.svelte`
- `packages/desktop/src/pages/Bookmarks.svelte`
- `packages/desktop/src/pages/Research.svelte`
- `packages/desktop/src/pages/WebBrowser.svelte`
- `packages/desktop/src/pages/Login.svelte`
- `packages/desktop/src/pages/Setup.svelte`
- `packages/desktop/src/pages/Projects.svelte`
- `packages/desktop/src/pages/ProjectDetail.svelte`

### Core Components (21 files)
- `packages/desktop/src/components/ImportModal.svelte`
- `packages/desktop/src/components/ImportForm.svelte`
- `packages/desktop/src/components/ImportProgress.svelte`
- `packages/desktop/src/components/SidebarImportProgress.svelte`
- `packages/desktop/src/components/Map.svelte`
- `packages/desktop/src/components/MediaGrid.svelte`
- `packages/desktop/src/components/MediaViewer.svelte`
- `packages/desktop/src/components/LocationEditForm.svelte`
- `packages/desktop/src/components/LocationFormFields.svelte`
- `packages/desktop/src/components/AutocompleteInput.svelte`
- `packages/desktop/src/components/ImportIntelligence.svelte`
- `packages/desktop/src/components/DuplicateWarningPanel.svelte`
- `packages/desktop/src/components/ExifPanel.svelte`
- `packages/desktop/src/components/NotesSection.svelte`
- `packages/desktop/src/components/ToastContainer.svelte`
- `packages/desktop/src/components/SkeletonLoader.svelte`
- `packages/desktop/src/components/HealthMonitoring.svelte`
- `packages/desktop/src/components/LinkLocationModal.svelte`
- `packages/desktop/src/components/RecentImports.svelte`

### Location Sub-Components (15 files)
- `packages/desktop/src/components/location/LocationHeader.svelte`
- `packages/desktop/src/components/location/LocationHero.svelte`
- `packages/desktop/src/components/location/LocationGallery.svelte`
- `packages/desktop/src/components/location/LocationVideos.svelte`
- `packages/desktop/src/components/location/LocationDocuments.svelte`
- `packages/desktop/src/components/location/LocationAddress.svelte`
- `packages/desktop/src/components/location/LocationInfo.svelte`
- `packages/desktop/src/components/location/LocationMapSection.svelte`
- `packages/desktop/src/components/location/LocationNerdStats.svelte`
- `packages/desktop/src/components/location/LocationImportZone.svelte`
- `packages/desktop/src/components/location/LocationOriginalAssets.svelte`
- `packages/desktop/src/components/location/LocationBookmarks.svelte`
- `packages/desktop/src/components/location/LocationEditModal.svelte`
- `packages/desktop/src/components/location/SubLocationGrid.svelte`
- `packages/desktop/src/components/location/SubLocationGpsModal.svelte`

### New Files to Create (2 files)
- `resources/fonts/` directory with Braun Linear woff2 files
- `docs/design-system.md` (final token documentation)

**Total: ~55 files to modify + 2 new**

---

## Appendix: Before/After Visual Reference

The `braun-master-updated.html` file at `/Users/bryant/Downloads/braun-master-updated.html` serves as the authoritative visual reference for all component patterns.

Key reference sections:
- Core Palette (neutral scale)
- Typography scale and weights
- Button patterns
- Card patterns
- Input patterns
- Navigation patterns
- GPS confidence bars

---

*End of Plan*
