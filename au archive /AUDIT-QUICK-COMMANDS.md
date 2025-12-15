# AU Archive Audit - Quick Commands

## Option 1: Full Script (Recommended)

Download and run the preparation script:

```bash
# 1. Make it executable
chmod +x prepare-audit.sh

# 2. Run from your au-archive project root
cd "/Users/bryant/Documents/au archive"
./prepare-audit.sh
```

The script will:
- Zip `packages/desktop` (excluding node_modules, dist, etc.)
- Find and copy all spec documents
- Generate a codebase manifest
- Open the output folder on your Desktop

---

## Option 2: One-Liner Commands

Run these directly in Terminal:

```bash
# Navigate to your project
cd "/Users/bryant/Documents/au archive"

# Create output folder on Desktop
mkdir -p ~/Desktop/au-archive-audit

# Zip the codebase (excludes build artifacts)
zip -r ~/Desktop/au-archive-audit/au-archive-codebase.zip packages/desktop \
    -x "*/node_modules/*" \
    -x "*/dist/*" \
    -x "*/dist-electron/*" \
    -x "*/.svelte-kit/*" \
    -x "*/.DS_Store"

# Open the folder
open ~/Desktop/au-archive-audit
```

---

## Option 3: Copy-Paste Ready (Single Block)

```bash
cd "/Users/bryant/Documents/au archive" && \
mkdir -p ~/Desktop/au-archive-audit && \
zip -r ~/Desktop/au-archive-audit/au-archive-codebase.zip packages/desktop \
    -x "*/node_modules/*" -x "*/dist/*" -x "*/dist-electron/*" \
    -x "*/.svelte-kit/*" -x "*/.DS_Store" && \
echo "✓ Codebase zipped to ~/Desktop/au-archive-audit/" && \
open ~/Desktop/au-archive-audit
```

---

## After Running the Command

### Files You Need to Upload to Claude:

1. **au-archive-codebase.zip** - Created by the script
2. **AU-ARCHIVE-AUDIT-PROMPT.md** - Your spec doc
3. **AU-ARCHIVE-IMPLEMENTATION-CHECKLIST.md** - Your checklist
4. **import-v2-implementation-guide.md** - Your implementation guide
5. **FULL-AUDIT-COMMAND.md** - The audit prompt (paste its contents)

### Manually Copy Spec Docs (if not auto-found):

```bash
# If your spec docs are in Downloads:
cp ~/Downloads/AU-ARCHIVE-*.md ~/Desktop/au-archive-audit/
cp ~/Downloads/import-v2-implementation-guide.md ~/Desktop/au-archive-audit/
cp ~/Downloads/FULL-AUDIT-COMMAND.md ~/Desktop/au-archive-audit/
```

---

## In Claude (New Conversation)

1. **Click the attachment button** (📎)
2. **Upload all 4 files** from `~/Desktop/au-archive-audit/`
3. **Open FULL-AUDIT-COMMAND.md** in a text editor
4. **Copy everything below the `---` line**
5. **Paste into Claude** as your first message
6. **Hit Enter and wait** (this will take a while)

---

## Expected Output

The audit will produce:
- 5,000+ words of detailed findings
- File:line references for every issue
- Compliance matrix against all spec requirements
- Prioritized fix list with time estimates
- Final compliance score (percentage)

---

## Troubleshooting

**"packages/desktop not found"**
```bash
# Make sure you're in the right directory
pwd  # Should show: /Users/bryant/Documents/au archive
ls packages/  # Should show: desktop/
```

**"Zip is too large"**
```bash
# Check what's being included
unzip -l ~/Desktop/au-archive-audit/au-archive-codebase.zip | tail -20
# If node_modules snuck in, re-run with exclusions
```

**"Spec docs not found"**
```bash
# Find where they are
find ~ -name "AU-ARCHIVE-AUDIT-PROMPT.md" 2>/dev/null
# Then copy manually
```
