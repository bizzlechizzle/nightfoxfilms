# v0.1.0-alpha macOS Build Guide

## Prerequisites

Before building, verify:

```bash
cd ~/Documents/au\ archive

# Verify clean state
git status  # Should be clean, on main, tagged v0.1.0-alpha

# Verify builds work
pnpm install
pnpm build
pnpm -r lint
```

---

## Build Prompt

```
READ:
- @CLAUDE.md
- @techguide.md
- @packages/desktop/package.json

YOUR TASK: Configure and build macOS alpha distributable for Abandoned Archive v0.1.0-alpha.

---

## PART 1: Icon Setup

The app icon needs to be in the correct format for macOS.

### Required Icon Files
macOS requires an `.icns` file containing multiple resolutions. Create from the source PNG:

```bash
# Create iconset directory
mkdir -p build/icon.iconset

# Generate all required sizes from source PNG
# (Assumes source icon is at least 1024x1024)
sips -z 16 16     abandoned-upstate-icon.png --out build/icon.iconset/icon_16x16.png
sips -z 32 32     abandoned-upstate-icon.png --out build/icon.iconset/icon_16x16@2x.png
sips -z 32 32     abandoned-upstate-icon.png --out build/icon.iconset/icon_32x32.png
sips -z 64 64     abandoned-upstate-icon.png --out build/icon.iconset/icon_32x32@2x.png
sips -z 128 128   abandoned-upstate-icon.png --out build/icon.iconset/icon_128x128.png
sips -z 256 256   abandoned-upstate-icon.png --out build/icon.iconset/icon_128x128@2x.png
sips -z 256 256   abandoned-upstate-icon.png --out build/icon.iconset/icon_256x256.png
sips -z 512 512   abandoned-upstate-icon.png --out build/icon.iconset/icon_256x256@2x.png
sips -z 512 512   abandoned-upstate-icon.png --out build/icon.iconset/icon_512x512.png
sips -z 1024 1024 abandoned-upstate-icon.png --out build/icon.iconset/icon_512x512@2x.png

# Convert to icns
iconutil -c icns build/icon.iconset -o build/icon.icns

# Verify
ls -la build/icon.icns
```

---

## PART 2: Electron Builder Configuration

Check/create electron-builder config in `packages/desktop/`:

### Option A: In package.json
```json
{
  "name": "abandoned-archive",
  "version": "0.1.0-alpha",
  "description": "Document abandoned places with verifiable, local-first evidence",
  "author": "Your Name <your@email.com>",
  "license": "MIT",
  "main": "dist/main/index.js",
  "build": {
    "appId": "com.abandonedarchive.app",
    "productName": "Abandoned Archive",
    "copyright": "Copyright © 2025 Your Name",
    "directories": {
      "output": "release",
      "buildResources": "build"
    },
    "files": [
      "dist/**/*",
      "package.json"
    ],
    "mac": {
      "category": "public.app-category.photography",
      "icon": "build/icon.icns",
      "target": [
        {
          "target": "dmg",
          "arch": ["x64", "arm64"]
        }
      ],
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    },
    "dmg": {
      "contents": [
        {
          "x": 130,
          "y": 220
        },
        {
          "x": 410,
          "y": 220,
          "type": "link",
          "path": "/Applications"
        }
      ],
      "window": {
        "width": 540,
        "height": 380
      }
    }
  }
}
```

### Option B: electron-builder.yml (if preferred)
```yaml
appId: com.abandonedarchive.app
productName: Abandoned Archive
copyright: Copyright © 2025 Your Name

directories:
  output: release
  buildResources: build

files:
  - dist/**/*
  - package.json

mac:
  category: public.app-category.photography
  icon: build/icon.icns
  target:
    - target: dmg
      arch:
        - x64
        - arm64
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist

dmg:
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
```

---

## PART 3: Entitlements (Required for macOS)

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

These entitlements allow:
- Native modules (better-sqlite3, sharp) to function
- User file access (for archive folder)
- Download folder access (for imports)

---

## PART 4: Install electron-builder

```bash
cd packages/desktop
pnpm add -D electron-builder
```

Add build scripts to `packages/desktop/package.json`:

```json
{
  "scripts": {
    "dist": "electron-builder --mac",
    "dist:arm64": "electron-builder --mac --arm64",
    "dist:x64": "electron-builder --mac --x64",
    "dist:universal": "electron-builder --mac --universal"
  }
}
```

---

## PART 5: Build Directory Structure

Verify this structure exists:

```
packages/desktop/
├── build/
│   ├── icon.icns              # macOS icon
│   ├── icon.iconset/          # Icon sources (can delete after icns created)
│   └── entitlements.mac.plist # macOS entitlements
├── dist/                      # Built app (from pnpm build)
│   ├── main/
│   └── renderer/
├── release/                   # Output directory (created by electron-builder)
├── electron-builder.yml       # Or config in package.json
└── package.json
```

---

## PART 6: Build Commands

```bash
# Ensure clean build
cd ~/Documents/au\ archive
pnpm install
pnpm build

