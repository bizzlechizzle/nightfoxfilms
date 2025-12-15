# AU Archive Script Documentation (LILBITS)

Version: 0.1.0
Last Updated: 2025-11-21

---

## Purpose

This file documents every script in the AU Archive codebase following the LILBITS rule: One Script = One Function, maximum 300 lines of code per script.

Each entry includes:
- Script path
- Purpose (single sentence)
- Function signature
- Input parameters
- Output/return value
- Dependencies
- Example usage
- Line count

---

## Golden Rule: LILBITS

One Script = One Function
Maximum 300 lines of code per script
Break up larger scripts into smaller, focused modules
Each script documented here

---

## Core Package Scripts

### packages/core/src/domain/location.ts

Purpose: Location entity model with business logic and validation

Exports:
- LocationEntity class
- GPSCoordinatesSchema (Zod)
- AddressSchema (Zod)
- LocationInputSchema (Zod)
- LocationSchema (Zod)

Key Methods:
```typescript
LocationEntity.generateShortName(name: string): string
// Generates 12-character slug from location name
// Input: Full location name
// Output: Slugified 12-char string
// Example: "Old Factory Building" -> "old-facto"

LocationEntity.generateLoc12(uuid: string): string
// Generates 12-character ID from UUID
// Input: UUID string
// Output: First 12 chars of UUID without hyphens
// Example: "a3d5e8f9-c1b2-d4e6-f8a0-c2d4e6f8a0c2" -> "a3d5e8f9c1b2"

LocationEntity.getGPSConfidence(): GPSConfidence
// Determines GPS accuracy level
// Input: None (uses instance data)
// Output: 'verified' | 'high' | 'medium' | 'low' | 'none'
// Example: Map-clicked + verified -> 'verified'

LocationEntity.needsMapVerification(): boolean
// Checks if GPS needs user verification
// Input: None
// Output: true if gps_verified_on_map is false
// Example: Geocoded address -> true

LocationEntity.hasValidGPS(): boolean
// Validates GPS coordinates are within bounds
// Input: None
// Output: true if lat/lng are valid
// Example: lat=91 -> false (out of range)

LocationEntity.getFullAddress(): string | null
// Formats full address string
// Input: None
// Output: Comma-separated address or null
// Example: "123 Main St, Albany, NY, 12084"

LocationEntity.getDisplayName(): string
// Gets display name with AKA if exists
// Input: None
// Output: Name string
// Example: "Old Factory (Smith Mill)"
```

Dependencies:
- zod (validation)
- slugify (name generation)

Line Count: ~150 lines

---

### packages/core/src/domain/media.ts

Purpose: Image, Video, Document, and Map entity schemas

Exports:
- ImageSchema (Zod)
- VideoSchema (Zod)
- DocumentSchema (Zod)
- MapSchema (Zod)
- Type definitions for each

Key Schemas:
- BaseMediaSchema: Common fields (locid, subid, auth_imp)
- Image: SHA256, paths, EXIF metadata
- Video: SHA256, paths, FFmpeg metadata
- Document: SHA256, paths, document metadata
- Map: SHA256, paths, map-specific metadata

Dependencies:
- zod (validation)

Line Count: ~80 lines

---

### packages/core/src/repositories/location-repository.ts

Purpose: Location repository interface (abstract)

Exports:
- LocationRepository interface
- LocationFilters interface

Methods:
```typescript
create(input: LocationInput): Promise<Location>
// Creates new location
// Input: LocationInput object
// Output: Created Location object
// Throws: Validation error, database error

findById(id: string): Promise<Location | null>
// Finds location by ID
// Input: Location UUID
// Output: Location or null if not found
// Throws: Database error

findAll(filters?: LocationFilters): Promise<Location[]>
// Finds all locations with optional filters
// Input: Optional filters (state, type, hasGPS, search)
// Output: Array of Location objects
// Throws: Database error

update(id: string, input: Partial<LocationInput>): Promise<Location>
// Updates existing location
// Input: Location ID + partial update data
// Output: Updated Location object
// Throws: Not found error, validation error, database error

delete(id: string): Promise<void>
// Deletes location
// Input: Location UUID
// Output: None
// Throws: Not found error, database error

count(filters?: LocationFilters): Promise<number>
// Counts locations with optional filters
// Input: Optional filters
// Output: Count number
// Throws: Database error
```

Dependencies:
- @au-archive/core/domain (Location types)

