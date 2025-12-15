# v0.1.0-alpha macOS Build — Complete Resolution

## Overview

This prompt will diagnose, fix, and complete the macOS build. No partial solutions — the output is a working .dmg file.

---

```
You are building the macOS alpha release for Abandoned Archive v0.1.0-alpha.

READ FIRST — IN THIS ORDER:
1. @CLAUDE.md (complete file)
2. @techguide.md
3. @packages/desktop/package.json

YOUR TASK: Diagnose, fix, and complete the macOS build. Do not stop until a working .dmg exists.

---

## PHASE 1: Diagnose Current State

### 1.1 Check What Exists

```bash
# Project structure
ls -la packages/desktop/

# Build config
cat packages/desktop/package.json | grep -A 50 '"build"'
cat packages/desktop/electron-builder.yml 2>/dev/null || echo "No electron-builder.yml"
cat packages/desktop/electron-builder.json 2>/dev/null || echo "No electron-builder.json"

# Icon files
ls -la packages/desktop/build/ 2>/dev/null || echo "No build directory"
ls -la build/ 2>/dev/null || echo "No root build directory"
find . -name "*.icns" -o -name "*icon*.png" 2>/dev/null | grep -v node_modules

# electron-builder installed?
cat packages/desktop/package.json | grep electron-builder

# Current dist output
ls -la packages/desktop/dist/ 2>/dev/null || echo "No dist directory"
ls -la packages/desktop/release/ 2>/dev/null || echo "No release directory"
```

### 1.2 Check Previous Build Attempts

```bash
# Any error logs?
cat packages/desktop/release/*.log 2>/dev/null || echo "No build logs"

# Check for common issues
cat packages/desktop/package.json | grep '"main"'
cat packages/desktop/package.json | grep '"version"'
```

### 1.3 Document Current State

| Item | Status | Path/Value |
|------|--------|------------|
| electron-builder installed | | |
| Build config location | | |
| Icon file (.icns) exists | | |
| Icon file (.png source) exists | | |
| entitlements.plist exists | | |
| package.json "main" field | | |
| package.json version | | |
| pnpm build works | | |
| Previous build errors | | |

---

## PHASE 2: Fix All Issues

Based on diagnosis, fix EVERY issue found.

### 2.1 Create Build Directory Structure

```bash
mkdir -p packages/desktop/build
```

### 2.2 Icon Setup

If .icns doesn't exist, create from PNG:

```bash
# Find the source icon
find . -name "*icon*.png" -o -name "*logo*.png" | grep -v node_modules | head -5

# If icon exists, convert it (replace PATH_TO_ICON with actual path)
# Minimum 1024x1024 required
```

Create icon conversion script `packages/desktop/scripts/create-icons.sh`:

```bash
#!/bin/bash
set -e

ICON_SOURCE="$1"
OUTPUT_DIR="packages/desktop/build"

if [ -z "$ICON_SOURCE" ]; then
    echo "Usage: ./create-icons.sh <path-to-1024x1024-png>"
    exit 1
fi

if [ ! -f "$ICON_SOURCE" ]; then
    echo "Error: Icon file not found: $ICON_SOURCE"
    exit 1
fi

# Check dimensions
DIMENSIONS=$(sips -g pixelWidth -g pixelHeight "$ICON_SOURCE" | grep pixel | awk '{print $2}')
echo "Icon dimensions: $DIMENSIONS"

mkdir -p "$OUTPUT_DIR/icon.iconset"

# Generate all required sizes
sips -z 16 16     "$ICON_SOURCE" --out "$OUTPUT_DIR/icon.iconset/icon_16x16.png"
sips -z 32 32     "$ICON_SOURCE" --out "$OUTPUT_DIR/icon.iconset/icon_16x16@2x.png"
sips -z 32 32     "$ICON_SOURCE" --out "$OUTPUT_DIR/icon.iconset/icon_32x32.png"
sips -z 64 64     "$ICON_SOURCE" --out "$OUTPUT_DIR/icon.iconset/icon_32x32@2x.png"
sips -z 128 128   "$ICON_SOURCE" --out "$OUTPUT_DIR/icon.iconset/icon_128x128.png"
sips -z 256 256   "$ICON_SOURCE" --out "$OUTPUT_DIR/icon.iconset/icon_128x128@2x.png"
sips -z 256 256   "$ICON_SOURCE" --out "$OUTPUT_DIR/icon.iconset/icon_256x256.png"
sips -z 512 512   "$ICON_SOURCE" --out "$OUTPUT_DIR/icon.iconset/icon_256x256@2x.png"
sips -z 512 512   "$ICON_SOURCE" --out "$OUTPUT_DIR/icon.iconset/icon_512x512.png"
sips -z 1024 1024 "$ICON_SOURCE" --out "$OUTPUT_DIR/icon.iconset/icon_512x512@2x.png"

# Create .icns
iconutil -c icns "$OUTPUT_DIR/icon.iconset" -o "$OUTPUT_DIR/icon.icns"

echo "Created: $OUTPUT_DIR/icon.icns"
ls -la "$OUTPUT_DIR/icon.icns"
```

Run it:
```bash
chmod +x packages/desktop/scripts/create-icons.sh
./packages/desktop/scripts/create-icons.sh /path/to/abandoned-upstate-icon.png
```

### 2.3 Create Entitlements

Create `packages/desktop/build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.files.downloads.read-write</key>
    <true/>
</dict>
</plist>
```

### 2.4 Install electron-builder

```bash
cd packages/desktop
pnpm add -D electron-builder
```

### 2.5 Configure electron-builder

Create or update `packages/desktop/electron-builder.yml`:

```yaml
appId: com.abandonedarchive.app
productName: Abandoned Archive
copyright: Copyright © 2025

directories:
  output: release
  buildResources: build

files:
  - dist/**/*
  - package.json
  - "!**/*.map"
  - "!**/*.ts"

