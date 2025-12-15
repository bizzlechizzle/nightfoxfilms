<script lang="ts">
  /**
   * DuplicateWarningPanel.svelte
   *
   * Migration 38: Inline duplicate detection panel for location creation.
   * ADR: ADR-pin-conversion-duplicate-prevention.md
   *
   * Premium UX: Non-blocking, inline awareness panel that helps prevent
   * duplicate locations in the archive. Shows when a potential duplicate
   * is detected based on GPS proximity (≤150m) or name similarity (≥50%).
   *
   * User can either:
   * - "This is the same place" → Navigate to existing location
   * - "Different place" → Add exclusion and proceed with creation
   */

  interface DuplicateMatch {
    locationId: string;
    locnam: string;
    akanam: string | null;
    state: string | null;
    matchType: 'gps' | 'name' | 'combined';
    distanceMeters?: number;
    nameSimilarity?: number;
    matchedField?: 'locnam' | 'akanam';
    mediaCount: number;
    /** GPS coordinates of the matched location (for map view) */
    lat?: number | null;
    lng?: number | null;
    /** Token-based match details (new) */
    sharedTokens?: string[];
    /** Confidence tier from multi-signal matching */
    confidenceTier?: 'high' | 'medium' | 'low' | 'none';
    /** Total confidence score (0-100) */
    confidenceScore?: number;
    /** Whether user review is recommended */
    requiresUserReview?: boolean;
    /** Whether this is a generic name match */
    isGenericNameMatch?: boolean;
  }

  interface Props {
    // The name the user is trying to create
    proposedName: string;
    // The detected duplicate match
    match: DuplicateMatch;
    // Called when user confirms it's the same place
    onSamePlace: (locationId: string, locationName: string) => void;
    // Called when user says it's a different place
    onDifferentPlace: (matchName: string) => void;
    // Optional: Show loading state when processing
    processing?: boolean;
    // GPS of the proposed new location (for map comparison)
    proposedLat?: number | null;
    proposedLng?: number | null;
  }

  import Map from './Map.svelte';

  let {
    proposedName,
    match,
    onSamePlace,
    onDifferentPlace,
    processing = false,
    proposedLat = null,
    proposedLng = null,
  }: Props = $props();

  // Map view toggle state
  let showMapView = $state(false);

  // Check if we have GPS coordinates to show on map
  // Need at least one set of coordinates to show map
  $effect(() => {
    const hasProposedGps = proposedLat != null && proposedLng != null;
    const hasMatchGps = match.lat != null && match.lng != null;
    // If no GPS available at all, hide map view
    if (!hasProposedGps && !hasMatchGps) {
      showMapView = false;
    }
  });

  // Compute if map view is available (at least one location has GPS)
  const canShowMap = $derived(
    (proposedLat != null && proposedLng != null) ||
    (match.lat != null && match.lng != null)
  );

  // Build map locations array for Map component
  const mapLocations = $derived.by(() => {
    const locations: Array<{
      locid: string;
      locnam: string;
      gps_lat: number;
      gps_lng: number;
      gps_confidence: string;
    }> = [];

    // Add matched location if it has GPS
    if (match.lat != null && match.lng != null) {
      locations.push({
        locid: match.locationId,
        locnam: match.locnam,
        gps_lat: match.lat,
        gps_lng: match.lng,
        gps_confidence: 'verified',
      });
    }

    // Add proposed location if it has GPS
    if (proposedLat != null && proposedLng != null) {
      locations.push({
        locid: 'proposed-new',
        locnam: proposedName || 'New Location',
        gps_lat: proposedLat,
        gps_lng: proposedLng,
        gps_confidence: 'medium',
      });
    }

    return locations;
  });

  // Format distance for display
  function formatDistance(meters: number | undefined): string {
    if (!meters) return '';
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  }

  // Format similarity percentage
  function formatSimilarity(similarity: number | undefined): string {
    if (!similarity) return '';
    return `${Math.round(similarity * 100)}%`;
  }

  // Get matched field display name (historicalName removed)
  function getMatchedFieldLabel(field: string | undefined): string {
    switch (field) {
      case 'locnam': return 'primary name';
      case 'akanam': return 'AKA name';
      default: return 'name';
    }
  }

  function handleSamePlace() {
    if (!processing) {
      onSamePlace(match.locationId, match.locnam);
    }
  }

  function handleDifferentPlace() {
    if (!processing) {
      onDifferentPlace(match.locnam);
    }
  }
</script>

