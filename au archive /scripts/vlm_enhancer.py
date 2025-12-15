#!/usr/bin/env python3
"""
VLM Enhancer - Deep Image Analysis with Qwen3-VL

Stage 2 of the three-stage image tagging pipeline.
Provides rich descriptions, architectural analysis, and condition assessment.

Usage:
    python vlm_enhancer.py --image /path/to/image.jpg
    python vlm_enhancer.py --image /path/to/image.jpg --view-type interior
    python vlm_enhancer.py --image /path/to/image.jpg --tags "building,decay,graffiti"

Output (JSON):
    {
        "description": "Rich natural language description...",
        "caption": "Short caption for alt text",
        "architectural_style": "Art Deco",
        "estimated_period": {"start": 1920, "end": 1940, "confidence": 0.7},
        "condition_assessment": {"overall": "poor", "score": 0.3, "details": "..."},
        "notable_features": ["feature1", "feature2"],
        "search_keywords": ["keyword1", "keyword2"],
        "duration_ms": 5000,
        "model": "qwen3-vl-7b",
        "device": "mps"
    }

Setup:
    cd scripts/vlm-server
    python3 -m venv venv
    source venv/bin/activate
    pip install transformers torch torchvision pillow accelerate
    # Download model on first run

Per CLAUDE.md Rule 9: Local LLMs for background tasks only.
"""

import argparse
import json
import sys
import time
from pathlib import Path

# Check for required dependencies
try:
    import torch
    from PIL import Image
except ImportError as e:
    print(json.dumps({
        "error": f"Missing dependency: {e}. Run: pip install torch torchvision pillow",
        "description": "",
        "caption": "",
        "notable_features": [],
        "search_keywords": [],
        "duration_ms": 0,
        "model": "none",
        "device": "none"
    }))
    sys.exit(1)

# Model loading is deferred for faster startup when checking availability
MODEL = None
PROCESSOR = None
MODEL_NAME = None


def get_device(requested: str = "auto") -> str:
    """Determine best available device."""
    if requested == "mps" and torch.backends.mps.is_available():
        return "mps"
    elif requested == "cuda" and torch.cuda.is_available():
        return "cuda"
    elif requested == "auto":
        if torch.backends.mps.is_available():
            return "mps"
        elif torch.cuda.is_available():
            return "cuda"
    return "cpu"


def load_model(model_name: str = "qwen3-vl", device: str = "auto"):
    """Load VLM model and processor."""
    global MODEL, PROCESSOR, MODEL_NAME

    if MODEL is not None:
        return

    device = get_device(device)

    try:
        from transformers import AutoModelForCausalLM, AutoProcessor

        # Model selection
        model_map = {
            "qwen3-vl": "Qwen/Qwen2-VL-7B-Instruct",  # Latest available
            "qwen2-vl": "Qwen/Qwen2-VL-7B-Instruct",
            "llava": "llava-hf/llava-1.5-7b-hf",
        }

        hf_model = model_map.get(model_name, model_map["qwen3-vl"])

        print(f"Loading {hf_model}...", file=sys.stderr)

        PROCESSOR = AutoProcessor.from_pretrained(hf_model, trust_remote_code=True)

        # Load model with appropriate dtype
        dtype = torch.float16 if device != "cpu" else torch.float32

        MODEL = AutoModelForCausalLM.from_pretrained(
            hf_model,
            torch_dtype=dtype,
            device_map=device if device != "mps" else None,
            trust_remote_code=True,
        )

        if device == "mps":
            MODEL = MODEL.to(device)

        MODEL_NAME = model_name
        print(f"Model loaded on {device}", file=sys.stderr)

    except Exception as e:
        raise RuntimeError(f"Failed to load model {model_name}: {e}")


def build_prompt(
    view_type: str | None = None,
    tags: list[str] | None = None,
    location_type: str | None = None,
    location_name: str | None = None,
    state: str | None = None,
) -> str:
    """Build context-aware analysis prompt."""
    context_parts = []

    if location_name:
        context_parts.append(f"This is an image from '{location_name}'")
    if location_type:
        context_parts.append(f"a {location_type}")
    if state:
        context_parts.append(f"in {state}")
    if view_type and view_type != "unknown":
        context_parts.append(f"showing an {view_type} view")
    if tags:
        context_parts.append(f"Previously identified elements: {', '.join(tags[:15])}")

    context = ". ".join(context_parts) + "." if context_parts else ""

    prompt = f"""{context}

Analyze this image of an abandoned or historic location. Provide:

1. DESCRIPTION: A detailed 2-3 sentence description of what you see.

2. CAPTION: A single concise sentence suitable for alt text.

3. ARCHITECTURAL_STYLE: If visible, identify the architectural style (Art Deco, Mid-Century Modern, Victorian, Industrial, Brutalist, Colonial Revival, etc.) or "unknown".

4. ESTIMATED_PERIOD: Estimate when this structure was likely built based on architectural features. Provide start year, end year, and your reasoning.

5. CONDITION_ASSESSMENT: Assess the current condition:
   - Overall: excellent/good/fair/poor/critical
   - Score: 0.0 (destroyed) to 1.0 (pristine)
   - Key observations about decay, damage, or preservation

6. NOTABLE_FEATURES: List 3-5 notable architectural or historical features visible.

7. SEARCH_KEYWORDS: Suggest 5-8 keywords for finding similar locations.

Respond in JSON format only."""

    return prompt