extraResources:
  - from: "../../data"
    to: "data"
    filter:
      - "**/*"
      - "!*.db"

mac:
  category: public.app-category.photography
  icon: build/icon.icns
  target:
    - target: dmg
      arch:
        - arm64
        - x64
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  artifactName: "${productName}-${version}-${arch}.${ext}"

dmg:
  artifactName: "${productName}-${version}-${arch}.${ext}"
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
  window:
    width: 540
    height: 380

# Rebuild native modules for Electron
npmRebuild: true
nodeGypRebuild: false

# Include native dependencies
nativeRebuilder: sequential
```

### 2.6 Update package.json Scripts

Add to `packages/desktop/package.json` scripts:

```json
{
  "scripts": {
    "dist": "pnpm build && electron-builder --mac",
    "dist:arm64": "pnpm build && electron-builder --mac --arm64",
    "dist:x64": "pnpm build && electron-builder --mac --x64"
  }
}
```

### 2.7 Fix package.json Fields

Ensure these fields exist in `packages/desktop/package.json`:

```json
{
  "name": "abandoned-archive",
  "version": "0.1.0-alpha",
  "description": "Document abandoned places with verifiable, local-first evidence",
  "author": "Your Name",
  "license": "MIT",
  "main": "dist/main/index.js",
  "repository": {
    "type": "git",
    "url": "https://github.com/bizzlechizzle/au-archive.git"
  }
}
```

### 2.8 Verify Native Module Compatibility

```bash
# Check better-sqlite3 and sharp are compatible with Electron version
cat packages/desktop/package.json | grep electron
cat packages/desktop/package.json | grep better-sqlite3
cat packages/desktop/package.json | grep sharp

# Rebuild native modules for Electron
cd packages/desktop
pnpm rebuild
```

---

## PHASE 3: Build

### 3.1 Clean Build

```bash
# From project root
cd ~/Documents/au\ archive

# Clean everything
rm -rf packages/desktop/dist
rm -rf packages/desktop/release
rm -rf node_modules/.cache

# Fresh install
pnpm install

# Rebuild native modules
pnpm --filter desktop rebuild

# Build the app
pnpm build

# Verify build output
ls -la packages/desktop/dist/
ls -la packages/desktop/dist/main/
ls -la packages/desktop/dist/renderer/
```

### 3.2 Run electron-builder

```bash
cd packages/desktop

# Build for current architecture first (faster)
pnpm dist:arm64  # If on Apple Silicon
# OR
pnpm dist:x64    # If on Intel

# Watch for errors and fix them
```

### 3.3 Common Build Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot find module` | main field wrong | Fix package.json "main" to match actual output |
| `icon.icns not found` | Missing icon | Run icon creation script |
| `native module` errors | Electron/Node mismatch | Run `pnpm --filter desktop rebuild` |
| `code signing` errors | Missing entitlements | Create entitlements.plist |
| `ENOENT dist/main` | Build didn't run | Run `pnpm build` first |
| `Cannot read package.json` | Wrong working directory | Run from packages/desktop |

