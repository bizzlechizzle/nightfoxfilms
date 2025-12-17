# Changelog

All notable changes to the Nightfox Films documentation repository will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for documentation versions.

---

## [Unreleased] - 2025-12-16

### Fixed - Desktop App Bug Fixes

**Camera Loans Section (CoupleDetail.svelte):**
- Fixed Camera Loans section showing on ALL couples with Date Night deliverables
- Now only shows when contract explicitly includes camera loan deliverable (`loaner_camera`, `camera_loan`, `loaner`, `guest_cam` codes)
- Or when existing loan records exist for the couple

**Import Progress Bar (Import.svelte):**
- Fixed progress bar not updating during imports
- Progress bar now uses correct property names from ImportController (`filesProcessed`, `filesTotal`, `currentFile`)
- Added fallbacks for backward compatibility with older progress events

**Network Error Handling (Import.svelte + preload):**
- Added `onPaused` and `onError` event handlers to preload script
- Import page now displays error/paused states with appropriate UI
- Network errors (ENOTCONN, etc.) now show user-friendly "Import Paused" message
- Added TypeScript types for new event data structures

**Pre-existing Type Errors (CoupleDetail.svelte):**
- Fixed `isDatePast` function used before declaration
- Fixed `hasRehearsalDinner` to check deliverables instead of non-existent property

**Copy Service Directory Creation (copy-service.ts):**
- Fixed silent `.catch(() => {})` swallowing mkdir errors
- Added comprehensive error logging for directory creation failures
- Added path existence checks for parent and grandparent directories
- Added logging for path construction (workingPath, folderName, tempDir)

**Import Path Construction (import-controller.ts):**
- Fixed baseStoragePath derivation to handle both cases:
  - When `working_path` is storage root (e.g., `/Volumes/nightfox`)
  - When `working_path` incorrectly contains folder name (e.g., `/Volumes/nightfox/couple-folder`)
- Added pre-copy verification that storage path exists and is accessible
- Added automatic couple folder creation if it doesn't exist
- Added detailed logging for path construction debugging
- Fixed thumbnail directory path derivation to use consistent baseStoragePath

### Changed
- Updated api.ts with new import event handler types
- Added error state CSS styles to Import.svelte
- Added fs import to import-controller.ts for path verification

---

## [1.0.0] - 2025-11-18

### Added - Experience Overhaul

**Core Documentation:**
- Created `claude.md` with comprehensive development principles (KISS, FAANG PE, BPL, BPA, NME, WWYDD, DRETW, LILBITS)
- Created `techguide.md` mapping all 50+ files and their dependencies (800+ lines)
- Created `lilbits.md` for documenting modular scripts following LILBITS principle
- Created `todo.md` with gap analysis and task tracking
- Created `STATUS-UPDATE.md` auditing CRITICAL-MISSING-PIECES.md (43% completed, 13% partial, 44% remaining)
- Created `CHANGELOG.md` (this file) for version tracking
- Updated `README.md` from empty placeholder to comprehensive 447-line project overview

**Repository Organization:**
- Created `.gitignore` to exclude OS cruft (.DS_Store, temp files, etc.)
- Created `archive/` directory with README for outdated content
- Moved `pages/` (Logseq notes) to `archive/pages/` (superseded by root .md files)
- Removed `.DS_Store` from repository
- Created organized `scripts/` directory structure (validation/, deployment/, utils/)
- Created `tests/` directory for future test files

**Automation Scripts:**
- Created `scripts/validation/validate-markdown.sh` - Functional link checker for all markdown files
- Created `scripts/deployment/launch.sh` - Template for website deployment (awaiting actual website)
- Created `scripts/deployment/health-check.sh` - Template for monitoring live website
- All scripts made executable and follow LILBITS principle (one script = one function)

**Documentation Quality:**
- Added "Last Updated" dates to all new core documentation files
- Established 11-step development process in claude.md
- Documented complete file dependency map in techguide.md
- Created comprehensive gap analysis showing why no launch script exists (documentation-only repo)

### Changed
- Updated repository structure from flat to organized hierarchy
- Improved documentation health from 0% to 100% for core files
- Repository now has clear separation between active docs and archived drafts

### Fixed
- Removed macOS `.DS_Store` file that should have been gitignored
- Archived duplicate Logseq notes that conflicted with polished documentation
- Established single source of truth for all documentation

### Technical Metrics
- **Files added:** 11 new files
- **Files archived:** 12 files moved to archive/
- **Lines of documentation added:** 3,856 lines
- **Scripts created:** 3 (1 functional, 2 templates)
- **Documentation coverage:** Core docs 100%, Strategy docs TBD

---

## [0.9.0] - 2025-11-17 and earlier

### Context
Prior to the 2025-11-18 overhaul, the repository contained excellent business strategy and website content documentation but lacked technical infrastructure.

