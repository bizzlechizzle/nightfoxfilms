<script lang="ts">
  import type { Location } from '@au-archive/core';
  import { LocationEntity } from '@au-archive/core';
  import AutocompleteInput from './AutocompleteInput.svelte';
  import { STATE_ABBREVIATIONS, getStateCodeFromName } from '../../electron/services/us-state-codes';
  import { DOCUMENTATION_OPTIONS, ACCESS_OPTIONS, GPS_SOURCE_OPTIONS } from '../constants/location-enums';

  // Field names that can be shown
  export type FieldName =
    | 'name' | 'akaName' | 'shortName'
    | 'state' | 'category' | 'class'
    | 'documentation' | 'access' | 'historic'
    | 'street' | 'city' | 'county' | 'zipcode'
    | 'gps' | 'gpsSource' | 'gpsVerified'
    | 'author'
    | 'isSubLocation' | 'parentLocation' | 'isPrimarySubLocation';

  interface Props {
    fields: FieldName[];
    required?: FieldName[];
    values: Record<string, any>;
    onValueChange: (field: string, value: any) => void;
    suggestions?: {
      categories?: string[];
      classes?: string[];
      authors?: string[];
      cities?: string[];
      counties?: string[];
    };
    locations?: Location[];
    disabled?: boolean;
    idPrefix?: string;
  }

  let {
    fields,
    required = [],
    values,
    onValueChange,
    suggestions = {},
    locations = [],
    disabled = false,
    idPrefix = 'loc',
  }: Props = $props();

  // GPS parsing state
  let gpsParseError = $state('');
  let parsedLat = $state<number | null>(null);
  let parsedLng = $state<number | null>(null);

  // Generate state suggestions (all US states + formatted)
  function getStateSuggestions(): string[] {
    const existingStates = new Set<string>();
    locations.forEach(loc => {
      if (loc.address?.state) {
        const code = loc.address.state.toUpperCase();
        const fullName = Object.entries(STATE_ABBREVIATIONS).find(([_, abbr]) => abbr === code)?.[0];
        if (fullName) {
          const titleCased = fullName.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
          existingStates.add(`${code} (${titleCased})`);
        } else {
          existingStates.add(code);
        }
      }
    });

    const allStates = Object.entries(STATE_ABBREVIATIONS).map(([name, code]) => {
      const titleCased = name.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      return `${code} (${titleCased})`;
    });

    const merged = new Set([...existingStates, ...allStates]);
    return Array.from(merged).sort();
  }

  // Normalize state input - accepts full name or code
  function handleStateChange(value: string) {
    if (!value) {
      onValueChange('state', '');
      return;
    }

    // Extract just the code if format is "NY (New York)"
    const codeMatch = value.match(/^([A-Z]{2})\s*\(/);
    if (codeMatch) {
      onValueChange('state', codeMatch[1]);
      return;
    }

    // Try to convert full name to code
    const code = getStateCodeFromName(value);
    if (code) {
      onValueChange('state', code);
      return;
    }

    // Otherwise store as-is (will be uppercased)
    onValueChange('state', value.toUpperCase().substring(0, 2));
  }

  // Parse GPS input - accepts multiple formats
  function parseGpsInput(input: string): { lat: number; lng: number } | null {
    if (!input.trim()) return null;

    const trimmed = input.trim();

    // Format 1: Decimal degrees "42.123456, -73.123456" or "42.123456 -73.123456"
    const decimalMatch = trimmed.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
    if (decimalMatch) {
      const lat = parseFloat(decimalMatch[1]);
      const lng = parseFloat(decimalMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    // Format 2: DMS "42°7'23.4"N 73°7'23.4"W"
    const dmsMatch = trimmed.match(/(\d+)°(\d+)'([\d.]+)"?([NS])\s*(\d+)°(\d+)'([\d.]+)"?([EW])/i);
    if (dmsMatch) {
      let lat = parseInt(dmsMatch[1]) + parseInt(dmsMatch[2]) / 60 + parseFloat(dmsMatch[3]) / 3600;
      let lng = parseInt(dmsMatch[5]) + parseInt(dmsMatch[6]) / 60 + parseFloat(dmsMatch[7]) / 3600;
      if (dmsMatch[4].toUpperCase() === 'S') lat = -lat;
      if (dmsMatch[8].toUpperCase() === 'W') lng = -lng;
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    // Format 3: Simple DMS "42 7 23 N 73 7 23 W"
    const simpleDmsMatch = trimmed.match(/(\d+)\s+(\d+)\s+([\d.]+)\s*([NS])\s+(\d+)\s+(\d+)\s+([\d.]+)\s*([EW])/i);
    if (simpleDmsMatch) {
      let lat = parseInt(simpleDmsMatch[1]) + parseInt(simpleDmsMatch[2]) / 60 + parseFloat(simpleDmsMatch[3]) / 3600;
      let lng = parseInt(simpleDmsMatch[5]) + parseInt(simpleDmsMatch[6]) / 60 + parseFloat(simpleDmsMatch[7]) / 3600;
      if (simpleDmsMatch[4].toUpperCase() === 'S') lat = -lat;
      if (simpleDmsMatch[8].toUpperCase() === 'W') lng = -lng;
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    return null;
  }

  // Handle GPS input change
  function handleGpsInputChange(value: string) {
    onValueChange('gpsInput', value);
    if (value) {
      const parsed = parseGpsInput(value);
      if (parsed) {
        parsedLat = parsed.lat;
        parsedLng = parsed.lng;
        gpsParseError = '';
        onValueChange('gpsLat', parsed.lat);
        onValueChange('gpsLng', parsed.lng);
      } else {
        parsedLat = null;
        parsedLng = null;
        gpsParseError = 'Could not parse GPS coordinates. Try: "42.123, -73.456" or DMS format';
        onValueChange('gpsLat', null);
        onValueChange('gpsLng', null);
      }
    } else {
      parsedLat = null;
      parsedLng = null;
      gpsParseError = '';
      onValueChange('gpsLat', null);
      onValueChange('gpsLng', null);
    }
  }

  // Generate short name from location name using core slugify
  // DECISION-010: Use LocationEntity.generateShortName() for consistent slug generation
  // "Old Factory" → "old-factory" (with hyphens, not "oldfactory")
  function generateShortName(name: string): string {
    return LocationEntity.generateShortName(name);
  }

  // Auto-generate short name when location name changes
  function handleNameChange(value: string) {
    onValueChange('name', value);
    if (value && !values.shortName && fields.includes('shortName')) {
      onValueChange('shortName', generateShortName(value));
    }
  }

  // Filter out sub-locations for parent selection
  function getParentLocationOptions(): Location[] {
    return locations.filter(loc => !loc.sub12);
  }

  // Check if field should be shown
  function showField(field: FieldName): boolean {
    return fields.includes(field);
  }

  // Check if field is required
  function isRequired(field: FieldName): boolean {
    return required.includes(field);
  }

  // Common input classes
  const inputClass = 'w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 disabled:opacity-50';
</script>

<div class="space-y-4">
  <!-- Name Field -->
  {#if showField('name')}
    <div>
      <label for="{idPrefix}-name" class="block text-sm font-medium text-braun-700 mb-1">
        Name {#if isRequired('name')}<span class="text-red-500">*</span>{/if}
      </label>
      <input
        id="{idPrefix}-name"
        type="text"
        value={values.name || ''}
        oninput={(e) => handleNameChange(e.currentTarget.value)}
        placeholder="Enter location name"
        {disabled}
        class={inputClass}
      />
    </div>
  {/if}

  <!-- AKA Name Field -->
  {#if showField('akaName')}
    <div>
      <label for="{idPrefix}-aka" class="block text-sm font-medium text-braun-700 mb-1">
        AKA / Alternate Name
      </label>
      <input
        id="{idPrefix}-aka"
        type="text"
        value={values.akaName || ''}
        oninput={(e) => onValueChange('akaName', e.currentTarget.value)}
        placeholder="Other names for this location"
        {disabled}
        class={inputClass}
      />
    </div>
  {/if}

  <!-- Short Name Field -->
  {#if showField('shortName')}
    <div>
      <label for="{idPrefix}-short" class="block text-sm font-medium text-braun-700 mb-1">
        Short Name (12 chars max)
      </label>
      <input
        id="{idPrefix}-short"
        type="text"
        value={values.shortName || ''}
        oninput={(e) => onValueChange('shortName', e.currentTarget.value)}
        maxlength="12"
        placeholder="Auto-generated"
        {disabled}
        class={inputClass}
      />
      <p class="text-xs text-braun-500 mt-1">Used in folder names</p>
    </div>
  {/if}

  <!-- State Field -->
  {#if showField('state')}
    <div>
      <label for="{idPrefix}-state" class="block text-sm font-medium text-braun-700 mb-1">
        State {#if isRequired('state')}<span class="text-red-500">*</span>{/if}
      </label>
      <AutocompleteInput
        value={values.state || ''}
        onchange={handleStateChange}
        suggestions={getStateSuggestions()}
        id="{idPrefix}-state"
        placeholder="NY or New York"
        class="{inputClass} uppercase"
      />
      <p class="text-xs text-braun-500 mt-1">Type 2-letter code or full state name</p>
    </div>
  {/if}

  <!-- Category Field -->
  {#if showField('category')}
    <div>
      <label for="{idPrefix}-category" class="block text-sm font-medium text-braun-700 mb-1">
        Category {#if isRequired('category')}<span class="text-red-500">*</span>{/if}
      </label>
      <AutocompleteInput
        value={values.category || ''}
        onchange={(val) => onValueChange('category', val)}
        suggestions={suggestions.categories || []}
        id="{idPrefix}-category"
        placeholder="e.g., Factory, Hospital, School"
        class={inputClass}
      />
    </div>
  {/if}

  <!-- Class Field -->
  {#if showField('class')}
    <div>
      <label for="{idPrefix}-class" class="block text-sm font-medium text-braun-700 mb-1">
        Class
      </label>
      <AutocompleteInput
        value={values.class || ''}
        onchange={(val) => onValueChange('class', val)}
        suggestions={suggestions.classes || []}
        id="{idPrefix}-class"
        placeholder="e.g., Textile Mill, Asylum"
        class={inputClass}
      />
    </div>
  {/if}

  <!-- Documentation Field -->
  {#if showField('documentation')}
    <div>
      <label for="{idPrefix}-documentation" class="block text-sm font-medium text-braun-700 mb-1">
        Documentation Level
      </label>
      <select
        id="{idPrefix}-documentation"
        value={values.documentation || ''}
        onchange={(e) => onValueChange('documentation', e.currentTarget.value)}
        {disabled}
        class={inputClass}
      >
        <option value="">Select...</option>
        {#each DOCUMENTATION_OPTIONS as opt}
          <option value={opt}>{opt}</option>
        {/each}
      </select>
    </div>
  {/if}

  <!-- Access Field -->
  {#if showField('access')}
    <div>
      <label for="{idPrefix}-access" class="block text-sm font-medium text-braun-700 mb-1">
        Access Status
      </label>
      <select
        id="{idPrefix}-access"
        value={values.access || ''}
        onchange={(e) => onValueChange('access', e.currentTarget.value)}
        {disabled}
        class={inputClass}
      >
        <option value="">Select...</option>
        {#each ACCESS_OPTIONS as opt}
          <option value={opt}>{opt}</option>
        {/each}
      </select>
    </div>
  {/if}

  <!-- Historic Field -->
  {#if showField('historic')}
    <div class="flex items-center gap-2">
      <input
        id="{idPrefix}-historic"
        type="checkbox"
        checked={values.historic || false}
        onchange={(e) => onValueChange('historic', e.currentTarget.checked)}
        {disabled}
        class="h-4 w-4 text-braun-900 border-braun-300 rounded focus:border-braun-600"
      />
      <label for="{idPrefix}-historic" class="text-sm font-medium text-braun-700">
        Historic / Landmark
      </label>
    </div>
  {/if}

  <!-- Author Field -->
  {#if showField('author')}
    <div>
      <label for="{idPrefix}-author" class="block text-sm font-medium text-braun-700 mb-1">
        Author
      </label>
      <AutocompleteInput
        value={values.author || ''}
        onchange={(val) => onValueChange('author', val)}
        suggestions={suggestions.authors || []}
        id="{idPrefix}-author"
        placeholder="Your name"
        class={inputClass}
      />
    </div>
  {/if}

  <!-- Address Section -->
  {#if showField('street') || showField('city') || showField('county') || showField('zipcode')}
    <div class="border-t pt-4 mt-4">
      <h3 class="text-md font-semibold text-foreground mb-3">Address</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        {#if showField('street')}
          <div class="md:col-span-2">
            <label for="{idPrefix}-street" class="block text-sm font-medium text-braun-700 mb-1">
              Street Address
            </label>
            <input
              id="{idPrefix}-street"
              type="text"
              value={values.street || ''}
              oninput={(e) => onValueChange('street', e.currentTarget.value)}
              placeholder="123 Main Street"
              {disabled}
              class={inputClass}
            />
          </div>
        {/if}

        {#if showField('city')}
          <div>
            <label for="{idPrefix}-city" class="block text-sm font-medium text-braun-700 mb-1">
              City
            </label>
            <AutocompleteInput
              value={values.city || ''}
              onchange={(val) => onValueChange('city', val)}
              suggestions={suggestions.cities || []}
              id="{idPrefix}-city"
              placeholder="City name"
              class={inputClass}
            />
          </div>
        {/if}

        {#if showField('county')}
          <div>
            <label for="{idPrefix}-county" class="block text-sm font-medium text-braun-700 mb-1">
              County
            </label>
            <AutocompleteInput
              value={values.county || ''}
              onchange={(val) => onValueChange('county', val)}
              suggestions={suggestions.counties || []}
              id="{idPrefix}-county"
              placeholder="County name"
              class={inputClass}
            />
          </div>
        {/if}

        {#if showField('zipcode')}
          <div>
            <label for="{idPrefix}-zipcode" class="block text-sm font-medium text-braun-700 mb-1">
              Zipcode
            </label>
            <input
              id="{idPrefix}-zipcode"
              type="text"
              value={values.zipcode || ''}
              oninput={(e) => onValueChange('zipcode', e.currentTarget.value)}
              placeholder="12345"
              {disabled}
              class={inputClass}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- GPS Section -->
  {#if showField('gps')}
    <div class="border-t pt-4 mt-4">
      <h3 class="text-md font-semibold text-foreground mb-3">GPS Coordinates</h3>
      <div>
        <label for="{idPrefix}-gps" class="block text-sm font-medium text-braun-700 mb-1">
          Coordinates
        </label>
        <input
          id="{idPrefix}-gps"
          type="text"
          value={values.gpsInput || ''}
          oninput={(e) => handleGpsInputChange(e.currentTarget.value)}
          placeholder="42.123456, -73.654321 or DMS format"
          {disabled}
          class={inputClass}
        />
        {#if gpsParseError}
          <p class="text-xs text-red-500 mt-1">{gpsParseError}</p>
        {:else if parsedLat !== null && parsedLng !== null}
          <p class="text-xs text-green-600 mt-1">
            Parsed: {parsedLat.toFixed(6)}, {parsedLng.toFixed(6)}
          </p>
        {:else}
          <p class="text-xs text-braun-500 mt-1">Accepts decimal degrees or DMS format</p>
        {/if}
      </div>
    </div>
  {/if}

  <!-- GPS Source -->
  {#if showField('gpsSource')}
    <div>
      <label for="{idPrefix}-gps-source" class="block text-sm font-medium text-braun-700 mb-1">
        GPS Source
      </label>
      <select
        id="{idPrefix}-gps-source"
        value={values.gpsSource || 'manual_entry'}
        onchange={(e) => onValueChange('gpsSource', e.currentTarget.value)}
        {disabled}
        class={inputClass}
      >
        {#each GPS_SOURCE_OPTIONS as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>
  {/if}

  <!-- GPS Verified -->
  {#if showField('gpsVerified')}
    <div class="flex items-center gap-2">
      <input
        id="{idPrefix}-gps-verified"
        type="checkbox"
        checked={values.gpsVerified || false}
        onchange={(e) => onValueChange('gpsVerified', e.currentTarget.checked)}
        {disabled}
        class="h-4 w-4 text-braun-900 border-braun-300 rounded focus:border-braun-600"
      />
      <label for="{idPrefix}-gps-verified" class="text-sm font-medium text-braun-700">
        GPS Verified on Map
      </label>
    </div>
  {/if}

  <!-- Sub-location Section -->
  {#if showField('isSubLocation')}
    <div class="border-t pt-4 mt-4">
      <h3 class="text-md font-semibold text-foreground mb-3">Sub-Location</h3>
      <div class="flex items-center gap-2 mb-4">
        <input
          id="{idPrefix}-is-sub"
          type="checkbox"
          checked={values.isSubLocation || false}
          onchange={(e) => onValueChange('isSubLocation', e.currentTarget.checked)}
          {disabled}
          class="h-4 w-4 text-braun-900 border-braun-300 rounded focus:border-braun-600"
        />
        <label for="{idPrefix}-is-sub" class="text-sm font-medium text-braun-700">
          This is a sub-location (part of another location)
        </label>
      </div>

      {#if values.isSubLocation && showField('parentLocation')}
        <div class="mt-4">
          <label for="{idPrefix}-parent" class="block text-sm font-medium text-braun-700 mb-1">
            Parent Location <span class="text-red-500">*</span>
          </label>
          <select
            id="{idPrefix}-parent"
            value={values.parentLocation || ''}
            onchange={(e) => onValueChange('parentLocation', e.currentTarget.value)}
            {disabled}
            class={inputClass}
          >
            <option value="">Select parent location...</option>
            {#each getParentLocationOptions() as loc}
              <option value={loc.locid}>{loc.locnam} ({loc.address?.state || 'N/A'})</option>
            {/each}
          </select>
        </div>

        {#if showField('isPrimarySubLocation')}
          <div class="flex items-center gap-2 mt-4">
            <input
              id="{idPrefix}-primary-sub"
              type="checkbox"
              checked={values.isPrimarySubLocation || false}
              onchange={(e) => onValueChange('isPrimarySubLocation', e.currentTarget.checked)}
              {disabled}
              class="h-4 w-4 text-braun-900 border-braun-300 rounded focus:border-braun-600"
            />
            <label for="{idPrefix}-primary-sub" class="text-sm font-medium text-braun-700">
              Primary sub-location (main building/feature)
            </label>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>
