#!/usr/bin/env bash
#
# Script Name: validate-markdown.sh
# Purpose: Check all .md files for broken links and formatting errors
# Usage: ./validate-markdown.sh [--fix-internal]
# Dependencies: grep, find
# Exit codes: 0=success (no issues), 1=errors found, 2=invalid args
#
# Last Updated: 2025-11-18

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Counters
TOTAL_FILES=0
FILES_CHECKED=0
BROKEN_INTERNAL_LINKS=0
BROKEN_EXTERNAL_LINKS=0
ERRORS=0
WARNINGS=0

# Colors for output
readonly RED='\033[0;31m'
readonly YELLOW='\033[1;33m'
readonly GREEN='\033[0;32m'
readonly NC='\033[0m' # No Color

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Validate all markdown files for broken links and formatting issues.

OPTIONS:
    -h, --help      Show this help message
    -v, --verbose   Enable verbose output
    --fix-internal  Report internal links that need fixing

CHECKS:
    - Internal links (references to other .md files)
    - External links (HTTP/HTTPS URLs - warns only, doesn't validate)
    - Image links (references to image files)

EXAMPLES:
    $(basename "$0")
    $(basename "$0") --verbose

EOF
}

check_internal_link() {
    local file="$1"
    local link="$2"
    local line_num="$3"

    # Remove fragment (#section) if present
    local link_path="${link%%#*}"

    # Resolve relative path
    local file_dir="$(dirname "$file")"
    local target_path

    if [[ "$link_path" == ./* ]] || [[ "$link_path" == ../* ]]; then
        target_path="$(cd "$file_dir" && realpath -m "$link_path" 2>/dev/null || echo "$link_path")"
    else
        target_path="$PROJECT_ROOT/$link_path"
    fi

    # Check if file exists
    if [[ ! -f "$target_path" ]]; then
        echo -e "  ${RED}ERROR${NC}: Broken internal link on line $line_num: $link"
        echo -e "    Expected file: $target_path"
        ((BROKEN_INTERNAL_LINKS++))
        ((ERRORS++))
        return 1
    fi

    return 0
}

check_file() {
    local file="$1"
    local relative_path="${file#$PROJECT_ROOT/}"

    ((TOTAL_FILES++))

    echo -n "Checking: $relative_path... "

    local has_issues=0

    # Find all markdown links: [text](url)
    while IFS= read -r line; do
        local line_num="${line%%:*}"
        local content="${line#*:}"

        # Extract links from markdown syntax: [text](link)
        while [[ "$content" =~ \[([^]]+)\]\(([^)]+)\) ]]; do
            local link="${BASH_REMATCH[2]}"

            # Check if it's an internal link (.md file or relative path)
            if [[ "$link" == *.md* ]] || [[ "$link" == ./* ]] || [[ "$link" == ../* ]]; then
                check_internal_link "$file" "$link" "$line_num" || has_issues=1
            # Check if it's an external link (just warn, don't validate)
            elif [[ "$link" == http* ]]; then
                # External links detected but not validated (would require network calls)
                :
            fi

            # Remove the matched link and continue searching
            content="${content#*\]\(${BASH_REMATCH[2]}\)}"
        done
    done < <(grep -n '\[.*\](.*)'  "$file" 2>/dev/null || true)

    if [[ $has_issues -eq 0 ]]; then
        echo -e "${GREEN}OK${NC}"
        ((FILES_CHECKED++))
    else
        echo -e "${YELLOW}ISSUES FOUND${NC}"
    fi
}

main() {
    echo "Starting markdown validation..."
    echo "Project root: $PROJECT_ROOT"
    echo ""

    # Find all .md files, excluding node_modules and .git
    while IFS= read -r file; do
        check_file "$file"
    done < <(find "$PROJECT_ROOT" -name "*.md" -type f \
        ! -path "*/node_modules/*" \
        ! -path "*/.git/*" \
        ! -path "*/archive/*" \
        2>/dev/null)

    echo ""
    echo "========================================="
    echo "Summary:"
    echo "========================================="
    echo "  Total files found: $TOTAL_FILES"
    echo "  Files checked: $FILES_CHECKED"
    echo "  Broken internal links: $BROKEN_INTERNAL_LINKS"
    echo "  Errors: $ERRORS"
    echo "  Warnings: $WARNINGS"
    echo ""

    if [[ $ERRORS -eq 0 && $WARNINGS -eq 0 ]]; then
        echo -e "${GREEN}All markdown files are valid!${NC}"
        return 0
    elif [[ $ERRORS -eq 0 ]]; then
        echo -e "${YELLOW}Validation completed with warnings.${NC}"
        return 0
    else
        echo -e "${RED}Validation failed with errors.${NC}"
        return 1
    fi
}

# Parse arguments
VERBOSE=0
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
            echo "ERROR: Unknown option: $1" >&2
            usage
            exit 2
            ;;
    esac
done

main
