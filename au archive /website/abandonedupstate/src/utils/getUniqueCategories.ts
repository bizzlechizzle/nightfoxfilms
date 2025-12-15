import type { CollectionEntry } from "astro:content";
import { slugifyStr } from "./slugify";

export interface CategorySummary {
  label: string;
  slug: string;
  count: number;
}

const getUniqueCategories = (posts: CollectionEntry<"blog">[]): CategorySummary[] => {
  const map = new Map<string, CategorySummary>();

  for (const { data } of posts) {
    const rawValue =
      typeof data.category === "string"
        ? data.category
        : typeof (data as Record<string, unknown>).catagory === "string"
          ? ((data as Record<string, unknown>).catagory as string)
          : "";

    if (!rawValue) continue;

    rawValue
      .split(",")
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(part => {
        const key = part.toLowerCase();
        const existing = map.get(key);
        if (existing) {
          existing.count += 1;
          return;
        }
        const label = part;
        map.set(key, {
          label,
          slug: slugifyStr(label),
          count: 1,
        });
      });
  }

  return Array.from(map.values()).sort((a, b) =>
    b.count - a.count || a.label.localeCompare(b.label)
  );
};

export default getUniqueCategories;