Line Count: ~30 lines (interface only)

---

## Desktop Package Scripts

### packages/desktop/electron/database/connection.ts

Purpose: SQLite database connection management

Exports:
```typescript
getDatabase(): Database
// Gets or creates database connection
// Input: None (uses Electron userData path)
// Output: better-sqlite3 Database instance
// Side effects: Creates database file if not exists, runs schema.sql
// Example: const db = getDatabase();

closeDatabase(): void
// Closes database connection
// Input: None
// Output: None
// Side effects: Closes connection, sets db to null
// Example: closeDatabase(); // Call on app quit
```

Dependencies:
- better-sqlite3
- electron (for userData path)
- fs (file system)
- path

Line Count: ~40 lines

---

### packages/desktop/electron/database/schema.sql

Purpose: Database schema definition (SQL file, not TypeScript)

Tables Created:
- locs (locations)
- slocs (sub-locations)
- imgs (images)
- vids (videos)
- docs (documents)
- maps (maps)
- settings (app settings)

Indexes Created:
- idx_locs_state (on address_state)
- idx_locs_type (on type)
- idx_locs_gps (on gps_lat, gps_lng)
- idx_locs_loc12 (on loc12)
- idx_slocs_locid (on locid)
- idx_imgs_locid, idx_imgs_subid, idx_imgs_sha
- Similar indexes for vids, docs, maps

Line Count: ~200 lines SQL

---

### packages/desktop/electron/repositories/sqlite-location-repository.ts

Purpose: SQLite implementation of LocationRepository

Exports:
- SQLiteLocationRepository class

Constructor:
```typescript
constructor(db: Database)
// Input: better-sqlite3 Database instance
// Example: new SQLiteLocationRepository(getDatabase())
```

Methods:
Implements all LocationRepository interface methods using better-sqlite3 prepared statements.

Key Implementation Details:
- Uses prepared statements for all queries
- Handles JSON serialization for GPS metadata
- Maps database rows to Location domain objects
- Handles NULL values appropriately

Dependencies:
- better-sqlite3
- crypto (for UUID generation)
- @au-archive/core/repositories (interface)
- @au-archive/core/domain (Location types)

Line Count: ~200 lines

---

## Utility Scripts (Future)

### packages/core/src/utils/crypto.ts

Purpose: SHA256 hash calculation for files

Function:
```typescript
calculateSHA256(filePath: string): Promise<string>
// Calculates SHA256 hash of file
// Input: Absolute file path
// Output: SHA256 hash as hex string
// Example: "a3d5e8f9c1b2d4e6f8a0c2d4e6f8a0c2..."
```

Dependencies:
- Node crypto
- fs/promises (streams)

Line Count: ~30 lines (estimated)
Status: Not yet implemented

---

### packages/core/src/utils/slugify.ts

Purpose: Wrapper for slugify library with project defaults

Function:
```typescript
generateSlug(text: string, maxLength?: number): string
// Generates URL-safe slug
// Input: Text string, optional max length
// Output: Slugified string
// Example: "Old Factory!" -> "old-factory"
```

Dependencies:
- slugify

Line Count: ~20 lines (estimated)
Status: Not yet implemented

---

### packages/core/src/utils/distance.ts

Purpose: Calculate distance between GPS coordinates

Function:
```typescript
calculateDistance(
  gps1: { lat: number; lng: number },
  gps2: { lat: number; lng: number }
): number
// Calculates distance in meters using Haversine formula
// Input: Two GPS coordinate objects
// Output: Distance in meters
// Example: { lat: 42.65, lng: -73.75 }, { lat: 42.66, lng: -73.76 } -> 1234
```

Dependencies:
- None (pure math)

Line Count: ~30 lines (estimated)
Status: Not yet implemented

---

## Service Scripts (Future)

### packages/desktop/electron/services/import-service.ts

Purpose: File import pipeline

Class: ImportService

Methods:
```typescript
import(filePath: string, locId: string): Promise<ImportResult>
// Imports file to location
// Steps:
// 1. Calculate SHA256
// 2. Check for duplicate
// 3. Extract metadata
// 4. Copy/hardlink to archive
// 5. Verify integrity
// 6. Insert database record
// 7. Delete original (if setting enabled)

extractMetadata(filePath: string): Promise<Metadata>
// Delegates to ExifTool or FFmpeg based on file type

determineFileType(filePath: string): FileType
// Returns 'image' | 'video' | 'document' | 'map' | 'unknown'

createFolderStructure(location: Location): Promise<void>
// Creates organized folder structure for location
```

