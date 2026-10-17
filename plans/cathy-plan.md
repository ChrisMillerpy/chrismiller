# Plan: Cathy v1

The first, simplest working Cathy. YAGNI: build only what's below, harden later.

**Status:** planned, not started. Replaced the earlier, bigger harness plan, which has been deleted (it's still in git history). See [What changed](#what-changed-from-the-harness-plan).

## What Chris gets

1. Tap the **Cathy** card on the admin home screen → `/cathy`, a **chat explorer**: a list of every active chat, newest first, and a **New chat** button.
2. Tap a chat → a full-screen chat with that Cathy. Messages stream in live.
3. Each chat is one Cathy. She has her **own branch** off `main` (`cathy/<session-id>`) and her own Linux box. She can read, write and edit files, run commands, commit, push and **open PRs**.
4. Cathy can **message the front end** (her replies, plus anything she wants to tell Chris while working), and **message other Cathys** by session id.

Chris merges PRs himself. That's the approval step; nothing else leaves the system.

## Not in v1

- No students, portfolios, or row-level security. Chris is the only user.
- No TUI, no WhatsApp. The web page is the only surface. The agent is built so a terminal version is a small add-on later (see [Terminal later](#terminal-later)).
- No long-term memory beyond each chat's own history.
- No workspace persistence: the box is wiped when it sleeps, so Cathy pushes her work to her branch.
- No Cloudflare Access. The existing `ADMIN_PASSWORD` basic auth (open if unset).

## Architecture

Three separate pieces, so a chat turn never waits for a Linux box to boot:

1. **The agent** (`cathy/agent/`): Cathy as plain Mastra TypeScript. Model, instructions, tools. It doesn't know where it runs; it's handed a sandbox.
2. **The Cathy Worker** (`cathy/worker/`): the registry (D1) and one **Session Durable Object** per chat. The Durable Object runs the agent itself, keeps the chat history and talks to the page. Starts instantly.
3. **The sandbox** (`cathy/sandbox/`): one Linux box per chat (a Cloudflare Sandbox container) with the repo, git, gh and node. Only touched when Cathy runs a command or reads/writes a file.

```
Phone ──▶ Admin Worker (admin/)            Cathy Worker (cathy/worker/)
            /cathy       explorer page      ├─ D1: sessions table (the registry)
            /cathy/:id   chat page          └─ Session Durable Object (one per chat)
            /api/cathy/* ── service ──────▶     ├─ runs the Mastra agent (cathy/agent/)
                            binding             ├─ SQLite: this chat's messages
                                                ├─ WebSockets to open chat pages
                                                └─ sandbox tools ──▶ Sandbox (one per chat)
                                                                     Linux box: /workspace = repo on cathy/<id>
                                                                     git, gh, node; sleeps when idle
```

- **One database (D1)** registers sessions. It only answers "which chats exist?". It never holds messages. Its schema lives in the root `d1/` folder so other Workers can share it later.
- **Each session is its own object**: a Durable Object that owns the chat history (in its built-in SQLite), the live WebSocket connections, and the agent loop. Session id = Durable Object id = sandbox id.
- **Talking is instant; doing wakes the box.** A reply that needs no tools never touches the sandbox.
- **Fast after the first command:** the sandbox has `sleepAfter: 10m`, so it stays awake for 10 minutes after its last command and every command resets the clock. Opening a chat page also sends a cheap "wake up" to the sandbox in the background, so it's usually warm before Cathy needs it.
- **The agent is stateless.** Each turn, the Durable Object passes the chat history to the agent. A sandbox that slept loses only its checkout, which is quick to restore (see [Sandbox start](#sandbox-start)).

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

Every request to the Cathy Worker needs `INTERNAL_TOKEN`, which admin adds when forwarding. So its workers.dev URL is useless to anyone else. (`message_cathy` and `tell_chris` run inside the Worker, so the sandbox never calls back.)

WebSocket events (server → page): `history`, `delta` (streaming text), `tool` (name + short summary), `message` (finished message), `status` (`thinking` / `idle` / `waking sandbox`).
Page → server: `{ type: "send", text }`.

## Cathy's tools

| Tool | Runs in | Notes |
| --- | --- | --- |
| `read_file`, `write_file`, `edit_file`, `list_files`, `grep` | Sandbox | Mastra Workspace tools if the sandbox provider supports files; otherwise five small tools of ours over the sandbox's file API |
| `execute_command` | Sandbox | git, node, npm, gh available |
| `open_pr` | Sandbox | Commits, pushes `cathy/<id>`, opens a PR to `main` with `gh`. Returns the URL |
| `tell_chris` | Worker | Posts a message to the chat page while she's mid-task |
| `list_cathys` | Worker | Active sessions from D1 (id, title) |
| `message_cathy` | Worker | Sends text to another session's Durable Object; it arrives as a `cathy` message and wakes her |

**Loop guard:** a Cathy may answer another Cathy, but a chain of Cathy-to-Cathy messages stops after 3 hops without a message from Chris. The Durable Object counts hops and drops the 4th with a `notice`.

## Sandbox start

The image is built once at deploy, with everything baked in so nothing installs at runtime: node 22, git, gh, and a recent clone of the repo with `node_modules` installed. When a sandbox wakes:

1. `git fetch` (seconds, since the clone is already there).
2. Check out `cathy/<id>` if it exists on GitHub, otherwise create it from `origin/main` and push it.

Cathy's instructions tell her to commit and push to her branch after each meaningful change, since the box can sleep.

## Secrets

Cathy Worker secrets, copied from GitHub repo secrets by the deploy workflow (as now). Only `GITHUB_TOKEN` is passed into the sandbox:

| Secret | Scope |
| --- | --- |
| `ANTHROPIC_API_KEY` | A **workspace-scoped** key, so no workspace-id header is needed |
| `GITHUB_TOKEN` | Fine-grained PAT, `chrismiller` repo only: Contents and Pull requests read/write |
| `INTERNAL_TOKEN` | Random string; admin → Cathy Worker. Set on both Workers |
| `ADMIN_PASSWORD` | Optional; page login |

The Anthropic key stays in the Worker, out of the sandbox. Cathy's shell can read `GITHUB_TOKEN`, so keep it narrow.

## Files

```
d1/                         the registry database (schema only)
  migrations/0001_sessions.sql
cathy/
  agent/                    Cathy herself: runtime-agnostic Mastra code
    cathy.ts                createCathy({ workspace, tools }) → Mastra Agent
    instructions.md         her system prompt
  worker/                   the Cathy Worker
    wrangler.jsonc          D1 binding (migrations_dir ../../d1/migrations), Session Durable Object, Sandbox binding
    src/index.ts            /api routes, INTERNAL_TOKEN check
    src/session.ts          Session Durable Object: history, WebSockets, runs the agent
    src/tools.ts            tell_chris, list_cathys, message_cathy
  sandbox/
    Dockerfile              Cloudflare Sandbox base image + git, gh, node 22, repo clone, npm ci
admin/                      the interface: our own pages (not Mastra's Studio)
  src/index.js              pages; forwards /api/cathy/* to the CATHY service binding
  wrangler.jsonc            + services: [{ binding: "CATHY", service: "withchris-cathy" }]
```

A `deploy-cathy.yml` workflow deploys `cathy/` on changes, the same way `deploy-admin.yml` does.

## Terminal later

`cathy/agent/` has no Cloudflare code in it, so a terminal Cathy is a small script, roughly:

```ts
// cathy/cli.ts  (run with: npx tsx cathy/cli.ts)
const cathy = createCathy({ workspace: new Workspace({ sandbox: new LocalSandbox({ workingDirectory: process.cwd() }) }) });
// read a line, cathy.stream(history), print the reply, repeat
```

Same Cathy, same tools, working on your local checkout. Later options: point it at a cloud session's sandbox instead of the local disk, or plug it into Mastra Code's terminal UI.

## Phases

| Phase | Done when |
| --- | --- |
| **0. Spike** | One hard-coded session: the Durable Object runs Mastra and calls Claude; Cathy runs `git status` in her sandbox and replies. **Timed:** first reply with no tools, sandbox cold wake, warm command. Deployed via GitHub Actions |
| **1. Sessions** | D1 registry, explorer page, New chat, Session Durable Object with history and WebSocket, chat page with streaming, wake-on-open |
| **2. Branches and PRs** | Per-session branch on sandbox start, `open_pr` works, PR link shows in chat |
| **3. Cathy to Cathy** | `list_cathys`, `message_cathy`, `tell_chris`, loop guard |

Each phase is one PR.

## Risks and unknowns (checked in the spike)

- **Workers Paid** ($5 a month) is needed for the sandbox containers.
- **Mastra inside a Durable Object:** Mastra officially deploys to Workers, but running an `Agent` inside a Durable Object is unverified. Fallback: a plain Mastra Worker the Durable Object calls.
- **Sandbox provider for Mastra:** Mastra's `@mastra/cloudflare-sandbox` talks to a "bridge" Worker over HTTP. Inside our Worker we can call the Sandbox binding directly, so we may write a thin provider (or five tools) instead. Decided in the spike.
- **Deploying containers from GitHub Actions:** `wrangler deploy` builds the image with Docker on the runner. Should work on `ubuntu-latest`.
- **Cold start:** the first command after 10 quiet minutes waits for the box. Wake-on-open hides most of it; the page shows `waking sandbox`.
- **WebSockets through a service binding:** expected to pass through; checked in phase 1.
- **Basic auth on WebSockets:** browsers usually resend cached credentials on same-origin WebSockets. If not, fall back to a token in the query string.
- **Cost:** a sandbox only runs while awake (up to 10 minutes after the last command). Idle chats cost nothing.

## What changed from the harness plan

Decided by Chris, 16 Oct 2026:

- **No Supabase.** One D1 database for the session registry; per-session state in Durable Objects. Revisit when real student data arrives.
- **Mastra** (confirmed). The agent runs in each session's Durable Object, separate from the sandbox, so talking is instant and only commands wait for a box. Built so it can run in a terminal later.
- **Web first.** The Cathy card on the admin page; TUI later.
- **Auth is basic.** Password or open, fix in a month when it matters.

## Sources

- [Mastra Workspace](https://mastra.ai/docs/workspace/overview), [filesystem tools](https://mastra.ai/docs/sandbox/filesystem)
- [Cloudflare Sandbox architecture](https://developers.cloudflare.com/sandbox/concepts/architecture/) (Worker → Durable Object → container)
- [Deploy Mastra to Cloudflare](https://mastra.ai/guides/deployment/cloudflare), [Mastra Cloudflare Sandbox](https://mastra.ai/integrations/sandboxes/cloudflare-sandbox)
