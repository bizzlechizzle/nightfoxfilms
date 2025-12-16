#!/usr/bin/env python3
"""
Merge all camera sources into canonical.json

Priority order:
1. manual (hand-curated, highest trust)
2. openmvg (has sensor data)
3. exiftool (most comprehensive)
4. user (community contributions)

The merge logic:
- Deduplicate by make+model (case-insensitive)
- Prefer entries with more data
- Combine technical specs from multiple sources
- Generate stable UUIDs based on make+model
"""

import json
import uuid
import hashlib
from pathlib import Path
from datetime import datetime

SOURCES_DIR = Path(__file__).parent.parent / "sources"
OUTPUT_DIR = Path(__file__).parent.parent / "signatures"


def generate_stable_uuid(make: str, model: str) -> str:
    """Generate a stable UUID from make+model (always same for same input)."""
    key = f"{make.lower().strip()}|{model.lower().strip()}"
    # Use UUID5 with a namespace for deterministic IDs
    namespace = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # Standard namespace
    return str(uuid.uuid5(namespace, key))


def normalize_make(make: str) -> str:
    """Normalize manufacturer names."""
    make = make.strip()

    # Common variations
    normalizations = {
        "fuji": "Fujifilm",
        "fuji film": "Fujifilm",
        "fujifilm": "Fujifilm",
        "panasonic/leica": "Panasonic",
        "konica minolta": "Konica-Minolta",
        "konica-minolta": "Konica-Minolta",
        "hewlett-packard": "HP",
        "hewlett packard": "HP",
        "eastman kodak": "Kodak",
        "eastman-kodak": "Kodak",
        "lg electronics": "LG",
        "research in motion": "BlackBerry",
        "rim": "BlackBerry",
    }

    lower = make.lower()
    if lower in normalizations:
        return normalizations[lower]

    # Title case if all lowercase
    if make == make.lower():
        return make.title()

    return make


def normalize_model(model: str, make: str) -> str:
    """Clean up model names."""
    model = model.strip()

    # Remove make prefix if present
    make_lower = make.lower()
    if model.lower().startswith(make_lower + " "):
        model = model[len(make) + 1:]
    elif model.lower().startswith(make_lower):
        model = model[len(make):]

    return model.strip()


def load_source(name: str) -> list[dict]:
    """Load cameras from a source JSON file."""
    path = SOURCES_DIR / name / "cameras.json"
    if not path.exists():
        print(f"  Source not found: {path}")
        return []

    with open(path) as f:
        data = json.load(f)

    cameras = data.get("cameras", [])
    print(f"  Loaded {len(cameras)} from {name}")
    return cameras


def merge_camera_data(existing: dict, new: dict) -> dict:
    """Merge data from new into existing, preferring existing non-null values."""
    result = existing.copy()

    # Merge top-level fields (prefer existing)
    for key in ['category', 'medium', 'year_released']:
        if not result.get(key) and new.get(key):
            result[key] = new[key]

    # Merge technical specs (combine)
    if 'technical' in new:
        if 'technical' not in result:
            result['technical'] = {}
        for key, value in new['technical'].items():
            if value and not result['technical'].get(key):
                result['technical'][key] = value

    # Track sources
    sources = set(result.get('sources', []))
    sources.add(new.get('source', 'unknown'))
    result['sources'] = list(sources)

    return result


def build_matching_rules(make: str, model: str) -> dict:
    """Build matching rules for a camera."""
    rules = {
        "exif_make": [make],
        "exif_model": [model],
        "filename_patterns": [],
        "folder_patterns": []
    }

    # Add common filename patterns based on make
    make_lower = make.lower()
    model_lower = model.lower()

    if make_lower == "sony":
        if any(x in model_lower for x in ['fx3', 'fx6', 'fx9', 'a7', 'a9', 'a1']):
            rules['filename_patterns'] = ["C*.MP4", "C*.MXF"]
            rules['folder_patterns'] = ["PRIVATE/M4ROOT/*"]
        elif 'handycam' in model_lower or model_lower.startswith('hdr-'):
            rules['filename_patterns'] = ["M2U*.MPG", "*.MTS"]

    elif make_lower == "canon":
        if any(x in model_lower for x in ['c70', 'c300', 'c500', 'c200']):
            rules['filename_patterns'] = ["*.MXF", "*.MP4"]
            rules['folder_patterns'] = ["CONTENTS/CLIPS/*"]
        elif any(x in model_lower for x in ['5d', '6d', '7d', 'r5', 'r6', 'r3']):
            rules['filename_patterns'] = ["MVI_*.MOV", "MVI_*.MP4"]
        else:
            rules['filename_patterns'] = ["MVI_*.MOV", "MVI_*.AVI"]

    elif make_lower == "panasonic":
        if any(x in model_lower for x in ['gh5', 'gh6', 's1', 's5', 'bgh1']):
            rules['filename_patterns'] = ["P*.MOV", "P*.MP4"]
        else:
            rules['filename_patterns'] = ["*.MTS", "*.M2TS"]

    elif make_lower == "gopro":
        rules['filename_patterns'] = ["GH*.MP4", "GP*.MP4", "GOPR*.MP4", "GX*.MP4"]

    elif make_lower == "dji":
        rules['filename_patterns'] = ["DJI_*.MP4", "DJI_*.MOV"]

    elif make_lower == "apple":
        rules['filename_patterns'] = ["IMG_*.MOV", "IMG_*.MP4"]

    elif make_lower == "blackmagic":
        rules['filename_patterns'] = ["*.BRAW", "*.DNG"]

    return rules


