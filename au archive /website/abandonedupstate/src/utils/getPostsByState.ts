import type { CollectionEntry } from "astro:content";
import getSortedPosts from "./getSortedPosts";
import { slugifyStr } from "./slugify";

const getPostsByState = (posts: CollectionEntry<"blog">[], stateSlug: string) =>
  getSortedPosts(
    posts.filter(post => {
      if (typeof post.data.state !== "string") return false;
      return post.data.state
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .some(part => slugifyStr(part) === stateSlug);
    })
  );

export default getPostsByState;
