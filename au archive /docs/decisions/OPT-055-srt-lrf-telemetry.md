# OPT-055: SRT Telemetry Extraction

## Status: COMPLETED

## Problem

SRT files from DJI drones contain valuable frame-by-frame telemetry (GPS, altitude, speed, gimbal angles) but currently import as opaque documents with no metadata extraction.

## Solution

### SRT Files
- **Storage**: Keep in `docs` table and `org-doc-[LOC12]/` folder (file needs a home)
- **Parsing**: Detect DJI telemetry format, parse and extract summary
- **Linking**: Store parsed telemetry JSON on matching video record in `vids.srt_telemetry`
- **Standard subtitles**: Import normally as documents, no special handling

### LRF Files
- **No change** - Keep as documents. Not playable as normal video, don't clutter video list.

## Schema Change

```sql
ALTER TABLE vids ADD COLUMN srt_telemetry TEXT; -- JSON blob
```

Example stored data:
```json
{
  "frames": 1847,
  "duration_sec": 61.5,
  "gps_bounds": {
    "min_lat": 42.123,
    "max_lat": 42.129,
    "min_lng": -73.567,
    "max_lng": -73.561
  },
  "altitude_range": {
    "min_m": 45,
    "max_m": 120
  },
  "parsed_from": "DJI_0001.SRT",
  "parsed_at": "2025-12-02T21:00:00Z"
}
```

## Files to Modify

| File | Change |
|------|--------|
| `packages/desktop/electron/main/database.ts` | Add migration for `srt_telemetry` column |
| `packages/desktop/electron/services/srt-telemetry-service.ts` | NEW - Parse DJI SRT format |
| `packages/desktop/electron/services/file-import-service.ts` | Hook SRT parsing after document import |

## DJI SRT Format Reference

```
1
00:00:00,033 --> 00:00:00,066
F/2.8, SS 320, ISO 100, EV 0, GPS (42.1234, -73.5678, 150), D 25.2m, H 45.3m, HS 5.2m/s, VS 0.0m/s
```

Key fields:
- `GPS (lat, lng, alt)` - Position with altitude
- `D` - Distance from home point
- `H` - Height/altitude
- `HS` - Horizontal speed
- `VS` - Vertical speed

## Implementation Steps

1. Add `srt_telemetry` column to `vids` table (migration 46)
2. Create `srt-telemetry-service.ts` with:
   - `isDjiTelemetry(content: string): boolean` - detect DJI format
   - `parseDjiSrt(content: string): TelemetrySummary` - extract data
3. In import flow, after SRT imports as document:
   - Read file content, check if DJI telemetry
   - If yes, find matching video by basename (DJI_0001.SRT → DJI_0001.MP4)
   - Parse and store summary on video record

## Acceptance Criteria

- [x] `srt_telemetry` column added to `vids` table
- [x] DJI telemetry SRT files detected by content
- [x] Telemetry summary (GPS bounds, altitude range, duration) parsed and stored
- [x] SRT linked to matching video by filename
- [x] Standard subtitle SRT files import normally (no parsing)
- [x] SRT file itself stored in documents (has a home)
