# Thumbnail URL Patterns - Developer Guide

## Overview

This guide explains how to correctly display thumbnails in Svelte components using the custom `media://` protocol.

## The Correct Pattern

**Always use this pattern for thumbnail URLs:**

```svelte
<script lang="ts">
  import { thumbnailCache } from '../stores/thumbnail-cache-store';

  const cacheVersion = $derived($thumbnailCache);
</script>

<img src={`media://${thumbPath}?v=${cacheVersion}`} alt="" />
```

## Why This Pattern Works

### 1. Template Literal Syntax
Use JavaScript template literals `{``}` for dynamic URL construction:
```svelte
<!-- CORRECT -->
<img src={`media://${path}?v=${version}`} />

<!-- WRONG - don't use string interpolation -->
<img src="media://{path}" />
```

### 2. No URL Encoding Needed
The `media://` protocol handler automatically handles:
- Spaces in paths (e.g., `/Documents/au archive /...`)
- Special characters
- URL normalization

```svelte
<!-- CORRECT - no encoding -->
<img src={`media://${path}`} />

<!-- WRONG - unnecessary encoding -->
<img src="media://{encodeURI(path)}" />
```

### 3. Cache Busting Required
Always include `?v=${cacheVersion}` to ensure fresh thumbnails after regeneration:
- The `thumbnailCache` store updates when thumbnails are regenerated
- Without this, browsers may serve stale cached images

### 4. Null/Undefined Checks
Always wrap in conditional to prevent rendering broken images:
```svelte
{#if thumbPath}
  <img src={`media://${thumbPath}?v=${cacheVersion}`} />
{/if}
```

## Complete Example

```svelte
<script lang="ts">
  import { thumbnailCache } from '../stores/thumbnail-cache-store';

  interface MediaItem {
    imgsha: string;
    thumb_path_sm?: string;
    thumb_path_lg?: string;
    thumb_path?: string;
  }

  let { item }: { item: MediaItem } = $props();

  const cacheVersion = $derived($thumbnailCache);

  // Get best available thumbnail
  const thumbPath = $derived(
    item.thumb_path_sm || item.thumb_path_lg || item.thumb_path
  );
</script>

<div class="thumbnail-container">
  {#if thumbPath}
    <img
      src={`media://${thumbPath}?v=${cacheVersion}`}
      alt=""
      class="w-full h-full object-cover"
    />
  {:else}
    <div class="placeholder">No thumbnail</div>
  {/if}
</div>
```

## How the media:// Protocol Works

1. **Browser sends request**: `media:///Users/.../thumb.jpg?v=1`
2. **Electron intercepts**: Protocol handler in `main/index.ts`
3. **URL parsing**: `new URL(request.url)` extracts pathname
4. **Path decoding**: `decodeURIComponent()` handles spaces/special chars
5. **File served**: `net.fetch('file://' + filePath)` serves the file
6. **Cache headers**: No-cache headers prevent stale responses

## Common Mistakes to Avoid

| Mistake | Why It's Wrong |
|---------|----------------|
| Using `encodeURI()` | Protocol handler already handles decoding |
| Forgetting cache buster | Thumbnails may appear stale after regeneration |
| Using `file://` protocol | Blocked by Electron security policies |
| Missing null check | Renders broken image if path is undefined |
| Using string interpolation | May not handle complex paths correctly |

## Reference Files

Working examples to reference:
- `components/location/LocationHero.svelte:81` - Hero image display
- `components/location/LocationGallery.svelte:61` - Gallery thumbnails
- `components/MediaViewer.svelte:93` - Full media viewer
- `pages/Dashboard.svelte:225,286` - Dashboard thumbnails

## Troubleshooting

If thumbnails don't load:

1. **Check DevTools Network tab**: Is the media:// request returning 404?
2. **Check console for errors**: Look for `[media protocol]` logs
3. **Verify file exists**: Run `ls -la "<path>"` in terminal
4. **Check database**: Verify `thumb_path_sm` is populated
5. **Clear browser cache**: Hard refresh or increment cache version
