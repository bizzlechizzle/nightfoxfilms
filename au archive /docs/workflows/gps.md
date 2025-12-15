# GPS Workflow

## GPS-First Philosophy

Map-confirmed GPS coordinates are the highest confidence tier. Always prioritize map verification over metadata.

## Confidence Tiers (Priority Order)

1. **Map-confirmed** (Green) — User right-click or drag on satellite view
2. **High/EXIF** (Blue) — Photo EXIF with accuracy <10 meters
3. **Medium/Reverse** (Amber) — Reverse-geocoded from providers
4. **Low/Manual** (Red) — Manual entry or estimates
5. **None** (Gray) — No GPS data

## Map Interactions

- **Atlas defaults to ESRI satellite** layer for maximum detail
- **Right-click** on map → Add new location at coordinates
- **Shift + drag** existing pin → Move location (updates GPS)
- **Layer toggles** limited to documented set (no experimental layers in Light mode)

## Verification Workflow

1. Create location via form OR map pin
2. If GPS from EXIF/manual, show "Improve GPS" button
3. Click "Improve GPS" → Opens Atlas modal centered on location
4. User confirms or adjusts pin on satellite view
5. Save → Upgrades GPS confidence to "Map-confirmed"
6. Never auto-downgrade confidence (only manual changes or higher-tier sources)

## UI Obligations

- **Marker colors** must map to confidence (defined in ui-spec.md)
- **Forms** show current confidence label + "Improve GPS" button for sub-optimal tiers
- **Atlas** centers on last edited location
- **Exports** can require map-confirmed GPS (block low-confidence exports)

## Field Storage

- `gps_lat`, `gps_lng` — Decimal degrees
- `gps_accuracy_meters` — Numeric accuracy from EXIF or provider
- `gps_source` — Enum: map_confirmed, photo_exif, reverse_geocode, manual
- `gps_verified_on_map` — Boolean, true only after satellite confirmation
- `gps_captured_at` — ISO8601 timestamp
- `gps_leaflet_payload` — JSON debug blob (never mutated by renderer)

## Upgrade Path

Higher-confidence data overwrites lower tiers **only after user confirmation**. Automated processes may only promote, never demote.
