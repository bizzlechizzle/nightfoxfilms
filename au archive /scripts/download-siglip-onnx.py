#!/usr/bin/env python3
"""
Download and export SigLIP model to ONNX format.

This script:
1. Downloads SigLIP-base-patch16-224 from Hugging Face
2. Exports the vision encoder to ONNX format
3. Precomputes text embeddings for scene classification prompts
4. Saves everything to resources/models/

Usage:
    python scripts/download-siglip-onnx.py
    python scripts/download-siglip-onnx.py --model google/siglip-base-patch16-224
    python scripts/download-siglip-onnx.py --output-dir ./custom/path
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Check for required packages
try:
    import torch
    from transformers import AutoProcessor, AutoModel
    import numpy as np
except ImportError as e:
    print(f"Missing required package: {e}")
    print("\nInstall required packages with:")
    print("  pip install torch transformers numpy onnx")
    sys.exit(1)


# Scene classification prompts (must match scene-classifier.ts)
VIEW_TYPE_PROMPTS = {
    "interior": [
        "interior of an abandoned building",
        "inside an empty room with decay",
        "indoor photograph of a derelict space",
        "hallway of an abandoned facility",
        "inside a deserted building",
    ],
    "exterior": [
        "exterior of an abandoned building",
        "outside view of a derelict structure",
        "facade of an abandoned factory",
        "abandoned building from outside",
        "outdoor photograph of empty building",
    ],
    "aerial": [
        "aerial view of abandoned buildings",
        "drone photograph of derelict property",
        "overhead view of empty industrial site",
        "birds eye view of abandoned complex",
        "aerial photograph of ruins",
    ],
    "detail": [
        "close-up detail of decay and rust",
        "macro shot of peeling paint",
        "detail photograph of abandoned equipment",
        "closeup of deteriorating surface",
        "texture detail of urban decay",
    ],
}


def export_siglip_to_onnx(
    model_name: str = "google/siglip-base-patch16-224",
    output_dir: str = None,
):
    """Export SigLIP vision encoder to ONNX and compute text embeddings."""

    if output_dir is None:
        # Default to resources/models relative to project root
        script_dir = Path(__file__).parent
        output_dir = script_dir.parent / "resources" / "models"

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading model: {model_name}")
    print(f"Output directory: {output_dir}")

    # Load model and processor
    processor = AutoProcessor.from_pretrained(model_name)
    model = AutoModel.from_pretrained(model_name)
    model.eval()

    # Determine device
    if torch.backends.mps.is_available():
        device = torch.device("mps")
        print("Using MPS (Apple Silicon) acceleration")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
        print("Using CUDA acceleration")
    else:
        device = torch.device("cpu")
        print("Using CPU")

    model = model.to(device)

    # =========================================================================
    # Export Vision Encoder to ONNX
    # =========================================================================
    print("\n[1/3] Exporting vision encoder to ONNX...")

    onnx_path = output_dir / "siglip-base-patch16-224.onnx"

    # Create dummy input for tracing
    dummy_image = torch.randn(1, 3, 224, 224).to(device)

    # We need to export just the vision encoder part
    class VisionEncoder(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.vision_model = model.vision_model

        def forward(self, pixel_values):
            outputs = self.vision_model(pixel_values)
            # Return the pooled output (CLS token embedding)
            return outputs.pooler_output

    vision_encoder = VisionEncoder(model)
    vision_encoder.eval()

    # Move model back to CPU for ONNX export (more compatible)
    vision_encoder = vision_encoder.to("cpu")
    dummy_image = dummy_image.to("cpu")

    # Export to ONNX
    torch.onnx.export(
        vision_encoder,
        dummy_image,
        str(onnx_path),
        input_names=["pixel_values"],
        output_names=["image_embeds"],
        dynamic_axes={
            "pixel_values": {0: "batch_size"},
            "image_embeds": {0: "batch_size"},
        },
        opset_version=14,
        do_constant_folding=True,
    )

    print(f"   Saved vision encoder to: {onnx_path}")

    # Verify ONNX model
    try:
        import onnx
        onnx_model = onnx.load(str(onnx_path))
        onnx.checker.check_model(onnx_model)
        print("   ONNX model verification: PASSED")
    except ImportError:
        print("   ONNX verification skipped (onnx package not installed)")
    except Exception as e:
        print(f"   ONNX verification warning: {e}")

    # Get file size
    size_mb = onnx_path.stat().st_size / (1024 * 1024)
    print(f"   Model size: {size_mb:.1f} MB")

    # =========================================================================
    # Compute Text Embeddings
    # =========================================================================
    print("\n[2/3] Computing text embeddings for classification prompts...")

    # Move model back to device for inference
    model = model.to(device)

    all_prompts = []
    for view_type, prompts in VIEW_TYPE_PROMPTS.items():
        all_prompts.extend(prompts)

    print(f"   Processing {len(all_prompts)} prompts...")

    text_embeddings = {}

    with torch.no_grad():
        for prompt in all_prompts:
            # Process text
            inputs = processor(text=[prompt], return_tensors="pt", padding=True)
            inputs = {k: v.to(device) for k, v in inputs.items() if k != "pixel_values"}

            # Get text embedding
            text_outputs = model.text_model(**inputs)
            text_embed = text_outputs.pooler_output.squeeze().cpu().numpy()

            # Normalize embedding
            text_embed = text_embed / np.linalg.norm(text_embed)

            text_embeddings[prompt] = text_embed.tolist()

    # Save embeddings
    embeddings_path = output_dir / "siglip-base-patch16-224-text-embeddings.json"
    with open(embeddings_path, "w") as f:
        json.dump(text_embeddings, f)

    print(f"   Saved {len(text_embeddings)} text embeddings to: {embeddings_path}")

    # =========================================================================
    # Create Model Info
    # =========================================================================
    print("\n[3/3] Creating model info...")

    info = {
        "model_name": model_name,
        "model_type": "siglip",
        "input_size": 224,
        "embedding_dim": model.config.vision_config.hidden_size,
        "normalization": {"mean": [0.5, 0.5, 0.5], "std": [0.5, 0.5, 0.5]},
        "onnx_file": "siglip-base-patch16-224.onnx",
        "embeddings_file": "siglip-base-patch16-224-text-embeddings.json",
        "view_types": list(VIEW_TYPE_PROMPTS.keys()),
        "prompts_per_type": {k: len(v) for k, v in VIEW_TYPE_PROMPTS.items()},
    }

    info_path = output_dir / "siglip-base-patch16-224-info.json"
    with open(info_path, "w") as f:
        json.dump(info, f, indent=2)

    print(f"   Saved model info to: {info_path}")

    # =========================================================================
    # Summary
    # =========================================================================
    print("\n" + "=" * 60)
    print("SUCCESS! SigLIP model exported and ready for use.")
    print("=" * 60)
    print(f"\nFiles created:")
    print(f"  - {onnx_path}")
    print(f"  - {embeddings_path}")
    print(f"  - {info_path}")
    print(f"\nTotal size: {sum(f.stat().st_size for f in output_dir.glob('siglip*')) / (1024 * 1024):.1f} MB")
    print("\nThe scene classifier service can now use these files.")


def main():
    parser = argparse.ArgumentParser(
        description="Download and export SigLIP model to ONNX format"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="google/siglip-base-patch16-224",
        help="HuggingFace model name (default: google/siglip-base-patch16-224)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Output directory (default: resources/models/)",
    )

    args = parser.parse_args()

    export_siglip_to_onnx(
        model_name=args.model,
        output_dir=args.output_dir,
    )


if __name__ == "__main__":
    main()
