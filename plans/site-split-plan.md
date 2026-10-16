# Plan: split the site into learn, blog and home

Today one Astro site serves `withchris.uk/learn` and `withchris.uk/blog`. Split it into three small sites, each in its own folder and on its own subdomain.

**Status:** planned, not started.

## Target

| Folder | URL | What | Worker |
| --- | --- | --- | --- |
| `learn/` | learn.withchris.uk | Tutoring page (today's `/learn`) | `withchris-learn` |
| `blog/` | blog.withchris.uk | Blog index, posts, RSS (today's `/blog`, `/rss.xml`) | `withchris-blog` |
| `home/` | withchris.uk | Simple landing page: name, one line, two links (Tuition, Blog) | `withchris-home` |
| `shared/` | — | Header, Footer, Base layout, `global.css`, `site.ts`, favicon | — |

All three are static Astro builds served as Workers static assets, like today.

**Old links keep working:** `home` redirects `withchris.uk/learn` → `learn.withchris.uk`, `/blog/*` → `blog.withchris.uk/*`, `/rss.xml` → `blog.withchris.uk/rss.xml` (301s).

## How the folders work

YAGNI: no npm workspaces. One `package.json` and `node_modules` at the root, as now. Each folder is an Astro project with its own `astro.config.mjs` and `wrangler.jsonc`, built with `astro build --root <folder>`. Pages import shared parts with relative paths (`../../shared/...`).

```
learn/  astro.config.mjs  wrangler.jsonc  src/pages/index.astro  src/assets/me.png
blog/   astro.config.mjs  wrangler.jsonc  src/pages/index.astro  src/pages/[...slug].astro
        src/pages/rss.xml.ts  src/content/  src/content.config.ts  src/components/ (CTDemo, PostCover)
        src/lib/posts.ts  src/scripts/ct-demo.js
home/   astro.config.mjs  wrangler.jsonc  src/pages/index.astro  src/pages/404.astro
shared/ Base.astro  Header.astro  Footer.astro  CursorGlow.astro  global.css  site.ts  favicon.svg
```

`site.ts` gains one URL per site (`home`, `learn`, `blog`). Header links become full URLs: Tuition → learn, Blog → blog, the name → home. Sitemaps and RSS use each site's own URL.

Root `package.json` scripts: `dev:learn`, `dev:blog`, `dev:home`, `build` (all three), `check`.

## Deploys

- Move the site from **Workers Builds** to **GitHub Actions**, like `admin/`: one workflow, one job per folder, triggered by changes to that folder or `shared/`.
- **Chris, one dashboard step:** disconnect Workers Builds from the old `chrismiller` Worker, or its next build fails on the new layout. Delete that Worker once `home` is live.
- Until the domain is active in the new account, each site is reachable on its workers.dev URL. Custom domains (`learn.`, `blog.`, apex) are set in each `wrangler.jsonc` and start working when the domain moves.

## Steps (one PR)

1. Create `shared/`, move the shared files, fix imports.
2. Create `learn/` and `blog/` from today's pages; check both build and look the same.
3. Create `home/`: landing page plus the redirects.
4. Replace the root `astro.config.mjs` and `wrangler.jsonc`; add the workflow.
5. Update `README.md` (layout, commands, deploys).

## Risks

- **Imports outside the project root:** Vite allows them when the repo root has the `package.json`; check `npm run dev:*` works, not just builds.
- **Email:** unaffected. `learn@withchris.uk` routing is per-domain, not per-site.
- **Cross-site links in posts:** any post linking to `/learn` must become a full URL. Grep for them.
