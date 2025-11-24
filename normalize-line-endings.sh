#!/bin/bash
# Bash script to normalize line endings in archive files
# This prevents file size mismatches when deploying to Netlify
# Netlify converts CRLF to LF, causing size verification failures

echo "Normalizing line endings in archive files..."

ARCHIVE_DIR="$(dirname "$0")/archive"
if [ ! -d "$ARCHIVE_DIR" ]; then
    echo "Error: archive directory not found!"
    exit 1
fi

# Text files that might have line ending issues
TEXT_FILES=(
    "game0.projectc"
    "game0.dmanifest"
    "archive_files.json"
)

TOTAL_SAVED=0
for file in "${TEXT_FILES[@]}"; do
    FILE_PATH="$ARCHIVE_DIR/$file"
    if [ -f "$FILE_PATH" ]; then
        ORIGINAL_SIZE=$(stat -f%z "$FILE_PATH" 2>/dev/null || stat -c%s "$FILE_PATH" 2>/dev/null || echo "0")
        dos2unix "$FILE_PATH" 2>/dev/null || sed -i 's/\r$//' "$FILE_PATH"
        NEW_SIZE=$(stat -f%z "$FILE_PATH" 2>/dev/null || stat -c%s "$FILE_PATH" 2>/dev/null || echo "0")
        SAVED=$((ORIGINAL_SIZE - NEW_SIZE))
        if [ "$SAVED" -gt 0 ]; then
            echo "  $file : $ORIGINAL_SIZE -> $NEW_SIZE bytes (saved $SAVED bytes)"
            TOTAL_SAVED=$((TOTAL_SAVED + SAVED))
        else
            echo "  $file : Already normalized"
        fi
    fi
done

if [ "$TOTAL_SAVED" -gt 0 ]; then
    echo ""
    echo "Total bytes saved: $TOTAL_SAVED"
    echo ""
    echo "WARNING: You need to update archive_files.json with the new file sizes!"
    echo "Current game0.projectc size: $(stat -f%z "$ARCHIVE_DIR/game0.projectc" 2>/dev/null || stat -c%s "$ARCHIVE_DIR/game0.projectc" 2>/dev/null) bytes"
else
    echo ""
    echo "All files already normalized."
fi

echo ""
echo "Done!"

