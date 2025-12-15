#!/bin/bash
#
# AU Archive - Dependency Health Check
# Quick verification of all dependencies
#
# Usage: ./scripts/check-deps.sh
#

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}AU Archive - Dependency Check${NC}"
echo "════════════════════════════════════════════════════"
echo ""

# Detect platform
case "$(uname -s)" in
  Darwin*)  PLATFORM="macOS" ;;
  Linux*)   PLATFORM="Linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="Windows" ;;
  *)        PLATFORM="Unknown" ;;
esac

echo "Platform: $PLATFORM"
echo ""
echo "Required Dependencies:"
echo "──────────────────────────────────────────────────"

# Node.js
printf "  %-25s" "Node.js"
if command -v node >/dev/null 2>&1; then
  version=$(node --version)
  if [[ "$version" =~ ^v(1[8-9]|2[0-9]|[3-9][0-9]) ]]; then
    echo -e "${GREEN}✓${NC} $version"
  else
    echo -e "${YELLOW}⚠${NC} $version (recommend v18+)"
  fi
else
  echo -e "${RED}✗${NC} Not installed"
fi

# pnpm
printf "  %-25s" "pnpm"
if command -v pnpm >/dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} v$(pnpm --version)"
else
  echo -e "${RED}✗${NC} Not installed (npm install -g pnpm)"
fi

# Git
printf "  %-25s" "Git"
if command -v git >/dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} $(git --version | cut -d' ' -f3)"
else
  echo -e "${RED}✗${NC} Not installed"
fi

echo ""
echo "Optional Dependencies (Enhanced Features):"
echo "──────────────────────────────────────────────────"

# libpostal
printf "  %-25s" "libpostal"
libpostal_found=false
if [ "$PLATFORM" = "macOS" ] && command -v brew >/dev/null 2>&1; then
  if brew list libpostal &>/dev/null; then
    libpostal_found=true
  fi
elif ldconfig -p 2>/dev/null | grep -q libpostal || [ -f /usr/local/lib/libpostal.so ]; then
  libpostal_found=true
fi

if [ "$libpostal_found" = true ]; then
  echo -e "${GREEN}✓${NC} ML-powered address parsing"
else
  echo -e "${YELLOW}○${NC} Using regex fallback"
  echo "                            Install: brew install libpostal (macOS)"
fi

# ExifTool
printf "  %-25s" "ExifTool"
if command -v exiftool >/dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} v$(exiftool -ver)"
else
  echo -e "${YELLOW}○${NC} Metadata extraction limited"
  echo "                            Install: brew install exiftool (macOS)"
fi

# FFmpeg
printf "  %-25s" "FFmpeg"
if command -v ffmpeg >/dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} Installed"
else
  echo -e "${YELLOW}○${NC} Video processing disabled"
  echo "                            Install: brew install ffmpeg (macOS)"
fi

# ImageMagick (optional)
printf "  %-25s" "ImageMagick"
if command -v convert >/dev/null 2>&1 || command -v magick >/dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} Installed"
else
  echo -e "${YELLOW}○${NC} Optional image processing"
fi

echo ""
echo "──────────────────────────────────────────────────"
echo ""
echo "Legend: ${GREEN}✓${NC} Installed  ${YELLOW}○${NC} Optional/Fallback  ${RED}✗${NC} Missing"
echo ""

# Check if in the right directory
if [ -f "package.json" ] && grep -q "au-archive" package.json 2>/dev/null; then
  echo "Project: $(pwd)"

  # Check if node_modules exists
  if [ -d "node_modules" ]; then
    echo -e "Dependencies: ${GREEN}Installed${NC}"
  else
    echo -e "Dependencies: ${RED}Not installed${NC} (run: pnpm install)"
  fi
else
  echo -e "${YELLOW}Note: Run this from the project root directory${NC}"
fi

echo ""
