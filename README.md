# withchris.uk

Chris Miller's sites, in one repo:

| Folder | Site | What |
| --- | --- | --- |
| `learn/` | learn.withchris.uk | Maths tutoring page |
| `blog/` | blog.withchris.uk | Blog |
| `home/` | withchris.uk | Landing page; also redirects old `/learn` and `/blog` links |
| `shared/` | — | Header, footer, layout, theme (`theme.css`) and settings (`site.ts`) used by all three |
| `admin/` | (workers.dev for now) | Private admin home screen |

Until `withchris.uk` is active in the new Cloudflare account, each site runs on its workers.dev address (see `shared/site.ts`).

The three public sites are static, built with [Astro](https://astro.build). There's no database and no server code. Blog posts are Markdown/MDX files in this repo. Cloudflare hosts them and handles the domain and the `learn@` email address.

| Need | Tool | Cost |
| --- | --- | --- |
| Site generator | Astro, with MDX for posts and KaTeX for maths | Free |
| Hosting | Cloudflare Workers (static assets) | Free |
| Domain | `withchris.uk`, registered through Cloudflare or any registrar | About £5–10 a year |
| Incoming email | Cloudflare Email Routing (`learn@` forwards to Gmail) | Free |
| Outgoing email | Gmail "Send mail as" | Free |

## Running it locally

You need Node 22 or newer (`node -v` to check; `nvm use` picks up `.nvmrc`). One `npm install` at the root covers every site.

```sh
npm install
npm run dev:learn     # or dev:blog, dev:home. Runs in the background; `npx astro dev stop` (inside the folder) stops it
```

| Command | What it does |
| --- | --- |
| `npm run dev:<site>` | Local dev server for `learn`, `blog` or `home`. Draft posts are shown, with a "Draft" badge. |
| `npm run build:<site>` | Builds one site into `<site>/dist/`. Drafts are left out. |
| `npm run build` | Builds all three. |
| `npm run check` | Type-checks all three and validates every post's frontmatter. |

## Project layout

```
shared/
  site.ts                 Name, email and each site's address. Change them here.
  theme.css               Colours and fonts for every site (admin too)
  global.css              Base styles
  Base.astro              Shared <head>, header and footer
  Header.astro, Footer.astro, CursorGlow.astro, NotFound.astro
learn/
  src/pages/index.astro   Tutoring page
  src/assets/             Your photo
blog/
  src/pages/index.astro   Post listing
  src/pages/[...slug].astro  A single post (/<post-name>/)
  src/pages/rss.xml.ts    RSS feed
  src/content/blog/       Blog posts (.md or .mdx)
  src/content.config.ts   The fields every post must have
  src/components/         PostCover, CTDemo (the interactive CT demo)
  src/scripts/            Client-side code for interactive components
home/
  src/pages/index.astro   Landing page
  public/_redirects       Old withchris.uk/learn and /blog links → the new sites
<site>/public/            Files served as-is (favicon, icon, robots.txt)
<site>/astro.config.mjs   Astro settings for that site
<site>/wrangler.jsonc     Cloudflare settings for that site
admin/                    Private admin Worker
cathy/                    Cathy, the repo's AI agent: code in agent/, worker/, sandbox/
cathy/self/               Her soul (SOUL.md), memory/ and skills/. Markdown she loads each turn and can edit via PR.
```

## Writing a blog post

Create a file in `blog/src/content/blog/`. The filename becomes the URL: `my-post.mdx` is published at `blog.withchris.uk/my-post/`.

```mdx
---
title: The pigeonhole principle at GCSE
date: 2026-10-20
description: One sentence shown on the blog listing and in link previews.
draft: true          # optional: visible in `npm run dev`, hidden on the live site
motif: waves         # optional: pattern for the generated cover (waves, sines, rings, dots, rays, grid)
cover: ./pigeons.jpg # optional: your own cover image, relative to this file
coverAlt: Pigeons on a roof
---

Ordinary **Markdown**, with inline maths like $e^{i\pi} + 1 = 0$ and display maths:

$$
\sum_{n=1}^\infty \frac{1}{n^2} = \frac{\pi^2}{6}
$$

![A diagram](./diagram.png)
```

What a post can contain:

- **Text, links, lists, tables, quotes:** standard Markdown.
- **Maths:** `$...$` for inline and `$$...$$` for display, written in LaTeX. It's rendered by KaTeX when the site is built, so readers' browsers do no extra work.
- **Code:** fenced code blocks with a language name (` ```python `) are syntax-highlighted.
- **Images:** for images used by one post, make the post a folder (`blog/src/content/blog/my-post/index.mdx`) and put the images next to it. Astro resizes and compresses them.
- **Interactive elements and animations:** use `.mdx` and import a component, as `backprojection-by-hand.mdx` does with `<CTDemo />`. To make a new one, copy `blog/src/components/CTDemo.astro` and `blog/src/scripts/ct-demo.js`. Plain JavaScript in a `<script>` tag works, and so do canvas, SVG and libraries from npm.
- **Videos:** put the file in `blog/public/` and use `<video src="/clip.mp4" controls></video>` in an `.mdx` post.

The sample post `backprojection-by-hand.mdx` is marked `draft: true`. Read it through, then set `draft: false` (or delete the line) if you want it published.

## Adding your photo

Save it as `learn/src/assets/me.jpg` (`.png` and `.webp` also work). The About section on the tutoring page picks it up automatically. A portrait crop of about 4:5 suits the layout.

## Deploying

GitHub Actions deploys everything on every push to `main`, using the `CLOUDFLARE_API_TOKEN` repo secret:

- `.github/workflows/deploy-sites.yml` builds and deploys `learn`, `blog` and `home` (Workers `withchris-learn`, `withchris-blog`, `withchris-home`).
- `.github/workflows/deploy-admin.yml` deploys `admin`.

Each posts a commit status with its address, so you can see the result on the commit in GitHub.

### Cloudflare Access (login for the live admin)

The live admin (`withchris-admin.withchris.workers.dev`) can sit behind Cloudflare Access: only `learn@withchris.uk` gets in, with a one-time code sent to that email. No Google setup. The code checks Cloudflare's sign-in token on every request, and refuses if anything is off.

Until you finish these steps, admin keeps using the password. Previews and local dev always use the password.

1. Open Cloudflare → Zero Trust → Settings → Authentication. Check *One-time PIN* is listed as a login method (it is by default).
2. Go to Workers & Pages → `withchris-admin` → Settings → Domains & Routes. Next to `workers.dev`, turn on *Cloudflare Access*. Leave preview URLs alone.
3. Edit the Access policy it creates (Zero Trust → Access → Applications):
   - Action: Allow
   - Include: Emails → `learn@withchris.uk`
   - Login method: One-time PIN only
   - Session duration: 1 month
4. On that application, copy the *AUD tag* (Overview, or Edit → Basic information). Copy your *team domain* too (Zero Trust → Settings → Custom Pages, or the start of the login page address). It looks like `yourteam.cloudflareaccess.com`.
5. Put both in `admin/wrangler.jsonc`, under `vars`: `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Or send them to Cathy to do it. Merge and push.
6. Open admin in a private window. You should get the code screen, then the home screen. Check that an email other than `learn@withchris.uk` gets no code.

Careful with step 5: set both or neither. If only one is set, admin refuses everyone. Don't set them before step 2, or you'll be locked out. To undo, empty both values and push. The password login comes back.

After step 5, the deploy's "Check admin answers" status will show HTTP 302 or 403 instead of 200. That's expected.

### When the domain is active in the new Cloudflare account

1. In `shared/site.ts`, set `DOMAIN_LIVE = true`.
2. Add each custom domain to its `wrangler.jsonc`, for example in `learn/wrangler.jsonc`:
   `"routes": [{ "pattern": "learn.withchris.uk", "custom_domain": true }]`. Use `blog.withchris.uk` and `withchris.uk` for the others.
3. Push. The old `withchris.uk/learn` and `/blog/...` links redirect to the new sites.

### Setting up learn@withchris.uk

**Receiving email.**

1. In the Cloudflare dashboard, open `withchris.uk` and go to *Email → Email Routing*. Enable it, and let Cloudflare add the DNS records it suggests.
2. Under *Destination addresses*, add your Gmail address. Click the link in the verification email Cloudflare sends.
3. Under *Routing rules*, create a custom address `learn@withchris.uk` that forwards to your Gmail.

Send a test email to `learn@withchris.uk` from another account to check it arrives.

**Replying as learn@withchris.uk from Gmail.**

1. Turn on 2-Step Verification for your Google account. Then create an app password at <https://myaccount.google.com/apppasswords>.
2. In Gmail, go to *Settings → See all settings → Accounts and Import → Send mail as → Add another email address*.
3. Enter your name and `learn@withchris.uk`. Untick *Treat as an alias*.
4. Enter these SMTP settings:
   - Server: `smtp.gmail.com`
   - Port: `587`
   - Username: your Gmail address
   - Password: the app password
   - Security: TLS
5. Gmail sends a confirmation code to `learn@withchris.uk`. It reaches you through the forwarding rule. Enter it.
6. Back in Cloudflare DNS, edit the SPF `TXT` record on `withchris.uk` so Google is allowed to send for the domain. Otherwise replies may land in spam:
   ```
   v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all
   ```

When you reply to a tutoring enquiry, choose `learn@withchris.uk` in the *From* field. You can also tick *Reply from the same address the message was sent to* under *Accounts and Import*, so Gmail does this automatically.

## Why not Vercel, Supabase or Google Cloud?

- **Vercel:** its free plan is for non-commercial sites only, and a tutoring business counts as commercial. Cloudflare's free tier has no such rule.
- **Supabase:** the site has no users, logins or form submissions, and posts live in git. A database would add a moving part without adding anything. It's worth reconsidering if you later want comments, a contact form that stores enquiries, or an online editor.
- **Google Cloud:** it could host the site, but it would need more setup than Cloudflare for the same result. Keeping the domain, email and hosting in one Cloudflare account is simpler.

## Changing the domain or email

Edit `shared/site.ts`.
