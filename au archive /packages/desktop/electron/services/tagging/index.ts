/**
 * Image Auto-Tagging Module
 *
 * Three-stage image tagging pipeline:
 * - Stage 0: SigLIP scene classification (view type detection)
 * - Stage 1: Florence-2 context-aware tagging
 * - Stage 2: Qwen3-VL deep enhancement (optional, for hero images)
 *
 * Per CLAUDE.md Rule 9: Local LLMs for background tasks only.
 *
 * @module services/tagging
 */

export * from './urbex-taxonomy';
export * from './image-tagging-service';
export * from './scene-classifier';
export * from './vlm-enhancement-service';
export * from './location-tag-aggregator';
