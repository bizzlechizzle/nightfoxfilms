<script lang="ts">
  /**
   * LocationDocuments - Document list
   * Sub-accordion within Original Assets
   * Per DECISION-020: Opens in system viewer (best tool for job)
   */
  import type { MediaDocument } from './types';

  interface Props {
    documents: MediaDocument[];
    onOpenFile: (path: string) => void;
  }

  let { documents, onOpenFile }: Props = $props();

  const DOCUMENT_LIMIT = 5;
  let isOpen = $state(true); // Expanded by default
  let showAllDocuments = $state(false);

  const displayedDocuments = $derived(showAllDocuments ? documents : documents.slice(0, DOCUMENT_LIMIT));

  // Get file extension for icon display
  function getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toUpperCase() || 'DOC';
  }
</script>

{#if documents.length > 0}
  <div class="border-b border-braun-200 last:border-b-0">
    <!-- Sub-accordion header -->
    <button
      onclick={() => isOpen = !isOpen}
      aria-expanded={isOpen}
      class="w-full py-3 flex items-center justify-between text-left hover:bg-braun-100 transition-colors"
    >
      <h3 class="text-sm font-medium text-braun-900">Documents ({documents.length})</h3>
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
      <div class="pb-4 space-y-2">
        {#each displayedDocuments as doc}
          <button
            onclick={() => onOpenFile(doc.docloc)}
            class="w-full flex items-center gap-3 p-3 bg-braun-50 rounded hover:bg-braun-100 transition text-left"
          >
            <!-- File type badge -->
            <div class="w-10 h-10 bg-braun-200 rounded flex items-center justify-center text-xs font-medium text-braun-600">
              {getFileExtension(doc.docnam)}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-braun-900 truncate" title={doc.docnamo || doc.docnam}>{doc.docnamo || doc.docnam}</p>
              <p class="text-xs text-braun-400 font-mono truncate" title={doc.docnam}>{doc.docnam}</p>
            </div>
            <!-- External link icon -->
            <svg class="w-4 h-4 text-braun-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        {/each}

        <!-- Show more -->
        {#if documents.length > DOCUMENT_LIMIT}
          <div class="mt-3 text-center">
            <button
              onclick={() => showAllDocuments = !showAllDocuments}
              class="text-sm text-braun-900 hover:underline"
            >
              {showAllDocuments ? 'Show Less' : `Show All (${documents.length - DOCUMENT_LIMIT} more)`}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
