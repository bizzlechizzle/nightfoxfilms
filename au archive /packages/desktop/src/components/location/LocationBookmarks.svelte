<script lang="ts">
  /**
   * LocationBookmarks - Bookmark list and add form
   * Per LILBITS: ~180 lines, single responsibility
   */
  import type { Bookmark } from './types';

  interface Props {
    bookmarks: Bookmark[];
    onAddBookmark: (data: { url: string; title: string; description: string; type: string }) => Promise<void>;
    onDeleteBookmark: (urlid: string) => void;
    onOpenBookmark: (url: string) => void;
  }

  let { bookmarks, onAddBookmark, onDeleteBookmark, onOpenBookmark }: Props = $props();

  let showAddBookmark = $state(false);
  let newBookmarkUrl = $state('');
  let newBookmarkTitle = $state('');
  let newBookmarkDescription = $state('');
  let newBookmarkType = $state('');
  let addingBookmark = $state(false);

  async function handleAddBookmark() {
    if (!newBookmarkUrl.trim()) return;
    addingBookmark = true;
    try {
      await onAddBookmark({
        url: newBookmarkUrl.trim(),
        title: newBookmarkTitle.trim(),
        description: newBookmarkDescription.trim(),
        type: newBookmarkType.trim()
      });
      newBookmarkUrl = '';
      newBookmarkTitle = '';
      newBookmarkDescription = '';
      newBookmarkType = '';
      showAddBookmark = false;
    } finally {
      addingBookmark = false;
    }
  }
</script>

<div class="mt-6 bg-white rounded border border-braun-300 p-6">
  <div class="flex items-center justify-between mb-3">
    <div class="flex items-center gap-2">
      <svg class="w-5 h-5 text-braun-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
      <h2 class="text-xl font-semibold text-braun-900">Bookmarks ({bookmarks.length})</h2>
    </div>
    <button
      onclick={() => showAddBookmark = !showAddBookmark}
      class="text-sm text-braun-900 hover:underline"
    >
      {showAddBookmark ? 'Cancel' : '+ Add Bookmark'}
    </button>
  </div>

  {#if showAddBookmark}
    <div class="mb-3 p-4 bg-braun-50 rounded">
      <div class="space-y-3">
        <div>
          <label for="bookmark-url" class="block form-label mb-1">URL *</label>
          <input
            id="bookmark-url"
            type="url"
            bind:value={newBookmarkUrl}
            placeholder="https://..."
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="bookmark-title" class="block form-label mb-1">Title</label>
            <input
              id="bookmark-title"
              type="text"
              bind:value={newBookmarkTitle}
              placeholder="Link title"
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            />
          </div>
          <div>
            <label for="bookmark-type" class="block form-label mb-1">Type</label>
            <select
              id="bookmark-type"
              bind:value={newBookmarkType}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            >
              <option value="">Select type...</option>
              <option value="article">Article</option>
              <option value="news">News</option>
              <option value="history">History</option>
              <option value="photo">Photo Gallery</option>
              <option value="video">Video</option>
              <option value="map">Map</option>
              <option value="forum">Forum</option>
              <option value="social">Social Media</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div>
          <label for="bookmark-desc" class="block form-label mb-1">Description</label>
          <textarea
            id="bookmark-desc"
            bind:value={newBookmarkDescription}
            placeholder="Optional description"
            rows="2"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 resize-none"
          ></textarea>
        </div>
        <button
          onclick={handleAddBookmark}
          disabled={addingBookmark || !newBookmarkUrl.trim()}
          class="w-full px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
        >
          {addingBookmark ? 'Adding...' : 'Add Bookmark'}
        </button>
      </div>
    </div>
  {/if}

  {#if bookmarks.length > 0}
    <div class="space-y-2">
      {#each bookmarks as bookmark}
        <div class="flex items-start justify-between p-3 bg-braun-50 rounded hover:bg-braun-100 transition">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <button
                onclick={() => onOpenBookmark(bookmark.url)}
                class="text-braun-900 hover:underline font-medium truncate"
              >
                {bookmark.url_title || bookmark.url}
              </button>
              {#if bookmark.url_type}
                <span class="px-2 py-0.5 bg-braun-100 text-braun-600 text-xs rounded capitalize">
                  {bookmark.url_type}
                </span>
              {/if}
            </div>
            {#if bookmark.url_title}
              <p class="text-xs text-braun-400 truncate">{bookmark.url}</p>
            {/if}
            {#if bookmark.url_description}
              <p class="text-sm text-braun-600 mt-1">{bookmark.url_description}</p>
            {/if}
          </div>
          <button
            onclick={() => onDeleteBookmark(bookmark.urlid)}
            class="ml-2 p-1 text-braun-400 hover:text-error transition"
            title="Delete bookmark"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <div class="text-center text-braun-400 py-8 border-2 border-dashed border-braun-200 rounded">
      <svg class="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
      <p class="text-sm">No bookmarks yet</p>
      <p class="text-xs mt-1">Add links to articles, photos, and resources</p>
    </div>
  {/if}
</div>
