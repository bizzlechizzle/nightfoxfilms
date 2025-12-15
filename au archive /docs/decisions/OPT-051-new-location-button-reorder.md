# OPT-051: New Location Button Text and Modal Button Reorder

## Status
Accepted

## Date
2025-12-02

## Context
Minor UI polish for the New Location workflow:
1. The WebBrowser sidebar button displayed "+ New Location" - the plus prefix is redundant since the button's purpose is already clear from context
2. The ImportModal footer buttons were ordered "Cancel | Create | Add Media" but "Create" should be the primary action on the right

## Decision
1. Remove the `+` prefix from the WebBrowser "New Location" button
2. Reorder modal footer buttons to: Cancel | Add Media | Create

This places the primary action (Create) in the rightmost position, following common UI conventions where the primary action is on the right.

## Changes
- `packages/desktop/src/pages/WebBrowser.svelte`: `+ New Location` → `New Location`
- `packages/desktop/src/components/ImportModal.svelte`: Reorder buttons to Cancel | Add Media | Create

## Consequences
- Cleaner button text without redundant prefix
- Primary action (Create) now in conventional rightmost position
- No functional changes
