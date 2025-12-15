<script lang="ts">
  import { onMount } from 'svelte';
  import type { Location, LocationInput } from '@au-archive/core';
  import AutocompleteInput from './AutocompleteInput.svelte';
  import { STATE_ABBREVIATIONS, getStateCodeFromName } from '../../electron/services/us-state-codes';
  import { getCategoryForClass } from '../lib/type-hierarchy';

  interface Props {
    location: Location;
    onSave: (input: Partial<LocationInput>) => Promise<void>;
    onCancel: () => void;
  }

  let { location, onSave, onCancel }: Props = $props();

  let allLocations = $state<Location[]>([]);
  let categorySuggestions = $state<string[]>([]);
  let classSuggestions = $state<string[]>([]);
  let authorSuggestions = $state<string[]>([]);
  let stateSuggestions = $state<string[]>([]);

  let formData = $state({
    locnam: location.locnam,
    akanam: location.akanam || '',
    category: location.category || '',
    class: location.class || '',
    // P0: condition and status removed - use access only
    documentation: location.documentation || '',
    access: location.access || '',
    historic: location.historic || false,
    address_street: location.address?.street || '',
    address_city: location.address?.city || '',
    address_county: location.address?.county || '',
    address_state: location.address?.state || '',
    address_zipcode: location.address?.zipcode || '',
    gps_lat: location.gps?.lat?.toString() || '',
    gps_lng: location.gps?.lng?.toString() || '',
    is_sublocation: !!location.sub12,
    parent_locid: '',
    primary_sublocation: false,
  });

  let saving = $state(false);
  let error = $state<string | null>(null);

  // Auto-fill category when user enters a known class
  $effect(() => {
    if (formData.class && !formData.category) {
      const matchedCategory = getCategoryForClass(formData.class);
      if (matchedCategory) {
        formData.category = matchedCategory;
      }
    }
  });

  onMount(async () => {
    try {
      // Load all locations for parent selector and suggestions
      const locations = await window.electronAPI.locations.findAll();
      // Filter out the current location to prevent self-parenting
      allLocations = locations.filter(loc => loc.locid !== location.locid);

      // Extract unique values for autocomplete suggestions
      const categories = new Set<string>();
      const classes = new Set<string>();
      const authors = new Set<string>();
      const states = new Set<string>();

      locations.forEach(loc => {
        if (loc.category) categories.add(loc.category);
        if (loc.class) classes.add(loc.class);
        if (loc.auth_imp) authors.add(loc.auth_imp);
        if (loc.address?.state) {
          const code = loc.address.state.toUpperCase();
          const fullName = Object.entries(STATE_ABBREVIATIONS).find(([_, abbr]) => abbr === code)?.[0];
          if (fullName) {
            const titleCased = fullName.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
            states.add(`${code} (${titleCased})`);
          } else {
            states.add(code);
          }
        }
      });

      // Add all US states in format "NY (New York)"
      const allStates = Object.entries(STATE_ABBREVIATIONS).map(([name, code]) => {
        const titleCased = name.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
        return `${code} (${titleCased})`;
      });
      states.forEach(s => allStates.push(s));

      categorySuggestions = Array.from(categories).sort();
      classSuggestions = Array.from(classes).sort();
      authorSuggestions = Array.from(authors).sort();
      stateSuggestions = Array.from(new Set(allStates)).sort();
    } catch (err) {
      console.error('Error loading locations:', err);
    }
  });

  async function handleSubmit() {
    try {
      saving = true;
      error = null;

      const updates: Partial<LocationInput> = {
        locnam: formData.locnam,
        akanam: formData.akanam || undefined,
        category: formData.category || undefined,
        class: formData.class || undefined,
        // P0: condition and status removed - use access only
        documentation: formData.documentation || undefined,
        access: formData.access || undefined,
        historic: formData.historic,
      };

      if (formData.address_street || formData.address_city || formData.address_state) {
        updates.address = {
          street: formData.address_street || undefined,
          city: formData.address_city || undefined,
          county: formData.address_county || undefined,
          state: formData.address_state || undefined,
          zipcode: formData.address_zipcode || undefined,
        };
      }

      if (formData.gps_lat && formData.gps_lng) {
        updates.gps = {
          lat: parseFloat(formData.gps_lat),
          lng: parseFloat(formData.gps_lng),
          source: location.gps?.source || 'manual_entry',
          verifiedOnMap: location.gps?.verifiedOnMap || false,
        };
      }

      await onSave(updates);
    } catch (err) {
      console.error('Error saving location:', err);
      error = 'Failed to save location';
    } finally {
      saving = false;
    }
  }

  // Normalize state input - accepts full name or code
  function handleStateChange(value: string) {
    if (!value) {
      formData.address_state = '';
      return;
    }

    // Extract just the code if format is "NY (New York)"
    const codeMatch = value.match(/^([A-Z]{2})\s*\(/);
    if (codeMatch) {
      formData.address_state = codeMatch[1];
      return;
    }

    // Try to convert full name to code
    const code = getStateCodeFromName(value);
    if (code) {
      formData.address_state = code;
      return;
    }

    // Otherwise store as-is (will be uppercased)
    formData.address_state = value.toUpperCase().substring(0, 2);
  }
</script>

<div class="bg-white rounded border border-braun-300 p-6">
  <div class="flex justify-between items-center mb-6">
    <h2 class="text-xl font-semibold text-foreground">Edit Location</h2>
    <button
      onclick={onCancel}
      class="text-sm text-braun-500 hover:text-braun-700"
    >
      Cancel
    </button>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-100 text-red-700 rounded">
      {error}
    </div>
  {/if}

  <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-6">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="md:col-span-2">
        <label for="locnam" class="block text-sm font-medium text-braun-700 mb-1">
          Location Name *
        </label>
        <input
          id="locnam"
          type="text"
          bind:value={formData.locnam}
          required
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        />
      </div>

      <div>
        <label for="akanam" class="block text-sm font-medium text-braun-700 mb-1">
          Also Known As
        </label>
        <input
          id="akanam"
          type="text"
          bind:value={formData.akanam}
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        />
      </div>

      <div class="md:col-span-2">
        <div class="flex items-center mb-2">
          <input
            type="checkbox"
            bind:checked={formData.is_sublocation}
            id="is_sublocation"
            class="mr-2"
          />
          <label for="is_sublocation" class="text-sm font-medium text-braun-700">
            This is a sub-location
          </label>
        </div>
        <p class="text-xs text-braun-500">
          Sub-locations are places within a larger location (e.g., "East Wing" within "Abandoned Hospital")
        </p>
      </div>

      {#if formData.is_sublocation}
        <div class="md:col-span-2 p-4 bg-braun-50 border border-braun-200 rounded">
          <h4 class="text-sm font-semibold text-braun-900 mb-3">Sub-Location Details</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label for="parent_locid" class="block text-sm font-medium text-braun-700 mb-1">
                Parent Location <span class="text-red-500">*</span>
              </label>
              <select
                id="parent_locid"
                bind:value={formData.parent_locid}
                required={formData.is_sublocation}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              >
                <option value="">Select parent location...</option>
                {#each allLocations as parentLoc}
                  <option value={parentLoc.locid}>
                    {parentLoc.locnam} {parentLoc.address?.state ? `(${parentLoc.address.state})` : ''}
                  </option>
                {/each}
              </select>
              <p class="text-xs text-braun-500 mt-1">
                The main location this sub-location belongs to
              </p>
            </div>

            <div class="flex items-center">
              <input
                type="checkbox"
                bind:checked={formData.primary_sublocation}
                id="primary_sublocation"
                class="mr-2"
              />
              <label for="primary_sublocation" class="text-sm text-braun-700">
                Primary sub-location
              </label>
            </div>
          </div>
        </div>
      {/if}

      <div>
        <label for="category" class="block text-sm font-medium text-braun-700 mb-1">
          Category
        </label>
        <AutocompleteInput
          bind:value={formData.category}
          onchange={(val) => formData.category = val}
          suggestions={categorySuggestions}
          id="category"
          placeholder="e.g., Hospital, Factory, School..."
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        />
        <p class="text-xs text-braun-500 mt-1">
          Start typing to see suggestions from existing locations
        </p>
      </div>

      <div>
        <label for="class" class="block text-sm font-medium text-braun-700 mb-1">
          Class
        </label>
        <AutocompleteInput
          bind:value={formData.class}
          onchange={(val) => formData.class = val}
          suggestions={classSuggestions}
          id="class"
          placeholder="e.g., Psychiatric, Manufacturing..."
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        />
        <p class="text-xs text-braun-500 mt-1">
          Start typing to see suggestions
        </p>
      </div>

      <!-- P0: Condition and Status fields removed - use Access only -->

      <div>
        <label for="documentation" class="block text-sm font-medium text-braun-700 mb-1">
          Documentation
        </label>
        <input
          id="documentation"
          type="text"
          bind:value={formData.documentation}
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        />
      </div>

      <div>
        <label for="access" class="block text-sm font-medium text-braun-700 mb-1">
          Access
        </label>
        <input
          id="access"
          type="text"
          bind:value={formData.access}
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        />
      </div>

      <div class="flex items-center">
        <input
          type="checkbox"
          bind:checked={formData.historic}
          id="historic"
          class="mr-2"
        />
        <label for="historic" class="text-sm text-braun-700">
          Historic Landmark
        </label>
      </div>
    </div>

    <div class="border-t pt-6">
      <h3 class="text-lg font-semibold mb-4 text-foreground">Address</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="md:col-span-2">
          <label for="street" class="block text-sm font-medium text-braun-700 mb-1">
            Street
          </label>
          <input
            id="street"
            type="text"
            bind:value={formData.address_street}
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>

        <div>
          <label for="city" class="block text-sm font-medium text-braun-700 mb-1">
            City
          </label>
          <input
            id="city"
            type="text"
            bind:value={formData.address_city}
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>

        <div>
          <label for="county" class="block text-sm font-medium text-braun-700 mb-1">
            County
          </label>
          <input
            id="county"
            type="text"
            bind:value={formData.address_county}
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>

        <div>
          <label for="state" class="block text-sm font-medium text-braun-700 mb-1">
            State
          </label>
          <AutocompleteInput
            bind:value={formData.address_state}
            onchange={handleStateChange}
            suggestions={stateSuggestions}
            id="state"
            placeholder="NY or New York"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>

        <div>
          <label for="zipcode" class="block text-sm font-medium text-braun-700 mb-1">
            Zipcode
          </label>
          <input
            id="zipcode"
            type="text"
            bind:value={formData.address_zipcode}
            placeholder="12345"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>
      </div>
    </div>

    <div class="border-t pt-6">
      <h3 class="text-lg font-semibold mb-4 text-foreground">GPS Coordinates</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label for="gps_lat" class="block text-sm font-medium text-braun-700 mb-1">
            Latitude
          </label>
          <input
            id="gps_lat"
            type="text"
            bind:value={formData.gps_lat}
            placeholder="42.123456"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>

        <div>
          <label for="gps_lng" class="block text-sm font-medium text-braun-700 mb-1">
            Longitude
          </label>
          <input
            id="gps_lng"
            type="text"
            bind:value={formData.gps_lng}
            placeholder="-73.123456"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>
      </div>
    </div>

    <div class="flex justify-end gap-4">
      <button
        type="button"
        onclick={onCancel}
        class="px-4 py-2 bg-braun-200 text-foreground rounded hover:bg-braun-300 transition"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        class="px-6 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  </form>
</div>
