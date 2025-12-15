#!/usr/bin/env python3
"""
Florence-2 Image Tagger

Stage 1 of the image tagging pipeline.
Replaces RAM++ with Florence-2-large for context-aware tagging.

Uses dynamic prompts built from:
- view_type (from Stage 0 scene classifier)
- location_type (from database)
- state/region (from database)

Usage:
    python florence_tagger.py --image /path/to/image.jpg
    python florence_tagger.py --image /path/to/image.jpg --view-type interior --location-type hospital
    python florence_tagger.py --image /path/to/image.jpg --output text

Per CLAUDE.md Rule 9: Local LLMs for background tasks only.
"""

import argparse
import json
import sys
import time
from pathlib import Path

# Check for required packages
try:
    import torch
    from PIL import Image
    from transformers import AutoProcessor, AutoModelForCausalLM
except ImportError as e:
    print(json.dumps({
        "error": f"Missing required package: {e}",
        "tags": [],
        "confidence": {},
    }))
    sys.exit(1)


# ============================================================================
# Configuration
# ============================================================================

MODEL_NAME = "microsoft/Florence-2-large"
DEFAULT_DEVICE = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"

# Stoplist of generic tags to filter out (same as RAM++)
STOPLIST = {
    'appear', 'attach', 'back', 'call', 'click', 'close', 'dark', 'day',
    'different', 'display', 'down', 'each', 'end', 'even', 'every', 'face',
    'field', 'fill', 'find', 'first', 'follow', 'free', 'front', 'full',
    'game', 'give', 'go', 'group', 'hang', 'high', 'hold', 'include', 'keep',
    'large', 'last', 'lay', 'lead', 'leave', 'left', 'light', 'line', 'live',
    'long', 'look', 'low', 'main', 'make', 'many', 'move', 'new', 'next',
    'old', 'open', 'other', 'part', 'place', 'play', 'point', 'put', 'read',
    'rest', 'right', 'run', 'same', 'set', 'show', 'side', 'sit', 'small',
    'stand', 'start', 'still', 'stop', 'take', 'tall', 'thing', 'top', 'turn',
    'two', 'use', 'view', 'wait', 'walk', 'watch', 'white', 'work', 'write',
    'young', 'image', 'photo', 'photograph', 'picture', 'shot',
}

# Urbex-relevant tag categories to boost
URBEX_BOOST_TAGS = {
    'abandoned', 'decay', 'ruin', 'derelict', 'empty', 'broken', 'damaged',
    'graffiti', 'rust', 'peeling', 'crumbling', 'overgrown', 'debris',
    'industrial', 'factory', 'warehouse', 'hospital', 'asylum', 'school',
    'prison', 'church', 'theater', 'hotel', 'mill', 'power plant',
    'brick', 'concrete', 'metal', 'wood', 'glass', 'tile', 'ceiling',
    'hallway', 'corridor', 'staircase', 'window', 'door', 'roof',
    'equipment', 'machinery', 'pipe', 'tank', 'boiler', 'generator',
}


# ============================================================================
# Model Management
# ============================================================================

_model = None
_processor = None


def load_model(device: str = DEFAULT_DEVICE):
    """Load Florence-2 model and processor."""
    global _model, _processor

    if _model is not None:
        return _model, _processor

    print(f"Loading Florence-2 model on {device}...", file=sys.stderr)
    start = time.time()

    _processor = AutoProcessor.from_pretrained(MODEL_NAME, trust_remote_code=True)
    _model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME,
        torch_dtype=torch.float16 if device != "cpu" else torch.float32,
        trust_remote_code=True,
    ).to(device)
    _model.eval()

    print(f"Model loaded in {time.time() - start:.1f}s", file=sys.stderr)
    return _model, _processor


# ============================================================================
# Prompt Construction
# ============================================================================

