<script lang="ts">
  /**
   * LocationWebSources - "Websites" archive management
   * Shows web-extracted images/videos inline per source
   * OPT-109: Comprehensive web archiving replacing simple bookmarks
   * OPT-111: Enhanced metadata viewer modal integration
   * OPT-116: PIN confirmation for destructive delete
   * FIX: Auto-refresh when bookmarks saved from browser extension
   * Per LILBITS: ~300 lines, single responsibility
   */

  import { onMount } from 'svelte';
  import WebSourceDetailModal from './WebSourceDetailModal.svelte';

  type ComponentStatusValue = 'pending' | 'done' | 'failed' | 'skipped';

  interface ComponentStatus {
    screenshot?: ComponentStatusValue;
    pdf?: ComponentStatusValue;
    html?: ComponentStatusValue;
    warc?: ComponentStatusValue;
    images?: ComponentStatusValue;
    videos?: ComponentStatusValue;
    text?: ComponentStatusValue;
  }

  interface WebSource {
    source_id: string;
    url: string;
    title: string | null;
    source_type: string;
    status: 'pending' | 'archiving' | 'complete' | 'partial' | 'failed';
    notes: string | null;
    extracted_title: string | null;
    extracted_author: string | null;
    extracted_date: string | null;
    word_count: number;
    image_count: number;
    video_count: number;
    screenshot_path: string | null;
    created_at: string;
    archived_at: string | null;
    component_status: ComponentStatus | null;
    archive_error: string | null;
    // OPT-120: Extraction Pipeline fields
    smart_title: string | null;
    smart_summary: string | null;
    extraction_status: string | null;
    extraction_confidence: number | null;
    domain: string | null;
  }

  // Web source image/video types from database
  interface WebSourceImage {
    id: number;
    source_id: string;
    image_index: number;
    url: string;
    local_path: string | null;
    hash: string | null;
    width: number | null;
    height: number | null;
    size: number | null;
    original_filename: string | null;
    alt: string | null;
    caption: string | null;
  }

  interface WebSourceVideo {
    id: number;
    source_id: string;
    video_index: number;
    url: string;
    local_path: string | null;
    hash: string | null;
    title: string | null;
    duration: number | null;
    thumbnail_path: string | null;
  }

  interface Props {
    locid: string;
    onOpenSource: (url: string) => void;
  }

  let { locid, onOpenSource }: Props = $props();

  // State
  let sources = $state<WebSource[]>([]);
  let loading = $state(true);
  let isOpen = $state(true); // Expanded by default as sub-accordion
  let showAddForm = $state(false);
  let archivingSource = $state<string | null>(null);
  let expandedSource = $state<string | null>(null);

  // Inline media display state
  let expandedMediaSource = $state<string | null>(null);
  let sourceMedia = $state<Map<string, { images: WebSourceImage[]; videos: WebSourceVideo[] }>>(new Map());
  let loadingMedia = $state<string | null>(null);

  // OPT-111: Detail modal state
  let showDetailModal = $state(false);
  let detailSourceId = $state<string | null>(null);

  // OPT-116: Delete confirmation state
  let showDeleteConfirm = $state(false);
  let deleteSourceId = $state<string | null>(null);
  let deleteSourceTitle = $state('');
  let deletePin = $state('');
  let deletePinError = $state('');
  let deleting = $state(false);

  // Helper for component status icons
  function getComponentIcon(status: ComponentStatusValue | undefined): string {
    switch (status) {
      case 'done': return '✓';
      case 'failed': return '✗';
      case 'skipped': return '○';
      case 'pending': return '◌';
      default: return '·';
    }
  }

  function getComponentClass(status: ComponentStatusValue | undefined): string {
    switch (status) {
      case 'done': return 'text-green-600';
      case 'failed': return 'text-red-600';
      case 'skipped': return 'text-braun-400';
      default: return 'text-braun-300';
    }
  }

  // Add form state
  let newUrl = $state('');
  let newTitle = $state('');
  let newType = $state('article');
  let newNotes = $state('');
  let addingSource = $state(false);

  // Load sources on mount and when locid changes
  $effect(() => {
    if (locid) {
      loadSources();
    }
  });

  // FIX: Listen for web sources saved from browser extension and auto-refresh
  onMount(() => {
    const unsubscribe = window.electronAPI?.websources?.onWebSourceSaved?.((payload) => {
      // Only refresh if the saved source is for this location
      if (payload.locid === locid) {
        loadSources();
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  });

  async function loadSources() {
    loading = true;
    try {
      sources = await window.electronAPI.websources.findByLocation(locid);
    } catch (err) {
      console.error('Failed to load web sources:', err);
    } finally {
      loading = false;
    }
  }

  async function handleAddSource() {
    if (!newUrl.trim()) return;
    addingSource = true;
    try {
      await window.electronAPI.websources.create({
        url: newUrl.trim(),
        title: newTitle.trim() || null,
        locid,
        source_type: newType,
        notes: newNotes.trim() || null,
      });
      // Reset form
      newUrl = '';
      newTitle = '';
      newType = 'article';
      newNotes = '';
      showAddForm = false;
      // Reload
      await loadSources();
    } catch (err) {
      console.error('Failed to add web source:', err);
      alert(err instanceof Error ? err.message : 'Failed to add source');
    } finally {
      addingSource = false;
    }
  }

  async function handleArchive(sourceId: string) {
    archivingSource = sourceId;
    try {
      await window.electronAPI.websources.archive(sourceId, {
        captureScreenshot: true,
        capturePdf: true,
        captureHtml: true,
        captureWarc: true,
        extractImages: true,
        extractText: true,
      });
      await loadSources();
    } catch (err) {
      console.error('Failed to archive source:', err);
      alert(err instanceof Error ? err.message : 'Failed to archive');
    } finally {
      archivingSource = null;
    }
  }

  // OPT-116: Open delete confirmation modal
  function handleDelete(sourceId: string) {
    const source = sources.find(s => s.source_id === sourceId);
    if (!source) return;
    deleteSourceId = sourceId;
    deleteSourceTitle = source.title || source.extracted_title || source.url;
    deletePin = '';
    deletePinError = '';
    showDeleteConfirm = true;
  }

  // OPT-116: Verify PIN and delete
  async function verifyDeletePin() {
    if (!deletePin) {
      deletePinError = 'Please enter your PIN';
      return;
    }

    try {
      const users = await window.electronAPI?.users?.findAll?.() || [];
      const currentUser = users[0] as { user_id: string } | undefined;

      if (!currentUser) {
        deletePinError = 'No user found';
        return;
      }

      const result = await window.electronAPI?.users?.verifyPin(currentUser.user_id, deletePin);
      if (result?.success) {
        await executeDelete();
      } else {
        deletePinError = 'Invalid PIN';
      }
    } catch (err) {
      console.error('PIN verification failed:', err);
      deletePinError = 'Verification failed';
    }
  }

  // OPT-116: Execute the actual deletion
  async function executeDelete() {
    if (!deleteSourceId) return;
    try {
      deleting = true;
      await window.electronAPI.websources.delete(deleteSourceId);
      showDeleteConfirm = false;
      await loadSources();
    } catch (err) {
      console.error('Failed to delete source:', err);
      deletePinError = 'Delete failed';
    } finally {
      deleting = false;
    }
  }

  function cancelDelete() {
    showDeleteConfirm = false;
    deleteSourceId = null;
    deleteSourceTitle = '';
    deletePin = '';
    deletePinError = '';
  }

  // OPT-111: Open detail modal for archive viewing
  function handleViewArchive(sourceId: string) {
    detailSourceId = sourceId;
    showDetailModal = true;
  }

  function handleCloseDetail() {
    showDetailModal = false;
    detailSourceId = null;
  }

  // Toggle inline media display for a source
  async function toggleMediaDisplay(sourceId: string) {
    // If already expanded, collapse
    if (expandedMediaSource === sourceId) {
      expandedMediaSource = null;
      return;
    }

    // Check if already loaded
    if (sourceMedia.has(sourceId)) {
      expandedMediaSource = sourceId;
      return;
    }

    // Load media for this source
    loadingMedia = sourceId;
    try {
      const [images, videos] = await Promise.all([
        window.electronAPI.websources.getImages(sourceId),
        window.electronAPI.websources.getVideos(sourceId),
      ]);
      sourceMedia.set(sourceId, { images: images || [], videos: videos || [] });
      sourceMedia = sourceMedia; // Trigger reactivity
      expandedMediaSource = sourceId;
    } catch (err) {
      console.error('Failed to load media for source:', err);
    } finally {
      loadingMedia = null;
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'complete': return 'bg-green-100 text-green-700';
      case 'partial': return 'bg-yellow-100 text-yellow-700';
      case 'failed': return 'bg-red-100 text-red-700';
      case 'archiving': return 'bg-blue-100 text-blue-700';
      default: return 'bg-braun-100 text-braun-600';
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'complete': return 'Archived';
      case 'partial': return 'Partial';
      case 'failed': return 'Failed';
      case 'archiving': return 'Archiving...';
      default: return 'Pending';
    }
  }

  const sourceTypes = [
    { value: 'article', label: 'Article' },
    { value: 'gallery', label: 'Photo Gallery' },
    { value: 'video', label: 'Video' },
    { value: 'social', label: 'Social Media' },
    { value: 'map', label: 'Map' },
    { value: 'document', label: 'Document' },
    { value: 'archive', label: 'Archive' },
    { value: 'other', label: 'Other' },
  ];
</script>

<div class="border-b border-braun-200 last:border-b-0">
  <!-- Sub-accordion header -->
  <button
    onclick={() => isOpen = !isOpen}
    aria-expanded={isOpen}
    class="w-full py-3 flex items-center justify-between text-left hover:bg-braun-100 transition-colors"
  >
    <h3 class="text-sm font-medium text-braun-900">Websites ({sources.length})</h3>
    <svg
      class="w-4 h-4 text-braun-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if isOpen}
    <div class="pb-4">
      <!-- Add Website button -->
      <div class="flex justify-end mb-3">
        <button
          onclick={() => showAddForm = !showAddForm}
          class="text-sm text-braun-900 hover:underline"
        >
          {showAddForm ? 'Cancel' : '+ Add Website'}
        </button>
      </div>

      {#if showAddForm}
    <div class="mb-4 p-4 bg-braun-50 rounded">
      <div class="space-y-3">
        <div>
          <label for="source-url" class="block form-label mb-1">URL *</label>
          <input
            id="source-url"
            type="url"
            bind:value={newUrl}
            placeholder="https://..."
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="source-title" class="block form-label mb-1">Title</label>
            <input
              id="source-title"
              type="text"
              bind:value={newTitle}
              placeholder="Optional title"
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            />
          </div>
          <div>
            <label for="source-type" class="block form-label mb-1">Type</label>
            <select
              id="source-type"
              bind:value={newType}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            >
              {#each sourceTypes as type}
                <option value={type.value}>{type.label}</option>
              {/each}
            </select>
          </div>
        </div>
        <div>
          <label for="source-notes" class="block form-label mb-1">Notes</label>
          <textarea
            id="source-notes"
            bind:value={newNotes}
            placeholder="Optional notes about this source"
            rows="2"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 resize-none"
          ></textarea>
        </div>
        <button
          onclick={handleAddSource}
          disabled={addingSource || !newUrl.trim()}
          class="w-full px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
        >
          {addingSource ? 'Adding...' : 'Add Website'}
        </button>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-8 text-braun-400">Loading...</div>
  {:else if sources.length > 0}
    <div class="space-y-3">
      {#each sources as source}
        <div class="p-4 bg-braun-50 rounded hover:bg-braun-100 transition">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <!-- OPT-120: Use smart_title if available, fall back to extracted_title, then title -->
              <div class="flex items-center gap-2 flex-wrap">
                <button
                  onclick={() => onOpenSource(source.url)}
                  class="text-braun-900 hover:underline font-medium truncate max-w-md"
                >
                  {source.smart_title || source.title || source.extracted_title || source.url}
                </button>
{#if (source.status === 'partial' || source.status === 'failed') && source.component_status}
                  <button
                    onclick={() => expandedSource = expandedSource === source.source_id ? null : source.source_id}
                    class="px-2 py-0.5 text-xs rounded capitalize cursor-pointer hover:opacity-80 {getStatusColor(source.status)}"
                    title="Click to see details"
                  >
                    {getStatusLabel(source.status)} ▾
                  </button>
                {:else}
                  <span class="px-2 py-0.5 text-xs rounded capitalize {getStatusColor(source.status)}">
                    {getStatusLabel(source.status)}
                  </span>
                {/if}
                <span class="px-2 py-0.5 bg-braun-100 text-braun-600 text-xs rounded capitalize">
                  {source.source_type}
                </span>
              </div>
              <!-- OPT-120: Show smart summary (TL;DR) if available -->
              {#if source.smart_summary}
                <p class="text-sm text-braun-700 mt-2 line-clamp-2">{source.smart_summary}</p>
              {/if}
              <!-- Source info row: domain, date, author -->
              <div class="flex items-center gap-2 mt-1 text-xs text-braun-400">
                {#if source.domain}
                  <span>{source.domain}</span>
                  <span class="text-braun-300">•</span>
                {/if}
                {#if source.extracted_date}
                  <span>{source.extracted_date}</span>
                  <span class="text-braun-300">•</span>
                {/if}
                {#if source.extracted_author}
                  <span>{source.extracted_author}</span>
                {:else}
                  <span class="truncate">{source.url}</span>
                {/if}
              </div>
              {#if source.status === 'complete' || source.status === 'partial'}
                <div class="flex items-center gap-4 mt-2 text-xs text-braun-500">
                  {#if source.word_count > 0}
                    <span>{source.word_count.toLocaleString()} words</span>
                  {/if}
                  {#if source.image_count > 0 || source.video_count > 0}
                    <button
                      onclick={() => toggleMediaDisplay(source.source_id)}
                      class="flex items-center gap-1 hover:text-braun-700 transition-colors"
                      title={expandedMediaSource === source.source_id ? 'Hide media' : 'Show media'}
                    >
                      {#if source.image_count > 0}
                        <span>{source.image_count} images</span>
                      {/if}
                      {#if source.image_count > 0 && source.video_count > 0}
                        <span>•</span>
                      {/if}
                      {#if source.video_count > 0}
                        <span>{source.video_count} videos</span>
                      {/if}
                      <svg class="w-3 h-3 transition-transform {expandedMediaSource === source.source_id ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  {/if}
                </div>
              {/if}
              {#if source.notes}
                <p class="text-sm text-braun-600 mt-2 italic">{source.notes}</p>
              {/if}
              {#if expandedSource === source.source_id && source.component_status}
                <div class="mt-3 p-3 bg-white rounded border border-braun-200 text-xs">
                  <div class="font-medium text-braun-700 mb-2">Archive Components:</div>
                  <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div class={getComponentClass(source.component_status.screenshot)}>
                      {getComponentIcon(source.component_status.screenshot)} Screenshot
                    </div>
                    <div class={getComponentClass(source.component_status.pdf)}>
                      {getComponentIcon(source.component_status.pdf)} PDF
                    </div>
                    <div class={getComponentClass(source.component_status.html)}>
                      {getComponentIcon(source.component_status.html)} HTML
                    </div>
                    <div class={getComponentClass(source.component_status.warc)}>
                      {getComponentIcon(source.component_status.warc)} WARC
                    </div>
                    <div class={getComponentClass(source.component_status.images)}>
                      {getComponentIcon(source.component_status.images)} Images{#if source.image_count > 0} ({source.image_count}){/if}
                    </div>
                    <div class={getComponentClass(source.component_status.videos)}>
                      {getComponentIcon(source.component_status.videos)} Videos{#if source.video_count > 0} ({source.video_count}){/if}
                    </div>
                    <div class={getComponentClass(source.component_status.text)}>
                      {getComponentIcon(source.component_status.text)} Text{#if source.word_count > 0} ({source.word_count.toLocaleString()} words){/if}
                    </div>
                  </div>
                  {#if source.archive_error}
                    <div class="mt-2 text-red-600 text-xs">Error: {source.archive_error}</div>
                  {/if}
                </div>
              {/if}
              <!-- Inline media display -->
              {#if expandedMediaSource === source.source_id}
                <div class="mt-3 p-3 bg-white rounded border border-braun-200">
                  {#if loadingMedia === source.source_id}
                    <div class="text-sm text-braun-400 text-center py-4">Loading media...</div>
                  {:else}
                    {@const media = sourceMedia.get(source.source_id)}
                    {#if media}
                      <!-- Images grid -->
                      {#if media.images.length > 0}
                        <div class="mb-3">
                          <div class="text-xs font-medium text-braun-600 mb-2">Images ({media.images.length})</div>
                          <div class="grid grid-cols-4 gap-2">
                            {#each media.images.slice(0, 8) as image}
                              <button
                                onclick={() => handleViewArchive(source.source_id)}
                                class="aspect-square bg-braun-100 rounded overflow-hidden hover:opacity-80 transition"
                                title={image.alt || image.original_filename || 'Web image'}
                              >
                                {#if image.local_path}
                                  <img
                                    src="file://{image.local_path}"
                                    alt={image.alt || ''}
                                    class="w-full h-full object-cover"
                                  />
                                {:else}
                                  <div class="w-full h-full flex items-center justify-center text-braun-400">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  </div>
                                {/if}
                              </button>
                            {/each}
                          </div>
                          {#if media.images.length > 8}
                            <button
                              onclick={() => handleViewArchive(source.source_id)}
                              class="mt-2 text-xs text-braun-600 hover:text-braun-900"
                            >
                              View all {media.images.length} images...
                            </button>
                          {/if}
                        </div>
                      {/if}
                      <!-- Videos list -->
                      {#if media.videos.length > 0}
                        <div>
                          <div class="text-xs font-medium text-braun-600 mb-2">Videos ({media.videos.length})</div>
                          <div class="space-y-1">
                            {#each media.videos.slice(0, 4) as video}
                              <button
                                onclick={() => handleViewArchive(source.source_id)}
                                class="w-full flex items-center gap-2 p-2 bg-braun-50 rounded hover:bg-braun-100 transition text-left"
                              >
                                <svg class="w-4 h-4 text-braun-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span class="text-xs text-braun-700 truncate">{video.title || video.url}</span>
                                {#if video.duration}
                                  <span class="text-xs text-braun-400 ml-auto">{Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}</span>
                                {/if}
                              </button>
                            {/each}
                          </div>
                          {#if media.videos.length > 4}
                            <button
                              onclick={() => handleViewArchive(source.source_id)}
                              class="mt-2 text-xs text-braun-600 hover:text-braun-900"
                            >
                              View all {media.videos.length} videos...
                            </button>
                          {/if}
                        </div>
                      {/if}
                      {#if media.images.length === 0 && media.videos.length === 0}
                        <div class="text-sm text-braun-400 text-center py-2">No media found</div>
                      {/if}
                    {/if}
                  {/if}
                </div>
              {/if}
            </div>
            <div class="flex items-center gap-2 ml-4">
              {#if source.status === 'pending' || source.status === 'failed'}
                <button
                  onclick={() => handleArchive(source.source_id)}
                  disabled={archivingSource === source.source_id}
                  class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 disabled:opacity-50"
                  title="Archive this page"
                >
                  {archivingSource === source.source_id ? 'Archiving...' : 'Archive'}
                </button>
              {:else if source.status === 'partial'}
                <button
                  onclick={() => handleArchive(source.source_id)}
                  disabled={archivingSource === source.source_id}
                  class="px-3 py-1 text-sm border border-braun-300 rounded hover:bg-braun-100 disabled:opacity-50"
                  title="Re-archive to retry failed components"
                >
                  {archivingSource === source.source_id ? 'Archiving...' : 'Re-archive'}
                </button>
                <button
                  onclick={() => handleViewArchive(source.source_id)}
                  class="px-3 py-1 text-sm border border-braun-300 rounded hover:bg-braun-100"
                  title="View archive details"
                >
                  View
                </button>
              {:else if source.status === 'complete'}
                <button
                  onclick={() => handleViewArchive(source.source_id)}
                  class="px-3 py-1 text-sm border border-braun-300 rounded hover:bg-braun-100"
                  title="View archive details"
                >
                  View
                </button>
              {/if}
              <button
                onclick={() => handleDelete(source.source_id)}
                class="p-1 text-braun-400 hover:text-error transition"
                title="Delete source"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else}
      <div class="text-center text-braun-400 py-8 border-2 border-dashed border-braun-200 rounded">
        <p class="text-sm">No websites yet</p>
        <p class="text-xs mt-1">Add URLs to articles, photos, and resources to archive them</p>
      </div>
    {/if}
    </div>
  {/if}
</div>

<!-- OPT-111: Archive Detail Modal -->
{#if showDetailModal && detailSourceId}
  <WebSourceDetailModal
    sourceId={detailSourceId}
    onClose={handleCloseDetail}
    onOpenUrl={onOpenSource}
  />
{/if}

<!-- OPT-116: Delete Confirmation Modal (PIN required) -->
{#if showDeleteConfirm}
<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={cancelDelete}>
  <div class="bg-white rounded border border-braun-300 p-6 w-full max-w-md mx-4" onclick={(e) => e.stopPropagation()}>
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-semibold text-error">Delete Web Source?</h3>
      <button onclick={cancelDelete} class="text-braun-400 hover:text-braun-600">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
    <p class="text-sm text-braun-600 mb-2 truncate" title={deleteSourceTitle}>{deleteSourceTitle}</p>
    <div class="bg-braun-100 border border-braun-300 rounded p-4 mb-4">
      <p class="text-sm text-braun-700 mb-2">This action cannot be undone.</p>
      <p class="text-sm text-error font-medium">All archived files will be permanently deleted.</p>
    </div>
    <div class="mb-4">
      <label for="delete-pin" class="block text-sm font-medium text-braun-700 mb-1">Enter PIN to confirm</label>
      <input
        id="delete-pin"
        type="password"
        inputmode="numeric"
        pattern="[0-9]*"
        maxlength="6"
        bind:value={deletePin}
        placeholder="PIN"
        onkeydown={(e) => e.key === 'Enter' && verifyDeletePin()}
        class="w-24 px-3 py-2 text-center border border-braun-300 rounded focus:outline-none focus:border-braun-600"
      />
      {#if deletePinError}
        <p class="text-sm text-error mt-1">{deletePinError}</p>
      {/if}
    </div>
    <div class="flex justify-end gap-3">
      <button
        onclick={cancelDelete}
        disabled={deleting}
        class="px-4 py-2 bg-braun-200 text-braun-700 rounded hover:bg-braun-300 transition"
      >
        Cancel
      </button>
      <button
        onclick={verifyDeletePin}
        disabled={deleting || !deletePin}
        class="px-4 py-2 bg-error text-white rounded hover:opacity-90 transition disabled:opacity-50"
      >
        {deleting ? 'Deleting...' : 'Delete'}
      </button>
    </div>
  </div>
</div>
{/if}
