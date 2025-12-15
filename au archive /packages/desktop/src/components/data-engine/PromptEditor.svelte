<script lang="ts">
  import {
    type CategoryKey,
    type CategoryPrompt,
    DEFAULT_PROMPTS,
    getPromptKey,
    parseStoredPrompt,
  } from './default-prompts';

  interface Props {
    category: CategoryKey;
  }

  let { category }: Props = $props();

  let promptData = $state<CategoryPrompt>({
    systemPrompt: DEFAULT_PROMPTS[category],
    enabled: true,
    lastModified: new Date().toISOString(),
    modifiedBy: 'system',
  });

  let saving = $state(false);
  let saveMessage = $state('');
  let isModified = $state(false);
  let originalPrompt = $state('');

  $effect(() => {
    loadPrompt();
  });

  async function loadPrompt() {
    try {
      const key = getPromptKey(category);
      const value = await window.electronAPI.settings.get(key);
      promptData = parseStoredPrompt(value, category);
      originalPrompt = promptData.systemPrompt;
      isModified = false;
    } catch (err) {
      console.error('Failed to load prompt:', err);
      promptData = parseStoredPrompt(null, category);
      originalPrompt = promptData.systemPrompt;
    }
  }

  function handleInput() {
    isModified = promptData.systemPrompt !== originalPrompt;
  }

  async function savePrompt() {
    saving = true;
    saveMessage = '';

    try {
      const key = getPromptKey(category);
      const currentUser = await window.electronAPI.settings.get('current_user');

      const data: CategoryPrompt = {
        systemPrompt: promptData.systemPrompt,
        enabled: promptData.enabled,
        lastModified: new Date().toISOString(),
        modifiedBy: currentUser || 'default',
      };

      await window.electronAPI.settings.set(key, JSON.stringify(data));
      originalPrompt = promptData.systemPrompt;
      isModified = false;
      saveMessage = 'Saved';
      setTimeout(() => (saveMessage = ''), 2000);
    } catch (err) {
      console.error('Failed to save prompt:', err);
      saveMessage = 'Failed to save';
      setTimeout(() => (saveMessage = ''), 3000);
    } finally {
      saving = false;
    }
  }

  function resetToDefault() {
    promptData.systemPrompt = DEFAULT_PROMPTS[category];
    isModified = promptData.systemPrompt !== originalPrompt;
  }
</script>

<div class="space-y-4">
  <label class="block">
    <span class="text-xs font-semibold text-braun-400 uppercase tracking-wider">
      System Prompt
    </span>
    <textarea
      bind:value={promptData.systemPrompt}
      oninput={handleInput}
      rows="10"
      class="mt-2 w-full px-3 py-2 border border-braun-300 rounded text-sm font-mono leading-relaxed focus:outline-none focus:border-braun-600 resize-y"
      placeholder="Enter custom system prompt for {category} extraction..."
    ></textarea>
  </label>

  <div class="flex items-center gap-4">
    <label class="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        bind:checked={promptData.enabled}
        class="w-4 h-4 rounded border-braun-300 text-braun-900 focus:ring-braun-600"
      />
      <span class="text-sm text-braun-700">Enable auto-tagging for this category</span>
    </label>
  </div>

  <div class="flex justify-between items-center pt-2">
    <button
      onclick={resetToDefault}
      class="text-xs text-braun-600 hover:text-braun-900 hover:underline transition-colors"
    >
      Reset to Default
    </button>

    <div class="flex items-center gap-3">
      {#if saveMessage}
        <span class="text-xs text-braun-600">{saveMessage}</span>
      {/if}

      <button
        onclick={savePrompt}
        disabled={saving || !isModified}
        class="px-4 py-2 text-sm bg-braun-900 text-white rounded hover:bg-braun-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : 'Save Prompt'}
      </button>
    </div>
  </div>

  {#if promptData.lastModified && promptData.modifiedBy !== 'system'}
    <p class="text-xs text-braun-400 mt-2">
      Last modified by {promptData.modifiedBy} on {new Date(promptData.lastModified).toLocaleDateString()}
    </p>
  {/if}
</div>
