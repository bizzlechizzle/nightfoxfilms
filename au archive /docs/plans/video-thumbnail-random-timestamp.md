# Video Thumbnail Random Timestamp Plan

## Problem

Video thumbnails are missing or showing unhelpful frames because:
1. `PosterFrameService` extracts at a **fixed 1-second timestamp**
2. Many videos have black frames, title cards, or transitions at 1 second
3. No duration-aware logic to pick a representative frame

## Current Flow

```
Video Import → FFmpegService.extractMetadata() → gets duration
            → PosterFrameService.generatePoster() → fixed 1s timestamp
            → ThumbnailService.generateAllSizes() → 400/800/1920px
            → Database stores paths
```

## Solution

Extract poster frame at a **random timestamp between 20-50% of video duration** instead of fixed 1 second.

### Why 20-50%?
- **< 20%**: Often intros, logos, or black frames
- **> 50%**: Risk of hitting credits, endings, or spoilers
- **20-50%**: Usually captures actual content

### Fallback Logic
- If duration unknown or ≤ 3 seconds: use 1 second (current behavior)
- If duration > 3 seconds: random point in 20-50% range

## Files to Modify

### 1. `packages/desktop/electron/services/poster-frame-service.ts`
- Inject FFmpegService dependency (already present)
- Add `getDuration()` call before extraction
- Calculate random timestamp: `Math.random() * (0.5 - 0.2) + 0.2) * duration`
- Fall back to 1 second for short/unknown duration videos

**Changes:**
```typescript
// Current
private readonly DEFAULT_TIMESTAMP = 1;
await this.ffmpegService.extractFrame(sourcePath, posterPath, this.DEFAULT_TIMESTAMP, size);

// New
private calculateTimestamp(duration: number | null): number {
  if (!duration || duration <= 3) return 1; // Fallback for short videos
  const minPercent = 0.2;
  const maxPercent = 0.5;
  const percent = Math.random() * (maxPercent - minPercent) + minPercent;
  return Math.floor(duration * percent);
}

const metadata = await this.ffmpegService.extractMetadata(sourcePath);
const timestamp = this.calculateTimestamp(metadata.duration);
await this.ffmpegService.extractFrame(sourcePath, posterPath, timestamp, size);
```

### 2. `packages/desktop/electron/services/ffmpeg-service.ts`
- No changes needed - already accepts `timestampSeconds` parameter

### 3. `packages/desktop/electron/main/ipc-handlers/media-processing.ts`
- Regeneration handler already calls `posterService.generatePoster()`
- Will automatically use new random timestamp logic
- No changes needed

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Duration unknown | Use 1 second |
| Duration ≤ 3 seconds | Use 1 second |
| Duration > 3 seconds | Random 20-50% |
| Metadata extraction fails | Catch error, use 1 second |
| Very long videos (hours) | Same logic, 20-50% |

## Testing Checklist

1. [ ] Import a video with title card at start - should get mid-video frame
2. [ ] Import a short clip (< 3s) - should still get frame at 1s
3. [ ] Import video with unknown duration - should fall back to 1s
4. [ ] Regenerate existing video thumbnails - should get new random frames
5. [ ] Verify dashboard displays video thumbnails correctly

## Scope

- **In scope**: Random timestamp extraction for video poster frames
- **Out of scope**:
  - User-selectable timestamp UI
  - Multiple frame extraction for "best frame" detection
  - Black frame detection/avoidance algorithms

## Risks

- **Low**: Metadata extraction adds ~50-100ms per video (already happens during import)
- **Low**: Random timestamp could hit a transitional frame (acceptable trade-off vs guaranteed 1s black frame)

## Estimate

Single file change (`poster-frame-service.ts`), ~15 lines of code.
