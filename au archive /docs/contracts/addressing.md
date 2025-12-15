# Address Contract

## Normalization Pipeline

See `electron/services/address-normalizer.ts`:

- State codes forced to two uppercase characters, derived from full names when needed.
- Zipcodes sanitized to `#####` or `#####-####` formats; other characters removed.
- City and county trimmed and title-cased; "County" suffix removed automatically.
- Street kept as entered but whitespace collapsed.

## Normalization Rules

- State codes must be two uppercase letters.
- ZIP codes must be 5 digits or 5+4; other characters stripped.
- City/county title-cased; "County" suffix removed.

## Provider Selection

- Light edition relies on online Nominatim API.
- Offline Beast uses local libpostal data under `resources/libpostal/`.
- Provider name + timestamp stored with every lookup.

## Confidence Labels

`high` (map-confirmed or provider-level), `medium`, `low`; UI surfaces this beside address block.

## User Edits

Manual overrides trump provider data but still pass through normalization; never overwrite verified manual entries without explicit confirmation dialog.

## Cache Rules

- Reverse-geocode results cached per coordinate pair with TTL recorded in SQLite.
- Offline Beast caches are warmed at install time; Light edition caches per session.

## Error Handling

- If provider fails, store failure reason and show retry call-to-action; never write partial data.
- Mapping UI must still allow GPS confirmation even when address lookup is down.
