# GPS Contract

## Fields and Invariants

- `gps_lat` / `gps_lng`: Decimal degrees, stored whenever confidence is not `none`.
- `gps_accuracy_meters`: Numeric accuracy from EXIF or provider; defaults to null for manual entries.
- `gps_source`: Enum (`map_confirmed`, `photo_exif`, `reverse_geocode`, `manual`).
- `gps_verified_on_map`: Boolean, true only after satellite confirmation.
- `gps_captured_at`: ISO8601 timestamp of the reading.
- `gps_leaflet_payload`: JSON blob of the pointer event (used for debugging, never mutated by renderer).

## Priority Order

Top tier wins, recorded in a `gps_confidence` field per `docs/workflows/gps.md`:

1. Map-confirmed coordinates (user right-click or drag on satellite view).
2. Photo EXIF coordinates with accuracy under 10 meters.
3. Reverse-geocoded coordinates from providers.
4. Manual coordinates or estimates.

## Upgrade Path

Higher-confidence data overwrites lower tiers only after user confirmation; automated processes may only promote, never demote.

## UI Obligations

- Marker colors map to confidence (green, blue, amber, red, gray as defined in UI spec).
- Atlas defaults to satellite layer and centers on last edited location.
- Forms show current confidence label plus button to "Improve GPS" that opens the map modal.

## Display Contract

| Confidence | Color | Default action |
| --- | --- | --- |
| Map confirmed | Green | Treat as ground truth; only editable via "Improve GPS" modal |
| High (EXIF) | Blue | Encourage map verification tooltip |
| Medium (reverse) | Amber | Show "Verify on map" call-to-action |
| Low/manual | Red | Block exports that require verified coordinates |
| None | Gray | Hide from map, list as "Needs GPS" |

## GPS Map Interactions

- Atlas defaults to ESRI satellite.
- Right-click adds location; hold shift to drag existing pins (per `docs/workflows/gps.md`).
- Layer toggles limited to documented set; no experimental layers in Light mode.
