<script lang="ts">
  interface Note {
    note_id: string;
    locid: string;
    note_text: string;
    note_date: string;
    auth_imp: string | null;
    note_type: string;
  }

  interface Props {
    locid: string;
    currentUser: string;
  }

  let { locid, currentUser }: Props = $props();

  let notes = $state<Note[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showAddForm = $state(false);
  let newNoteText = $state('');
  let editingNoteId = $state<string | null>(null);
  let editingNoteText = $state('');
  let saving = $state(false);

  async function loadNotes() {
    try {
      loading = true;
      error = null;
      const result = (await window.electronAPI.notes.findByLocation(locid)) as Note[];
      notes = result;
    } catch (err) {
      console.error('Error loading notes:', err);
      error = 'Failed to load notes';
    } finally {
      loading = false;
    }
  }

  async function handleAddNote() {
    if (!newNoteText.trim()) return;

    try {
      saving = true;
      error = null;

      await window.electronAPI.notes.create({
        locid,
        note_text: newNoteText.trim(),
        auth_imp: currentUser,
        note_type: 'general',
      });

      newNoteText = '';
      showAddForm = false;
      await loadNotes();
    } catch (err) {
      console.error('Error creating note:', err);
      error = 'Failed to create note';
    } finally {
      saving = false;
    }
  }

  async function handleUpdateNote(note_id: string) {
    if (!editingNoteText.trim()) return;

    try {
      saving = true;
      error = null;

      await window.electronAPI.notes.update(note_id, {
        note_text: editingNoteText.trim(),
      });

      editingNoteId = null;
      editingNoteText = '';
      await loadNotes();
    } catch (err) {
      console.error('Error updating note:', err);
      error = 'Failed to update note';
    } finally {
      saving = false;
    }
  }

  async function handleDeleteNote(note_id: string) {
    if (!confirm('Are you sure you want to delete this note?')) return;

    try {
      saving = true;
      error = null;

      await window.electronAPI.notes.delete(note_id);
      await loadNotes();
    } catch (err) {
      console.error('Error deleting note:', err);
      error = 'Failed to delete note';
    } finally {
      saving = false;
    }
  }

  function startEdit(note: Note) {
    editingNoteId = note.note_id;
    editingNoteText = note.note_text;
  }

  function cancelEdit() {
    editingNoteId = null;
    editingNoteText = '';
  }

  function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Load notes on mount
  $effect(() => {
    loadNotes();
  });
</script>

<div class="mt-6 bg-white rounded border border-braun-300 p-6">
  <div class="flex justify-between items-center mb-3">
    <h2 class="text-lg font-semibold text-braun-900">Notes</h2>
    {#if !showAddForm}
      <button
        onclick={() => (showAddForm = true)}
        disabled={saving}
        class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
      >
        Add Note
      </button>
    {/if}
  </div>

  {#if error}
    <div class="mb-3 p-3 bg-red-100 text-red-700 rounded text-sm">
      {error}
    </div>
  {/if}

  {#if showAddForm}
    <div class="mb-3 p-4 bg-braun-50 border border-braun-200 rounded">
      <h3 class="text-sm font-semibold text-braun-900 mb-2">New Note</h3>
      <textarea
        bind:value={newNoteText}
        placeholder="Enter your note here..."
        rows="4"
        class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 mb-3"
      ></textarea>
      <div class="flex justify-end gap-2">
        <button
          onclick={() => {
            showAddForm = false;
            newNoteText = '';
          }}
          disabled={saving}
          class="px-3 py-1 text-sm bg-braun-200 text-braun-900 rounded hover:bg-braun-300 transition disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onclick={handleAddNote}
          disabled={saving || !newNoteText.trim()}
          class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Note'}
        </button>
      </div>
    </div>
  {/if}

  {#if loading}
    <p class="text-braun-500 text-sm">Loading notes...</p>
  {:else if notes.length === 0}
    <p class="text-braun-400 text-sm text-center py-8">
      No notes yet. Add your first note to get started!
    </p>
  {:else}
    <div class="space-y-3">
      {#each notes as note}
        <div class="border border-braun-200 rounded p-4">
          {#if editingNoteId === note.note_id}
            <textarea
              bind:value={editingNoteText}
              rows="4"
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 mb-3"
            ></textarea>
            <div class="flex justify-between items-center">
              <div class="text-xs text-braun-500">
                Editing note
              </div>
              <div class="flex gap-2">
                <button
                  onclick={cancelEdit}
                  disabled={saving}
                  class="px-3 py-1 text-sm bg-braun-200 text-braun-900 rounded hover:bg-braun-300 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onclick={() => handleUpdateNote(note.note_id)}
                  disabled={saving || !editingNoteText.trim()}
                  class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          {:else}
            <div class="flex justify-between items-start mb-2">
              <div class="text-sm text-braun-500">
                {formatDate(note.note_date)}
                {#if note.auth_imp}
                  · by {note.auth_imp}
                {/if}
              </div>
              <div class="flex gap-2">
                <button
                  onclick={() => startEdit(note)}
                  disabled={saving}
                  class="text-xs text-braun-600 hover:text-braun-800 disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  onclick={() => handleDeleteNote(note.note_id)}
                  disabled={saving}
                  class="text-xs text-error hover:opacity-80 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
            <p class="text-sm text-braun-800 whitespace-pre-wrap">{note.note_text}</p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