def build_prompt(
    view_type: str | None = None,
    location_type: str | None = None,
    state: str | None = None,
) -> str:
    """
    Build a context-aware prompt for Florence-2.

    Examples:
    - "Describe this interior photograph of an abandoned hospital in detail."
    - "Describe this exterior photograph of an abandoned building in New York."
    - "Describe this photograph in detail."
    """
    parts = []

    # View type
    if view_type and view_type != "unknown":
        parts.append(f"this {view_type} photograph")
    else:
        parts.append("this photograph")

    # Location type
    if location_type:
        parts.append(f"of an abandoned {location_type}")
    else:
        parts.append("of an abandoned building")

    # State/region
    if state:
        parts.append(f"in {state}")

    prompt = "Describe " + " ".join(parts) + " in detail. List all visible objects, architectural features, conditions, and notable details."

    return prompt


def build_caption_prompt(
    view_type: str | None = None,
    location_type: str | None = None,
) -> str:
    """Build a simpler caption prompt for tag extraction."""
    if view_type and view_type != "unknown":
        if location_type:
            return f"<MORE_DETAILED_CAPTION>An {view_type} view of an abandoned {location_type}"
        return f"<MORE_DETAILED_CAPTION>An {view_type} view of an abandoned building"
    if location_type:
        return f"<MORE_DETAILED_CAPTION>An abandoned {location_type}"
    return "<MORE_DETAILED_CAPTION>"


# ============================================================================
# Tag Extraction
# ============================================================================

def extract_tags_from_caption(caption: str) -> list[str]:
    """Extract individual tags from a detailed caption."""
    import re

    # Normalize text
    text = caption.lower()

    # Split into words and phrases
    words = re.findall(r'\b[a-z]+(?:\s+[a-z]+)?\b', text)

    # Filter and deduplicate
    tags = []
    seen = set()

    for word in words:
        # Skip stoplist
        if word in STOPLIST:
            continue

        # Skip very short words
        if len(word) < 3:
            continue

        # Skip already seen
        if word in seen:
            continue

        seen.add(word)
        tags.append(word)

    return tags


def calculate_confidence(tags: list[str], caption: str) -> dict[str, float]:
    """
    Calculate confidence scores for tags based on occurrence and relevance.

    Tags that appear in urbex-relevant categories get boosted confidence.
    """
    confidence = {}
    caption_lower = caption.lower()

    for tag in tags:
        # Base confidence from occurrence count
        count = caption_lower.count(tag)
        base_conf = min(0.9, 0.5 + (count - 1) * 0.1)

        # Boost for urbex-relevant tags
        if tag in URBEX_BOOST_TAGS or any(b in tag for b in URBEX_BOOST_TAGS):
            base_conf = min(0.95, base_conf + 0.15)

        confidence[tag] = round(base_conf, 3)

    return confidence


def calculate_quality_score(tags: list[str], view_type: str | None) -> float:
    """
    Calculate image quality score for hero selection.

    Factors:
    - Number of tags (more = more interesting)
    - View type (exterior preferred)
    - Presence of urbex-relevant tags
    """
    score = 0.5

    # Tag count bonus (up to +0.2)
    tag_bonus = min(0.2, len(tags) * 0.01)
    score += tag_bonus

    # View type bonus
    if view_type == "exterior":
        score += 0.15
    elif view_type == "aerial":
        score += 0.1
    elif view_type == "interior":
        score += 0.05

    # Urbex tag bonus
    urbex_count = sum(1 for t in tags if t in URBEX_BOOST_TAGS)
    score += min(0.15, urbex_count * 0.02)

    return round(min(1.0, score), 3)


# ============================================================================
# Main Tagging Function
# ============================================================================

