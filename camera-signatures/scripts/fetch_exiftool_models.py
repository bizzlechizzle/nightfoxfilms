#!/usr/bin/env python3
"""
Fetch and parse ExifTool's tested camera models list.
Source: https://exiftool.org/models.html

HTML Structure:
- Manufacturers in <a class=th>Make</a>
- Models in <td> cells separated by <br>
"""

import json
import re
import urllib.request
from pathlib import Path
from datetime import datetime, timezone

EXIFTOOL_URL = "https://exiftool.org/models.html"
OUTPUT_DIR = Path(__file__).parent.parent / "sources" / "exiftool"


def fetch_models_html() -> str:
    """Download the ExifTool models page."""
    print(f"Fetching {EXIFTOOL_URL}...")

    req = urllib.request.Request(
        EXIFTOOL_URL,
        headers={"User-Agent": "Mozilla/5.0 (Nightfox Camera DB Builder)"}
    )

    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8")


def parse_models_html(html: str) -> list[dict]:
    """
    Parse camera models from ExifTool's HTML.

    Structure:
    <a name='Make' class=th>Make</a>
    ...
    <td>Model1<br>Model2<br>Model3</td>
    """
    cameras = []

    # Split by manufacturer sections
    # Each manufacturer starts with <a name='...' class=th>Name</a>
    make_pattern = re.compile(
        r"<a\s+name='([^']+)'\s+class=th>([^<]+)</a>.*?</td></tr>\s*<tr[^>]*>(.*?)</tr>",
        re.DOTALL | re.IGNORECASE
    )

    for match in make_pattern.finditer(html):
        make_name = match.group(2).strip()
        models_html = match.group(3)

        # Extract models from <td> cells
        # Models are separated by <br>
        td_pattern = re.compile(r"<td>(.*?)</td>", re.DOTALL | re.IGNORECASE)

        for td_match in td_pattern.finditer(models_html):
            td_content = td_match.group(1)

            # Split by <br> and clean up
            models = re.split(r'<br\s*/?>', td_content, flags=re.IGNORECASE)

            for model in models:
                # Clean up the model name
                model = re.sub(r'<[^>]+>', '', model)  # Remove any HTML tags
                model = model.strip()

                if model and len(model) > 0:
                    cameras.append({
                        "make": make_name,
                        "model": model,
                        "source": "exiftool"
                    })

    # Deduplicate
    seen = set()
    unique_cameras = []
    for cam in cameras:
        key = f"{cam['make'].lower()}|{cam['model'].lower()}"
        if key not in seen:
            seen.add(key)
            unique_cameras.append(cam)

    return unique_cameras


