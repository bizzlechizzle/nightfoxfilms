import type { CollectionEntry } from "astro:content";
import { slugifyStr } from "./slugify";
import postFilter from "./postFilter";

interface AuthorEntry {
  author: string;
  authorName: string;
  count: number;
}

const getUniqueAuthors = (posts: CollectionEntry<"blog">[]) => {
  const map = new Map<string, AuthorEntry>();

  posts.filter(postFilter).forEach(post => {
    const name = post.data.author;
    const slug = slugifyStr(name);

    const existing = map.get(slug);

    if (existing) {
      existing.count += 1;
    } else {
      map.set(slug, {
        author: slug,
        authorName: name,
        count: 1,
      });
    }
  });

  return Array.from(map.values()).sort((a, b) =>
    a.author.localeCompare(b.author)
  );
};

export default getUniqueAuthors;
