# Build Log — v0.1.0-alpha

## Build Information

| Field | Value |
|-------|-------|
| Date | 2025-11-30 |
| Platform | macOS 15.6.1 (Sequoia) |
| Architecture | arm64 (built for both arm64 and x64) |
| Electron | 35.7.5 |
| electron-builder | 24.13.3 |
| Node.js | 20+ |

---

## Build Command

```bash
cd packages/desktop
pnpm dist:arm64
```

---

## Output Files

| File | Size | SHA256 |
|------|------|--------|
| Abandoned Archive-0.1.0-alpha-arm64.dmg | 313 MB | `0be69a9d10143440d184a1d98b96242291db1affdf1dc0d199a30f7f0ad9396a` |
| Abandoned Archive-0.1.0-alpha.dmg | 318 MB | `ddb36a166c88c869ad4f3ceff9001266553b411aa2d943e7518c332bdfc3deee` |

---

## Build Steps Completed

1. **Icon Setup**
   - Source: `resources/icons/abandoned-upstate-icon.png` (1024x1024)
   - Created iconset with all required sizes
   - Converted to `build/icon.icns` (2.3 MB)

2. **Configuration**
   - Updated `electron-builder.config.json`:
     - Product name: Abandoned Archive
     - Category: public.app-category.photography
     - Targets: DMG (arm64, x64)
     - Hardened runtime enabled
     - Entitlements configured
   - Updated `package.json`:
     - Added description, author, license
     - Pinned electron version to 35.7.5
     - Added dist scripts

3. **Entitlements**
   - Created `build/entitlements.mac.plist`
   - Allows JIT, unsigned memory, library validation bypass
   - File access for user-selected and downloads

4. **Build**
   - `pnpm build` succeeded (Vite bundle)
   - `pnpm dist:arm64` succeeded (electron-builder)
   - Native modules rebuilt for both architectures

---

## Warnings (Expected)

```
• skipped macOS application code signing
  reason=cannot find valid "Developer ID Application" identity
```

This is expected for unsigned alpha. Users must use right-click workaround on first launch.

```
• file source doesn't exist from=/Users/bryant/Documents/au archive /resources/bin
```

The `resources/bin` directory for bundled binaries doesn't exist yet. This is optional for alpha.

---

## Test Results

| Check | Status |
|-------|--------|
| DMG files created | ✅ Pass |
| File sizes reasonable | ✅ Pass (310-314 MB) |
| Both architectures built | ✅ Pass |
| SHA256 checksums computed | ✅ Pass |
| Code signing skipped (expected) | ⚠️ Expected |

---

## Directory Structure After Build

```
packages/desktop/
├── build/
│   ├── icon.icns              # macOS app icon
│   ├── icon.iconset/          # Icon sources
│   └── entitlements.mac.plist # macOS entitlements
├── release/
│   ├── Abandoned Archive-0.1.0-alpha-arm64.dmg
│   ├── Abandoned Archive-0.1.0-alpha-arm64.dmg.blockmap
│   ├── Abandoned Archive-0.1.0-alpha.dmg
│   ├── Abandoned Archive-0.1.0-alpha.dmg.blockmap
│   ├── builder-debug.yml
│   ├── mac/                   # Unpacked x64 app
│   └── mac-arm64/             # Unpacked arm64 app
└── electron-builder.config.json
```

---

## Next Steps

1. Test DMG installation on clean machine
2. Verify app launches with Gatekeeper workaround
3. Test core functionality (import, map, database)
4. Upload to GitHub Releases when ready
5. Consider code signing for production release
