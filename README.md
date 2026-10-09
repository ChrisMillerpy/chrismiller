# withchris.uk

Chris Miller's personal site: a maths tutoring page at `/learn` and a blog at `/blog`. The homepage redirects to `/learn` for now.

It's a static site built with [Astro](https://astro.build). There's no database and no server code. Blog posts are Markdown/MDX files in this repo. The site is hosted on Cloudflare, which also handles the domain and the `learn@` email address.

| Need | Tool | Cost |
| --- | --- | --- |
| Site generator | Astro, with MDX for posts and KaTeX for maths | Free |
| Hosting | Cloudflare Workers (static assets) | Free |
| Domain | `withchris.uk`, registered through Cloudflare or any registrar | About £5–10 a year |
| Incoming email | Cloudflare Email Routing (`learn@` forwards to Gmail) | Free |
| Outgoing email | Gmail "Send mail as" | Free |

## Running it locally

You need Node 22 or newer (`node -v` to check; `nvm use` picks up `.nvmrc`).

```sh
npm install
npm run dev        # http://localhost:4321, reloads as you edit
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server. Draft posts are shown, with a "Draft" badge. |
| `npm run build` | Builds the production site into `dist/`. Drafts are left out. |
| `npm run preview` | Serves the built `dist/` locally, to check exactly what will be deployed. |
| `npm run check` | Type-checks the project and validates every post's frontmatter. |
| `npm run deploy` | Builds and deploys to Cloudflare from your machine (see below). |

## Project layout

```
src/
  site.ts                 Name, domain and email. Change them here.
  pages/
    learn.astro           Tutoring page (/learn)
    blog/index.astro      Blog listing (/blog)
    blog/[...slug].astro  A single post (/blog/<post-name>/)
    rss.xml.ts            RSS feed (/rss.xml)
    404.astro
  content/blog/           Blog posts (.md or .mdx)
  content.config.ts       The fields every post must have
  components/             Header, Footer, PostCover, CTDemo (the interactive CT demo)
  layouts/Base.astro      Shared <head>, header and footer
  styles/global.css       Colours, fonts and spacing used across the site
  scripts/                Client-side code for interactive components
  assets/                 Images that Astro optimises (put your photo here)
public/                   Files served as-is (favicon, robots.txt)
mockups/                  The design mockups. Not part of the site.
astro.config.mjs          Astro settings (maths rendering, sitemap, the / → /learn redirect)
wrangler.jsonc            Cloudflare deploy settings
```

## Writing a blog post

Create a file in `src/content/blog/`. The filename becomes the URL: `my-post.mdx` is published at `/blog/my-post/`.

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
- **Images:** for images used by one post, make the post a folder (`src/content/blog/my-post/index.mdx`) and put the images next to it. Astro resizes and compresses them.
- **Interactive elements and animations:** use `.mdx` and import a component, as `backprojection-by-hand.mdx` does with `<CTDemo />`. To make a new one, copy `src/components/CTDemo.astro` and `src/scripts/ct-demo.js`. Plain JavaScript in a `<script>` tag works, and so do canvas, SVG and libraries from npm.
- **Videos:** put the file in `public/` and use `<video src="/clip.mp4" controls></video>` in an `.mdx` post.

The sample post `backprojection-by-hand.mdx` is marked `draft: true`. Read it through, then set `draft: false` (or delete the line) if you want it published.

## Adding your photo

Save it as `src/assets/me.jpg` (`.png` and `.webp` also work). The About section on `/learn` picks it up automatically. A portrait crop of about 4:5 suits the layout.

## Deploying

### One-time setup

**1. Buy the domain.** In the [Cloudflare dashboard](https://dash.cloudflare.com), go to *Domain Registration → Register Domains* and search for `withchris.uk`. Cloudflare sells domains at cost.

If Cloudflare doesn't offer `.uk`, buy it from Porkbun or Namecheap instead. Then in Cloudflare choose *Add a domain*, enter `withchris.uk`, and at your registrar replace the nameservers with the two Cloudflare gives you.

Also consider buying `withchris.co.uk`, because UK parents often type `.co.uk` out of habit. You can redirect it to `withchris.uk` with a Cloudflare redirect rule.

**2. Put the site on Cloudflare.** Pick one of these.

- **Automatic deploys from GitHub (recommended).** Push this repo to GitHub. In Cloudflare go to *Workers & Pages → Create → Import a repository*, choose the repo, and set:
  - Build command: `npm run build`
  - Deploy command: `npx wrangler deploy`

  After that, every push to `main` deploys the site.
- **Deploy from your laptop.** Run `npx wrangler login` once, then `npm run deploy` whenever you want to publish.

Either way the site goes live at `withchris.<your-subdomain>.workers.dev`.

**3. Connect the domain.** Open the `withchris` Worker and go to *Settings → Domains & Routes → Add → Custom domain*. Add `withchris.uk`, then add `www.withchris.uk` too. Cloudflare creates the DNS records and the HTTPS certificate for you.

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

Edit `src/site.ts`. Also update the sitemap line in `public/robots.txt`.
