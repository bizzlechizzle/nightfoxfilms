<script lang="ts">
  /**
   * LocationPeopleCompanies - Display extracted people and organizations (OPT-120)
   * Shows entities extracted by Document Intelligence from web sources.
   * Braun white card styling, view-only mode.
   */
  import { onMount } from 'svelte';

  interface Props {
    locid: string;
    onUpdate?: () => void;
  }

  let { locid, onUpdate }: Props = $props();

  interface Entity {
    extraction_id: string;
    entity_type: 'person' | 'organization';
    entity_name: string;
    entity_role: string | null;
    date_range: string | null;
    confidence: number;
    context_sentence: string | null;
    status: 'approved' | 'pending' | 'rejected';
    created_at: string;
  }

  let entities = $state<Entity[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Split entities by type
  let people = $derived(entities.filter(e => e.entity_type === 'person'));
  let organizations = $derived(entities.filter(e => e.entity_type === 'organization'));

  // Only show if we have entities
  let hasData = $derived(entities.length > 0);

  // Role display labels
  const roleLabels: Record<string, string> = {
    owner: 'Owner',
    architect: 'Architect',
    developer: 'Developer',
    employee: 'Employee',
    founder: 'Founder',
    visitor: 'Visitor',
    photographer: 'Photographer',
    historian: 'Historian',
    company: 'Company',
    government: 'Government',
    school: 'School',
    hospital: 'Hospital',
    church: 'Church',
    nonprofit: 'Nonprofit',
    military: 'Military',
    unknown: '',
  };

  onMount(async () => {
    await loadEntities();
  });

  // Reload when locid changes
  $effect(() => {
    const _ = locid;
    loadEntities();
  });

  async function loadEntities() {
    if (!window.electronAPI?.extraction?.entities) {
      loading = false;
      return;
    }

    loading = true;
    error = null;

    try {
      const result = await window.electronAPI.extraction.entities.getByLocation(locid);
      if (result.success && result.entities) {
        entities = result.entities;
      } else if (result.error) {
        error = result.error;
      }
    } catch (e) {
      console.error('Failed to load entities:', e);
      error = 'Failed to load extracted entities';
    } finally {
      loading = false;
    }
  }

  function formatRole(entity: Entity): string {
    const label = roleLabels[entity.entity_role || 'unknown'] || entity.entity_role;
    if (entity.date_range) {
      return label ? `${label} (${entity.date_range})` : entity.date_range;
    }
    return label || '';
  }

  function getConfidenceClass(confidence: number): string {
    if (confidence >= 0.85) return 'text-green-600';
    if (confidence >= 0.5) return 'text-amber-600';
    return 'text-red-600';
  }
</script>

{#if loading}
  <!-- Don't show anything while loading -->
{:else if error}
  <!-- Silent fail - don't show error for entities -->
{:else if hasData}
  <div class="bg-white rounded border border-braun-300 mb-8">
    <!-- Header -->
    <div class="px-8 pt-6 pb-4">
      <h2 class="text-2xl font-semibold text-braun-900 leading-none">People & Companies</h2>
    </div>

    <!-- Content -->
    <div class="px-8 pb-6">
      <div class="grid grid-cols-2 gap-8">
        <!-- People Column -->
        <div>
          {#if people.length > 0}
            <h3 class="text-sm font-medium text-braun-500 uppercase tracking-wide mb-3">People</h3>
            <ul class="space-y-2">
              {#each people as person (person.extraction_id)}
                <li class="flex items-start gap-2">
                  <!-- Confidence indicator dot -->
                  <span class="mt-1.5 w-2 h-2 rounded-full {getConfidenceClass(person.confidence)} bg-current flex-shrink-0" title="Confidence: {Math.round(person.confidence * 100)}%"></span>
                  <div class="min-w-0 flex-1">
                    <span class="text-[15px] font-medium text-braun-900">{person.entity_name}</span>
                    {#if formatRole(person)}
                      <span class="text-[14px] text-braun-600"> - {formatRole(person)}</span>
                    {/if}
                    {#if person.status === 'pending'}
                      <span class="ml-2 text-[11px] text-amber-600 uppercase tracking-wide">(unverified)</span>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-sm text-braun-500">No people extracted</p>
          {/if}
        </div>

        <!-- Organizations Column -->
        <div>
          {#if organizations.length > 0}
            <h3 class="text-sm font-medium text-braun-500 uppercase tracking-wide mb-3">Companies & Organizations</h3>
            <ul class="space-y-2">
              {#each organizations as org (org.extraction_id)}
                <li class="flex items-start gap-2">
                  <!-- Confidence indicator dot -->
                  <span class="mt-1.5 w-2 h-2 rounded-full {getConfidenceClass(org.confidence)} bg-current flex-shrink-0" title="Confidence: {Math.round(org.confidence * 100)}%"></span>
                  <div class="min-w-0 flex-1">
                    <span class="text-[15px] font-medium text-braun-900">{org.entity_name}</span>
                    {#if formatRole(org)}
                      <span class="text-[14px] text-braun-600"> - {formatRole(org)}</span>
                    {/if}
                    {#if org.status === 'pending'}
                      <span class="ml-2 text-[11px] text-amber-600 uppercase tracking-wide">(unverified)</span>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-sm text-braun-500">No companies extracted</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