# Build for current architecture (faster for testing)
cd packages/desktop
pnpm dist

# Or build universal binary (both Intel and Apple Silicon)
pnpm dist:universal
```

---

## PART 7: Verify Build Output

After build completes:

```bash
ls -la packages/desktop/release/

# Should see:
# - Abandoned Archive-0.1.0-alpha.dmg (or similar)
# - Abandoned Archive-0.1.0-alpha-arm64.dmg
# - Abandoned Archive-0.1.0-alpha-x64.dmg
# - mac/ or mac-arm64/ or mac-universal/ directory
```

### Test the DMG:
1. Open the .dmg file
2. Drag app to Applications (or run from DMG)
3. Launch the app
4. Verify:
   - [ ] App opens without crash
   - [ ] Icon displays correctly in Dock
   - [ ] Icon displays correctly in Finder
   - [ ] Basic functionality works
   - [ ] No code signing warnings (if unsigned, Gatekeeper will warn)

---

## PART 8: Known Issues for Unsigned Alpha

Since this is alpha without code signing:

### First Launch Warning
Users will see: "Abandoned Archive can't be opened because it is from an unidentified developer"

**Workaround for users:**
1. Right-click (or Control-click) the app
2. Select "Open" from context menu
3. Click "Open" in the dialog
4. App will be remembered as safe

### Document this in release notes:
```markdown
## Installation (macOS)

1. Download the .dmg file
2. Open the .dmg and drag Abandoned Archive to Applications
3. **First launch only**: Right-click the app → Open → Open
   (Required because app is not code-signed)
4. App will launch normally after first run
```

---

## PART 9: Code Signing (Future)

For production releases, you'll need:

| Requirement | Purpose | Cost |
|-------------|---------|------|
| Apple Developer Account | Sign and notarize | $99/year |
| Developer ID Certificate | Code signing | Included |
| Notarization | Apple malware scan | Included |

For v0.1.0-alpha, unsigned is acceptable. Add to v0.1.0 release checklist.

---

## Deliverables

### D1: Build Checklist
Create `docs/final/macos-build-checklist.md`:

```markdown
# macOS Build Checklist — v0.1.0-alpha

## Pre-Build
- [ ] Git tag exists: v0.1.0-alpha
- [ ] pnpm build succeeds
- [ ] pnpm -r lint passes
- [ ] Icon converted to .icns

## Configuration
- [ ] electron-builder config exists
- [ ] entitlements.mac.plist exists
- [ ] Version in package.json: 0.1.0-alpha
- [ ] App name correct: Abandoned Archive

## Build
- [ ] electron-builder installed
- [ ] pnpm dist succeeds
- [ ] .dmg file created

## Verification
- [ ] DMG opens
- [ ] App drags to Applications
- [ ] App launches (with Gatekeeper workaround)
- [ ] Icon displays correctly
- [ ] Core functionality works
- [ ] No console errors

## Distribution
- [ ] DMG renamed appropriately
- [ ] Release notes updated with install instructions
- [ ] Uploaded to GitHub Releases (optional for alpha)
```

### D2: Build Output Log
```markdown
# Build Log — v0.1.0-alpha

## Date: [date]
## Platform: macOS [version]
## Architecture: [arm64/x64/universal]

## Build Command
[command used]

## Output Files
| File | Size | SHA256 |
|------|------|--------|

## Test Results
| Check | Pass/Fail |
|-------|-----------|
```

---

## CONSTRAINTS

- **No code signing for alpha** — Document Gatekeeper workaround
- **Test on clean machine if possible** — Or at least fresh user account
- **Icon must be high quality** — Users see this in Dock
- **DMG window should be branded** — Not generic Electron look

## COMPLETION CRITERIA

- electron-builder configured
- Icon in correct format
- Build succeeds without errors
- DMG created and tested
- Installation documented

Report: "macOS BUILD COMPLETE — [filename].dmg ([size]MB) created and verified"
```