<div class="duplicate-warning-panel">
  <div class="bg-braun-100 border border-braun-300 rounded p-4">
    <div class="flex gap-3">
      <!-- Warning icon - uses functional warning color -->
      <div class="flex-shrink-0">
        <svg class="w-5 h-5 text-warning mt-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
      </div>

      <div class="flex-1 min-w-0">
        <!-- Header with map view toggle -->
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-sm font-semibold text-braun-900">
            Possible duplicate found
          </h4>
          {#if canShowMap}
            <button
              type="button"
              onclick={() => showMapView = !showMapView}
              class="text-xs text-braun-600 hover:text-braun-900 font-medium flex items-center gap-1 transition-colors"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              {showMapView ? 'hide map' : 'map view'}
            </button>
          {/if}
        </div>

        <!-- What user is creating -->
        <p class="text-sm text-braun-600 mt-1">
          You're creating: <strong class="font-medium">{proposedName}</strong>
        </p>

        <!-- Match details card -->
        <div class="mt-3 p-3 bg-white rounded border border-braun-200">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-braun-900 truncate">{match.locnam}</p>
              {#if match.akanam}
                <p class="text-xs text-braun-500 truncate">AKA: {match.akanam}</p>
              {/if}
            </div>
          </div>

          <!-- Match metadata -->
          <div class="flex flex-wrap items-center gap-2 mt-2 text-xs text-braun-600">
            {#if match.matchType === 'gps'}
              <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-braun-200 text-braun-700 rounded">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
                </svg>
                {formatDistance(match.distanceMeters)} away
              </span>
            {:else if match.matchType === 'combined'}
              <!-- Combined GPS + Name match -->
              <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-gps-verified/20 text-braun-700 rounded">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
                </svg>
                {formatDistance(match.distanceMeters)}
              </span>
              <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-braun-200 text-braun-700 rounded">
                {match.nameSimilarity}% name match
              </span>
            {:else}
              <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-braun-200 text-braun-700 rounded">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                </svg>
                {match.nameSimilarity}% {getMatchedFieldLabel(match.matchedField)} match
              </span>
            {/if}

            <!-- Confidence tier badge -->
            {#if match.confidenceTier}
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded {
                match.confidenceTier === 'high' ? 'bg-gps-verified/20 text-gps-verified' :
                match.confidenceTier === 'medium' ? 'bg-gps-medium/20 text-gps-medium' :
                'bg-gps-low/20 text-gps-low'
              }">
                {match.confidenceTier} confidence
              </span>
            {/if}

            {#if match.state}
              <span class="text-braun-400">•</span>
              <span>{match.state}</span>
            {/if}

            <span class="text-braun-400">•</span>
            <span>{match.mediaCount} {match.mediaCount === 1 ? 'file' : 'files'}</span>
          </div>

          <!-- Shared tokens (if available) - helps user understand why it matched -->
          {#if match.sharedTokens && match.sharedTokens.length > 0}
            <div class="mt-2 text-xs text-braun-500">
              <span class="font-medium">Shared words:</span>
              {match.sharedTokens.join(', ')}
            </div>
          {/if}

          <!-- Generic name warning -->
          {#if match.isGenericNameMatch}
            <div class="mt-2 text-xs text-gps-medium flex items-center gap-1">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
              </svg>
              Generic name - matched by GPS proximity
            </div>
          {/if}
        </div>

        <!-- Map view (collapsible) -->
        {#if showMapView && mapLocations.length > 0}
          <div class="mt-3 rounded overflow-hidden border border-braun-200">
            <div class="h-48">
              <Map
                locations={mapLocations}
                limitedInteraction={true}
                hideAttribution={true}
                defaultLayer="satellite-labels"
                showLayerControl={false}
                popupMode="minimal"
                fitBounds={mapLocations.length > 1}
              />
            </div>
            <!-- Map legend -->
            <div class="bg-white px-3 py-2 border-t border-braun-200 text-xs text-braun-600 flex items-center gap-4">
              {#if match.lat != null && match.lng != null}
                <span class="flex items-center gap-1">
                  <span class="w-2 h-2 rounded-full bg-gps-verified"></span>
                  Existing: {match.locnam}
                </span>
              {/if}
              {#if proposedLat != null && proposedLng != null}
                <span class="flex items-center gap-1">
                  <span class="w-2 h-2 rounded-full bg-gps-medium"></span>
                  New: {proposedName || 'New Location'}
                </span>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Action buttons -->
        <div class="flex flex-wrap gap-2 mt-4">
          <button
            onclick={handleSamePlace}
            disabled={processing}
            class="px-4 py-2 bg-braun-900 text-white text-sm font-medium rounded hover:bg-braun-600 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            {#if processing}
              <span class="w-4 h-4 border border-white rounded"></span>
            {:else}
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            {/if}
            This is the same place
          </button>

          <button
            onclick={handleDifferentPlace}
            disabled={processing}
            class="px-4 py-2 bg-braun-100 text-braun-700 text-sm font-medium rounded hover:bg-braun-200 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
            Different place
          </button>
        </div>

        <!-- Help text -->
        <p class="text-xs text-braun-500 mt-3">
          {#if match.matchType === 'gps'}
            This location is very close to an existing entry in your archive.
          {:else if match.matchType === 'combined'}
            This location is nearby and has a similar name to an existing entry.
          {:else if match.isGenericNameMatch}
            Generic names like this require GPS verification to match.
          {:else}
            The name you entered is similar to an existing location.
          {/if}
          {#if match.requiresUserReview}
            <strong>Review recommended</strong> - please verify this is the same place.
          {/if}
        </p>
      </div>
    </div>
  </div>
</div>

<style>
  /* Braun: No entrance animations - static UI only */
</style>
