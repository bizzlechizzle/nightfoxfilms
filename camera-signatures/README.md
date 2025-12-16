# Nightfox Camera Signatures

Comprehensive database of camera signatures for automatic identification from video metadata.

## Overview

This database enables automatic camera detection by matching:
- EXIF Make/Model metadata
- Filename patterns (e.g., `C*.MP4` for Sony, `MVI_*.MOV` for Canon)
- Folder structures (e.g., `PRIVATE/M4ROOT/*` for Sony)
- Technical fingerprints

## Data Sources

| Source | Cameras | Description |
|--------|---------|-------------|
| [ExifTool models.html](https://exiftool.org/models.html) | ~7,500 | All cameras tested with ExifTool |
| [openMVG Database](https://github.com/openMVG/CameraSensorSizeDatabase) | ~3,900 | Cameras with sensor dimensions |
| Manual curation | ~85 | Wedding video cameras with patterns |

## Usage

### In Nightfox

The `signatures/canonical.json` file is bundled with Nightfox and used by the camera matcher service to automatically identify cameras during import.

### Standalone

```python
import json

with open('signatures/canonical.json') as f:
    db = json.load(f)

# Find a camera by make/model
def find_camera(make, model):
    for cam in db['cameras']:
        if cam['make'].lower() == make.lower():
            if model.lower() in [m.lower() for m in cam['matching']['exif_model']]:
                return cam
    return None

# Example
camera = find_camera('Sony', 'ILCE-FX3')
print(camera['model'])  # "FX3"
print(camera['medium']) # "modern"
```

## Building the Database

### Prerequisites

- Python 3.10+
- Internet connection (for fetching sources)

### Build Steps

```bash
# Fetch ExifTool camera list
python scripts/fetch_exiftool_models.py

# Fetch openMVG sensor database
python scripts/fetch_openmvg.py

# Merge all sources into canonical.json
python scripts/merge_sources.py
```

### Output

The merge script creates `signatures/canonical.json` with this structure:

```json
{
  "version": "1.0.0",
  "generated_at": "2025-01-01T00:00:00Z",
  "camera_count": 8000,
  "cameras": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "make": "Sony",
      "model": "FX3",
      "model_variants": ["ILCE-FX3", "FX3"],
      "category": "cinema",
      "medium": "modern",
      "matching": {
        "exif_make": ["Sony"],
        "exif_model": ["ILCE-FX3", "FX3"],
        "filename_patterns": ["C*.MP4", "C*.MXF"],
        "folder_patterns": ["PRIVATE/M4ROOT/*"]
      },
      "technical": {
        "sensor_width_mm": 35.6
      },
      "processing": {
        "deinterlace": false,
        "audio_channels": "stereo"
      }
    }
  ]
}
```

## Schema

See `schema/camera-signature.schema.json` for the full JSON Schema specification.

### Categories

- `cinema` - Professional cinema cameras (RED, ARRI, Blackmagic, Sony FX, Canon C-series)
- `professional` - High-end mirrorless/DSLR (Sony A1/A9, Canon R3, Nikon Z9)
- `prosumer` - Enthusiast cameras (Sony A7, Canon R5/R6, Panasonic GH)
- `consumer` - Consumer camcorders and point-and-shoots
- `action` - GoPro, Insta360, DJI Action
- `drone` - DJI Mavic, Phantom, Inspire
- `smartphone` - iPhone, Pixel, Galaxy
- `scanner` - Film scanners (Super8, 8mm)

### Mediums

- `modern` - HD/4K digital cameras (2010+)
- `dadcam` - SD/early HD camcorders, needs deinterlacing
- `super8` - Film scans from Super8/8mm

## Contributing

### Adding a Camera

1. Add to `sources/manual/cameras.json`:

```json
{
  "make": "Manufacturer",
  "model": "Model Name",
  "model_variants": ["Model Name", "Alternative Name"],
  "category": "prosumer",
  "medium": "modern",
  "year_released": 2024,
  "filename_patterns": ["PREFIX*.MP4"],
  "notes": "Optional notes"
}
```

2. Run `python scripts/merge_sources.py`
3. Submit a PR

### Training a New Camera (via Nightfox)

1. In Nightfox, go to Cameras > Train Camera
2. Add 10+ sample files from the camera
3. Review the auto-detected signature
4. Export the signature
5. Submit to this repo

## License

MIT License - See LICENSE file

## Acknowledgments

- [Phil Harvey](https://exiftool.org/) for ExifTool and the camera models database
- [openMVG project](https://github.com/openMVG/openMVG) for the sensor size database
- [digicamdb.com](https://www.digicamdb.com/) for camera specifications
