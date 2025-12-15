import type { CollectionEntry } from "astro:content";
import getSortedPosts from "./getSortedPosts";
import { slugifyStr } from "./slugify";

const getPostsByCategory = (
  posts: CollectionEntry<"blog">[],
  categorySlug: string
) =>
  getSortedPosts(
    posts.filter(post => {
      const dataRecord = post.data as Record<string, unknown>;
      const rawValue =
        typeof dataRecord.category === "string"
          ? (dataRecord.category as string)
          : typeof dataRecord.catagory === "string"
            ? (dataRecord.catagory as string)
            : "";

      if (!rawValue) return false;

      return rawValue
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .some(part => slugifyStr(part) === categorySlug);
    })
  );

export default getPostsByCategory;
