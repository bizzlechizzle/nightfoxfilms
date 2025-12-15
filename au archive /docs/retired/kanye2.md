# KANYE2: The Experience Blows - Critical UX Audit

**Version:** 2.0.0
**Created:** 2025-11-23
**Status:** ULTRATHINK COMPLETE - READY FOR IMPLEMENTATION
**Priority:** P0 - CRITICAL - APP IS UNUSABLE IN CURRENT STATE

---

## Executive Summary

**THE PROBLEM:** This archive app generates thumbnails, extracts GPS, has geocoding, has a Map component with fallbacks - but NONE OF IT IS WIRED UP TO THE USER INTERFACE.

**RESULT:** Users see:
- Gray SVG placeholder icons instead of their imported photos
- "No GPS coordinates available" when they have a full street address
- No map even when we know the state
- Sloppy address formatting with inconsistent interactivity

**ROOT CAUSE:** Integration failure. Backend is 90% working. Frontend is not connected.

---

## ULTRATHINK: Why This Matters

### Archive App Philosophy (from claude.md)

> "AU Archive Desktop App is an all-in-one tool that manages abandoned locations. It organizes, imports, and catalogs abandoned locations with media (images, videos, documents, maps) and associated metadata."

**A photo archive where you cannot see the photos is not an archive.**
**A location app where you cannot see locations on a map is not a location app.**

### What Makes a "Premium Archive Experience"

| Feature | Premium | Current State | Gap |
|---------|---------|---------------|-----|
| **Browse Photos** | Instant thumbnail grid | Gray SVG placeholders | BROKEN |
| **Photo Quality** | Crisp at all sizes | 256px blurry on HiDPI | DEGRADED |
| **See Location on Map** | Always shows something | Hidden if no GPS | BROKEN |
| **Address Display** | Clean, hierarchical | Sloppy text blob | DEGRADED |
| **Copy Address** | One-click copy | Not available | MISSING |
| **Forward Geocode** | Address -> GPS | Not implemented | MISSING |

### The Disconnect Visualized

```
WHAT WE BUILD:                    WHAT USER SEES:

thumbnail-service.ts              LocationDetail.svelte
  |                                 |
  v                                 v
[256px JPEG files]  ------X------> [Gray SVG placeholder]
  |                                 |
  + saved to DB                     + thumb_path IGNORED!
    (thumb_path)

geocoding-service.ts              LocationDetail.svelte
  |                                 |
  v                                 v
[forwardGeocode()]  ------X------> [NEVER CALLED]
  |                                 |
  + EXISTS!                         + User sees "No GPS"

Map.svelte                        LocationDetail.svelte
  |                                 |
  v                                 v
[state centroid     ------X------> [Map component
 fallback logic]                    hidden by {#if location.gps}]
  |                                 |
  + WORKS!                          + Fallback never reached
```

---

## ISSUE #1: THUMBNAILS NOT DISPLAYING (P0 - CRITICAL)

### Symptom
User imports photos to a location. Goes to location detail page. Sees **gray placeholder icons** instead of actual images.

### Evidence Chain

**Step 1: Thumbnail generated correctly**
File: `packages/desktop/electron/services/thumbnail-service.ts`
```typescript
// Lines 29-62 - This WORKS
async generateThumbnail(sourcePath: string, hash: string): Promise<string | null> {
  const thumbPath = this.mediaPathService.getThumbnailPath(hash);
  await sharp(sourcePath)
    .resize(256, 256, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 80 })
    .toFile(thumbPath);
  return thumbPath;  // Returns: ~/.au-archive/.thumbnails/a3/a3d5e8f9...jpg
}
```

**Step 2: Path saved to database correctly**
File: `packages/desktop/electron/services/file-import-service.ts`
```typescript
// Lines 767-791 - This WORKS
await trx.insertInto('imgs').values({
  imgsha: hash,
  thumb_path: thumbPath,  // SAVED!
  // ...
});
```

