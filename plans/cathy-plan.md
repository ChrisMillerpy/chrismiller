# Plan: Cathy v1

The first, simplest working Cathy. YAGNI: build only what's below, harden later.

**Status:** planned, not started. Supersedes the big [harness plan](../harness-plan.md) for now (see [What changed](#what-changed-from-the-harness-plan)).

## What Chris gets

1. Tap the **Cathy** card on the admin home screen → `/cathy`, a **chat explorer**: a list of every active chat, newest first, and a **New chat** button.
2. Tap a chat → a full-screen chat with that Cathy. Messages stream in live.
3. Each chat is one Cathy. She has her **own branch** off `main` (`cathy/<session-id>`) and her own Linux box. She can read, write and edit files, run commands, commit, push and **open PRs**.
4. Cathy can **message the front end** (her replies, plus anything she wants to tell Chris while working), and **message other Cathys** by session id.

Chris merges PRs himself. That's the approval step; nothing else leaves the system.

## Not in v1

- No students, portfolios, or row-level security. Chris is the only user.
- No TUI, no WhatsApp. The web page is the only surface. (Mastra's HTTP API means a TUI is just another client later.)
- No long-term memory beyond each chat's own history.
- No workspace persistence: the box is wiped when it sleeps, so Cathy pushes her work to her branch.
- No Cloudflare Access. The existing `ADMIN_PASSWORD` basic auth (open if unset).

## Architecture

Everything Cathy lives in `cathy/` as its own Worker. The admin Worker only serves pages and forwards API calls to it through a **service binding**.

```
Phone ──▶ Admin Worker (admin/)            Cathy Worker (cathy/)
            /cathy       explorer page      ├─ D1: sessions table (the registry)
            /cathy/:id   chat page          └─ Session Durable Object (one per chat)
            /api/cathy/* ── service ──────▶     ├─ SQLite: this chat's messages
                            binding             ├─ WebSockets to open chat pages
                                                └─ Container (one per chat, sleeps when idle)
                                                     └─ Node: Mastra agent "Cathy"
                                                         ├─ /workspace = repo on cathy/<id>
                                                         ├─ tools: read/write/edit/grep/execute_command
                                                         └─ tools: open_pr, tell_chris, message_cathy, list_cathys
```

- **One database (D1)** registers sessions. It only answers "which chats exist?". It never holds messages. Its schema lives in the root `d1/` folder so other Workers can share it later; the Cathy Worker is the one that binds it today.
- **Each session is its own object**: a Durable Object that owns the chat history (in its built-in SQLite), the live WebSocket connections, and its container. With Cloudflare Containers, the container *is* addressed through that Durable Object, so one id = one chat = one Cathy = one box.
- **The container runs Mastra.** The box is both where the agent lives and its sandbox, so Mastra's Workspace uses the local disk and shell. No separate sandbox service.
- **The agent is stateless.** Each turn, the Durable Object sends the chat history to the container and streams the reply back. A box that slept and woke up loses nothing but its checkout, which it re-clones.

## Data

D1, one table:

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,          -- short random id, e.g. "k3f9q2"
  title       TEXT NOT NULL,             -- first message, trimmed; Cathy can rename
  branch      TEXT NOT NULL,             -- cathy/<id>
  status      TEXT NOT NULL DEFAULT 'active',  -- active | archived
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_message TEXT                      -- preview for the explorer
);
```

Session Durable Object SQLite, one table:

```sql
CREATE TABLE messages (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  role     TEXT NOT NULL,     -- user | assistant | tool | cathy (from another Cathy) | notice
  sender   TEXT,              -- 'chris', or the other Cathy's session id
  content  TEXT NOT NULL,     -- text, or JSON for tool calls/results
  at       INTEGER NOT NULL
);
```

## API

Admin Worker serves `GET /cathy` (explorer) and `GET /cathy/:id` (chat), and forwards `/api/cathy/*` to the Cathy Worker. Cathy Worker routes:

| Route | Does |
| --- | --- |
| `GET /api/sessions` | Active sessions from D1 |
| `POST /api/sessions` | New session: id, D1 row, branch name. Returns id |
| `POST /api/sessions/:id/archive` | Hide from the explorer |
| `GET /api/sessions/:id/ws` | WebSocket to that session's Durable Object: history on connect, then live events |
| `POST /internal/sessions/:id/messages` | Container → Worker: `message_cathy` and `tell_chris` |

Every request to the Cathy Worker needs `INTERNAL_TOKEN` (admin adds it when forwarding; the container sends it). So its workers.dev URL is useless to anyone else.

WebSocket events (server → page): `history`, `delta` (streaming text), `tool` (name + short summary), `message` (finished message), `status` (`thinking` / `idle` / `waking`).
Page → server: `{ type: "send", text }`.

## Cathy's tools

| Tool | From | Notes |
| --- | --- | --- |
| `read_file`, `write_file`, `edit_file`, `list_files`, `grep` | Mastra Workspace (`LocalFilesystem` on `/workspace`) | Built in |
| `execute_command` | Mastra Workspace (`LocalSandbox`) | Built in. git, node, npm, gh available |
| `open_pr` | Ours | Commits, pushes `cathy/<id>`, opens a PR to `main` with `gh`. Returns the URL |
| `tell_chris` | Ours | Posts a message to the chat page while she's mid-task |
| `list_cathys` | Ours | Active sessions from D1 (id, title) |
| `message_cathy` | Ours | Sends text to another session; it arrives there as a `cathy` message and wakes her |

**Loop guard:** a Cathy may answer another Cathy, but a chain of Cathy-to-Cathy messages stops after 3 hops without a message from Chris. The Durable Object counts hops and drops the 4th with a `notice`.

## Session start (in the container)

1. `git clone --depth 50` the repo with `GITHUB_TOKEN`.
2. If `origin/cathy/<id>` exists, check it out. Otherwise branch from `origin/main` and push it.
3. `npm ci` only if a task needs it (Cathy decides).

Cathy's instructions tell her to commit and push to her branch after each meaningful change, since the box can sleep.

## Secrets

Worker secrets, copied from GitHub repo secrets by the deploy workflow (as now), and passed to the container as env vars:

| Secret | Scope |
| --- | --- |
| `ANTHROPIC_API_KEY` | A **workspace-scoped** key, so no workspace-id header is needed |
| `GITHUB_TOKEN` | Fine-grained PAT, `chrismiller` repo only: Contents and Pull requests read/write |
| `INTERNAL_TOKEN` | Random string; admin → Cathy Worker and container → Cathy Worker. Set on both Workers |
| `ADMIN_PASSWORD` | Optional; page login |

Cathy's shell can read these. Keep them narrow.

## Files

```
d1/                       the registry database (schema only)
  migrations/0001_sessions.sql
cathy/                    the Cathy Worker: session objects and containers
  wrangler.jsonc          D1 binding (migrations_dir ../d1/migrations), Session Durable Object, container (sleepAfter 10m)
  src/worker.ts           /api and /internal routes, INTERNAL_TOKEN check
  src/session.ts          Session Durable Object (extends Container)
  agent/                  the container: the Mastra agent
    Dockerfile            node:22 + git + gh
    package.json          mastra, @ai-sdk/anthropic
    src/agent.ts          the Cathy agent, workspace, our tools
    src/server.ts         POST /turn: history in, event stream out
admin/                    the interface: our own pages (not Mastra's Studio)
  src/index.js            pages; forwards /api/cathy/* to the CATHY service binding
  wrangler.jsonc          + services: [{ binding: "CATHY", service: "withchris-cathy" }]
```

A `deploy-cathy.yml` workflow deploys `cathy/` on changes, the same way `deploy-admin.yml` does.

## Phases

| Phase | Done when |
| --- | --- |
| **0. Spike** | One hard-coded session: the container starts, Mastra calls Claude, Cathy runs `git status` in a clone and replies through a plain HTTP endpoint. Deployed via GitHub Actions |
| **1. Sessions** | D1 registry, explorer page, New chat, Session Durable Object with history and WebSocket, chat page with streaming |
| **2. Branches and PRs** | Per-session branch on start, `open_pr` works, PR link shows in chat |
| **3. Cathy to Cathy** | `list_cathys`, `message_cathy`, `tell_chris`, loop guard |

Each phase is one PR.

## Risks and unknowns (checked in the spike)

- **Workers Paid** ($5 a month) is needed for Containers.
- **Mastra in a container:** expected fine (plain Node), but Workspace tool names and `LocalSandbox` behaviour in a container are unverified.
- **Deploying containers from GitHub Actions:** `wrangler deploy` builds the image with Docker on the runner. Should work on `ubuntu-latest`.
- **Cold starts:** a sleeping box takes seconds to wake, plus a clone. The page shows `waking`.
- **WebSockets through a service binding:** expected to pass through; checked in phase 1.
- **Basic auth on WebSockets:** browsers usually resend cached credentials on same-origin WebSockets. If not, fall back to a token in the query string.
- **Cost:** one container per active chat. Ten idle chats cost nothing; ten busy ones cost ten containers. Archive old chats.

## What changed from the harness plan

Decided by Chris, 16 Oct 2026:

- **No Supabase.** One D1 database for the session registry; per-session state in Durable Objects. Revisit when real student data arrives.
- **Mastra** (confirmed), running in a Cloudflare Container per session, not a shared harness server.
- **Web first.** The Cathy card on the admin page; TUI later.
- **Auth is basic.** Password or open, fix in a month when it matters.

## Sources

- [Mastra Workspace](https://mastra.ai/docs/workspace/overview), [filesystem tools](https://mastra.ai/docs/sandbox/filesystem)
- [Cloudflare Sandbox architecture](https://developers.cloudflare.com/sandbox/concepts/architecture/) (Worker → Durable Object → container)
