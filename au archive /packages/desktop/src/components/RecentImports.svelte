<script lang="ts">
  interface ImportRecord {
    import_id: string;
    locid: string | null;
    import_date: string;
    auth_imp: string | null;
    img_count: number;
    vid_count: number;
    doc_count: number;
    locnam?: string;
    address_state?: string;
  }

  interface Props {
    imports: ImportRecord[];
  }

  let { imports }: Props = $props();

  function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
</script>

<div class="mt-8">
  <h2 class="text-lg font-semibold mb-3 text-foreground">Recent Imports</h2>
  {#if imports.length > 0}
    <div class="bg-white rounded border border-braun-300">
      <ul class="divide-y divide-braun-200">
        {#each imports as importRecord}
          <li class="p-4 hover:bg-braun-50">
            <div class="flex justify-between items-start">
              <div>
                {#if importRecord.locnam}
                  <p class="font-medium text-foreground">{importRecord.locnam}</p>
                {:else}
                  <p class="font-medium text-braun-500">Import #{importRecord.import_id.slice(0, 8)}</p>
                {/if}
                <p class="text-sm text-braun-500 mt-1">
                  {formatDate(importRecord.import_date)}
                  {#if importRecord.auth_imp}
                    · by {importRecord.auth_imp}
                  {/if}
                </p>
              </div>
              <div class="text-sm text-braun-600">
                {#if importRecord.img_count > 0}
                  <span class="block">{importRecord.img_count} images</span>
                {/if}
                {#if importRecord.vid_count > 0}
                  <span class="block">{importRecord.vid_count} videos</span>
                {/if}
                {#if importRecord.doc_count > 0}
                  <span class="block">{importRecord.doc_count} documents</span>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <div class="bg-white rounded border border-braun-300 p-6 text-center text-braun-400">
      <p>No recent imports</p>
    </div>
  {/if}
</div>
