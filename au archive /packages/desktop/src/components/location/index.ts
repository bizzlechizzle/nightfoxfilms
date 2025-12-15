/**
 * Location Detail Components
 * Per LILBITS: Each component under 300 lines
 * Per PUEA: Components show only what exists
 */

export { default as LocationHeader } from './LocationHeader.svelte';
export { default as LocationInfo } from './LocationInfo.svelte';
export { default as LocationMapSection } from './LocationMapSection.svelte';
export { default as LocationGallery } from './LocationGallery.svelte';
export { default as LocationVideos } from './LocationVideos.svelte';
export { default as LocationDocuments } from './LocationDocuments.svelte';
export { default as LocationMaps } from './LocationMaps.svelte'; // MAP-MEDIA-FIX-001
export { default as LocationRecords } from './LocationRecords.svelte';
export { default as LocationImportZone } from './LocationImportZone.svelte';
export { default as LocationBookmarks } from './LocationBookmarks.svelte';
export { default as LocationWebSources } from './LocationWebSources.svelte';
export { default as LocationNerdStats } from './LocationNerdStats.svelte';
export { default as LocationSettings } from './LocationSettings.svelte';
export { default as SubLocationGrid } from './SubLocationGrid.svelte';
// Timeline (Migration 69)
export { default as LocationTimeline } from './LocationTimeline.svelte';
export { default as TimelineEventRow } from './TimelineEventRow.svelte';
export { default as TimelineDateInput } from './TimelineDateInput.svelte';
// Horizontal info strip (replaces LocationInfo in main position)
export { default as LocationInfoHorizontal } from './LocationInfoHorizontal.svelte';
// OPT-120: Document Intelligence - People & Companies (legacy, replaced by Research section)
export { default as LocationPeopleCompanies } from './LocationPeopleCompanies.svelte';
// Research section with Timeline, People, Companies
export { default as LocationResearch } from './LocationResearch.svelte';
export { default as LocationResearchTimeline } from './LocationResearchTimeline.svelte';
export { default as LocationResearchPeople } from './LocationResearchPeople.svelte';
export { default as LocationResearchCompanies } from './LocationResearchCompanies.svelte';

export * from './types';
