# ML Models

This directory contains ML model files for the image tagging pipeline.

**Models are NOT committed to git** (too large). Download them using the setup scripts.

## Required Models

### SigLIP (Stage 0 - Scene Classification)

Download with:
```bash
cd scripts/ram-server
source venv/bin/activate  # or create: python3 -m venv venv && source venv/bin/activate
pip install transformers torch onnx onnxscript sentencepiece
python ../download-siglip-onnx.py
```

This creates:
- `siglip-base-patch16-224.onnx` (~1.2MB metadata)
- `siglip-base-patch16-224.onnx.data` (~354MB weights)
- `siglip-base-patch16-224-text-embeddings.json` (precomputed embeddings)
- `siglip-base-patch16-224-info.json` (model info)

## Model Sizes

| Model | Files | Total Size |
|-------|-------|------------|
| SigLIP | 4 | ~355MB |

## Usage

Models are loaded automatically by:
- `scene-classifier.ts` - SigLIP for view type detection
- `image-tagging-service.ts` - Orchestrates the pipeline

If models are missing, the services will log warnings and skip those stages.
