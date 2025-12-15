<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from '../stores/router';

  interface Bookmark {
    bookmark_id: string;
    url: string;
    title: string | null;
    locid: string | null;
    bookmark_date: string;
    auth_imp: string | null;
    locnam?: string;
  }

  let bookmarks = $state<Bookmark[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showAddForm = $state(false);
  let newUrl = $state('');
  let newTitle = $state('');
  let adding = $state(false);
  let currentUser = $state('default');

  async function loadBookmarks() {
    try {
      loading = true;
      error = null;
      const result = (await window.electronAPI.bookmarks.findAll()) as Bookmark[];
      bookmarks = result;
    } catch (err) {
      console.error('Error loading bookmarks:', err);
      error = 'Failed to load bookmarks';
    } finally {
      loading = false;
    }
  }

  async function handleAddBookmark() {
    if (!newUrl.trim()) return;

    try {
      adding = true;
      error = null;

      await window.electronAPI.bookmarks.create({
        url: newUrl.trim(),
        title: newTitle.trim() || null,
        locid: null,
        auth_imp: currentUser,
      });

      newUrl = '';
      newTitle = '';
      showAddForm = false;
      await loadBookmarks();
    } catch (err) {
      console.error('Error creating bookmark:', err);
      error = 'Failed to create bookmark. Please check the URL format.';
    } finally {
      adding = false;
    }
  }

  async function handleDeleteBookmark(bookmark_id: string) {
    if (!confirm('Are you sure you want to delete this bookmark?')) return;

    try {
      error = null;
      await window.electronAPI.bookmarks.delete(bookmark_id);
      await loadBookmarks();
    } catch (err) {
      console.error('Error deleting bookmark:', err);
      error = 'Failed to delete bookmark';
    }
  }

  async function openBookmark(url: string) {
    try {
      await window.electronAPI.shell.openExternal(url);
    } catch (err) {
      console.error('Error opening bookmark:', err);
      error = 'Failed to open bookmark';
    }
  }

  function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  onMount(async () => {
    await loadBookmarks();

    // Load current user
    try {
      const settings = await window.electronAPI.settings.getAll();
      currentUser = settings.current_user || 'default';
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  });
</script>

<div class="p-8">
  <div class="mb-8 flex justify-between items-center">
    <div>
      <h1 class="text-3xl font-bold text-foreground mb-2">Bookmarks</h1>
      <p class="text-braun-600">Saved web pages and resources</p>
    </div>
    {#if !showAddForm}
      <button
        onclick={() => (showAddForm = true)}
        class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition"
      >
        Add Bookmark
      </button>
    {/if}
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-100 text-red-700 rounded">
      {error}
    </div>
  {/if}

  {#if showAddForm}
    <div class="mb-6 p-6 bg-white rounded border border-braun-300">
      <h2 class="text-lg font-semibold mb-4">Add New Bookmark</h2>
      <div class="space-y-4">
        <div>
          <label for="url" class="block text-sm font-medium text-braun-700 mb-1">
            URL <span class="text-red-500">*</span>
          </label>
          <input
            id="url"
            type="url"
            bind:value={newUrl}
            placeholder="https://example.com"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>
        <div>
          <label for="title" class="block text-sm font-medium text-braun-700 mb-1">
            Title
          </label>
          <input
            id="title"
            type="text"
            bind:value={newTitle}
            placeholder="Optional title for the bookmark"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>
        <div class="flex justify-end gap-2">
          <button
            onclick={() => {
              showAddForm = false;
              newUrl = '';
              newTitle = '';
            }}
            disabled={adding}
            class="px-4 py-2 bg-braun-200 text-foreground rounded hover:bg-braun-300 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onclick={handleAddBookmark}
            disabled={adding || !newUrl.trim()}
            class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
          >
            {adding ? 'Adding...' : 'Add Bookmark'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if loading}
    <p class="text-braun-500">Loading bookmarks...</p>
  {:else if bookmarks.length === 0}
    <div class="bg-white rounded border border-braun-300 p-12 text-center">
      <p class="text-braun-400 mb-4">No bookmarks yet</p>
      <button
        onclick={() => (showAddForm = true)}
        class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition"
      >
        Create Your First Bookmark
      </button>
    </div>
  {:else}
    <div class="bg-white rounded border border-braun-300">
      <div class="divide-y divide-braun-200">
        {#each bookmarks as bookmark}
          <div class="p-4 hover:bg-braun-50 transition">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <button
                  onclick={() => openBookmark(bookmark.url)}
                  class="text-left group"
                >
                  <h3 class="font-medium text-braun-900 group-hover:text-braun-600 transition">
                    {bookmark.title || bookmark.url}
                  </h3>
                  {#if bookmark.title}
                    <p class="text-sm text-braun-500 mt-1">{bookmark.url}</p>
                  {/if}
                </button>
                <div class="text-xs text-braun-400 mt-2">
                  <span>{formatDate(bookmark.bookmark_date)}</span>
                  {#if bookmark.locnam}
                    <span class="ml-3">→ {bookmark.locnam}</span>
                  {/if}
                </div>
              </div>
              <button
                onclick={() => handleDeleteBookmark(bookmark.bookmark_id)}
                class="ml-4 text-red-600 hover:text-red-800 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
