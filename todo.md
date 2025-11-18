# TODO - Nightfox Films Repository Improvements

**Last Updated:** 2025-11-18
**Purpose:** Track technical debt, documentation gaps, and improvement opportunities

---

## CRITICAL - Do Immediately

### Documentation Gaps
- [x] Create this todo.md
- [x] Create claude.md with core principles and development process
- [x] Create comprehensive techguide.md mapping all files and dependencies
- [x] Update README.md from empty placeholder to comprehensive overview
- [x] Create lilbits.md for documenting modular scripts (when they exist)

### Technical Debt
- [x] Create .gitignore file (exclude .DS_Store, logseq cache, OS cruft)
- [x] Remove .DS_Store file from repository
- [x] Create archive/ directory for outdated or redundant files

### Repository Organization
- [x] Move logseq/pages content to archive (duplicates root .md files)
- [x] Audit CRITICAL-MISSING-PIECES.md (many items have been completed, update status) - See STATUS-UPDATE.md
- [x] Create CHANGELOG.md to track major documentation updates

---

## HIGH PRIORITY - Do This Week

### Automation Scripts
- [x] Create validate-markdown.sh - Check all .md files for broken links
- [ ] Create check-todos.sh - Extract all TODO items from markdown files
- [ ] Create update-toc.sh - Auto-generate table of contents for long docs
- [ ] Create backup.sh - Backup documentation to external location

### Documentation Improvements
- [x] Add "Last Updated" dates to all major strategy documents
- [ ] Create quick-reference.md - One-page cheat sheet of all key info
- [ ] Create file-map.md - Visual diagram of file relationships
- [ ] Add version numbers to pricing-sheet-2025.md and other evolving docs

### Content Validation
- [ ] Verify all internal links work (between .md files)
- [ ] Check for outdated information (dates, pricing, contact info)
- [ ] Ensure consistency across wireframes vs copy files
- [ ] Proofread all documents for typos and formatting

---

## MEDIUM PRIORITY - Do This Month

### Website Implementation
- [ ] DECISION: Choose website platform (Squarespace, Webflow, WordPress, or custom)
- [ ] If custom build: Create separate code repository
- [x] If custom build: Create deployment scripts (launch.sh, health-check.sh) - TEMPLATES CREATED
- [ ] If custom build: Set up CI/CD pipeline (GitHub Actions)

### Repository Hygiene
- [ ] Review all files - identify which can be archived
- [ ] Create docs/ directory - move all .md files there for better organization
- [ ] Create templates/ directory - separate wireframes, copy, examples
- [ ] Add LICENSE file (if open-sourcing any content)

### Developer Experience
- [ ] Create CONTRIBUTING.md (if others will edit documentation)
- [ ] Add pre-commit hooks (markdown linting, link checking)
- [ ] Create Makefile for common tasks (validate, build-toc, etc.)
- [ ] Document folder structure in README.md

---

## LOW PRIORITY - Nice to Have

### Advanced Automation
- [ ] Create script to convert wireframes to HTML templates
- [ ] Build markdown-to-PDF generator for client deliverables
- [ ] Create screenshot tool for documenting website progress
- [ ] Set up automated backups (daily git push to backup remote)

### Documentation Enhancements
- [ ] Add visual diagrams (client journey, content hierarchy, file relationships)
- [ ] Create video walkthrough of repository structure
- [ ] Build searchable index of all documents
- [ ] Add keyword tags to each document for easy searching

### Integration Ideas
- [ ] Connect repo to project management tool (Notion, Airtable)
- [ ] Create webhook to notify when documentation updates
- [ ] Build simple web interface to browse documentation
- [ ] Export key documents to other formats (PDF, Notion, Google Docs)

---

## COMPLETED
- [x] Comprehensive exploration and audit of repository (2025-11-18)
- [x] Identified why no launch script exists (documentation-only repo)
- [x] Documented all major gaps in project structure
- [x] Created master todo list (this file)
- [x] Created claude.md with all core principles and 11-step process (2025-11-18)
- [x] Created techguide.md mapping all 50+ files and dependencies (2025-11-18)
- [x] Updated README.md from empty to comprehensive (2025-11-18)
- [x] Created lilbits.md for script documentation (2025-11-18)
- [x] Created .gitignore file (2025-11-18)
- [x] Removed .DS_Store from repository (2025-11-18)
- [x] Created archive/ directory (2025-11-18)
- [x] Moved pages/ to archive/pages/ (2025-11-18)
- [x] Created scripts directory structure (validation/, deployment/, utils/) (2025-11-18)
- [x] Created validate-markdown.sh script (2025-11-18)
- [x] Created launch.sh template for deployment (2025-11-18)
- [x] Created health-check.sh template for monitoring (2025-11-18)
- [x] Audited CRITICAL-MISSING-PIECES.md - created STATUS-UPDATE.md (2025-11-18)
- [x] Updated todo.md with all completed items and current metrics (2025-11-18)
- [x] Created CHANGELOG.md for version tracking (2025-11-18)
- [x] Added "Last Updated" dates to all major strategy documents (2025-11-18)
- [x] Verified cross-references between core docs (claude.md, techguide.md, lilbits.md, README.md, todo.md) (2025-11-18)

