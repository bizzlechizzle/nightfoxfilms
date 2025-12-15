import type { CollectionEntry } from "astro:content";
import getSortedPosts from "./getSortedPosts";
import { slugifyStr } from "./slugify";

const getPostsByAuthor = (posts: CollectionEntry<"blog">[], author: string) =>
  getSortedPosts(
    posts.filter(post => slugifyStr(post.data.author) === author)
  );

export default getPostsByAuthor;
