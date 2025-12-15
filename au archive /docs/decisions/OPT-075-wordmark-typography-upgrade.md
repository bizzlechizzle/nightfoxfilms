# OPT-075: Wordmark Typography Upgrade

**Date:** 2025-12-06
**Status:** Implemented
**Component:** Navigation.svelte

## Context

The "Abandoned Archive" wordmark in the sidebar was set at 11px — the Braun label tier — making it nearly invisible and failing to communicate brand importance.

## Problem

Per Braun Design Verification:

| Issue | Before | Braun Standard |
|-------|--------|----------------|
| Font size | 11px (label tier) | 24px for section heads / brand |
| Letter spacing | `tracking-wider` (~0.05em) | `-0.01em` for display text |
| Visual weight | Minimal, disappears | Should command sidebar presence |

Rams' Principles violated:
- **Understandable**: Brand barely visible
- **Aesthetic**: Disproportionate to 264px sidebar
- **Honest**: Doesn't communicate importance

## Decision

Upgrade wordmark to Braun **section head tier**:

| Property | Before | After |
|----------|--------|-------|
| Font size | `text-[11px]` (11px) | `text-2xl` (24px) |
| Letter spacing | `tracking-wider` | `tracking-tight` |
| Weight | `font-bold` | `font-bold` (unchanged) |
| Case | UPPERCASE | UPPERCASE (unchanged) |
| Layout | Stacked | Stacked (unchanged) |

## Implementation

```diff
- <span class="text-[11px] font-bold tracking-wider uppercase text-braun-900 leading-tight block">
+ <span class="text-2xl font-bold tracking-tight uppercase text-braun-900 leading-tight block">
    Abandoned<br/>Archive
  </span>
```

## Files Changed

- `packages/desktop/src/components/Navigation.svelte:38`
