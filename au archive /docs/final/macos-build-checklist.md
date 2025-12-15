# macOS Build Checklist — v0.1.0-alpha

## Pre-Build
- [x] Git clean and on main branch
- [x] pnpm build succeeds
- [x] Icon converted to .icns (1024x1024 source)

## Configuration
- [x] electron-builder.config.json exists
- [x] entitlements.mac.plist exists
- [x] Version in package.json: 0.1.0-alpha
- [x] App name correct: Abandoned Archive
- [x] Electron version pinned: 35.7.5

## Build
- [x] electron-builder installed (v24.13.3)
- [x] pnpm dist:arm64 succeeds
- [x] Both arm64 and x64 DMGs created

## Verification
- [x] DMGs exist in release/
- [x] File sizes reasonable (~310MB each)
- [x] SHA256 checksums computed
- [ ] DMG opens correctly
- [ ] App drags to Applications
- [ ] App launches (with Gatekeeper workaround)
- [ ] Icon displays correctly in Dock/Finder
- [ ] Core functionality works

## Distribution
- [x] DMG files named appropriately
- [x] Release notes include install instructions
- [ ] Upload to GitHub Releases (optional for alpha)

---

## Installation Instructions (for Release Notes)

### macOS Installation

1. Download the appropriate DMG:
   - **Apple Silicon (M1/M2/M3)**: `Abandoned Archive-0.1.0-alpha-arm64.dmg`
   - **Intel**: `Abandoned Archive-0.1.0-alpha.dmg`

2. Open the DMG and drag **Abandoned Archive** to Applications

3. **First launch only** (required because app is not code-signed):
   - Right-click (or Control-click) the app
   - Select "Open" from context menu
   - Click "Open" in the dialog

4. App will launch normally after first run

---

## Known Issues (v0.1.0-alpha)

### Unsigned App Warning
Users will see "Abandoned Archive can't be opened because it is from an unidentified developer". This is expected for alpha - workaround documented above.

### Code Signing (Future)
For production releases:
- Apple Developer Account ($99/year)
- Developer ID Certificate
- Notarization required

---

## Files Created

| File | Architecture | Size |
|------|--------------|------|
| Abandoned Archive-0.1.0-alpha-arm64.dmg | Apple Silicon | 310 MB |
| Abandoned Archive-0.1.0-alpha.dmg | Intel x64 | 314 MB |
