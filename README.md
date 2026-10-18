# withchris.uk

Chris Miller's maths tutoring business, in one repo: three public sites, a private admin, and Cathy, an AI agent that works on the repo.

| Folder | What | Runs at |
| --- | --- | --- |
| `learn/` | Tutoring page | `withchris-learn.withchris.workers.dev` (later `learn.withchris.uk`) |
| `blog/` | Blog | `withchris-blog.withchris.workers.dev` (later `blog.withchris.uk`) |
| `home/` | Landing page; redirects old `/learn` and `/blog` links | `withchris-home.withchris.workers.dev` (later `withchris.uk`) |
| `admin/` | Private home screen: Cathy chats, artifacts, link to this repo, evidence packs | `withchris-admin.withchris.workers.dev` |
| `cathy/` | Cathy's code, plus her soul, memory and skills | private Worker `withchris-cathy`, reached through admin and share |
| `share/` | Public, read-only links to artifacts Chris shares | `withchris-share.withchris.workers.dev` (later `artifacts.withchris.uk`) |
| `shared/` | Header, footer, layout, theme and `site.ts` (name, email, addresses), used by every site and admin | — |
| `packs/` | Evidence packs: proof that a change works. Served by admin at `/packs/` | — |
| `d1/` | SQL for Cathy's registry: chats, attachments, artifacts | — |
| `.agents/`, `AGENTS.md`, `CLAUDE.md` | Tooling and instructions for coding agents | — |

The public sites are static [Astro](https://astro.build) sites with no database or server code. Posts are Markdown/MDX in this repo. Everything is hosted on Cloudflare (Workers, D1, R2, Email Routing, DNS).

## Running it locally

Needs Node 22+ (`nvm use` reads `.nvmrc`). One `npm install` at the root covers everything.

| Command | What it does |
| --- | --- |
| `npm run dev:learn` (or `dev:blog`, `dev:home`) | Dev server. Blog drafts show with a "Draft" badge. Stop with `npx astro dev stop` inside the folder. |
| `npm run build` | Builds all three sites into `<site>/dist/`. Drafts are left out. `build:<site>` builds one. |
| `npm run check` | Type-checks the sites and validates every post's frontmatter. |
| `npm test` | Unit tests for `admin/`, `cathy/` and `share/`. |
| `npm run typecheck:workers` | Type-checks the admin, share and Cathy Workers. |
| `npm run dev:cathy` | Admin, Cathy and share together with `wrangler dev`, with a scripted stand-in for Claude. Admin is on `:8787`. Share links point at `:8788`, so for those also run `npx wrangler dev -c share/wrangler.jsonc --port 8788`. |
| `npm run e2e` | Browser test of admin → Cathy (Playwright). See the header of `cathy/e2e/chat.e2e.ts`. |
| `node cathy/e2e/agents.e2e.ts` | Browser test of sub-agents, against `npm run dev:cathy`. See its header. |

## Where things are

- **Change the name, email or addresses:** `shared/site.ts`. Colours and fonts: `shared/theme.css`.
- **Learn page:** `learn/src/pages/index.astro`. The About photo is `learn/src/assets/me.{jpg,png,webp}`, picked up automatically (about 4:5 portrait).
- **Blog:** posts in `blog/src/content/blog/`; the required fields are in `blog/src/content.config.ts`.
- **Admin home cards:** `admin/src/home.ts`. Cathy's screens: `admin/src/cathy.ts`. Artifacts: `admin/src/artifacts.ts` and `admin/src/artifact-ui.ts`. Login: `admin/src/auth.ts`.
- **Cathy:** `cathy/agent/` is the Mastra agent (no Cloudflare code), `cathy/worker/` the Worker (one Durable Object per chat), `cathy/sandbox/` the Linux box each chat gets. Her identity is in `cathy/self/` (`SOUL.md`, `memory/`, `skills/`). She loads it every turn and can edit it through a PR.
- **Cathy's models:** `MODEL` (default) and `MODELS` (the picker's list) in `cathy/worker/wrangler.jsonc`. `gpt-*` ids go to OpenAI on the API key, `chatgpt/*` ids to OpenAI on Chris's ChatGPT plan, the rest to Anthropic (`providerFor` in `models.ts`, models built in `provider.ts`). Effort levels, per-provider thinking settings and the 1-hour Claude prompt cache are in `cathy/worker/src/models.ts`. Each reply in admin shows its tokens and how much came from the cache (hover for exact numbers).
- **ChatGPT plan:** connect it at admin → ChatGPT plan (`admin/src/chatgpt-ui.ts`). The sign-in lives only in the `ChatGPT` Durable Object (`cathy/worker/src/chatgpt-account.ts`, logic in `chatgpt-vault.ts` and `chatgpt-oauth.ts`); requests go through `chatgpt-fetch.ts`, which only ever sends it to chatgpt.com. Uses the same sign-in as OpenAI's Codex CLI, which isn't an official option for other apps, so it can break without notice.
- **Sub-agents:** Cathy starts other Cathys with `spawn_agent` (tools and limits in `cathy/worker/src/conversation.ts`, logic in `cathy/worker/src/agents.ts`, how-to in `cathy/self/skills/sub-agents/`). Each is a normal chat with a `parent_id` (`d1/migrations/0003_subagents.sql`); admin nests them under their parent. Limits: `MAX_WORKING` (5 at once) in `agents.ts`; `MAX_AGENT_MESSAGES` and `MAX_HOPS` in `conversation.ts`.
- **Artifacts and attachments:** bytes in R2 (`withchris-files`), facts in D1 (`d1/migrations/0002_names_artifacts.sql`). Cathy publishes with the `publish_artifact` tool (`cathy/worker/src/box-files.ts`). Each artifact is private (admin only) or link (anyone with the link, served by `share/`).
- **Evidence packs:** one folder per pack in `packs/`, listed in `packs/index.html`.

