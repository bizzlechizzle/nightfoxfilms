#!/usr/bin/env python3
"""
RAM++ Local Inference Script

Runs RAM++ (Recognize Anything Model) locally on Mac with MPS acceleration.
Called by ram-tagging-service.ts as a subprocess for local inference fallback.

Per CLAUDE.md Rule 9: Local LLMs for background tasks only.

Usage:
    python scripts/ram_tagger.py --image /path/to/image.jpg
    python scripts/ram_tagger.py --image /path/to/image.jpg --device mps
    python scripts/ram_tagger.py --image /path/to/image.jpg --threshold 0.5 --max-tags 30

Output:
    JSON to stdout: {"tags": [...], "confidence": {...}, "duration_ms": 123}

Requirements:
    pip install torch torchvision pillow
    pip install git+https://github.com/xinyu1205/recognize-anything.git

    OR for HuggingFace transformers fallback:
    pip install transformers accelerate
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Suppress warnings
os.environ['PYTORCH_ENABLE_MPS_FALLBACK'] = '1'
import warnings
warnings.filterwarnings('ignore')


def load_ram_model(device: str, model_path: str | None = None):
    """
    Load RAM++ model with fallback chain:
    1. Try recognize-anything package (original RAM++)
    2. Try HuggingFace transformers (BLIP-based tagging)
    3. Fail with error
    """
    import torch

    # Try recognize-anything package first
    try:
        from ram.models import ram_plus
        from ram import get_transform

        # Default model path if not specified
        if not model_path:
            # Check common locations
            candidates = [
                Path.home() / '.cache/ram/ram_plus_swin_large_14m.pth',
                Path(__file__).parent / 'ram-server/ram_plus_swin_large_14m.pth',
                Path('/opt/models/ram_plus_swin_large_14m.pth'),
            ]
            for p in candidates:
                if p.exists():
                    model_path = str(p)
                    break

        if model_path and Path(model_path).exists():
            model = ram_plus(pretrained=model_path, image_size=384, vit='swin_l')
            model.eval()
            # Lower threshold to get more tags (default is 0.68 which is conservative)
            model.threshold = 0.5
            model = model.to(device)
            transform = get_transform(image_size=384)
            return model, transform, 'ram++'
        else:
            raise FileNotFoundError(f"RAM++ model not found at {model_path}")

    except ImportError:
        pass
    except Exception as e:
        print(f"RAM++ load failed: {e}", file=sys.stderr)

    # Try HuggingFace transformers (BLIP-based)
    try:
        from transformers import BlipProcessor, BlipForConditionalGeneration

        print("Loading BLIP model from HuggingFace...", file=sys.stderr)
        processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-large")
        model = BlipForConditionalGeneration.from_pretrained(
            "Salesforce/blip-image-captioning-large"
        ).to(device)
        model.eval()

        return (model, processor), None, 'blip'

    except ImportError:
        pass
    except Exception as e:
        print(f"BLIP load failed: {e}", file=sys.stderr)

    # Try RAM with transformers
    try:
        from transformers import AutoProcessor, AutoModelForZeroShotImageClassification

        print("Loading RAM from HuggingFace transformers...", file=sys.stderr)
        processor = AutoProcessor.from_pretrained("xinyu1205/recognize-anything-plus-model")
        model = AutoModelForZeroShotImageClassification.from_pretrained(
            "xinyu1205/recognize-anything-plus-model"
        ).to(device)
        model.eval()

        return (model, processor), None, 'ram-hf'

    except Exception as e:
        print(f"RAM-HF load failed: {e}", file=sys.stderr)

    raise RuntimeError(
        "No tagging model available. Install one of:\n"
        "  pip install git+https://github.com/xinyu1205/recognize-anything.git\n"
        "  pip install transformers accelerate"
    )


def tag_with_ram(model, transform, image_path: str, device: str, threshold: float, max_tags: int):
    """Tag image using original RAM++ model."""
    import torch
    from PIL import Image

    # Generic/unhelpful single-word tags to filter out
    # These add noise without describing the actual content
    STOPLIST = {
        # Verbs/actions that aren't descriptive
        'appear', 'attach', 'back', 'call', 'come', 'contain', 'cover',
        'display', 'feature', 'fill', 'give', 'hang', 'have', 'hold',
        'include', 'keep', 'lead', 'leave', 'lie', 'look', 'make',
        'place', 'put', 'see', 'set', 'show', 'sit', 'stand', 'take',
        'use', 'walk', 'wear', 'write',
        # Generic adjectives
        'big', 'black', 'blue', 'brown', 'dark', 'empty', 'full',
        'green', 'grey', 'large', 'left', 'little', 'long', 'new',
        'old', 'open', 'other', 'red', 'right', 'small', 'white', 'yellow',
        # Generic nouns that don't help identify content
        'area', 'background', 'bottom', 'center', 'corner', 'edge',
        'end', 'front', 'group', 'inside', 'middle', 'outside', 'part',
        'piece', 'row', 'side', 'top', 'view',
        # People-related (often false positives in abandoned places)
        'boy', 'child', 'girl', 'guy', 'kid', 'man', 'people', 'person', 'woman',
        # Too generic
        'build', 'item', 'object', 'stuff', 'thing',
    }

    # Apply threshold to model BEFORE inference
    original_threshold = model.threshold
    original_class_threshold = model.class_threshold.clone()

    model.threshold = threshold
    model.class_threshold = torch.ones_like(model.class_threshold) * threshold

    # Load and transform image
    image = Image.open(image_path).convert('RGB')
    image_tensor = transform(image).unsqueeze(0).to(device)

    # Run inference using model's generate_tag directly
    with torch.no_grad():
        tags_list, tags_zh_list = model.generate_tag(image_tensor)

    # Restore original thresholds
    model.threshold = original_threshold
    model.class_threshold = original_class_threshold

    # Parse results - RAM++ returns pipe-separated tags
    tags_en = tags_list[0] if tags_list else ""
    tag_list = [t.strip() for t in tags_en.split(' | ') if t.strip()]

    confidence_dict = {}
    filtered_tags = []

    # Filter tags: keep multi-word tags (more specific) and meaningful single words
    for tag in tag_list:
        if not tag:
            continue
        # Always keep multi-word tags (e.g., "brick building", "bell tower")
        # For single words, check against stoplist
        if ' ' in tag or tag.lower() not in STOPLIST:
            if len(filtered_tags) < max_tags:
                filtered_tags.append(tag)
                confidence_dict[tag] = 0.9

    return filtered_tags, confidence_dict


def tag_with_blip(model_tuple, image_path: str, device: str, threshold: float, max_tags: int):
    """Tag image using BLIP captioning model (fallback)."""
    import torch
    from PIL import Image

    model, processor = model_tuple
    image = Image.open(image_path).convert('RGB')

    # Generate caption
    inputs = processor(image, return_tensors="pt").to(device)

    with torch.no_grad():
        output = model.generate(**inputs, max_new_tokens=50)

    caption = processor.decode(output[0], skip_special_tokens=True)

    # Extract keywords from caption as "tags"
    # This is a simple fallback - not as good as real RAM++
    words = caption.lower().replace(',', ' ').replace('.', ' ').split()
    stop_words = {'a', 'an', 'the', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and'}

    tags = []
    confidence_dict = {}

    for word in words:
        if word not in stop_words and len(word) > 2 and word not in tags:
            tags.append(word)
            confidence_dict[word] = 0.7  # Fixed confidence for caption-based tags
            if len(tags) >= max_tags:
                break

    return tags, confidence_dict


def tag_with_ram_hf(model_tuple, image_path: str, device: str, threshold: float, max_tags: int):
    """Tag image using RAM from HuggingFace transformers."""
    import torch
    from PIL import Image

    model, processor = model_tuple
    image = Image.open(image_path).convert('RGB')

    # Common tag candidates for abandoned places
    candidate_labels = [
        "abandoned building", "factory", "hospital", "school", "church",
        "decay", "ruins", "graffiti", "broken windows", "overgrown",
        "industrial", "warehouse", "brick", "concrete", "machinery",
        "interior", "exterior", "hallway", "staircase", "roof",
        "urban exploration", "urbex", "derelict", "dilapidated",
        "nature reclaiming", "peeling paint", "rusty", "empty room",
        "old building", "historic", "vintage", "retro"
    ]

    inputs = processor(images=image, text=candidate_labels, return_tensors="pt", padding=True)
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)

    # Get probabilities
    probs = outputs.logits_per_image.softmax(dim=1)[0]

    # Filter and sort by confidence
    results = []
    for label, prob in zip(candidate_labels, probs):
        conf = float(prob.item())
        if conf >= threshold:
            results.append((label, conf))

    results.sort(key=lambda x: x[1], reverse=True)
    results = results[:max_tags]

    tags = [r[0] for r in results]
    confidence_dict = {r[0]: round(r[1], 3) for r in results}

    return tags, confidence_dict


def main():
    parser = argparse.ArgumentParser(description="RAM++ Local Image Tagger")
    parser.add_argument("--image", "-i", required=True, help="Path to image file")
    parser.add_argument("--device", "-d", default="mps",
                        choices=["mps", "cuda", "cpu"],
                        help="Device for inference (default: mps for Mac)")
    parser.add_argument("--threshold", "-t", type=float, default=0.5,
                        help="Minimum confidence threshold (default: 0.5)")
    parser.add_argument("--max-tags", "-m", type=int, default=15,
                        help="Maximum number of tags (default: 15)")
    parser.add_argument("--model", type=str, default=None,
                        help="Path to RAM++ model weights")
    parser.add_argument("--output", "-o", default="json",
                        choices=["json", "text"],
                        help="Output format (default: json)")
    args = parser.parse_args()

    # Validate image exists
    if not Path(args.image).exists():
        print(json.dumps({"error": f"Image not found: {args.image}"}))
        sys.exit(1)

    start_time = time.time()

    try:
        import torch

        # Check device availability
        device = args.device
        if device == "mps" and not torch.backends.mps.is_available():
            print("MPS not available, falling back to CPU", file=sys.stderr)
            device = "cpu"
        elif device == "cuda" and not torch.cuda.is_available():
            print("CUDA not available, falling back to CPU", file=sys.stderr)
            device = "cpu"

        # Load model (suppress library stdout during loading to keep JSON output clean)
        import io
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()  # Capture any stdout during model loading
        try:
            model_data, transform, model_type = load_ram_model(device, args.model)
        finally:
            captured = sys.stdout.getvalue()
            sys.stdout = old_stdout
            if captured.strip():
                print(captured.strip(), file=sys.stderr)  # Redirect to stderr

        # Run inference based on model type
        if model_type == 'ram++':
            tags, confidence = tag_with_ram(
                model_data, transform, args.image, device,
                args.threshold, args.max_tags
            )
        elif model_type == 'blip':
            tags, confidence = tag_with_blip(
                model_data, args.image, device,
                args.threshold, args.max_tags
            )
        elif model_type == 'ram-hf':
            tags, confidence = tag_with_ram_hf(
                model_data, args.image, device,
                args.threshold, args.max_tags
            )
        else:
            raise RuntimeError(f"Unknown model type: {model_type}")

        duration_ms = (time.time() - start_time) * 1000

        result = {
            "tags": tags,
            "confidence": confidence,
            "duration_ms": round(duration_ms, 2),
            "model": model_type,
            "device": device,
        }

        if args.output == "json":
            print(json.dumps(result))
        else:
            print(f"Tags: {', '.join(tags)}")
            print(f"Duration: {duration_ms:.0f}ms")

    except Exception as e:
        error_result = {
            "error": str(e),
            "tags": [],
            "confidence": {},
            "duration_ms": (time.time() - start_time) * 1000,
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