def merge_all_sources() -> list[dict]:
    """Merge all sources into a single list."""
    print("Loading sources...")

    # Load in priority order
    manual = load_source("manual")
    openmvg = load_source("openmvg")
    exiftool = load_source("exiftool")
    user = load_source("user")

    # Build merged database
    cameras_by_key = {}

    # Process in reverse priority (lowest first, so higher priority overwrites)
    for source_cameras, source_name in [
        (user, "user"),
        (exiftool, "exiftool"),
        (openmvg, "openmvg"),
        (manual, "manual")
    ]:
        for cam in source_cameras:
            make = normalize_make(cam.get('make', ''))
            model = normalize_model(cam.get('model', ''), make)

            if not make or not model:
                continue

            key = f"{make.lower()}|{model.lower()}"

            if key in cameras_by_key:
                cameras_by_key[key] = merge_camera_data(cameras_by_key[key], cam)
            else:
                cam['make'] = make
                cam['model'] = model
                cam['sources'] = [cam.get('source', source_name)]
                cameras_by_key[key] = cam

    print(f"\nMerged to {len(cameras_by_key)} unique cameras")
    return list(cameras_by_key.values())


def build_canonical_database(cameras: list[dict]) -> dict:
    """Build the final canonical.json structure."""

    canonical_cameras = []

    for cam in cameras:
        make = cam['make']
        model = cam['model']

        canonical = {
            "id": generate_stable_uuid(make, model),
            "make": make,
            "model": model,
            "model_variants": [model],  # Can be expanded
            "category": cam.get('category', 'unknown'),
            "medium": cam.get('medium', 'modern'),
            "year_released": cam.get('year_released'),
            "matching": build_matching_rules(make, model),
            "technical": cam.get('technical', {}),
            "processing": {
                "deinterlace": cam.get('medium') == 'dadcam',
                "audio_channels": "stereo",
                "suggested_lut": None
            },
            "source": cam.get('sources', ['unknown'])[0] if cam.get('sources') else 'unknown',
            "verified": cam.get('source') == 'manual'
        }

        # Add model to matching rules if not already there
        if model not in canonical['matching']['exif_model']:
            canonical['matching']['exif_model'].append(model)

        canonical_cameras.append(canonical)

    # Sort by make, then model
    canonical_cameras.sort(key=lambda c: (c['make'].lower(), c['model'].lower()))

    return {
        "version": "1.0.0",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "camera_count": len(canonical_cameras),
        "sources": {
            "exiftool": "https://exiftool.org/models.html",
            "openmvg": "https://github.com/openMVG/CameraSensorSizeDatabase",
            "manual": "nightfox-team"
        },
        "cameras": canonical_cameras
    }


def print_stats(database: dict):
    """Print statistics about the database."""
    cameras = database['cameras']

    print("\n" + "=" * 50)
    print("DATABASE STATISTICS")
    print("=" * 50)
    print(f"Total cameras: {len(cameras)}")

    # By make
    makes = {}
    for cam in cameras:
        make = cam['make']
        makes[make] = makes.get(make, 0) + 1

    print(f"\nManufacturers: {len(makes)}")
    print("\nTop 20 manufacturers:")
    for make, count in sorted(makes.items(), key=lambda x: -x[1])[:20]:
        print(f"  {make}: {count}")

    # By category
    categories = {}
    for cam in cameras:
        cat = cam['category']
        categories[cat] = categories.get(cat, 0) + 1

    print("\nBy category:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    # By medium
    mediums = {}
    for cam in cameras:
        med = cam['medium']
        mediums[med] = mediums.get(med, 0) + 1

    print("\nBy medium:")
    for med, count in sorted(mediums.items(), key=lambda x: -x[1]):
        print(f"  {med}: {count}")

    # By source
    sources = {}
    for cam in cameras:
        src = cam['source']
        sources[src] = sources.get(src, 0) + 1

    print("\nBy source:")
    for src, count in sorted(sources.items(), key=lambda x: -x[1]):
        print(f"  {src}: {count}")


def main():
    # Merge all sources
    cameras = merge_all_sources()

    if not cameras:
        print("ERROR: No cameras to merge!")
        return 1

    # Build canonical database
    database = build_canonical_database(cameras)

    # Save
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "canonical.json"

    with open(output_path, "w") as f:
        json.dump(database, f, indent=2)

    print(f"\nSaved to {output_path}")

    # Stats
    print_stats(database)

    # File size
    size_kb = output_path.stat().st_size / 1024
    print(f"\nFile size: {size_kb:.1f} KB")

    return 0


if __name__ == "__main__":
    exit(main())
