# Atlas View: Simplify Location Popup

## Task Request
Simplify the Atlas map popup by removing:
1. Verify Location button (and "Location Verified" indicator)
2. Type field
3. Town/City field

## Current State

### Popup Content (Map.svelte lines 574-589)
```html
<div class="location-popup">
  <strong>Location Name</strong><br/>
  <span>Type</span><br/>                    <!-- REMOVE -->
  <span>City, State</span>                  <!-- REMOVE City, keep State -->
  <button>View Details</button>
  <button>Verify Location</button>          <!-- REMOVE -->
</div>
```

### Map.svelte Usage
| Consumer | Needs Full Popup? |
|----------|-------------------|
| `Atlas.svelte` | NO - simplified popup requested |
| `LocationEditModal.svelte` | Maybe - editing context |
| `SubLocationGpsModal.svelte` | Maybe - GPS context |
| `LocationMapSection.svelte` | Maybe - detail context |

## Proposed Solution

**Add optional prop to Map.svelte for minimal popup mode:**

```typescript
// New prop
popupMode?: 'full' | 'minimal';  // default: 'full'
```

**Minimal mode shows:**
- Location name
- View Details button

**Full mode shows (current behavior):**
- Location name
- Type
- City, State
- View Details button
- Verify Location button (if handler provided)

## Changes Required

### 1. Map.svelte
**Add prop (around line 156):**
```typescript
popupMode?: 'full' | 'minimal';
```

**Update popup HTML generation (lines 560-589):**
- Wrap Type in condition: `popupMode !== 'minimal'`
- Wrap City+State in condition: `popupMode !== 'minimal'`
- Wrap Verify button in condition: `popupMode !== 'minimal'`

### 2. Atlas.svelte
**Add prop to Map component:**
```svelte
<Map
  ...
  popupMode="minimal"
/>
```

## CLAUDE.md Compliance Audit

| Rule | Status | Notes |
|------|--------|-------|
| Scope Discipline | ✅ | Only changes what's requested for Atlas |
| Keep It Simple | ✅ | Single prop controls popup complexity |
| Archive-First | ✅ | Full info still available in detail views |

## Files to Modify

1. **`packages/desktop/src/components/Map.svelte`**
   - Add `popupMode` prop with default `'full'`
   - Conditionally render Type, City, Verify button based on mode

2. **`packages/desktop/src/pages/Atlas.svelte`**
   - Add `popupMode="minimal"` prop to Map component

## Resulting Atlas Popup
```
┌─────────────────────┐
│ Location Name       │
│ [  View Details   ] │
└─────────────────────┘
```

## Testing Checklist

- [ ] Atlas popup shows: name + View Details button only
- [ ] Atlas popup does NOT show: type, city, state, verify button
- [ ] LocationEditModal popup still shows full content
- [ ] LocationMapSection popup still shows full content
- [ ] No TypeScript errors