---

## GAPS IDENTIFIED

### Why No Launch Script Exists
**Finding:** This repository contains ZERO executable code. It is a documentation/strategy repository for a wedding videography business.

**What exists:**
- Website wireframes (structure)
- Website copy (content)
- Business strategy documents
- Marketing templates
- Client management systems

**What does NOT exist:**
- No HTML/CSS/JavaScript code
- No Python/Ruby/Node.js scripts
- No build system or package manager
- No deployment configuration
- No CI/CD pipelines

**Conclusion:** Cannot create a "launch script" because there is nothing to launch. The website must first be built on a platform (Squarespace, WordPress, custom) before deployment scripts make sense.

### Other Major Gaps

**1. Empty README.md** - RESOLVED ✓
- Status: COMPLETED (2025-11-18)
- Now contains: Comprehensive project overview, structure, usage guides, next steps

**2. No .gitignore** - RESOLVED ✓
- Status: COMPLETED (2025-11-18)
- Created .gitignore excluding: .DS_Store, OS files, node_modules, temp files
- Removed .DS_Store from repository

**3. Duplicate Content** - RESOLVED ✓
- Status: COMPLETED (2025-11-18)
- Created archive/ directory with README
- Moved pages/ to archive/pages/
- Root .md files remain as authoritative source

**4. No Technical Documentation** - RESOLVED ✓
- Status: COMPLETED (2025-11-18)
- Created claude.md (development principles and process)
- Created techguide.md (complete file map and relationships)
- Created lilbits.md (script documentation system)

**5. No Version Control for Docs** - PARTIALLY RESOLVED
- Status: IN PROGRESS
- ✓ "Last Updated" dates added to core docs (claude.md, techguide.md, lilbits.md, todo.md, README.md)
- ✗ CHANGELOG.md not yet created (TODO)
- ✗ Version numbers not added to strategy docs (TODO)

**6. Outdated Status Tracking** - NOT YET RESOLVED
- Status: TODO
- CRITICAL-MISSING-PIECES.md still needs audit
- Should update status: what's done vs still missing

---

## RECOMMENDATIONS

### Immediate Next Steps

**1. Create Core Documentation (this sprint):**
- claude.md - Development principles and process
- techguide.md - Complete file map and relationships
- README.md - Comprehensive project overview
- lilbits.md - Script documentation system (for future scripts)

**2. Add Basic Automation (next sprint):**
- .gitignore file
- validate-markdown.sh script
- Pre-commit hooks for documentation quality

**3. Archive Cleanup (next sprint):**
- Create archive/ directory
- Move logseq/pages to archive
- Move .DS_Store to trash (don't commit)
- Update CRITICAL-MISSING-PIECES.md status

### Long-Term Vision

**If Building Custom Website:**
1. Create separate /website repository with actual code
2. Add this repo as submodule for content
3. Build deployment pipeline: docs → CMS → website
4. Create health-check.sh for monitoring
5. Add launch.sh for one-command deployment

**If Using Platform (Squarespace/WordPress):**
1. Keep this repo as documentation only
2. Add scripts to export content to platform format
3. Create backup scripts to archive live site
4. Document deployment process in techguide.md

---

## DECISION LOG

**Decisions Needed:**
- [ ] Website platform choice (custom vs Squarespace vs WordPress)
- [ ] Should documentation stay in root or move to docs/ directory?
- [ ] Keep logseq folder or archive it completely?
- [ ] Open source any of this content or keep private?

**Decisions Made:**
- [x] Repository will remain documentation-focused (not code)
- [x] Will create comprehensive technical documentation
- [x] Will add .gitignore and basic automation
- [x] Will archive duplicate/outdated content

---

## TRACKING METRICS

**Documentation Health:**
- Total .md files: 50+ (including new core docs)
- Files with "Last Updated" date: 5 / 50+ (claude.md, techguide.md, lilbits.md, todo.md, README.md)
- Files with version numbers: 1 / 50+ (pricing-sheet-2025.md)
- Broken internal links: Can now be checked with validate-markdown.sh
- Outdated content: Need manual audit

**Repository Health:**
- .gitignore exists: Yes (created 2025-11-18)
- README.md complete: Yes (comprehensive overview created)
- Technical docs exist: Yes (claude.md, techguide.md, lilbits.md created)
- Automation scripts: 3 (validate-markdown.sh, launch.sh template, health-check.sh template)
- Unneeded files in repo: No (archived to archive/ directory)
- Archive directory: Yes (archive/ with README)

**Target State:**
- All strategy docs have "Last Updated" dates
- README.md is comprehensive
- All technical documentation exists
- 3+ automation scripts for validation
- Zero cruft files in repository
- Clear separation: polished docs vs archived drafts

---

## NOTES

**Repository Type:** Documentation/Strategy (NOT code)
**Primary Purpose:** Business planning and website content for Nightfox Films
**Secondary Purpose:** Reference material for building website on external platform
**Current State:** Excellent strategy, missing technical documentation
**Target State:** Excellent strategy + excellent technical documentation + basic automation

---

**Next Review Date:** 2025-11-25 (review progress, update status)
