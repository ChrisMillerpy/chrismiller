# .agents

Tooling and config for coding agents working in this repo. Everything here is committed except `.env`.

| File | What it is |
| --- | --- |
| `AGENTS.md` | This file. |
| `new-worktree.sh` | Sets up a git worktree for a branch and symlinks env files into it. |
| `.env.example` | Template for `.agents/.env`, listing the variables agents expect. |
| `.env` | Real secrets. Gitignored. Lives in the main checkout only; worktrees get a symlink. |

## Worktrees: `new-worktree.sh`

Agents work in worktrees under `.claude/worktrees/<branch>`, not in the main checkout. Env files are gitignored, so a fresh worktree has none. The script fixes that.

```sh
.agents/new-worktree.sh <branch> [base-branch]   # base defaults to main
```

It works from the main checkout or from inside any worktree, and handles three cases:

- **Branch already has a worktree:** only (re)links env files there.
- **Branch exists, no worktree:** adds one at `.claude/worktrees/<branch>`.
- **Branch doesn't exist:** creates it from `origin/<base>` (fetched first) or local `<base>` if there's no remote, at `.claude/worktrees/<branch>`.

Then it finds every `.env` and `.env.*` file in the main checkout (skipping `.git`, `.claude`, `node_modules` and `.env.example`) and symlinks each one to the same path in the worktree. Because they're symlinks, editing a secret in the main checkout updates every worktree. A real (non-symlink) env file already in the worktree is left alone, so a worktree can override a value by replacing its symlink with a real file.

It refuses to run if the branch is checked out in the main checkout, or if the target directory exists but isn't a worktree for that branch.

## Env: `.env` and `.env.example`

`.agents/.env` holds secrets agents need. To set it up, copy `.env.example` to `.agents/.env` **in the main checkout** and fill in the values, then run `new-worktree.sh` (or re-run it on an existing worktree) to link it in.

When you add a variable, add it to `.env.example` too, with an empty value and a one-line comment, so the next person knows it exists.

Load it in a shell with:

```sh
set -a; source .agents/.env; set +a
```

## Cloudflare access

The site is hosted on Cloudflare Workers (see `wrangler.jsonc` and the README). `CLOUDFLARE_API_KEY` in `.agents/.env` gives agents API access to the Cloudflare account, so they can deploy, check Workers and builds, and read DNS or Email Routing settings without the dashboard.

Wrangler reads its token from `CLOUDFLARE_API_TOKEN`, so pass the key under that name:

```sh
set -a; source .agents/.env; set +a
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_KEY" npx wrangler whoami
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_KEY" npx wrangler deployments list
```

For the REST API, send it as a bearer token:

```sh
curl -s https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer $CLOUDFLARE_API_KEY"
```

Rules:

- Never print, log or commit the key, and never paste it into code, URLs or chat.
- Reads (list, get, whoami, verify) are fine. Anything that changes the account (deploys, DNS edits, deleting resources) needs Chris's go-ahead first.
- If a call fails with a permissions error, the token's scope is missing that permission. Tell Chris rather than working around it.
