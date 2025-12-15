<!--
  ToastContainer.svelte
  FIX 4.6: Toast notification display component
  Shows stacked toast notifications in bottom-right corner
-->
<script lang="ts">
  import { toasts, type Toast } from '../stores/toast-store';
  import { fly, fade } from 'svelte/transition';

  const typeClasses: Record<Toast['type'], string> = {
    success: 'bg-success',
    error: 'bg-error',
    warning: 'bg-warning text-braun-900',
    info: 'bg-braun-600',
  };

</script>

<div class="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
  {#each $toasts as toast (toast.id)}
    <div
      class="{typeClasses[toast.type]} text-white px-4 py-3 rounded flex items-center gap-3"
      in:fly={{ x: 100, duration: 200 }}
      out:fade={{ duration: 150 }}
      role="alert"
    >
      <span class="flex-1">{toast.message}</span>
      <button
        onclick={() => toasts.dismiss(toast.id)}
        class="text-white/80 hover:text-white text-xl leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  {/each}
</div>