## Writing a blog post

Add `blog/src/content/blog/my-post.mdx` (or `my-post/index.mdx` with images beside it). The filename becomes the URL: `/my-post/`.

```mdx
---
title: The pigeonhole principle at GCSE
date: 2026-10-20
description: One sentence for the listing and link previews.
draft: true          # optional: shown in dev, hidden on the live site
motif: waves         # optional generated cover: waves, sines, rings, dots, rays, grid
cover: ./pigeons.jpg # optional own cover image, relative to this file
coverAlt: Pigeons on a roof
---
```

Posts support Markdown, maths (`$inline$` and `$$display$$` LaTeX, rendered by KaTeX at build time), highlighted code blocks, and images (Astro resizes them). For interactive pieces use `.mdx` and import a component; `backprojection-by-hand.mdx` does this with `blog/src/components/CTDemo.astro` and `blog/src/scripts/ct-demo.js`. For video, put the file in `blog/public/` and use `<video src="/clip.mp4" controls>`. That sample post is still `draft: true`.

## Deploying

Pushing to `main` deploys. Each workflow reports a commit status with the result. Needs the `CLOUDFLARE_API_TOKEN` repo secret.

| Workflow | Deploys | Runs when |
| --- | --- | --- |
| `deploy-sites.yml` | `learn`, `blog`, `home` | their folders, `shared/` or dependencies change |
| `deploy-admin.yml` | Cathy first, then share, then admin (after `npm test`) | `admin/`, `cathy/`, `share/`, `shared/`, `d1/` or `packs/` change |
| `preview.yml` | A throwaway admin + Cathy + share clone per branch, with its own D1 and R2, tested in a browser against real Claude; torn down when the PR closes | a branch touches those folders |

Other secrets the workflows use: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (for the GPT models), `CATHY_GITHUB_TOKEN`, `ADMIN_PASSWORD`.

Nothing runs `npm run check` or builds the sites on a PR, so check those locally before merging site changes.

### Admin login

Production admin is behind Cloudflare Access: only `learn@withchris.uk` gets in, with an emailed one-time code. The Worker also verifies Access's token itself (`admin/src/auth.ts`). The team domain and AUD tag are `vars` in `admin/wrangler.jsonc`.

- Set both `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, or neither. One alone makes admin refuse everyone.
- To fall back to the password login, empty both and push.
- Previews and local dev always use the password (`ADMIN_PASSWORD`).
- Because Access answers first, the deploy's "Check admin answers" status shows 302 or 403 rather than 200. That's expected.

### Putting the sites on withchris.uk

1. In `shared/site.ts`, set `DOMAIN_LIVE = true`.
2. In each site's `wrangler.jsonc`, add its route, e.g. `"routes": [{ "pattern": "learn.withchris.uk", "custom_domain": true }]` (`blog.withchris.uk`, `withchris.uk` for the others).
3. Push. `home/public/_redirects` then sends old `withchris.uk/learn` and `/blog/...` links to the new sites.

### Email (`learn@withchris.uk`)

Receiving: Cloudflare → `withchris.uk` → Email → Email Routing. Enable it, add and verify Chris's Gmail as a destination, then create `learn@withchris.uk` forwarding to it.

Sending as `learn@`: in Gmail, Settings → Accounts and Import → Send mail as. Add `learn@withchris.uk` (untick "Treat as an alias") using `smtp.gmail.com`, port 587, TLS, the Gmail address and a Google app password. Enter the confirmation code that arrives through the forwarding rule. Then make the SPF `TXT` record on `withchris.uk`:

```
v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all
```

## Agents and secrets

Read `AGENTS.md` first. `.agents/AGENTS.md` covers worktrees, `.agents/.env` and Cloudflare API access. Never commit secrets. Anything that changes the Cloudflare account needs Chris's go-ahead.

## Why Cloudflare, and no database for the sites

Vercel's free plan excludes commercial sites, and a tutoring business is one. Cloudflare's free tier has no such rule, and keeping domain, email and hosting in one account is simpler. The public sites have no users, logins or forms, so they have no database. Cathy's registry is the only D1 database, and her files (attachments, artifacts) are the only R2 bucket. Revisit if you want comments, stored enquiries or student data.