---

## PHASE 4: Test

### 4.1 Verify Build Output

```bash
ls -la packages/desktop/release/

# Should see .dmg file(s)
# e.g., Abandoned Archive-0.1.0-alpha-arm64.dmg
```

### 4.2 Test the DMG

```bash
# Open the DMG
open packages/desktop/release/*.dmg
```

Manual test checklist:

| Test | Pass? | Notes |
|------|-------|-------|
| DMG opens | | |
| Window shows app + Applications link | | |
| Can drag app to Applications | | |
| App launches (right-click → Open) | | |
| No crash on startup | | |
| Icon shows in Dock | | |
| Icon shows in Finder | | |
| Window appears | | |
| Can navigate UI | | |
| Can import a file | | |
| Database operations work | | |
| Can quit cleanly | | |

### 4.3 Test on Fresh User (Optional but Recommended)

```bash
# Create test user on Mac, or test in clean VM
# This catches issues with:
# - Hardcoded paths
# - Missing bundled files
# - Permission issues
```

---

## PHASE 5: Fix Any Test Failures

If ANY test fails:

1. Identify the root cause
2. Fix it
3. Rebuild
4. Retest

Common runtime issues:

| Issue | Cause | Fix |
|-------|-------|-----|
| White screen | Renderer didn't load | Check dist/renderer exists, check main.js paths |
| Database error | DB not bundled or wrong path | Check extraResources config |
| Native module crash | Wrong architecture | Rebuild with correct --arch flag |
| "App damaged" | Gatekeeper | Right-click → Open (expected for unsigned) |
| Missing files | extraResources wrong | Check electron-builder.yml files/extraResources |

---

## PHASE 6: Finalize

### 6.1 Rename Output (if needed)

```bash
cd packages/desktop/release

# Rename to clean filename
mv "Abandoned Archive-0.1.0-alpha-arm64.dmg" "AbandonedArchive-0.1.0-alpha-arm64.dmg"
```

### 6.2 Generate Checksum

```bash
cd packages/desktop/release
shasum -a 256 *.dmg > checksums.txt
cat checksums.txt
```

### 6.3 Document the Build

Create `docs/final/build-log.md`:

```markdown
# Build Log — v0.1.0-alpha

## Date: [date]
## Builder: [your machine]
## macOS Version: [version]
## Architecture: [arm64/x64]

## Build Command
```
pnpm dist:arm64
```

## Output Files
| File | Size | SHA256 |
|------|------|--------|
| AbandonedArchive-0.1.0-alpha-arm64.dmg | | |

## Test Results
| Test | Result |
|------|--------|
| DMG opens | ✅ |
| App launches | ✅ |
| Core functionality | ✅ |

## Known Issues
- Unsigned (requires right-click → Open on first launch)

## Installation Instructions
1. Download the .dmg
2. Open the .dmg
3. Drag Abandoned Archive to Applications
4. First launch: Right-click → Open → Open
```

---

## DELIVERABLES

By the end of this task, you must have:

1. **Working .dmg file** in `packages/desktop/release/`
2. **Verified app launches** and core features work
3. **Build documentation** in `docs/final/build-log.md`
4. **Checksum file** for distribution

## CONSTRAINTS

- **DO NOT STOP** until a working .dmg exists
- **FIX ALL ERRORS** — no "try again later"
- **TEST THE OUTPUT** — don't assume build success means working app
- **DOCUMENT EVERYTHING** — next build should be one command

## COMPLETION CRITERIA

Report: "macOS BUILD COMPLETE"

```
Output: [filename].dmg ([size] MB)
SHA256: [hash]
Tested: [pass/fail]
Location: packages/desktop/release/

Installation:
1. Download .dmg
2. Open and drag to Applications  
3. First launch: Right-click → Open → Open
```

If build fails after multiple attempts, provide:
- Exact error message
- What was tried
- What specific help is needed

DO NOT report partial progress. Only report when DONE or BLOCKED.
```

---

## Quick Reference Commands

If you need to run this manually outside of Claude Code:

```bash
# Full build sequence
cd ~/Documents/au\ archive
pnpm install
pnpm --filter desktop rebuild
pnpm build
cd packages/desktop
pnpm dist:arm64

# If icon needed first
./packages/desktop/scripts/create-icons.sh /path/to/icon.png

# Test the output
open packages/desktop/release/*.dmg
```
