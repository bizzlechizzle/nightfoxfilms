#!/bin/bash
# Post-process the preload script to fix ESM/CJS issues
# The vite-plugin-electron wraps code in a way that adds ESM exports to CJS files

PRELOAD_FILE="dist-electron/preload/index.cjs"

if [ ! -f "$PRELOAD_FILE" ]; then
    echo "Preload file not found: $PRELOAD_FILE"
    exit 1
fi

echo "Fixing preload script..."

# Create a clean CJS version by extracting the inner code
# Remove the wrapper: var c = ...; var k = c(() => { ... }); export default k();
# And just keep the inner code with proper CJS format

cat > "$PRELOAD_FILE.tmp" << 'PRELOAD_HEADER'
"use strict";
// AU Archive Preload Script (Fixed CJS)
const { contextBridge, ipcRenderer, webUtils } = require("electron");
PRELOAD_HEADER

# Extract everything between the first { and last }); but skip the wrapper
sed -n '/const { contextBridge/,/extractFilePaths/p' "$PRELOAD_FILE" | \
    sed 's/const { contextBridge: r, ipcRenderer: o, webUtils: d } = require("electron"), l = {/const api = {/' | \
    sed 's/r\.exposeInMainWorld/contextBridge.exposeInMainWorld/g' | \
    sed 's/o\.invoke/ipcRenderer.invoke/g' | \
    sed 's/o\.on/ipcRenderer.on/g' | \
    sed 's/o\.removeListener/ipcRenderer.removeListener/g' | \
    sed 's/d\.getPathForFile/webUtils.getPathForFile/g' >> "$PRELOAD_FILE.tmp"

# Add closing
echo "" >> "$PRELOAD_FILE.tmp"

mv "$PRELOAD_FILE.tmp" "$PRELOAD_FILE"
echo "Preload script fixed: $PRELOAD_FILE"