**Step 3: media:// protocol registered correctly**
File: `packages/desktop/electron/main/index.ts`
```typescript
// Lines 273-298 - This WORKS
protocol.handle('media', async (request) => {
  let filePath = decodeURIComponent(url.pathname);
  return net.fetch(`file://${filePath}`);
});
```

**Step 4: MediaGrid.svelte has correct rendering logic**
File: `packages/desktop/src/components/MediaGrid.svelte`
```svelte
<!-- This WORKS - but LocationDetail doesn't use it -->
{#if item.thumbPath}
  <img src={`media://${item.thumbPath}`} alt={item.name} />
{/if}
```

**Step 5: LocationDetail.svelte IGNORES thumb_path**
File: `packages/desktop/src/pages/LocationDetail.svelte`
```svelte
<!-- Lines 996-1000 - THE BUG -->
<div class="absolute inset-0 flex items-center justify-center text-gray-400">
  <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <!-- ONLY THIS SVG RENDERS - thumb_path NEVER USED! -->
    <path ... d="M4 16l4.586-4.586..." />
  </svg>
</div>
```

**The data exists but is not rendered:**
```typescript
// Lines 75-89 - Data is collected
const mediaViewerList = $derived(images.map(img => ({
  hash: img.imgsha,
  path: img.imgloc,
  thumbPath: (img as any).thumb_path || null,  // <-- HAS THE DATA!
  // ...
})));
```

### Root Cause
LocationDetail.svelte was written before the thumbnail system was complete. It uses a hardcoded SVG placeholder and never updated to use the actual `thumb_path` from the database.

### Impact
- Users cannot browse their archive visually
- The entire point of an image archive is defeated
- Trust in the app is destroyed

---

## ISSUE #2: MAP HIDDEN WHEN ADDRESS EXISTS (P0 - CRITICAL)

### Symptom
User has location with address "99 Myrtle Avenue Village Of Cambridge, NY 12816" but:
- Sees "No GPS coordinates available"
- Map is completely hidden
- No way to see location on map

### Evidence Chain

**Step 1: GeocodingService HAS forward geocoding**
File: `packages/desktop/electron/services/geocoding-service.ts`
```typescript
// Lines 232-268 - This EXISTS and WORKS
async forwardGeocode(address: string): Promise<GeocodingResult | null> {
  const url = new URL(`${this.NOMINATIM_BASE}/search`);
  url.searchParams.set('q', address);
  // ... returns GPS coordinates from address
}
```

**Step 2: But it's NEVER CALLED when location has address but no GPS**

There is NO code path that says:
```typescript
// THIS DOES NOT EXIST
if (location.hasAddress() && !location.hasGPS()) {
  const gps = await geocodingService.forwardGeocode(location.fullAddress);
  location.setGPS(gps);
}
```

**Step 3: Map.svelte HAS state centroid fallback**
File: `packages/desktop/src/components/Map.svelte`
```typescript
// Lines 67-80 - This WORKS but never reached
function getLocationCoordinates(location: Location) {
  // Has precise GPS
  if (location.gps?.lat && location.gps?.lng) {
    return { lat: location.gps.lat, lng: location.gps.lng, isApproximate: false };
  }
  // FALLBACK: State centroid
  const state = location.address?.state?.toUpperCase();
  if (state && STATE_CENTROIDS[state]) {
    return { ...STATE_CENTROIDS[state], isApproximate: true };  // <-- NEVER REACHED!
  }
  return null;
}
```

**Step 4: LocationDetail.svelte HIDES Map when no GPS**
File: `packages/desktop/src/pages/LocationDetail.svelte`
```svelte
<!-- Lines 785-853 - THE BUG -->
{#if location.gps}
  <Map locations={[location]} />  <!-- Only shows if GPS exists -->
{:else}
  <p class="text-gray-500 mb-3">No GPS coordinates available</p>  <!-- User sees this -->
{/if}
```

### Root Cause
The conditional `{#if location.gps}` prevents Map.svelte from receiving the location at all. Map's fallback logic never executes because the component is never mounted.

### Impact
- Locations with addresses appear to have no location data
- Users must manually find locations on Atlas to add GPS
- Forward geocoding infrastructure is wasted

---

## ISSUE #3: ADDRESS DISPLAY IS SLOPPY (P1 - UX)

### Symptom
Address displays as:
```
Address
99 Myrtle Avenue Village Of Cambridge, NY 12816
Washington County
```

Problems:
- Street is plain text (not clickable)
- City/State are clickable (inconsistent)
- Zipcode is plain text
- County is clickable
- No visual distinction between clickable/non-clickable
- No "Copy Address" button
- No "View on Map" for street

### Evidence
File: `packages/desktop/src/pages/LocationDetail.svelte`
```svelte
<!-- Lines 752-783 -->
<p class="text-base text-gray-900">
  {#if location.address.street}{location.address.street}<br/>{/if}  <!-- PLAIN TEXT -->
  {#if location.address.city}
    <button class="text-accent hover:underline">...</button>,  <!-- CLICKABLE -->
  {/if}
  {#if location.address.state}
    <button class="text-accent hover:underline">...</button>  <!-- CLICKABLE -->
  {/if}
  {#if location.address.zipcode}{location.address.zipcode}{/if}  <!-- PLAIN TEXT -->
</p>
```

### Premium Archive Address Display Should Be:
```
Address                              [Copy]
99 Myrtle Avenue                     [View on Map]
Cambridge, NY 12816
Washington County
```

- Street: Bold, primary - with "View on Map" action
- City, State, ZIP: Clean single line
- County: Subtle secondary info
- All interactive elements should look the same

---

## ISSUE #4: THUMBNAIL QUALITY ON HIDPI (P2 - COSMETIC)

### Symptom
On modern displays (MacBook Retina, 4K monitors), thumbnails look blurry/pixelated.

### Root Cause
File: `packages/desktop/electron/services/thumbnail-service.ts`
```typescript
// Line 10
private readonly DEFAULT_SIZE = 256;  // Only one size generated
```

256px thumbnails displayed on 2x HiDPI = 128 effective pixels = blurry.

### Premium Solution
Generate multiple sizes: 256px (1x), 512px (2x), 1024px (preview)
Use `srcset` in HTML to serve appropriate size.

---

## LOGIC FLOW: What SHOULD Happen

### On File Import
```
USER DROPS FILES
       |
       v
file-import-service.ts
       |
       +-- 1. Hash file (SHA256)
       +-- 2. Extract EXIF metadata
       +-- 3. Extract GPS from EXIF
       |        |
       |        +-- If GPS exists --> Save to imgs.meta_gps_lat/lng
       |
       +-- 4. Generate thumbnail (256px JPEG)
       |        |
       |        +-- Save to ~/.au-archive/.thumbnails/[bucket]/[hash].jpg
       |        +-- Save path to imgs.thumb_path
       |
       +-- 5. Copy file to archive
       +-- 6. Save to database
       |
       v
IMPORT COMPLETE
```

### On Location Save (NEW - Not Implemented)
```
LOCATION SAVED WITH ADDRESS BUT NO GPS
       |
       v
location-repository.ts (or hook)
       |
       +-- Check: Has address but no GPS?
       |        |
       |        YES --> Call geocodingService.forwardGeocode(fullAddress)
       |                    |
       |                    +-- Save gps_lat, gps_lng, gps_source='geocoded_address'
       |
       v
LOCATION NOW HAS GPS FROM ADDRESS
```

### On Location Detail View
```
USER OPENS LOCATION DETAIL
       |
       v
LocationDetail.svelte
       |
       +-- 1. Load location from DB
       +-- 2. Load media (images, videos, docs)
       |
       +-- 3. Display thumbnail grid
       |        |
       |        CURRENT: Shows SVG placeholder
       |        SHOULD:  <img src="media://{thumb_path}" />
       |
       +-- 4. Display map
       |        |
       |        CURRENT: {#if location.gps} --> Hidden if no GPS
       |        SHOULD:  ALWAYS show Map.svelte
       |                 Let Map handle fallback (state centroid)
       |
       +-- 5. Display address
       |        |
       |        CURRENT: Inconsistent interactivity
       |        SHOULD:  Clean formatting, copy button, all consistent
       |
       v
USER SEES THEIR ARCHIVE PROPERLY
```

---

## IMPLEMENTATION GUIDE (For Inexperienced Coder)

### Prerequisites
1. Read `claude.md` - understand the architecture
2. Read `kanye.md` - understand what was built
3. Run `pnpm dev` and go to a location with images
4. Open browser DevTools (F12) and check for errors

### Fix #1: Display Thumbnails (30 minutes)

**File to edit:** `packages/desktop/src/pages/LocationDetail.svelte`

**Find this code (around line 990-1007):**
```svelte
<button onclick={() => openLightbox(actualIndex)} class="aspect-square bg-gray-100...">
  <div class="absolute inset-0 flex items-center justify-center text-gray-400">
    <svg class="w-12 h-12" ...></svg>
  </div>
</button>
```

**Replace with:**
```svelte
<button onclick={() => openLightbox(actualIndex)} class="aspect-square bg-gray-100 rounded overflow-hidden hover:opacity-90 transition relative group">
  {#if (image as any).thumb_path}
    <img
      src={`media://${(image as any).thumb_path}`}
      alt={image.imgnam}
      loading="lazy"
      class="w-full h-full object-cover"
    />
  {:else}
    <div class="absolute inset-0 flex items-center justify-center text-gray-400">
      <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </div>
  {/if}
  <div class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-2 opacity-0 group-hover:opacity-100 transition">
    {#if image.meta_width && image.meta_height}
      {formatResolution(image.meta_width, image.meta_height)}
    {/if}
  </div>
</button>
```

**Why this works:**
- `(image as any).thumb_path` - accesses the thumb_path from the database
- `media://` protocol - tells Electron to serve the file
- Fallback SVG - only shows if no thumbnail exists

**Test:**
1. Import 3 JPG images to any location
2. Go to that location's detail page
3. You should see actual thumbnails, not gray icons
4. Click thumbnail - should open lightbox

---

### Fix #2: Always Show Map (20 minutes)

**File to edit:** `packages/desktop/src/pages/LocationDetail.svelte`

**Find this code (around line 785-853):**
```svelte
{#if location.gps}
  <!-- ... GPS display and map ... -->
{:else}
  <div class="text-center py-4">
    <p class="text-gray-500 mb-3">No GPS coordinates available</p>
    <button onclick={() => router.navigate('/atlas')} ...>
      Add GPS on Atlas
    </button>
  </div>
{/if}
```

**Replace the entire block with:**
```svelte
{#if location.gps}
  {@const confidence = getGpsConfidence(location.gps)}
  <div class="mb-4">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-medium text-gray-500">GPS Coordinates</h3>
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium
        {confidence.color === 'green' ? 'bg-green-100 text-green-800' :
         confidence.color === 'blue' ? 'bg-blue-100 text-blue-800' :
         confidence.color === 'yellow' ? 'bg-yellow-100 text-yellow-800' :
         'bg-gray-100 text-gray-600'}">
        {confidence.label}
      </span>
    </div>
    <p class="text-base text-gray-900 font-mono text-sm">
      {location.gps.lat.toFixed(6)}, {location.gps.lng.toFixed(6)}
    </p>
  </div>
  <div class="h-64 rounded overflow-hidden mb-3">
    <Map locations={[location]} />
  </div>
{:else if location.address?.state}
  <!-- Show approximate map based on state -->
  <div class="mb-4">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-medium text-gray-500">Location</h3>
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
        Approximate
      </span>
    </div>
  </div>
  <div class="h-64 rounded overflow-hidden mb-3">
    <Map locations={[location]} />
  </div>
  <p class="text-xs text-yellow-600 mt-2">
    Showing approximate location based on state. Add GPS for exact position.
  </p>
{:else}
  <div class="text-center py-4">
    <p class="text-gray-500 mb-3">No location data available</p>
    <button
      onclick={() => router.navigate('/atlas')}
      class="px-4 py-2 text-sm bg-accent text-white rounded hover:opacity-90 transition"
    >
      Add GPS on Atlas
    </button>
  </div>
{/if}
```

**Why this works:**
- Map.svelte already has state centroid fallback logic
- We just need to NOT hide the Map component
- Three states: GPS (exact), State only (approximate), Nothing (prompt to add)

**Test:**
1. Find or create a location with address but no GPS
2. Go to that location's detail page
3. You should see a map showing the state center
4. Yellow badge indicates "Approximate"

---

### Fix #3: Forward Geocode Address to GPS (45 minutes)

**File to create:** `packages/desktop/electron/services/location-geocode-service.ts`

```typescript
/**
 * Service to ensure locations with addresses have GPS coordinates
 * via forward geocoding when GPS is missing
 */

import type { Database } from '../main/database.types';
import type { Kysely } from 'kysely';
import { GeocodingService } from './geocoding-service';

export class LocationGeocodeService {
  constructor(
    private db: Kysely<Database>,
    private geocodingService: GeocodingService
  ) {}

  /**
   * Check if location has address but no GPS, and geocode if so
   */
  async ensureGpsFromAddress(locid: string): Promise<boolean> {
    // Get the location
    const location = await this.db
      .selectFrom('locs')
      .where('locid', '=', locid)
      .selectAll()
      .executeTakeFirst();

    if (!location) return false;

    // Already has GPS? Skip
    if (location.gps_lat && location.gps_lng) return true;

    // No address to geocode? Skip
    if (!location.address_street && !location.address_city) return false;

    // Build address string
    const addressParts = [
      location.address_street,
      location.address_city,
      location.address_state,
      location.address_zipcode
    ].filter(Boolean);

    if (addressParts.length === 0) return false;

    const addressString = addressParts.join(', ');

    try {
      const result = await this.geocodingService.forwardGeocode(addressString);

      if (result?.lat && result?.lng) {
        // Update location with geocoded GPS
        await this.db
          .updateTable('locs')
          .set({
            gps_lat: result.lat,
            gps_lng: result.lng,
            gps_source: 'geocoded_address',
            gps_accuracy: null, // Unknown accuracy from geocoding
          })
          .where('locid', '=', locid)
          .execute();

        console.log(`[LocationGeocode] Forward geocoded ${locid}: ${addressString} -> ${result.lat}, ${result.lng}`);
        return true;
      }
    } catch (error) {
      console.error(`[LocationGeocode] Failed to geocode ${addressString}:`, error);
    }

    return false;
  }

  /**
   * Process all locations missing GPS but having addresses
   */
  async geocodeAllMissingGps(): Promise<{ processed: number; success: number }> {
    const locationsNeedingGeocode = await this.db
      .selectFrom('locs')
      .where('gps_lat', 'is', null)
      .where(eb => eb.or([
        eb('address_street', 'is not', null),
        eb('address_city', 'is not', null)
      ]))
      .select('locid')
      .execute();

    let success = 0;
    for (const loc of locationsNeedingGeocode) {
      const result = await this.ensureGpsFromAddress(loc.locid);
      if (result) success++;
      // Rate limit: 1 request per second (Nominatim policy)
      await new Promise(resolve => setTimeout(resolve, 1100));
    }

    return { processed: locationsNeedingGeocode.length, success };
  }
}
```

**Then add to IPC handlers** in `packages/desktop/electron/main/ipc-handlers/`:

```typescript
// Add to location handlers
ipcMain.handle('location:ensureGpsFromAddress', async (_event, locid: string) => {
  const locationGeocodeService = new LocationGeocodeService(db, geocodingService);
  return await locationGeocodeService.ensureGpsFromAddress(locid);
});
```

**Then call on location detail load** in LocationDetail.svelte:
```typescript
onMount(async () => {
  // ... existing code ...

  // Try to geocode address to GPS if missing
  if (!location.gps && location.address) {
    await window.electronAPI.locations.ensureGpsFromAddress(location.locid);
    // Refresh location data
    location = await window.electronAPI.locations.findById(locid);
  }
});
```

---

### Fix #4: Clean Address Display (20 minutes)

**File to edit:** `packages/desktop/src/pages/LocationDetail.svelte`

**Find the address block (lines 752-783) and replace:**

```svelte
{#if location.address}
  <div class="mb-4">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-medium text-gray-500">Address</h3>
      <button
        onclick={() => {
          const addr = [
            location.address?.street,
            location.address?.city,
            location.address?.state,
            location.address?.zipcode
          ].filter(Boolean).join(', ');
          navigator.clipboard.writeText(addr);
        }}
        class="text-xs text-accent hover:underline"
        title="Copy address to clipboard"
      >
        Copy
      </button>
    </div>

    <div class="text-base text-gray-900 space-y-1">
      {#if location.address.street}
        <p class="font-medium">{location.address.street}</p>
      {/if}

      <p>
        {#if location.address.city}
          <button
            onclick={() => navigateToFilter('city', location.address!.city!)}
            class="text-accent hover:underline"
            title="View all locations in {location.address.city}"
          >{location.address.city}</button>{location.address.state ? ', ' : ''}
        {/if}
        {#if location.address.state}
          <button
            onclick={() => navigateToFilter('state', location.address!.state!)}
            class="text-accent hover:underline"
            title="View all locations in {location.address.state}"
          >{location.address.state}</button>
        {/if}
        {#if location.address.zipcode}
          {' '}{location.address.zipcode}
        {/if}
      </p>

      {#if location.address.county}
        <p class="text-sm text-gray-500">
          <button
            onclick={() => navigateToFilter('county', location.address!.county!)}
            class="hover:underline"
            title="View all locations in {location.address.county} County"
          >{location.address.county} County</button>
        </p>
      {/if}
    </div>
  </div>
{/if}
```

---

## VERIFICATION CHECKLIST

After implementing fixes, verify each one:

### Thumbnails
- [ ] Import 3 JPG images to a location
- [ ] Location detail shows actual thumbnail images (not gray SVGs)
- [ ] Thumbnails load quickly (lazy loading works)
- [ ] Click thumbnail opens MediaViewer with full image
- [ ] MediaViewer keyboard navigation works (arrow keys)

### Map Display
- [ ] Location with GPS shows map at exact location
- [ ] Location with address but no GPS shows map at state center
- [ ] Yellow "Approximate" badge shows for state-level
- [ ] Location with no address and no GPS shows prompt to add

### Forward Geocoding
- [ ] Create location with address "Albany, NY" and no GPS
- [ ] Refresh or trigger geocode
- [ ] Location now has GPS coordinates
- [ ] Map shows at correct city location (not state center)

### Address Display
- [ ] Street displays on its own line
- [ ] City, State, ZIP on single line
- [ ] County is subtle, below main address
- [ ] "Copy" button copies full address to clipboard
- [ ] City/State/County are all clickable

---

## CHANGELOG

| Date | Issue | Action | Status |
|------|-------|--------|--------|
| 2025-11-23 | Thumbnails not displaying | Documented root cause: LocationDetail ignores thumb_path | DOCUMENTED |
| 2025-11-23 | Map hidden when no GPS | Documented: Map.svelte has fallback, LocationDetail blocks it | DOCUMENTED |
| 2025-11-23 | Forward geocoding missing | Documented: geocodingService.forwardGeocode exists but never called | DOCUMENTED |
| 2025-11-23 | Address display sloppy | Documented: inconsistent interactivity, no copy button | DOCUMENTED |
| 2025-11-23 | Implementation guide | Created detailed step-by-step for inexperienced coders | DOCUMENTED |

---

## RELATED FILES

| File | Purpose | Status |
|------|---------|--------|
| `packages/desktop/src/pages/LocationDetail.svelte` | Main UI showing locations | NEEDS FIX |
| `packages/desktop/src/components/Map.svelte` | Map component with fallbacks | WORKS |
| `packages/desktop/src/components/MediaGrid.svelte` | Thumbnail grid component | WORKS (unused) |
| `packages/desktop/electron/services/thumbnail-service.ts` | Generates thumbnails | WORKS |
| `packages/desktop/electron/services/geocoding-service.ts` | Reverse and forward geocoding | WORKS |
| `packages/desktop/electron/services/file-import-service.ts` | Import pipeline | WORKS |
| `packages/desktop/electron/main/index.ts` | media:// protocol | WORKS |

---

## PRINCIPLES (Per claude.md)

- **LILBITS**: One script = one function. Max 300 lines.
- **KISS**: Keep it simple. Don't over-engineer.
- **NGS**: No Google Services. Using Nominatim for geocoding.
- **DAFIDFAF**: Don't add features not asked for. Focus on fixing what's broken.
- **BPL**: Bulletproof long-term. Use proven patterns.

---

## NEXT STEPS

1. **FIX #1** (P0): Display thumbnails in LocationDetail.svelte - 30 min
2. **FIX #2** (P0): Always show map (with fallback) - 20 min
3. **FIX #3** (P1): Forward geocode addresses to GPS - 45 min
4. **FIX #4** (P1): Clean address display - 20 min
5. **FIX #5** (P2): Multi-resolution thumbnails for HiDPI - 60 min (future)

**TOTAL TIME TO FIX CRITICAL ISSUES: ~2 hours**

---

*This is kanye2.md - tracking the critical UX issues preventing AU Archive from being a premium archive experience.*
