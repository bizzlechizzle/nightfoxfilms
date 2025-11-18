# LILBITS - Script Documentation

**Last Updated:** 2025-11-18
**Purpose:** Document all modular scripts following the LILBITS principle (One script = one function)
**Status:** No scripts exist yet, this file will be populated as scripts are created

---

## What is LILBITS?

**LILBITS = Always Write Scripts in Little Bits**

Core principles:
- **One script = one function** - Each script does ONE thing well
- **Modular** - Scripts can be combined to create complex workflows
- **Composable** - Scripts accept standard input/output for chaining
- **Reusable** - Write once, use many times
- **Testable** - Easy to test individual components
- **Maintainable** - Easy to understand, debug, and replace

---

## Documentation Template

For each script created, add entry in this format:

```markdown
### script-name.sh / script-name.py

**Purpose:** [One sentence description]

**Location:** `/home/user/nightfoxfilms/scripts/script-name.sh`

**What it does:** [Detailed explanation]

**Inputs:**
- Parameter 1: [description, type, required/optional]
- Parameter 2: [description, type, required/optional]

**Outputs:**
- stdout: [what it prints]
- stderr: [error messages]
- Exit code: 0 = success, 1 = error

**Dependencies:**
- External tools: [e.g., grep, awk, jq]
- Other scripts: [scripts it calls]
- Files it reads: [configuration files, data files]

**Usage:**
```bash
./scripts/script-name.sh [param1] [param2]
```

**Example:**
```bash
./scripts/script-name.sh input.txt output.txt
# Output: Processed 100 lines, written to output.txt
```

**Error Codes:**
- 0: Success
- 1: Invalid arguments
- 2: File not found
- 3: Permission denied

**Used by:**
- [List scripts or workflows that call this script]

**Last Updated:** [Date]
```

---

## Script Index

### Validation Scripts

#### validate-markdown.sh
**Status:** NOT YET CREATED
**Priority:** HIGH
**Purpose:** Check all .md files for broken links, formatting errors

**Planned functionality:**
- Find all .md files in repository
- Check internal links (references to other .md files)
- Check external links (HTTP/HTTPS URLs)
- Validate markdown syntax
- Report broken/invalid links

**Should check:**
- Internal links: `[Text](./file.md)` - verify file exists
- External links: `[Text](https://...)` - verify URL returns 200
- Image links: `![Alt](./image.png)` - verify file exists
- Anchor links: `[Text](#section)` - verify section exists

**Output format:**
```
Checking: README.md... OK
Checking: techguide.md...
  WARNING: Broken link on line 42: ./missing-file.md
  ERROR: Invalid URL on line 156: https://broken-link.com
Checking: claude.md... OK

Summary:
  Total files: 52
  Files checked: 52
  Broken internal links: 1
  Broken external links: 1
  Errors: 2
  Warnings: 0
```

---

#### check-todos.sh
**Status:** NOT YET CREATED
**Priority:** MEDIUM
**Purpose:** Extract all TODO items from markdown files

**Planned functionality:**
- Find all .md files
- Search for TODO patterns: `- [ ]`, `TODO:`, `FIXME:`
- Extract context (surrounding lines)
- Generate consolidated todo list
- Optionally integrate with todo.md

**Should find:**
- Checkboxes: `- [ ] Task description`
- Comments: `<!-- TODO: Fix this -->`
- Tags: `TODO: Implement feature`
- Priority tags: `HIGH PRIORITY:`, `CRITICAL:`

**Output format:**
```
Found 27 TODO items across 15 files:

CRITICAL-MISSING-PIECES.md:
  - [ ] Add location landing pages (line 57)
  - [ ] Create photographer partnership strategy (line 134)

MASTER-IMPLEMENTATION-CHECKLIST.md:
  - [ ] Set up Google Analytics (line 63)
  - [ ] Test contact form (line 209)

...

Summary:
  Total TODO items: 27
  CRITICAL: 3
  HIGH: 8
  MEDIUM: 12
  LOW: 4
```