### Existing (Pre-Overhaul)

**Strategy Documents:**
- `IMPLEMENTATION-SUMMARY.md` - Master implementation plan with ROI analysis
- `MASTER-IMPLEMENTATION-CHECKLIST.md` - 87-task checklist with 8-12 week timeline
- `QUICK-START-ACTION-PLAN.md` - 8-week tactical launch plan
- `CRITICAL-MISSING-PIECES.md` - Gap analysis (now audited in STATUS-UPDATE.md)
- `research-guide.md` - 1,122 lines of competitive analysis and SEO keywords
- `competitive-analysis.md` - Competitor breakdown and pricing comparison
- `developer-guide.md` - 2,562 lines of technical implementation guidance
- `rebrand.md` - Brand strategy and voice/tone guidelines
- `seo-implementation-guide.md` - Complete SEO strategy

**Website Content:**
- `wireframes/` - 7 complete page wireframes (home, services, about, FAQ)
- `copy/` - 6 pages of final website copy
- `sample-archive-posts/` - 2 example wedding archive post templates
- `blog-posts/` - 1 educational blog post (Super 8 vs Digital)
- `location-pages/` - 1 SEO-optimized location landing page (Buffalo)

**Client Systems:**
- `client-questionnaire-template.md` - Pre-wedding questionnaire (11 sections, 50+ questions)
- `consultation-call-script.md` - Sales call framework
- `contract-template-outline.md` - Service agreement template

**Marketing Materials:**
- `email-templates.md` - 10 email response templates
- `lead-nurture-email-sequence.md` - 5-email automated sequence
- `instagram-30-day-content-calendar.md` - 30 days of Instagram content
- `archive-blog-structure.md` - Template for SEO-optimized archive posts

**Pricing:**
- `pricing-sheet-2025.md` - Complete package pricing ($2,800-$6,400)

**Configuration:**
- `logseq/config.edn` - Logseq note-taking app configuration (now archived)

### What Was Missing (Pre-Overhaul)
- No README.md (only "# nightfoxfilms")
- No technical documentation explaining repository purpose
- No .gitignore (OS files like .DS_Store were committed)
- No file dependency map
- No development principles or process
- No automation scripts
- No version control for documentation
- Duplicate content in logseq/pages/ vs root .md files

---

## Version Numbering

This project uses Semantic Versioning for documentation:

**MAJOR.MINOR.PATCH**
- **MAJOR:** Significant restructuring or complete overhaul (1.0.0)
- **MINOR:** New features, substantial additions, or notable improvements (0.9.0 → 1.0.0)
- **PATCH:** Bug fixes, typo corrections, small updates (1.0.0 → 1.0.1)

Current version: **1.0.0** (2025-11-18)

---

## Categories

All changes are categorized as:
- **Added** - New files, features, or documentation
- **Changed** - Updates to existing documentation or structure
- **Deprecated** - Features or docs that will be removed soon
- **Removed** - Deleted files or features
- **Fixed** - Bug fixes or corrections
- **Security** - Security-related changes

---

## How to Contribute to Changelog

When making changes to the repository:

1. **Document in unreleased section:**
   Add your changes to an `## [Unreleased]` section at the top

2. **Categorize appropriately:**
   Use Added, Changed, Fixed, etc.

3. **Be specific:**
   Describe what changed and why, not just what you did

4. **Reference files:**
   Use backticks for file names: `filename.md`

5. **Date releases:**
   When ready to release, move [Unreleased] to a new version with date

---

## Future Releases (Planned)

### [1.1.0] - TBD
**Planned additions:**
- Additional location landing pages (Syracuse, Finger Lakes, Adirondacks)
- Weather contingency messaging for Super 8 service
- Photographer partnership strategy
- Portfolio/featured work page wireframe and copy
- Additional validation scripts (check-todos.sh, validate-pricing.sh)
- "Last Updated" dates added to all strategy documents

### [1.2.0] - TBD
**Planned additions:**
- Additional blog posts (Dad Cam vs Digital, etc.)
- Referral/loyalty program documentation
- Pinterest content strategy
- Expanded automation scripts (backup.sh, update-toc.sh)
- Pre-commit hooks for markdown linting

### [2.0.0] - TBD (When Website Launches)
**Major milestone:**
- Actual website implementation (platform TBD)
- Functional deployment scripts (launch.sh, health-check.sh)
- CI/CD pipeline
- Automated testing
- Live site monitoring

---

## Links

- [Repository](https://github.com/bizzlechizzle/nightfoxfilms)
- [Issue Tracker](https://github.com/bizzlechizzle/nightfoxfilms/issues)
- [Pull Requests](https://github.com/bizzlechizzle/nightfoxfilms/pulls)

---

**Maintained by:** Repository owner + AI assistants
**Review Schedule:** Update after every significant change or monthly (whichever comes first)
**Last Updated:** 2025-11-18
