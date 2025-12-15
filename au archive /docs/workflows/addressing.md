# Addressing Workflow

## Address Normalization Pipeline

See `electron/services/address-normalizer.ts` for implementation.

### Normalization Rules

1. **State codes** — Forced to 2 uppercase letters, derived from full names when needed
2. **ZIP codes** — Sanitized to `#####` or `#####-####`, other characters stripped
3. **City/county** — Title-cased, "County" suffix removed automatically
4. **Street** — Kept as entered, whitespace collapsed

## Provider Selection

### Light Edition
- Uses online **Nominatim API** (OpenStreetMap)
- Requires internet connection
- Results cached per session

### Offline Beast
- Uses local **libpostal** data under `resources/libpostal/`
- No internet required
- Caches warmed at install time

Provider name + timestamp stored with every lookup.

## Confidence Labels

- **high** — Map-confirmed or provider-level precision
- **medium** — City-level precision
- **low** — County or state-level only

UI surfaces confidence beside address block.

## User Edit Flow

1. User edits address fields manually
2. Manual entries still pass through normalization
3. **Manual overrides trump provider data**
4. Never overwrite verified manual entries without explicit confirmation dialog

## Cache Rules

- Reverse-geocode results cached per coordinate pair
- TTL recorded in SQLite
- Offline Beast: Caches warmed at install
- Light: Caches per session, cleared on restart

## Error Handling

- If provider fails → Store failure reason, show retry call-to-action
- **Never write partial data**
- Mapping UI must still allow GPS confirmation even when address lookup is down
- Fallback chain: full address → city → zipcode → county → state

## Cascade Geocoding

For locations with partial addresses, try cascading lookups:
1. Full address
2. City + state
3. Zipcode
4. County + state
5. State only

Return highest-confidence match.