---

#### validate-pricing.sh
**Status:** NOT YET CREATED
**Priority:** HIGH
**Purpose:** Ensure pricing consistency across all files

**Planned functionality:**
- Read pricing from pricing-sheet-2025.md (source of truth)
- Search for price mentions in all copy/*.md files
- Detect inconsistencies
- Report mismatches

**Should detect:**
- Super 8 package price ($2,800)
- Dad Cam package price ($2,400)
- Modern Digital range ($2,800-$4,200)
- Mixed Media range ($4,800-$6,400)
- Travel fees
- Add-on pricing

**Output format:**
```
Source of truth: pricing-sheet-2025.md
  Super 8: $2,800
  Dad Cam: $2,400
  Modern Digital: $2,800-$4,200
  Mixed Media: $4,800-$6,400

Checking copy files...
  copy/super-8-page-copy.md: OK ($2,800 matches)
  copy/dad-cam-page-copy.md: WARNING (says $2,500, should be $2,400)
  copy/mixed-media-page-copy.md: OK

Summary:
  Files checked: 6
  Matches: 5
  Mismatches: 1
```

---

### Content Scripts

#### update-toc.sh
**Status:** NOT YET CREATED
**Priority:** MEDIUM
**Purpose:** Auto-generate table of contents for long docs

**Planned functionality:**
- Read markdown file
- Extract all headings (H1, H2, H3, etc.)
- Generate TOC with links
- Insert TOC after specific marker (e.g., `<!-- TOC -->`)
- Preserve existing content

**Should handle:**
- Nested heading levels
- Anchor link generation
- Duplicate heading names
- Special characters in headings

**Usage:**
```bash
./scripts/update-toc.sh techguide.md
./scripts/update-toc.sh developer-guide.md
./scripts/update-toc.sh --all  # Update all docs with TOC marker
```

---

#### export-to-cms.sh
**Status:** NOT YET CREATED (only if using headless CMS)
**Priority:** LOW (depends on website platform choice)
**Purpose:** Convert markdown to CMS format

**Planned functionality:**
- Read markdown from copy/*.md
- Convert to CMS format (JSON for Sanity, API calls for WordPress)
- Upload via CMS API
- Handle images and assets

**Depends on:** Website platform decision

---

### Deployment Scripts (If Custom Website Built)

#### deploy.sh
**Status:** NOT YET CREATED (only if custom build)
**Priority:** CRITICAL (if custom website)
**Purpose:** Deploy website to hosting

**Planned functionality:**
- Build website (if static site generator)
- Run tests
- Deploy to hosting (Vercel, Netlify, etc.)
- Verify deployment succeeded
- Rollback if deployment failed

**Pre-deployment checks:**
- All tests pass
- No broken links
- Pricing is consistent
- Meta tags are present

**Usage:**
```bash
./scripts/deploy.sh production
./scripts/deploy.sh staging
```

---

#### health-check.sh
**Status:** NOT YET CREATED (only if website exists)
**Priority:** HIGH (if custom website)
**Purpose:** Verify website is live and functional

**Planned functionality:**
- Check all pages return 200 status
- Verify contact form works
- Check analytics tracking
- Verify SSL certificate valid
- Test key user flows

**Checks:**
- Home page loads
- All service pages load
- Contact form submits
- Pricing page displays correctly
- Archive posts accessible
- No 404 errors on main pages

**Output:**
```
Checking website health...
  [✓] Home page: 200 OK (156ms)
  [✓] Super 8 page: 200 OK (142ms)
  [✓] Contact form: Submission successful
  [✓] SSL certificate: Valid until 2026-11-18
  [✗] Analytics: GA4 not tracking (no pageviews)

Summary:
  Total checks: 15
  Passed: 14
  Failed: 1
  Overall status: WARNING
```

---

### Utility Scripts

#### backup-docs.sh
**Status:** NOT YET CREATED
**Priority:** MEDIUM
**Purpose:** Backup all documentation to external location

**Planned functionality:**
- Create timestamped archive of all .md files
- Compress to tar.gz
- Copy to backup location (external drive, cloud storage)
- Verify backup integrity
- Rotate old backups (keep last 10)

**Usage:**
```bash
./scripts/backup-docs.sh /path/to/backup/location
```

---

#### find-duplicates.sh
**Status:** NOT YET CREATED
**Priority:** LOW
**Purpose:** Find duplicate or very similar content across files

**Planned functionality:**
- Compare all .md files
- Detect duplicate paragraphs
- Flag files with >80% similar content
- Help identify what can be archived

---

## Script Organization

### Recommended Directory Structure

```
/nightfoxfilms/
├── scripts/
│   ├── validation/
│   │   ├── validate-markdown.sh
│   │   ├── check-todos.sh
│   │   └── validate-pricing.sh
│   │
│   ├── content/
│   │   ├── update-toc.sh
│   │   └── export-to-cms.sh
│   │
│   ├── deployment/
│   │   ├── deploy.sh
│   │   └── health-check.sh
│   │
│   └── utils/
│       ├── backup-docs.sh
│       └── find-duplicates.sh
│
└── tests/
    ├── test-validate-markdown.sh
    ├── test-check-todos.sh
    └── test-validate-pricing.sh
```

### Script Naming Conventions

- Use kebab-case: `validate-markdown.sh` not `validateMarkdown.sh`
- Verb-noun pattern: `check-todos.sh`, `update-toc.sh`, `deploy-site.sh`
- File extension indicates language: `.sh` (bash), `.py` (Python), `.js` (Node.js)
- One file = one script (no multi-script files)

---

## Writing New Scripts

### Process (Following claude.md)

When creating a new script:

1. **Define purpose** - What does it do? (one sentence)
2. **Design interface** - Inputs, outputs, error codes
3. **Check for existing solutions** (DRETW principle)
4. **Write the script** (KISS, BPL, BPA)
5. **Test thoroughly** - Happy path and error cases
6. **Document in lilbits.md** (this file)
7. **Update techguide.md** - Add to file map
8. **Create tests** - Unit tests in tests/ directory

### Template: Bash Script

```bash
#!/usr/bin/env bash
#
# Script Name: script-name.sh
# Purpose: [One sentence description]
# Usage: ./script-name.sh [arguments]
# Dependencies: [list tools]
# Exit codes: 0=success, 1=error, 2=invalid args
#
# Last Updated: YYYY-MM-DD

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Constants
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Functions
usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] ARG1 ARG2

Description of what this script does.

OPTIONS:
    -h, --help      Show this help message
    -v, --verbose   Enable verbose output

ARGUMENTS:
    ARG1            Description of arg1
    ARG2            Description of arg2

EXAMPLES:
    $(basename "$0") input.txt output.txt
    $(basename "$0") --verbose data.md

EOF
}

main() {
    # Script logic here
    echo "Script running..."
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--verbose)
            VERBOSE=1
            shift
            ;;
        *)
            # Positional argument
            ARGS+=("$1")
            shift
            ;;
    esac
done

# Validate arguments
if [[ ${#ARGS[@]} -lt 2 ]]; then
    echo "ERROR: Missing required arguments" >&2
    usage
    exit 2
fi

# Run main function
main "${ARGS[@]}"
```

### Template: Python Script

```python
#!/usr/bin/env python3
"""
Script Name: script_name.py
Purpose: [One sentence description]
Usage: python3 script_name.py [arguments]
Dependencies: [list packages]
Exit codes: 0=success, 1=error, 2=invalid args

Last Updated: YYYY-MM-DD
"""

import sys
import argparse
from pathlib import Path

# Constants
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent


def main(args):
    """Main script logic."""
    print(f"Processing {args.input}...")
    # Script logic here
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="[Script description]"
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Input file path"
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose output"
    )

    args = parser.parse_args()

    try:
        sys.exit(main(args))
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
```

---

## Testing Scripts

### Test File Template

```bash
#!/usr/bin/env bash
#
# Test suite for: script-name.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/../scripts/script-name.sh"

# Test counter
TESTS_RUN=0
TESTS_PASSED=0

test_happy_path() {
    echo "TEST: Happy path..."
    TESTS_RUN=$((TESTS_RUN + 1))

    # Run script
    output=$("${SCRIPT}" arg1 arg2 2>&1)

    # Assert
    if [[ "${output}" == *"expected"* ]]; then
        echo "  PASS"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "  FAIL: Unexpected output"
    fi
}

test_error_handling() {
    echo "TEST: Error handling..."
    TESTS_RUN=$((TESTS_RUN + 1))

    # Should fail with invalid args
    if "${SCRIPT}" invalid 2>/dev/null; then
        echo "  FAIL: Should have errored"
    else
        echo "  PASS"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    fi
}

# Run tests
test_happy_path
test_error_handling

# Summary
echo ""
echo "Tests run: ${TESTS_RUN}"
echo "Tests passed: ${TESTS_PASSED}"
echo "Tests failed: $((TESTS_RUN - TESTS_PASSED))"

if [[ ${TESTS_RUN} -eq ${TESTS_PASSED} ]]; then
    echo "All tests passed!"
    exit 0
else
    echo "Some tests failed!"
    exit 1
fi
```

---

## Integration with Makefile

### Recommended Makefile Targets

```makefile
.PHONY: help validate test deploy

help:
	@echo "Available commands:"
	@echo "  make validate   - Run all validation scripts"
	@echo "  make test       - Run all tests"
	@echo "  make deploy     - Deploy website"
	@echo "  make backup     - Backup all documentation"

validate:
	@echo "Running validation scripts..."
	@./scripts/validation/validate-markdown.sh
	@./scripts/validation/check-todos.sh
	@./scripts/validation/validate-pricing.sh

test:
	@echo "Running tests..."
	@./tests/test-validate-markdown.sh
	@./tests/test-check-todos.sh
	@./tests/test-validate-pricing.sh

deploy:
	@echo "Deploying website..."
	@./scripts/deployment/deploy.sh production

backup:
	@echo "Creating backup..."
	@./scripts/utils/backup-docs.sh ./backups
```

---

## Script Status Tracker

| Script | Status | Priority | Estimated Effort |
|--------|--------|----------|------------------|
| validate-markdown.sh | NOT CREATED | HIGH | 4 hours |
| check-todos.sh | NOT CREATED | MEDIUM | 2 hours |
| validate-pricing.sh | NOT CREATED | HIGH | 3 hours |
| update-toc.sh | NOT CREATED | MEDIUM | 3 hours |
| export-to-cms.sh | NOT CREATED | LOW | 6 hours (depends on platform) |
| deploy.sh | NOT CREATED | CRITICAL* | 8 hours |
| health-check.sh | NOT CREATED | HIGH* | 4 hours |
| backup-docs.sh | NOT CREATED | MEDIUM | 2 hours |
| find-duplicates.sh | NOT CREATED | LOW | 4 hours |

*Only if custom website is built (not needed for Squarespace/WordPress)

**Total estimated effort:** 32-36 hours for all scripts

---

## Next Steps

1. **Immediate:** Create validate-markdown.sh (high value, quick win)
2. **Short-term:** Create check-todos.sh and validate-pricing.sh
3. **Decision-dependent:** Wait on deploy.sh until website platform chosen
4. **Long-term:** Build remaining utility scripts as needed

---

**Last Updated:** 2025-11-18
**Scripts Created:** 0
**Scripts Planned:** 9
**Next Script to Build:** validate-markdown.sh
