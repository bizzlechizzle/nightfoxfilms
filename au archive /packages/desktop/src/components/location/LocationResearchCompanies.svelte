<script lang="ts">
  /**
   * LocationResearchCompanies - Company profiles nested accordion
   * Enhanced with new Profile API: aliases, dates, industry, key facts, social links
   * Per Braun: Nested accordion, confidence dots, functional colors
   */
  import { onMount } from 'svelte';
  import type { CompanyProfile } from '../../types/electron';

  interface Props {
    locid: string;
  }

  let { locid }: Props = $props();

  // Fallback to legacy entities if profiles not available
  interface LegacyEntity {
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

  let profiles = $state<CompanyProfile[]>([]);
  let legacyEntities = $state<LegacyEntity[]>([]);
  let loading = $state(true);
  let isOpen = $state(false);
  let expandedProfile = $state<string | null>(null);
  let useProfiles = $state(false);

  // For legacy view
  let organizations = $derived(legacyEntities.filter(e => e.entity_type === 'organization'));

  const roleLabels: Record<string, string> = {
    company: 'Company',
    government: 'Government',
    school: 'School',
    hospital: 'Hospital',
    church: 'Church',
    nonprofit: 'Nonprofit',
    military: 'Military',
    owner: 'Owner',
    developer: 'Developer',
    unknown: '',
  };

  const companyTypeLabels: Record<string, string> = {
    company: 'Company',
    government: 'Government Agency',
    school: 'Educational Institution',
    hospital: 'Healthcare',
    church: 'Religious Organization',
    nonprofit: 'Nonprofit',
    military: 'Military',
    unknown: 'Organization',
  };

  onMount(async () => {
    await loadData();
  });

  $effect(() => {
    const _ = locid;
    loadData();
  });

  async function loadData() {
    loading = true;

    // Try new profiles API first
    if (window.electronAPI?.extraction?.profiles?.companies) {
      try {
        const result = await window.electronAPI.extraction.profiles.companies.getByLocation(locid);
        if (result.success && result.profiles && result.profiles.length > 0) {
          profiles = result.profiles;
          useProfiles = true;
          loading = false;
          return;
        }
      } catch (e) {
        console.error('Failed to load company profiles:', e);
      }
    }

    // Fallback to legacy entities API
    if (window.electronAPI?.extraction?.entities) {
      try {
        const result = await window.electronAPI.extraction.entities.getByLocation(locid);
        if (result.success && result.entities) {
          legacyEntities = result.entities;
          useProfiles = false;
        }
      } catch (e) {
        console.error('Failed to load entities:', e);
      }
    }

    loading = false;
  }

  function formatRole(entity: LegacyEntity): string {
    const label = roleLabels[entity.entity_role || 'unknown'] || entity.entity_role;
    if (entity.date_range) {
      return label ? `${label} (${entity.date_range})` : entity.date_range;
    }
    return label || '';
  }

  function formatYears(profile: CompanyProfile): string {
    if (profile.founded_year && profile.dissolved_year) {
      return `${profile.founded_year}–${profile.dissolved_year}`;
    }
    if (profile.founded_year) {
      return `Founded ${profile.founded_year}`;
    }
    if (profile.dissolved_year) {
      return `Dissolved ${profile.dissolved_year}`;
    }
    return '';
  }

  function getStatusClass(status: string): string {
    if (status === 'verified') return 'text-[#4A8C5E]';
    if (status === 'pending') return 'text-[#C9A227]';
    return 'text-[#B85C4A]';
  }

  function getConfidenceClass(confidence: number): string {
    if (confidence >= 0.85) return 'bg-[#4A8C5E]';
    if (confidence >= 0.5) return 'bg-[#C9A227]';
    return 'bg-[#B85C4A]';
  }

  function toggleExpand(companyId: string) {
    expandedProfile = expandedProfile === companyId ? null : companyId;
  }
</script>

<!-- Nested accordion - no outer border -->
<div class="border-b border-braun-200 last:border-b-0">
  <button
    onclick={() => isOpen = !isOpen}
    aria-expanded={isOpen}
    class="w-full py-3 flex items-center justify-between text-left hover:bg-braun-50 transition-colors"
  >
    <span class="text-base font-medium text-braun-900">Companies</span>
    <div class="flex items-center gap-2">
      {#if !loading}
        <span class="text-sm text-braun-400">({useProfiles ? profiles.length : organizations.length})</span>
      {/if}
      <svg
        class="w-4 h-4 text-braun-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  </button>

  {#if isOpen}
    <div class="pb-4 pl-4">
      {#if loading}
        <div class="py-4 text-sm text-braun-500">Loading...</div>
      {:else if useProfiles && profiles.length > 0}
        <!-- Enhanced profile view -->
        <ul class="space-y-3">
          {#each profiles as profile (profile.company_id)}
            <li class="border-l-2 border-braun-200 pl-3">
              <!-- Profile header - clickable to expand -->
              <button
                onclick={() => toggleExpand(profile.company_id)}
                class="w-full text-left flex items-start gap-2"
              >
                <div class="min-w-0 flex-1">
                  <span class="text-[14px] font-medium text-braun-900">{profile.name}</span>
                  {#if profile.company_type && profile.company_type !== 'unknown'}
                    <span class="text-[13px] text-braun-500 ml-1">({companyTypeLabels[profile.company_type]})</span>
                  {/if}
                  {#if formatYears(profile)}
                    <span class="text-[13px] text-braun-600 ml-1">· {formatYears(profile)}</span>
                  {/if}
                  {#if profile.status === 'pending'}
                    <span class="ml-2 text-[11px] {getStatusClass(profile.status)} uppercase tracking-wide">(unverified)</span>
                  {/if}
                </div>
                <svg
                  class="w-4 h-4 text-braun-400 flex-shrink-0 transition-transform {expandedProfile === profile.company_id ? 'rotate-180' : ''}"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <!-- Expanded profile details -->
              {#if expandedProfile === profile.company_id}
                <div class="mt-2 pl-4 space-y-2 text-[13px]">
                  {#if profile.aliases.length > 0}
                    <div>
                      <span class="text-braun-500">Also known as:</span>
                      <span class="text-braun-700 ml-1">{profile.aliases.join(', ')}</span>
                    </div>
                  {/if}
                  {#if profile.industry}
                    <div>
                      <span class="text-braun-500">Industry:</span>
                      <span class="text-braun-700 ml-1">{profile.industry}</span>
                    </div>
                  {/if}
                  {#if profile.description}
                    <div class="text-braun-600">{profile.description}</div>
                  {/if}
                  {#if profile.key_facts.length > 0}
                    <ul class="list-disc list-inside text-braun-600 space-y-0.5">
                      {#each profile.key_facts as fact}
                        <li>{fact}</li>
                      {/each}
                    </ul>
                  {/if}
                  {#if profile.parent_company_name}
                    <div>
                      <span class="text-braun-500">Parent company:</span>
                      <span class="text-braun-700 ml-1">{profile.parent_company_name}</span>
                    </div>
                  {/if}
                  {#if profile.website || profile.social_links}
                    <div class="flex gap-3 mt-1">
                      {#if profile.website}
                        <a href={profile.website} target="_blank" rel="noopener" class="text-[#4A8C5E] hover:underline">Website</a>
                      {/if}
                      {#if profile.social_links?.wikipedia}
                        <a href={profile.social_links.wikipedia} target="_blank" rel="noopener" class="text-[#4A8C5E] hover:underline">Wikipedia</a>
                      {/if}
                    </div>
                  {/if}
                  {#if profile.location_refs && profile.location_refs.length > 1}
                    <div class="mt-2 pt-2 border-t border-braun-200">
                      <span class="text-braun-500 text-[12px] uppercase tracking-wide">Other locations:</span>
                      <ul class="mt-1 space-y-0.5">
                        {#each profile.location_refs.filter(r => r.locid !== locid) as ref}
                          <li class="text-braun-600">{ref.locnam} ({ref.relationship})</li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else if organizations.length > 0}
        <!-- Legacy entities view -->
        <ul class="space-y-2">
          {#each organizations as org (org.extraction_id)}
            <li class="flex items-start gap-2">
              <span
                class="mt-1.5 w-2 h-2 rounded-full flex-shrink-0 {getConfidenceClass(org.confidence)}"
                title="Confidence: {Math.round(org.confidence * 100)}%"
              ></span>
              <div class="min-w-0 flex-1">
                <span class="text-[14px] font-medium text-braun-900">{org.entity_name}</span>
                {#if formatRole(org)}
                  <span class="text-[13px] text-braun-600"> - {formatRole(org)}</span>
                {/if}
                {#if org.status === 'pending'}
                  <span class="ml-2 text-[11px] text-[#C9A227] uppercase tracking-wide">(unverified)</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="py-4 text-sm text-braun-500">No companies extracted</div>
      {/if}
    </div>
  {/if}
</div>
