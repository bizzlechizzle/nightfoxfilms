# ADR-047: Onboarding Flow Tweaks

**Status:** Approved
**Date:** 2025-12-09

---

## Context

The current onboarding flow (Setup.svelte) needs refinement:
1. Uses deprecated "Abandoned Upstate" logo (with NY state silhouette)
2. Collects nickname field that adds complexity to first-run
3. Lacks clarity on why name is collected (copyright purposes)
4. Should be restructured into 3 focused pages, each with an educational "rule"

---

## Current State Analysis

### Setup.svelte (325 lines)

**Page 1 - Welcome:**
- Shows deprecated logo image (`abandoned-upstate-logo.png`)
- Generic welcome text and feature list
- "Archive Setup" subtitle

**Page 2 - Setup:**
- Name field (required)
- Nickname field (optional) ← **Remove**
- PIN/Confirm PIN fields
- Archive Location selector

### Braun Design Audit Findings

**Compliant:**
- Uses correct `braun-*` color palette
- 4px border-radius (max allowed)
- Proper typography hierarchy
- Clean card-based layout
- 8pt grid alignment (p-4, p-6, gap-2, gap-3)

**Issues:**
- Image logo violates "no decorative elements" (has organic NY state shape)
- Text logo with outline stroke has rounded, non-geometric edges
- `text-xl` (20px) doesn't match Braun scale (should be 17px or 24px)

---

## Proposed Changes

### Page 1: Your Name
- **Replace:** `<img src={logo}>` with single-line text logo "ABANDONED ARCHIVE" (outside card)
- **Typography:** 36px, bold, tracking-tight (single cinematic line)
- **Field:** Name input with placeholder "First Name - Last Name"
- **Label:** "Name" (no heading, minimal)
- **Add:** Rule #1 (Preserve History)

### Page 2: Archive Location
- **Move:** Archive Location selector to dedicated page
- **Label:** "Folder" with Browse button
- **No helper text** (minimal design)
- **Add:** Rule #2 (Document Decay)

### Page 3: Security PIN
- **PIN and Confirm PIN** fields in 2-column grid
- **Add:** Rule #3 (Authentic Information)

---

## Visual Design: Text Logo

Single-line cinematic logo outside the card:

```
┌─────────────────────────────────────┐
│                                     │
│        ABANDONED ARCHIVE            │  ← 36px, bold, tracking-tight
│                                     │
└─────────────────────────────────────┘
```

**Tailwind Implementation:**
```html
<div class="text-center mb-8">
  <span class="text-4xl font-bold tracking-tight text-braun-900">ABANDONED ARCHIVE</span>
</div>
```

---

## Educational Rules (One Per Page)

Each page includes a minimal "rule" callout box (title only, no descriptions):

| Page | Rule |
|------|------|
| 1 | **Preserve History** |
| 2 | **Document Decay** |
| 3 | **Authentic Information** |

**Rule Box Design (Braun-compliant, title only):**
```html
<div class="bg-braun-100 border border-braun-300 rounded p-3 mt-4">
  <div class="text-xs font-semibold uppercase tracking-wider text-braun-500">
    Preserve History
  </div>
</div>
```

---

## Page Flow Summary

| Step | Title | Fields | Rule |
|------|-------|--------|------|
| 1 | Your Name | Name (required) | Preserve History |
| 2 | Archive Location | Folder selector | Document Decay |
| 3 | Security PIN | PIN, Confirm PIN | Authentic Information |

---

## Files to Modify

1. **`packages/desktop/src/pages/Setup.svelte`**
   - Replace logo `<img>` with CSS text logo
   - Remove nickname field and related state
   - Split Page 2 into Page 2 (user) + Page 3 (archive)
   - Update `totalSteps` to 3
   - Update `canProceed()` logic for 3 pages
   - Add rule callout boxes to each page

2. **`packages/desktop/src/pages/Login.svelte`** (consistency)
   - Replace logo `<img>` with same CSS text logo

3. **No new files required** - purely surgical edits

---

## Braun Compliance Checklist

- [x] No decorative images (text logo only)
- [x] Typography follows scale (36/24/15px)
- [x] Colors from `braun-*` palette only
- [x] Max 4px border-radius
- [x] 8pt grid spacing
- [x] No shadows
- [x] Geometric shapes only (rectangles)
- [x] Rule boxes use standard card pattern

---

## Migration Path

1. Remove `nickname` from Setup form state
2. Update `completeSetup()` to pass `null` for `display_name`
3. Existing users unaffected (nickname remains in DB if set)
4. Nickname can be edited via Settings after setup

---

## Decision

Implement 3-page onboarding with CSS text logo, educational rules per page, remove nickname field, add copyright explanation for name field.
