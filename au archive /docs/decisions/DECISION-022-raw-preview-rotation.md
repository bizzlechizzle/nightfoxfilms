# DECISION-022: Read EXIF Orientation from Parent RAW File

## Status
Accepted

## Date
2025-11-27

## Context
DSLR images shot in portrait mode appeared sideways in the UI. The camera stores:
- Raw pixels in landscape orientation (4288×2848)
- An EXIF `Orientation` tag saying "Rotate 90 CW"

When displaying, software should rotate based on this tag. Our preview extraction was not applying this rotation correctly.

## Problem

Embedded JPEG previews inside RAW files (extracted via ExifTool) **do not contain EXIF orientation tags**. The orientation is only stored in the parent RAW file's metadata, not in the embedded preview JPEG.

```
Parent RAW file:     Orientation = "Rotate 90 CW"  ← Has the tag
Embedded preview:    Orientation = (none)          ← Missing!
```

The previous code used `sharp(buffer).rotate()` which auto-rotates based on EXIF - but since the embedded JPEG had no EXIF orientation, it did nothing:

```javascript
// BEFORE (broken):
const rotatedBuffer = await sharp(bestBuffer).rotate().toBuffer();
// Result: No rotation applied because bestBuffer has no orientation EXIF
```

## Decision

1. Read orientation from the **parent RAW file** using ExifTool
2. Convert orientation string to degrees (90°, 180°, 270°)
3. Apply explicit rotation using `sharp(buffer).rotate(degrees)`

```javascript
// AFTER (fixed):
const rawOrientation = await this.exifToolService.getOrientation(sourcePath);
const rotationDegrees = this.orientationToDegrees(rawOrientation);

if (rotationDegrees !== 0) {
  finalBuffer = await sharp(bestBuffer).rotate(rotationDegrees).toBuffer();
}
```

## Orientation Mapping

| EXIF Value | String | Degrees |
|------------|--------|---------|
| 1 | Horizontal (normal) | 0° |
| 3 | Rotate 180 | 180° |
| 6 | Rotate 90 CW | 90° |
| 8 | Rotate 270 CW | 270° |

## Consequences

### Positive
- DSLR portrait shots now display correctly
- Works for all RAW formats (ARW, NEF, CR2, etc.)
- Existing images fixed via "Fix All Rotations" button

### Negative
- Extra ExifTool call per RAW file during preview extraction
- Slight increase in import time (~50ms per file)

### Acceptable Trade-off
Correctness is paramount. Users cannot manually fix 100k+ rotated images.

## Implementation

- `electron/services/preview-extractor-service.ts` - `extractPreview()` and `orientationToDegrees()`
- `electron/services/exiftool-service.ts` - `getOrientation()` method

## Testing Guidance

1. Import a DSLR RAW file shot in portrait mode (camera held vertically)
2. Verify thumbnail displays as portrait (taller than wide)
3. Check console for `[PreviewExtractor] Applied 90° rotation from RAW EXIF`
4. If images appear sideways, run Settings → "Fix All Rotations"

## Related Issues

- DECISION-021: Protocol caching (separate but related - prevented seeing fixed images)
