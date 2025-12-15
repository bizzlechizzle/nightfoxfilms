import type { CollectionEntry } from "astro:content";
import { slugifyStr } from "./slugify";

export interface StateSummary {
  label: string;
  slug: string;
  count: number;
}

const getUniqueStates = (posts: CollectionEntry<"blog">[]): StateSummary[] => {
  const map = new Map<string, StateSummary>();

  for (const { data } of posts) {
    if (typeof data.state !== "string") continue;
    const cleaned = data.state.trim();
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    const existing = map.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    const label = cleaned;
    map.set(key, {
      label,
      slug: slugifyStr(label),
      count: 1,
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    b.count - a.count || a.label.localeCompare(b.label)
  );
};

export default getUniqueStates;
