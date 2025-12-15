<script lang="ts">
  interface Props {
    value: string;
    onchange: (value: string) => void;
    suggestions: string[];
    placeholder?: string;
    id?: string;
    required?: boolean;
    maxlength?: number;
    class?: string;
  }

  let {
    value = $bindable(''),
    onchange,
    suggestions = [],
    placeholder = '',
    id = '',
    required = false,
    maxlength,
    class: className = '',
  }: Props = $props();

  let showSuggestions = $state(false);
  let highlightedIndex = $state(-1);
  let inputElement: HTMLInputElement | null = $state(null);

  // Filter suggestions based on current input
  let filteredSuggestions = $derived.by(() => {
    if (!value) return [];
    const lower = value.toLowerCase();
    return suggestions
      .filter(s => s.toLowerCase().includes(lower))
      .slice(0, 5); // Show max 5 suggestions
  });

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    value = target.value;
    onchange(value);
    showSuggestions = true;
    highlightedIndex = -1;
  }

  function handleFocus() {
    showSuggestions = filteredSuggestions.length > 0;
  }

  function handleBlur() {
    // Delay to allow click on suggestion
    setTimeout(() => {
      showSuggestions = false;
    }, 200);
  }

  function selectSuggestion(suggestion: string) {
    value = suggestion;
    onchange(suggestion);
    showSuggestions = false;
    highlightedIndex = -1;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!showSuggestions || filteredSuggestions.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        highlightedIndex = Math.min(highlightedIndex + 1, filteredSuggestions.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        highlightedIndex = Math.max(highlightedIndex - 1, -1);
        break;
      case 'Enter':
        event.preventDefault();
        if (highlightedIndex >= 0) {
          selectSuggestion(filteredSuggestions[highlightedIndex]);
        }
        break;
      case 'Escape':
        showSuggestions = false;
        highlightedIndex = -1;
        break;
    }
  }
</script>

<div class="relative">
  <input
    bind:this={inputElement}
    {id}
    type="text"
    {value}
    {placeholder}
    {required}
    {maxlength}
    class={className}
    oninput={handleInput}
    onfocus={handleFocus}
    onblur={handleBlur}
    onkeydown={handleKeydown}
    autocomplete="off"
  />

  {#if showSuggestions && filteredSuggestions.length > 0}
    <div class="absolute z-10 w-full mt-1 bg-white border border-braun-300 rounded max-h-48 overflow-y-auto">
      {#each filteredSuggestions as suggestion, index}
        <button
          type="button"
          onclick={() => selectSuggestion(suggestion)}
          class="w-full px-3 py-2 text-left text-sm hover:bg-braun-900 hover:text-white transition cursor-pointer {index === highlightedIndex ? 'bg-braun-900 text-white' : 'text-braun-900'}"
        >
          {suggestion}
        </button>
      {/each}
    </div>
  {/if}
</div>
