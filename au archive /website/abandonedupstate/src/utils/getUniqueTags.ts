import type { CollectionEntry } from "astro:content";
import { slugifyStr } from "./slugify";
import postFilter from "./postFilter";

interface TagSummary {
  tag: string;
  tagName: string;
  count: number;
}

const getUniqueTags = (posts: CollectionEntry<"blog">[]): TagSummary[] => {
  const map = new Map<string, TagSummary>();

  posts
    .filter(postFilter)
    .forEach(post => {
      if (!Array.isArray(post.data.tags)) return;
      post.data.tags.forEach(tagLabel => {
        const slug = slugifyStr(tagLabel);
        const existing = map.get(slug);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(slug, {
            tag: slug,
            tagName: tagLabel,
            count: 1,
          });
        }
      });
    });

  return Array.from(map.values()).sort(
    (a, b) => b.count - a.count || a.tagName.localeCompare(b.tagName)
  );
};

export default getUniqueTags;
