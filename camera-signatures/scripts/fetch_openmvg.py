#!/usr/bin/env python3
"""
Fetch and parse the openMVG Camera Sensor Size Database.
Source: https://github.com/openMVG/CameraSensorSizeDatabase

This provides sensor dimensions which helps with medium classification
and adds technical data to our signatures.
"""

import csv
import json
import urllib.request
from pathlib import Path
from datetime import datetime
from io import StringIO

OPENMVG_URL = "https://raw.githubusercontent.com/openMVG/CameraSensorSizeDatabase/master/sensor_database_detailed.csv"
OPENMVG_SIMPLE_URL = "https://raw.githubusercontent.com/openMVG/CameraSensorSizeDatabase/master/sensor_database.csv"
OUTPUT_DIR = Path(__file__).parent.parent / "sources" / "openmvg"


def fetch_csv(url: str) -> str:
    """Download the CSV file."""
    print(f"Fetching {url}...")

    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Nightfox Camera DB Builder)"}
    )

    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8")


def parse_detailed_csv(csv_text: str) -> list[dict]:
    """
    Parse the detailed CSV with sensor dimensions.

    Columns: CameraMaker,CameraModel,SensorDescription,SensorWidth(mm),SensorHeight(mm),SensorWidth(pixels),SensorHeight(pixels)
    """
    cameras = []
    reader = csv.DictReader(StringIO(csv_text))

    for row in reader:
        make = row.get('CameraMaker', '').strip()
        model = row.get('CameraModel', '').strip()

        if not make or not model:
            continue

        # Clean up model name (often includes make prefix)
        if model.lower().startswith(make.lower()):
            model = model[len(make):].strip()

        camera = {
            "make": make,
            "model": model,
            "source": "openmvg",
            "technical": {}
        }

        # Parse sensor dimensions
        try:
            sensor_width = float(row.get('SensorWidth(mm)', 0))
            sensor_height = float(row.get('SensorHeight(mm)', 0))
            if sensor_width > 0:
                camera['technical']['sensor_width_mm'] = sensor_width
            if sensor_height > 0:
                camera['technical']['sensor_height_mm'] = sensor_height
        except (ValueError, TypeError):
            pass

        # Parse pixel dimensions
        try:
            px_width = int(row.get('SensorWidth(pixels)', 0))
            px_height = int(row.get('SensorHeight(pixels)', 0))
            if px_width > 0 and px_height > 0:
                camera['technical']['max_resolution'] = f"{px_width}x{px_height}"
        except (ValueError, TypeError):
            pass

        cameras.append(camera)

    return cameras


def parse_simple_csv(csv_text: str) -> list[dict]:
    """
    Parse the simple CSV (fallback).

    Columns: CameraMaker,CameraModel,SensorWidth(mm)
    """
    cameras = []
    reader = csv.DictReader(StringIO(csv_text))

    for row in reader:
        make = row.get('CameraMaker', '').strip()
        model = row.get('CameraModel', '').strip()

        if not make or not model:
            continue

        # Clean up model name
        if model.lower().startswith(make.lower()):
            model = model[len(make):].strip()

        camera = {
            "make": make,
            "model": model,
            "source": "openmvg",
            "technical": {}
        }

        try:
            sensor_width = float(row.get('SensorWidth(mm)', 0))
            if sensor_width > 0:
                camera['technical']['sensor_width_mm'] = sensor_width
        except (ValueError, TypeError):
            pass

        cameras.append(camera)

    return cameras


def classify_by_sensor_size(sensor_width_mm: float) -> tuple[str, str]:
    """
    Classify camera by sensor size.
    Returns (category, medium)

    Sensor sizes:
    - Full Frame: 36mm
    - APS-C: 22-24mm
    - Micro 4/3: 17.3mm
    - 1": 13.2mm
    - 1/1.7": 7.6mm
    - 1/2.3": 6.17mm (typical compact/action cam)
    - Phone sensors: < 6mm
    """
    if sensor_width_mm >= 30:
        return 'professional', 'modern'  # Full frame or larger
    elif sensor_width_mm >= 20:
        return 'prosumer', 'modern'  # APS-C
    elif sensor_width_mm >= 15:
        return 'prosumer', 'modern'  # Micro 4/3
    elif sensor_width_mm >= 10:
        return 'consumer', 'modern'  # 1" sensors
    elif sensor_width_mm >= 6:
        return 'consumer', 'modern'  # Compact cameras
    elif sensor_width_mm >= 4:
        return 'consumer', 'dadcam'  # Small sensor compacts
    else:
        return 'smartphone', 'modern'  # Phone-sized sensors


def enrich_cameras(cameras: list[dict]) -> list[dict]:
    """Add category and medium based on sensor size and name."""
    for cam in cameras:
        sensor_width = cam.get('technical', {}).get('sensor_width_mm', 0)

        if sensor_width > 0:
            category, medium = classify_by_sensor_size(sensor_width)
            cam['category'] = category
            cam['medium'] = medium
        else:
            cam['category'] = 'unknown'
            cam['medium'] = 'modern'

    return cameras


def save_results(cameras: list[dict], output_dir: Path):
    """Save parsed cameras to JSON."""
    output_dir.mkdir(parents=True, exist_ok=True)

    cameras = enrich_cameras(cameras)

    # Deduplicate
    seen = set()
    unique = []
    for cam in cameras:
        key = f"{cam['make'].lower()}|{cam['model'].lower()}"
        if key not in seen:
            seen.add(key)
            unique.append(cam)

    output = {
        "source": "openmvg",
        "url": OPENMVG_URL,
        "fetched_at": datetime.utcnow().isoformat() + "Z",
        "camera_count": len(unique),
        "cameras": unique
    }

    output_path = output_dir / "cameras.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Saved {len(unique)} cameras to {output_path}")

    # Stats
    makes = set(c['make'] for c in unique)
    print(f"Manufacturers: {len(makes)}")

    with_sensor = sum(1 for c in unique if c.get('technical', {}).get('sensor_width_mm'))
    print(f"With sensor data: {with_sensor}")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Try detailed CSV first
    try:
        csv_text = fetch_csv(OPENMVG_URL)
        with open(OUTPUT_DIR / "sensor_database_detailed.csv", "w") as f:
            f.write(csv_text)
        cameras = parse_detailed_csv(csv_text)
        print(f"Parsed {len(cameras)} from detailed CSV")
    except Exception as e:
        print(f"Detailed CSV failed: {e}")
        print("Trying simple CSV...")
        csv_text = fetch_csv(OPENMVG_SIMPLE_URL)
        with open(OUTPUT_DIR / "sensor_database.csv", "w") as f:
            f.write(csv_text)
        cameras = parse_simple_csv(csv_text)
        print(f"Parsed {len(cameras)} from simple CSV")

    if not cameras:
        print("ERROR: No cameras parsed!")
        return 1

    save_results(cameras, OUTPUT_DIR)
    return 0


if __name__ == "__main__":
    exit(main())