def tag_image(
    image_path: str,
    view_type: str | None = None,
    location_type: str | None = None,
    state: str | None = None,
    device: str = DEFAULT_DEVICE,
    max_tags: int = 30,
) -> dict:
    """
    Tag an image using Florence-2.

    Returns:
        {
            "tags": ["tag1", "tag2", ...],
            "confidence": {"tag1": 0.85, "tag2": 0.72, ...},
            "caption": "Detailed description...",
            "quality_score": 0.75,
            "duration_ms": 1234,
            "model": "florence-2-large",
            "device": "mps"
        }
    """
    start_time = time.time()

    # Load model
    model, processor = load_model(device)

    # Load image
    try:
        image = Image.open(image_path).convert("RGB")
    except Exception as e:
        return {
            "error": f"Failed to load image: {e}",
            "tags": [],
            "confidence": {},
        }

    # Build prompt
    prompt = build_caption_prompt(view_type, location_type)

    # Process with Florence-2
    inputs = processor(text=prompt, images=image, return_tensors="pt").to(device)

    with torch.no_grad():
        generated_ids = model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=512,
            early_stopping=False,
            do_sample=False,
            num_beams=3,
        )

    # Decode output
    generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]

    # Parse the Florence-2 output
    parsed = processor.post_process_generation(
        generated_text,
        task="<MORE_DETAILED_CAPTION>",
        image_size=(image.width, image.height),
    )

    caption = parsed.get("<MORE_DETAILED_CAPTION>", generated_text)

    # Extract tags from caption
    tags = extract_tags_from_caption(caption)[:max_tags]

    # Calculate confidence
    confidence = calculate_confidence(tags, caption)

    # Sort by confidence
    tags = sorted(tags, key=lambda t: confidence.get(t, 0), reverse=True)

    # Calculate quality score
    quality_score = calculate_quality_score(tags, view_type)

    duration_ms = int((time.time() - start_time) * 1000)

    return {
        "tags": tags,
        "confidence": confidence,
        "caption": caption,
        "quality_score": quality_score,
        "duration_ms": duration_ms,
        "model": "florence-2-large",
        "device": device,
    }


# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Tag images using Florence-2 with context-aware prompts"
    )
    parser.add_argument(
        "--image", "-i",
        type=str,
        required=True,
        help="Path to image file",
    )
    parser.add_argument(
        "--view-type", "-v",
        type=str,
        choices=["interior", "exterior", "aerial", "detail", "unknown"],
        default=None,
        help="View type from Stage 0 classifier",
    )
    parser.add_argument(
        "--location-type", "-l",
        type=str,
        default=None,
        help="Location type (hospital, factory, school, etc.)",
    )
    parser.add_argument(
        "--state", "-s",
        type=str,
        default=None,
        help="State or region name",
    )
    parser.add_argument(
        "--device", "-d",
        type=str,
        choices=["mps", "cuda", "cpu"],
        default=DEFAULT_DEVICE,
        help=f"Device to run on (default: {DEFAULT_DEVICE})",
    )
    parser.add_argument(
        "--max-tags",
        type=int,
        default=30,
        help="Maximum number of tags to return (default: 30)",
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        choices=["json", "text"],
        default="json",
        help="Output format (default: json)",
    )

    args = parser.parse_args()

    # Validate image path
    image_path = Path(args.image)
    if not image_path.exists():
        print(json.dumps({"error": f"Image not found: {args.image}", "tags": [], "confidence": {}}))
        sys.exit(1)

    # Tag the image
    result = tag_image(
        str(image_path),
        view_type=args.view_type,
        location_type=args.location_type,
        state=args.state,
        device=args.device,
        max_tags=args.max_tags,
    )

    # Output
    if args.output == "json":
        print(json.dumps(result))
    else:
        print(f"Model: {result.get('model', 'unknown')}")
        print(f"Device: {result.get('device', 'unknown')}")
        print(f"Duration: {result.get('duration_ms', 0)}ms")
        print(f"Quality Score: {result.get('quality_score', 0):.2f}")
        print(f"\nCaption: {result.get('caption', 'N/A')}")
        print(f"\nTags ({len(result.get('tags', []))}):")
        for tag in result.get("tags", []):
            conf = result.get("confidence", {}).get(tag, 0)
            print(f"  {tag}: {conf:.2f}")


if __name__ == "__main__":
    main()
