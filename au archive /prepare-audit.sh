#!/bin/bash

# ============================================================================
# AU Archive Audit Preparation Script
# ============================================================================
# This script prepares all files needed for the full codebase audit.
# Run this from your au-archive project root directory.
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}       AU Archive - Audit Preparation Script                    ${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Configuration - EDIT THESE PATHS IF NEEDED
PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
OUTPUT_DIR="${OUTPUT_DIR:-$HOME/Desktop/au-archive-audit}"
SPEC_DOCS_DIR="${SPEC_DOCS_DIR:-$HOME/Documents}"  # Where your spec docs are

# Create output directory
echo -e "${YELLOW}[1/5]${NC} Creating output directory..."
mkdir -p "$OUTPUT_DIR"
echo -e "      ${GREEN}✓${NC} Created: $OUTPUT_DIR"

# Zip the codebase
echo ""
echo -e "${YELLOW}[2/5]${NC} Zipping packages/desktop folder..."

if [ -d "$PROJECT_ROOT/packages/desktop" ]; then
    cd "$PROJECT_ROOT"
    
    # Remove old zip if exists
    rm -f "$OUTPUT_DIR/au-archive-codebase.zip"
    
    # Create zip excluding node_modules, dist, and other build artifacts
    zip -r "$OUTPUT_DIR/au-archive-codebase.zip" packages/desktop \
        -x "*/node_modules/*" \
        -x "*/.git/*" \
        -x "*/dist/*" \
        -x "*/dist-electron/*" \
        -x "*/.svelte-kit/*" \
        -x "*/coverage/*" \
        -x "*/*.log" \
        -x "*/.DS_Store" \
        -x "*/Thumbs.db"
    
    ZIP_SIZE=$(du -h "$OUTPUT_DIR/au-archive-codebase.zip" | cut -f1)
    echo -e "      ${GREEN}✓${NC} Created: au-archive-codebase.zip ($ZIP_SIZE)"
else
    echo -e "      ${RED}✗${NC} ERROR: packages/desktop not found at $PROJECT_ROOT"
    echo -e "      ${RED}  Please run this script from your au-archive root directory${NC}"
    exit 1
fi

# Copy spec documents
echo ""
echo -e "${YELLOW}[3/5]${NC} Looking for spec documents..."

SPEC_FILES=(
    "AU-ARCHIVE-AUDIT-PROMPT.md"
    "AU-ARCHIVE-IMPLEMENTATION-CHECKLIST.md"
    "import-v2-implementation-guide.md"
    "FULL-AUDIT-COMMAND.md"
)

FOUND_COUNT=0
SEARCH_PATHS=(
    "$SPEC_DOCS_DIR"
    "$HOME/Downloads"
    "$HOME/Desktop"
    "$PROJECT_ROOT"
    "$PROJECT_ROOT/docs"
    "."
)

for spec_file in "${SPEC_FILES[@]}"; do
    FOUND=false
    for search_path in "${SEARCH_PATHS[@]}"; do
        if [ -f "$search_path/$spec_file" ]; then
            cp "$search_path/$spec_file" "$OUTPUT_DIR/"
            echo -e "      ${GREEN}✓${NC} Found & copied: $spec_file"
            FOUND=true
            ((FOUND_COUNT++))
            break
        fi
    done
    if [ "$FOUND" = false ]; then
        echo -e "      ${RED}✗${NC} NOT FOUND: $spec_file"
    fi
done

# Generate file manifest
echo ""
echo -e "${YELLOW}[4/5]${NC} Generating codebase manifest..."

cd "$PROJECT_ROOT"
cat > "$OUTPUT_DIR/CODEBASE-MANIFEST.txt" << 'EOF'
AU Archive Codebase Manifest
Generated: $(date)
============================================================================

DIRECTORY STRUCTURE:
EOF

# Add directory tree
if command -v tree &> /dev/null; then
    tree -I 'node_modules|dist|dist-electron|.svelte-kit|coverage' packages/desktop >> "$OUTPUT_DIR/CODEBASE-MANIFEST.txt" 2>/dev/null || true
else
    find packages/desktop -type f \
        -not -path "*/node_modules/*" \
        -not -path "*/dist/*" \
        -not -path "*/dist-electron/*" \
        -not -path "*/.svelte-kit/*" \
        | head -500 >> "$OUTPUT_DIR/CODEBASE-MANIFEST.txt"
fi

echo -e "      ${GREEN}✓${NC} Created: CODEBASE-MANIFEST.txt"

# Summary
echo ""
echo -e "${YELLOW}[5/5]${NC} Summary..."
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}AUDIT PACKAGE READY${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Output directory: $OUTPUT_DIR"
echo ""
echo "Files prepared:"
ls -lah "$OUTPUT_DIR"
echo ""

if [ $FOUND_COUNT -lt 4 ]; then
    echo -e "${YELLOW}⚠️  WARNING: Only $FOUND_COUNT of 4 spec documents found.${NC}"
    echo ""
    echo "Missing spec docs should be placed in one of these locations:"
    echo "  - $SPEC_DOCS_DIR"
    echo "  - $HOME/Downloads"
    echo "  - $HOME/Desktop"
    echo "  - $PROJECT_ROOT/docs"
    echo ""
fi

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}NEXT STEPS:${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "1. Open Claude (claude.ai) in a new conversation"
echo ""
echo "2. Attach these files from $OUTPUT_DIR:"
echo "   • au-archive-codebase.zip"
echo "   • AU-ARCHIVE-AUDIT-PROMPT.md"
echo "   • AU-ARCHIVE-IMPLEMENTATION-CHECKLIST.md"
echo "   • import-v2-implementation-guide.md"
echo ""
echo "3. Copy the contents of FULL-AUDIT-COMMAND.md and paste as your message"
echo ""
echo "4. Let the audit run (expect 5,000+ words of output)"
echo ""

# Open the output folder
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Opening output folder..."
    open "$OUTPUT_DIR"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$OUTPUT_DIR" 2>/dev/null || true
fi

echo -e "${GREEN}Done!${NC}"
echo ""