def analyze_image(
    image_path: str,
    view_type: str | None = None,
    tags: list[str] | None = None,
    location_type: str | None = None,
    location_name: str | None = None,
    state: str | None = None,
    max_tokens: int = 512,
) -> dict:
    """Run VLM analysis on image."""
    global MODEL, PROCESSOR

    if MODEL is None:
        raise RuntimeError("Model not loaded")

    # Load image
    image = Image.open(image_path).convert("RGB")

    # Build prompt
    prompt = build_prompt(view_type, tags, location_type, location_name, state)

    # Prepare inputs (model-specific formatting)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": prompt},
            ],
        }
    ]

    # Process with model
    try:
        text = PROCESSOR.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = PROCESSOR(
            text=[text],
            images=[image],
            padding=True,
            return_tensors="pt",
        )
        inputs = inputs.to(MODEL.device)

        # Generate
        with torch.no_grad():
            outputs = MODEL.generate(
                **inputs,
                max_new_tokens=max_tokens,
                do_sample=True,
                temperature=0.7,
                top_p=0.9,
            )

        # Decode
        response = PROCESSOR.batch_decode(
            outputs[:, inputs.input_ids.shape[1]:],
            skip_special_tokens=True,
        )[0]

        # Parse JSON from response
        return parse_vlm_response(response)

    except Exception as e:
        raise RuntimeError(f"VLM inference failed: {e}")


def parse_vlm_response(response: str) -> dict:
    """Parse VLM response, handling various output formats."""
    # Try to extract JSON from response
    response = response.strip()

    # Handle markdown code blocks
    if "```json" in response:
        start = response.find("```json") + 7
        end = response.find("```", start)
        response = response[start:end].strip()
    elif "```" in response:
        start = response.find("```") + 3
        end = response.find("```", start)
        response = response[start:end].strip()

    try:
        return json.loads(response)
    except json.JSONDecodeError:
        # If JSON parsing fails, extract what we can
        return {
            "description": response[:500] if len(response) > 100 else "Analysis failed",
            "caption": response[:100] if len(response) > 50 else "No caption",
            "architectural_style": None,
            "estimated_period": None,
            "condition_assessment": None,
            "notable_features": [],
            "search_keywords": [],
        }


def main():
    parser = argparse.ArgumentParser(description="VLM deep image analysis")
    parser.add_argument("--image", required=True, help="Path to image file")
    parser.add_argument("--model", default="qwen3-vl", choices=["qwen3-vl", "qwen2-vl", "llava"])
    parser.add_argument("--device", default="auto", choices=["auto", "mps", "cuda", "cpu"])
    parser.add_argument("--max-tokens", type=int, default=512)
    parser.add_argument("--output", default="json", choices=["json", "text"])

    # Context parameters
    parser.add_argument("--view-type", help="View type from Stage 0")
    parser.add_argument("--tags", help="Comma-separated tags from Stage 1")
    parser.add_argument("--location-type", help="Location type from database")
    parser.add_argument("--location-name", help="Location name")
    parser.add_argument("--state", help="State/region")

    args = parser.parse_args()

    # Validate image exists
    if not Path(args.image).exists():
        print(json.dumps({"error": f"Image not found: {args.image}"}))
        sys.exit(1)

    start_time = time.time()

    try:
        # Load model
        load_model(args.model, args.device)

        # Parse tags
        tags = args.tags.split(",") if args.tags else None

        # Run analysis
        result = analyze_image(
            args.image,
            view_type=args.view_type,
            tags=tags,
            location_type=args.location_type,
            location_name=args.location_name,
            state=args.state,
            max_tokens=args.max_tokens,
        )

        duration_ms = int((time.time() - start_time) * 1000)

        # Add metadata
        result["duration_ms"] = duration_ms
        result["model"] = MODEL_NAME or args.model
        result["device"] = get_device(args.device)

        if args.output == "json":
            print(json.dumps(result, indent=2))
        else:
            print(f"Description: {result.get('description', 'N/A')}")
            print(f"Caption: {result.get('caption', 'N/A')}")
            print(f"Style: {result.get('architectural_style', 'N/A')}")
            print(f"Features: {', '.join(result.get('notable_features', []))}")
            print(f"Duration: {duration_ms}ms")

    except Exception as e:
        error_result = {
            "error": str(e),
            "description": "",
            "caption": "",
            "notable_features": [],
            "search_keywords": [],
            "duration_ms": int((time.time() - start_time) * 1000),
            "model": args.model,
            "device": args.device,
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
