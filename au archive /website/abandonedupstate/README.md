# Abandoned Upstate

A custom Astro-powered archive documenting abandoned and historic locations throughout upstate New York and the surrounding region. The site features long-form writeups, photo galleries, and research notes that capture both current conditions and historical context for every location.

## Tech Stack

- [Astro](https://astro.build/) for static site generation
- [TypeScript](https://www.typescriptlang.org/) for type safety
- [Tailwind CSS](https://tailwindcss.com/) for utility-first styling
- [Pagefind](https://pagefind.app/) for fast static search
- Markdown/MDX content stored under `src/locations`

## Getting Started

Install dependencies and start the local dev server:

```bash
pnpm install
pnpm run dev
```

The site runs at `http://localhost:4321/` by default. Hot reloading is enabled for content and style changes.

### Useful Scripts

| Command             | Description                                |
| ------------------- | ------------------------------------------ |
| `pnpm run dev`      | Start the local development server         |
| `pnpm run build`    | Create a production build in `./dist`      |
| `pnpm run preview`  | Preview the production build locally       |
| `pnpm run lint`     | Run ESLint against the project             |

## Content & Media

- Location writeups live in `src/locations/*.mdx`.
- Images are organized per location inside `src/assets/images/`.
- Frontmatter supports fields like `featured`, `featuredCaption`, `tags`, and `ogImage` for tailored presentation and OG metadata.

## Project Structure

```
/
├── public/                  # Static assets copied as-is
├── src/
│   ├── assets/              # Icons, fonts, and location imagery
│   ├── components/          # Reusable Astro components
│   ├── layouts/             # Page/layout templates
│   ├── pages/               # Route definitions
│   ├── styles/              # Global and typography CSS
│   ├── utils/               # Helper utilities
│   └── locations/           # MDX content for each location
├── astro.config.ts          # Astro configuration
├── tailwind config files    # Tailwind & ESLint setup
└── README.md                # Project documentation
```

## Deployment

The project builds to static HTML and can be deployed to any static host (Cloudflare Pages, Netlify, GitHub Pages, etc.). Run `pnpm run build` and deploy the contents of the `dist/` directory.

---

Questions, feedback, or new leads? Reach out via the social links on the site and let's explore more forgotten places.
