<script lang="ts">
  /**
   * Import Intelligence Component
   *
   * Smart location matching during import. Shows when GPS is detected,
   * scans the archive for nearby locations/sub-locations/reference points,
   * and helps prevent duplicates.
   *
   * Premium UX: Non-blocking, inline awareness panel.
   */
  import type { IntelligenceMatch, IntelligenceScanResult } from '../types/electron';
  import { router } from '../stores/router';

  interface Props {
    lat: number;
    lng: number;
    hints?: {
      filename?: string;
      inferredType?: string;
      inferredState?: string;
    };
    // Called when user selects "Import to This Location"
    onSelectLocation?: (locid: string, name: string) => void;
    // Called when user selects "Import to Sub-Location"
    onSelectSubLocation?: (subid: string, locid: string, name: string) => void;
    // Called when user wants to create from ref point
    onCreateFromRefPoint?: (pointId: string, name: string, lat: number, lng: number) => void;
    // Called when user explicitly chooses "Create New"
    onCreateNew?: () => void;
    // For AKA flow: what name is the user trying to add?
    proposedName?: string;
    // Exclude a specific ref point from results (e.g., when already creating from it)
    excludeRefPointId?: string | null;
  }

  let {
    lat,
    lng,
    hints,
    onSelectLocation,
    onSelectSubLocation,
    onCreateFromRefPoint,
    onCreateNew,
    proposedName,
    excludeRefPointId,
  }: Props = $props();

  let scanning = $state(true);
  let scanResult = $state<IntelligenceScanResult | null>(null);
  let error = $state<string | null>(null);
  let addingAka = $state<string | null>(null); // Track which location we're adding AKA to

  // Run scan when component mounts or GPS changes
  $effect(() => {
    if (lat && lng) {
      runScan();
    }
  });

  async function runScan() {
    scanning = true;
    error = null;
    scanResult = null;

    try {
      // Defensive check: ensure API is available before calling
      if (!window.electronAPI?.importIntelligence?.scan) {
        console.error('[ImportIntelligence] API not available - preload may be out of sync');
        error = 'Import Intelligence not available. Please restart the app.';
        scanning = false;
        return;
      }

      const result = await window.electronAPI.importIntelligence.scan(lat, lng, hints, excludeRefPointId);
      scanResult = result;
    } catch (err) {
      console.error('[ImportIntelligence] Scan failed:', err);
      error = err instanceof Error ? err.message : 'Scan failed';
    } finally {
      scanning = false;
    }
  }

  function handleSelectMatch(match: IntelligenceMatch) {
    if (match.source === 'location') {
      onSelectLocation?.(match.id, match.name);
    } else if (match.source === 'sublocation') {
      // For sub-locations, we need the parent locid - it should be embedded in the match
      // The service returns parentName, but we'd need to look up the locid
      // For now, navigate to view it
      router.navigate(`/location/${match.id}`);
    } else if (match.source === 'refmap') {
      onCreateFromRefPoint?.(match.id, match.name, lat, lng);
    }
  }

  function handleViewLocation(match: IntelligenceMatch) {
    if (match.source === 'sublocation') {
      // Sub-location - navigate to parent with sub-location context
      // The subid is in match.id
      router.navigate(`/location/${match.id}`);
    } else if (match.source === 'location') {
      router.navigate(`/location/${match.id}`);
    }
    // Ref map points don't have a view page
  }

  async function handleAddAsAka(match: IntelligenceMatch) {
    if (!proposedName || match.source !== 'location') return;

    addingAka = match.id;
    try {
      await window.electronAPI.importIntelligence.addAkaName(match.id, proposedName);
      // Navigate to the location after adding AKA
      router.navigate(`/location/${match.id}`);
    } catch (err) {
      console.error('[ImportIntelligence] Failed to add AKA:', err);
    } finally {
      addingAka = null;
    }
  }

  // Get confidence color class - using braun neutral palette
  function getConfidenceColor(confidence: number): string {
    if (confidence >= 80) return 'bg-braun-200 text-braun-900 border-braun-300';
    if (confidence >= 60) return 'bg-braun-100 text-braun-800 border-braun-200';
    if (confidence >= 40) return 'bg-braun-100 text-braun-700 border-braun-200';
    return 'bg-braun-50 text-braun-600 border-braun-200';
  }

  // Get source icon (SVG paths for inline icons)
  function getSourceIcon(source: IntelligenceMatch['source']): string {
    switch (source) {
      case 'location': return 'pin';
      case 'sublocation': return 'building';
      case 'refmap': return 'flag';
    }
  }

  // Get source label
  function getSourceLabel(source: IntelligenceMatch['source']): string {
    switch (source) {
      case 'location': return 'Location';
      case 'sublocation': return 'Building';
      case 'refmap': return 'Reference Point';
    }
  }
</script>