def categorize_camera(make: str, model: str) -> tuple[str, str]:
    """
    Determine category and medium from make/model.
    Returns (category, medium)
    """
    make_lower = make.lower()
    model_lower = model.lower()

    # Cinema cameras
    if any(x in make_lower for x in ['red', 'arri', 'blackmagic']):
        return 'cinema', 'modern'
    if any(x in model_lower for x in ['cinema', 'c300', 'c500', 'c70', 'fx6', 'fx9', 'fs7', 'ursa', 'bmpcc']):
        return 'cinema', 'modern'

    # Action cameras
    if 'gopro' in make_lower or 'hero' in model_lower:
        return 'action', 'modern'
    if 'insta360' in make_lower:
        return 'action', 'modern'

    # Drones
    if 'dji' in make_lower:
        if any(x in model_lower for x in ['mavic', 'phantom', 'inspire', 'mini', 'air', 'spark']):
            return 'drone', 'modern'
        return 'action', 'modern'

    # Smartphones
    smartphone_makes = ['apple', 'google', 'samsung', 'huawei', 'xiaomi', 'oneplus', 'oppo', 'vivo', 'motorola', 'lg', 'htc', 'nokia', 'sony ericsson', 'blackberry', 'zte']
    if any(x in make_lower for x in smartphone_makes):
        if any(x in model_lower for x in ['iphone', 'ipad', 'pixel', 'galaxy', 'phone', 'note', 'mate', 'pro max']):
            return 'smartphone', 'modern'
        # Apple products are mostly phones/tablets
        if 'apple' in make_lower:
            return 'smartphone', 'modern'

    # Scanners
    if 'scanner' in model_lower or 'scan' in model_lower:
        return 'scanner', 'modern'

    # Professional cinema/broadcast
    pro_indicators = ['pmw', 'pxw', 'xdcam', 'hdcam', 'gy-', 'ag-', 'aj-', 'eos c', 'xl1', 'xl2', 'xh a', 'xf']
    if any(x in model_lower for x in pro_indicators):
        return 'professional', 'modern'

    # Professional mirrorless/DSLR
    pro_models = ['1d', '1dx', 'd5', 'd6', 'a9', 'a1', 'z9', 'gh6', 's1h', 'r3']
    if any(x in model_lower for x in pro_models):
        return 'professional', 'modern'

    # Prosumer
    prosumer = ['5d', 'd850', 'd750', 'd810', 'a7', 'gh5', 'gh4', 'x-t', 'x-h', 'xt-', 'z6', 'z7', 'r5', 'r6', 'r7', 'r8']
    if any(x in model_lower for x in prosumer):
        return 'prosumer', 'modern'

    # Consumer camcorders (dadcam indicators)
    dadcam_indicators = [
        'handycam', 'dcr-', 'hdr-', 'hvr-',  # Sony
        'vixia', 'legria', 'elura', 'zr', 'fs', 'hv',  # Canon
        'hc-', 'hdc-', 'nv-', 'pv-', 'sdr-',  # Panasonic
        'everio', 'gz-',  # JVC
        'easyshare', 'playsport',  # Kodak
        'xacti',  # Sanyo
    ]
    if any(x in model_lower for x in dadcam_indicators):
        return 'consumer', 'dadcam'

    # Old compact cameras (pre-2010 era naming)
    old_compact = ['powershot', 'coolpix', 'cybershot', 'exilim', 'finepix', 'optio', 'stylus', 'mju', 'dmc-fx', 'dmc-lx', 'dmc-tz']
    if any(x in model_lower for x in old_compact):
        # Check if it's a really old model (2-3 digit number)
        if re.search(r'[a-z]\d{1,3}$', model_lower):
            return 'consumer', 'dadcam'
        return 'consumer', 'modern'

    # Default: recent cameras are modern
    return 'consumer', 'modern'


def save_results(cameras: list[dict], output_dir: Path):
    """Save parsed cameras to JSON."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # Add category and medium
    for cam in cameras:
        category, medium = categorize_camera(cam['make'], cam['model'])
        cam['category'] = category
        cam['medium'] = medium

    output = {
        "source": "exiftool",
        "url": EXIFTOOL_URL,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "camera_count": len(cameras),
        "cameras": cameras
    }

    output_path = output_dir / "cameras.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Saved {len(cameras)} cameras to {output_path}")

    # Print stats
    makes = set(c['make'] for c in cameras)
    print(f"Manufacturers: {len(makes)}")

    categories = {}
    for c in cameras:
        cat = c.get('category', 'unknown')
        categories[cat] = categories.get(cat, 0) + 1
    print("Categories:", dict(sorted(categories.items(), key=lambda x: -x[1])))

    mediums = {}
    for c in cameras:
        med = c.get('medium', 'unknown')
        mediums[med] = mediums.get(med, 0) + 1
    print("Mediums:", dict(sorted(mediums.items(), key=lambda x: -x[1])))


def main():
    html = fetch_models_html()

    # Save raw HTML for debugging
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_DIR / "models.html", "w") as f:
        f.write(html)
    print(f"Saved raw HTML to {OUTPUT_DIR / 'models.html'}")

    cameras = parse_models_html(html)

    if not cameras:
        print("ERROR: No cameras parsed! Check the HTML structure.")
        return 1

    save_results(cameras, OUTPUT_DIR)
    return 0


if __name__ == "__main__":
    exit(main())