Dependencies:
- fs-extra
- path
- crypto utils
- exiftool-vendored
- fluent-ffmpeg
- Location repository

Line Count: ~280 lines (estimated)
Status: Not yet implemented

---

### packages/desktop/electron/services/geocoding-service.ts

Purpose: Reverse geocoding via Nominatim API

Class: GeocodingService

Methods:
```typescript
reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult>
// Calls Nominatim API to get address from GPS
// Input: Latitude, Longitude
// Output: Address object with city, state, etc.
// Includes caching to reduce API calls

forwardGeocode(address: string): Promise<GPSCoordinates[]>
// (Future) Search address to get GPS coordinates
```

Dependencies:
- node-fetch or axios
- Cache library (optional)

Line Count: ~150 lines (estimated)
Status: Not yet implemented

---

### packages/desktop/electron/services/exiftool-service.ts

Purpose: EXIF metadata extraction wrapper

Class: ExifToolService

Methods:
```typescript
extract(filePath: string): Promise<ExifMetadata>
// Extracts EXIF data from image
// Input: Image file path
// Output: Parsed metadata object
// Handles errors gracefully

extractGPS(filePath: string): Promise<GPSCoordinates | null>
// Extracts only GPS data
// Returns null if no GPS in EXIF
```

Dependencies:
- exiftool-vendored

Line Count: ~100 lines (estimated)
Status: Not yet implemented

---

### packages/desktop/electron/services/ffmpeg-service.ts

Purpose: Video metadata extraction wrapper

Class: FFmpegService

Methods:
```typescript
extractMetadata(filePath: string): Promise<VideoMetadata>
// Extracts video metadata
// Input: Video file path
// Output: Duration, dimensions, codec, etc.

generateThumbnail(filePath: string, outputPath: string): Promise<void>
// Generates video thumbnail at 1 second mark
```

Dependencies:
- fluent-ffmpeg

Line Count: ~80 lines (estimated)
Status: Not yet implemented

---

## UI Component Scripts (Future)

### packages/desktop/src/components/LocationForm.svelte

Purpose: Location creation/edit form component

Props:
- location?: Location (for editing)
- onSubmit: (data: LocationInput) => void
- onCancel: () => void

Features:
- Zod validation with Superforms
- GPS coordinate input
- Address fields (autofill from reverse-geocode)
- Type/status dropdowns
- Map preview with pin

Dependencies:
- Svelte 5
- Superforms
- Zod
- Leaflet (map preview)

Line Count: ~250 lines (estimated)
Status: Not yet implemented

---

### packages/desktop/src/components/MapViewer.svelte

Purpose: Interactive Leaflet map component

Props:
- locations: Location[]
- selectedLocation?: Location
- onLocationClick: (loc: Location) => void
- onMapClick: (gps: GPSCoordinates) => void

Features:
- Tile layer switching
- Marker clustering
- GPS confidence colors
- Right-click context menu

Dependencies:
- Svelte 5
- Leaflet
- Supercluster

Line Count: ~280 lines (estimated)
Status: Not yet implemented

---

### packages/desktop/src/components/FileImporter.svelte

Purpose: Drag & drop file import component

Props:
- locId: string
- onImportComplete: (results: ImportResult[]) => void

Features:
- Drag & drop area
- File picker button
- Progress display
- Error handling

Dependencies:
- Svelte 5
- Electron IPC

Line Count: ~150 lines (estimated)
Status: Not yet implemented

---

## Script Statistics

Total Scripts Implemented: 6
Total Scripts Planned: 15+
Average Line Count: ~120 lines
Largest Script: import-service.ts (280 lines, still under 300)

---

## LILBITS Compliance Checklist

When adding a new script, verify:
- [ ] Single responsibility (one function/purpose)
- [ ] Under 300 lines of code
- [ ] Documented in this file
- [ ] Includes function signature
- [ ] Lists dependencies
- [ ] Has usage example
- [ ] Follows KISS principle

---

## Notes

- Scripts over 250 lines should be reviewed for possible splitting
- Utility functions should be extracted to utils/
- Business logic belongs in services/, not UI components
- All database operations go through repositories
- Follow TypeScript strict mode

---

End of LILBITS Documentation