<div class="import-intelligence">
  {#if scanning}
    <div class="flex items-center gap-3 p-4 bg-braun-50 rounded border border-braun-200">
      <div class="w-5 h-5 border-2 border-braun-400 rounded flex items-center justify-center">
        <div class="w-2 h-2 bg-braun-300 rounded"></div>
      </div>
      <div>
        <p class="text-sm font-medium text-braun-700">Scanning archive...</p>
        <p class="text-xs text-braun-500">Checking for existing locations near this GPS</p>
      </div>
    </div>
  {:else if error}
    <div class="p-4 bg-braun-50 rounded border border-braun-300">
      <p class="text-sm text-error">{error}</p>
      <button
        onclick={runScan}
        class="mt-2 text-xs text-braun-600 hover:underline"
      >
        Retry scan
      </button>
    </div>
  {:else if scanResult}
    {#if scanResult.matches.length > 0}
      <!-- Matches found -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-braun-800">
            {scanResult.matches.length === 1 ? 'Match Found' : `${scanResult.matches.length} Potential Matches`}
          </h3>
          <span class="text-xs text-braun-400">
            Scanned {scanResult.scanned.locations + scanResult.scanned.sublocations + scanResult.scanned.refmaps} points in {scanResult.scanTimeMs}ms
          </span>
        </div>

        {#each scanResult.matches.slice(0, 3) as match}
          <div class="p-4 bg-white rounded border border-braun-200 hover:border-braun-400 transition-colors">
            <!-- Header: Name + Confidence -->
            <div class="flex items-start justify-between gap-3 mb-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  {#if getSourceIcon(match.source) === 'pin'}
                    <svg class="w-4 h-4 text-braun-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" /></svg>
                  {:else if getSourceIcon(match.source) === 'building'}
                    <svg class="w-4 h-4 text-braun-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clip-rule="evenodd" /></svg>
                  {:else}
                    <svg class="w-4 h-4 text-braun-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clip-rule="evenodd" /></svg>
                  {/if}
                  <h4 class="font-semibold text-braun-900 truncate">{match.name}</h4>
                </div>
                {#if match.parentName}
                  <p class="text-xs text-braun-500 mt-0.5">at {match.parentName}</p>
                {/if}
                {#if match.mapName}
                  <p class="text-xs text-braun-500 mt-0.5">from {match.mapName}</p>
                {/if}
              </div>
              <div class="shrink-0">
                <span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium border {getConfidenceColor(match.confidence)}">
                  {match.confidence}% {match.confidenceLabel}
                </span>
              </div>
            </div>

            <!-- Meta: Distance, Type, Media Count -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-braun-600 mb-3">
              <span class="font-medium">{match.distanceFeet} ft away</span>
              {#if match.type}
                <span>•</span>
                <span>{match.type}</span>
              {/if}
              {#if match.mediaCount !== undefined}
                <span>•</span>
                <span>{match.mediaCount} {match.mediaCount === 1 ? 'photo' : 'photos'}</span>
              {/if}
              <span>•</span>
              <span class="text-braun-400">{getSourceLabel(match.source)}</span>
            </div>

            <!-- Reasons -->
            <div class="flex flex-wrap gap-1.5 mb-3">
              {#each match.reasons as reason}
                <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-braun-100 text-braun-600 rounded text-xs">
                  <svg class="w-3 h-3 text-success" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                  {reason}
                </span>
              {/each}
            </div>

            <!-- Actions -->
            <div class="flex flex-wrap items-center gap-2">
              {#if match.source === 'location'}
                <button
                  onclick={() => handleSelectMatch(match)}
                  class="px-3 py-1.5 bg-braun-900 text-white text-sm font-medium rounded hover:bg-braun-600 transition"
                >
                  Import Here
                </button>
                <button
                  onclick={() => handleViewLocation(match)}
                  class="px-3 py-1.5 bg-braun-100 text-braun-700 text-sm font-medium rounded hover:bg-braun-200 transition"
                >
                  View
                </button>
                {#if proposedName && proposedName.toLowerCase() !== match.name.toLowerCase()}
                  <button
                    onclick={() => handleAddAsAka(match)}
                    disabled={addingAka === match.id}
                    class="px-3 py-1.5 bg-braun-100 text-braun-700 text-sm font-medium rounded hover:bg-braun-200 transition disabled:opacity-50"
                  >
                    {addingAka === match.id ? 'Adding...' : `Add "${proposedName}" as AKA`}
                  </button>
                {/if}
              {:else if match.source === 'sublocation'}
                <button
                  onclick={() => handleSelectMatch(match)}
                  class="px-3 py-1.5 bg-braun-900 text-white text-sm font-medium rounded hover:bg-braun-600 transition"
                >
                  Import to Building
                </button>
                <button
                  onclick={() => handleViewLocation(match)}
                  class="px-3 py-1.5 bg-braun-100 text-braun-700 text-sm font-medium rounded hover:bg-braun-200 transition"
                >
                  View
                </button>
              {:else if match.source === 'refmap'}
                <button
                  onclick={() => handleSelectMatch(match)}
                  class="px-3 py-1.5 bg-braun-900 text-white text-sm font-medium rounded hover:bg-braun-600 transition"
                >
                  Create from Reference
                </button>
              {/if}
            </div>
          </div>
        {/each}

        <!-- Create New Option -->
        <button
          onclick={() => onCreateNew?.()}
          class="w-full p-3 text-sm text-braun-600 hover:text-braun-900 hover:bg-braun-50 rounded border border-dashed border-braun-300 hover:border-braun-900 transition text-center"
        >
          None of these — Create New Location
        </button>
      </div>
    {:else}
      <!-- No matches -->
      <div class="p-4 bg-braun-50 rounded border border-braun-200">
        <div class="flex items-center gap-3">
          <svg class="w-6 h-6 text-braun-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" /></svg>
          <div>
            <p class="text-sm font-medium text-braun-700">No existing locations nearby</p>
            <p class="text-xs text-braun-500">
              Scanned {scanResult.scanned.locations} locations, {scanResult.scanned.sublocations} buildings, {scanResult.scanned.refmaps} reference points
            </p>
          </div>
        </div>
        {#if onCreateNew}
          <button
            onclick={() => onCreateNew?.()}
            class="mt-3 w-full px-4 py-2 bg-braun-900 text-white text-sm font-medium rounded hover:bg-braun-600 transition"
          >
            Create New Location
          </button>
        {/if}
      </div>
    {/if}
  {/if}
</div>
