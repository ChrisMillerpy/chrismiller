# Plan: the agent harness ("Cathy")

A harness for a team of AI tutors. Every agent is a tutor called **Cathy**, with her own portfolio of students, the worksheets she has set them, their submissions and chat history, and a staff room where she can talk to the other Cathys. The same harness drives a terminal UI today, and later WhatsApp, a student-facing workspace, coding and deploy jobs, and swarms of agents working together.

**Status:** research and planning. No harness code yet. This file is owned by the harness workstream; the admin workstream owns [`admin-user-account-plan.md`](admin-user-account-plan.md). See [Coordination](#coordination) for how the two talk.

## Goals

- **One harness, many surfaces.** A Cathy has one identity, memory and set of permissions whether she's reached from the TUI, WhatsApp, a student's browser or another agent.
- **Agents are principals, not superusers.** A Cathy can only read and write what her portfolio entitles her to. The database and file store enforce that, not just the prompt.
- **A staff room.** Cathys can find each other, ask each other for help, hand a student over, and work in groups or swarms.
- **Chris stays in control.** Anything that leaves the system (messages to students or parents, PRs, deploys) waits for his approval until he says otherwise. He can step into any session and steer it ("whisper").
- **Cheap when idle.** Pay for tokens when Cathys work, not for servers when they don't.

## Not in the first version

- No student or parent logins and no student-facing UI. Chris is the only human user, through the TUI.
- No WhatsApp. It's planned for phase 3 (see [Phases](#phases)).
- No web control panel. TUI only, by Chris's decision.

## Vocabulary

| Word | Meaning |
| --- | --- |
| **Harness** | Everything around the model: the agent loop, context and memory, tools, permissions, sessions, the surfaces people reach it through, and agent-to-agent messaging. |
| **Cathy** | One agent instance. Each has an id (`cathy_01`…), the shared Cathy persona, and her own memory and portfolio. |
| **Portfolio** | The students assigned to a Cathy, plus everything she has given them or received from them. |
| **Staff room** | The shared space where Cathys see who else exists, what they're working on, and message each other, one to one or in groups. |
| **Principal** | Anything that can be granted access: Chris, a future staff account, a Cathy, a student, a parent, a backend job. |
| **Surface** | A way into the harness: TUI, WhatsApp, web chat, GitHub, email, another agent. |
| **Job** | Heavy work done in a sandbox, for example building a worksheet, running code, or opening a PR. |

## Decisions

### Made by Chris

- **"Harness" is the name for what we're building.**
- **TUI only for now.** No web panel.
- **Agents are tutors named Cathy,** each with a portfolio of students, access to what she has given them and what they have submitted, and a staff room with the other Cathys.
- **Access control is enforced in the data layer:** row-level security on the database, scoped access to stored files, a service role for the backend, and IAM-style accounts for admin features (for example, a dashboard only Chris can see).
- **The two workstreams coordinate through plan files and inboxes** in `plans/`. See [Coordination](#coordination).

### Proposed, needs Chris's OK

#### H1. Build on Mastra, not from scratch

| Option | What it gives us | What's missing | Verdict |
| --- | --- | --- | --- |
| **Mastra** (Apache-2.0, TypeScript) | `Agent`, and `AgentController` (sessions with threads, modes, per-mode models, tool approvals, subagents, schedules, steering signals, goals). Channels for WhatsApp, Slack, Telegram and others, with several users driving one session. Workflows that pause for a human and resume. Observational memory. MCP. Evals. Storage on Postgres, LibSQL or D1. **Mastra Code**, a terminal coding agent built on `AgentController` and Pi's TUI library. Models through the Vercel AI SDK, including Anthropic. | `AgentController` is new and changes between minor versions. Running on Workers is unproven for the controller and channels (one open bug). Large dependency. | **Recommended.** It covers TUI, sessions, approvals, channels and subagents, which would otherwise be months of work. |
| **Pi** (MIT; `@earendil-works/pi-*`) | A small, readable harness: agent core, unified LLM API, TUI library, session trees with fork and rewind, TypeScript extensions, SDK embedding (`createAgentSession`), RPC mode. OpenClaw builds a WhatsApp and Telegram gateway on it. | By design, no permissions, subagents, MCP or multi-user sessions. We'd build all of the multi-tenant parts ourselves. Node only. | Use its TUI library through Mastra Code. Keep as plan B for the coding core. |
| **Cloudflare Think** (`@cloudflare/think`, preview) | Each agent is a Durable Object with its own SQLite: per-Cathy isolation by construction. Sub-agents, durable "fibers", session trees with search, a ladder of execution environments up to a full Sandbox, scheduling, inbound email. Models through the AI SDK. | Preview status. No TUI and no channels. Nothing to enforce row-level security across agents. | Strong plan B if Mastra won't run well on our stack. Revisit when it reaches GA. |
| **Claude Agent SDK** | Claude Code as a library: the best coding toolset. | Claude only. Spawns a subprocess, so it needs a container. Single-tenant. | Use inside sandboxes for heavy coding jobs (H4), not as the harness. |
| **Letta** | Memory-first agents; shared memory blocks map well onto a staff room. | Separate Python server to run. | No. Borrow the shared-memory idea. |
| **Anthropic Managed Agents** | Hosted loop and sandbox, multiagent threads, vaults, budgets. | Beta, lock-in, $0.08 per session-hour, no channels or TUI. | No for the core. Possible job runner later. |

What would change the verdict: the spike in phase 0 fails on any of: Anthropic prompt caching through the AI SDK provider; per-principal database credentials inside tools; a stable `AgentController` session API; hosting cost. If it fails, fall back to Think, with the Claude Agent SDK for coding.

#### H2. Data platform: Postgres with row-level security (Supabase), shared with the admin

Chris wants row-level security, storage permissions, a service role and IAM-style accounts. That's Postgres. D1 is SQLite and has no RLS, and nothing in Cloudflare's own stack enforces per-principal access in the database.

- **Proposal:** Supabase in the London region. One project gives Postgres with RLS, Storage with per-object policies, Auth (magic links for students later) and a service role. Workers reach it through Cloudflare Hyperdrive. Mastra has first-class Postgres storage and pgvector for memory search.
- **Why not "RLS in code" on D1:** Cathys run on model output, and prompt injection is real. With real RLS, a Cathy's tools run under a short-lived token that carries her `agent_id`, so even a fully hijacked Cathy can't read another portfolio. In-code checks can be bypassed by one forgotten `WHERE`.
- **Cost of choosing this:** a second provider (the admin plan rejected Supabase for that reason, when the job was one user's admin). Pro plan is $25 a month; the free tier pauses after a week idle.
- **Knock-on for the admin:** it isn't deployed and its database is empty, so now is the cheapest moment to move. `students`, `lessons` and payments would become Postgres tables. The admin keeps Cloudflare Access for Chris, and maps his Access email to a staff role. **The admin workstream and Chris decide this together. Until then nothing changes in `admin/`.**
- **Fallback:** if Chris prefers to stay Cloudflare-only, keep D1 and make a single data-access Worker the only path to data. It would take a principal and enforce scope on every query, and files would only be reached through signed R2 URLs it mints. That's weaker: it's application code, not database policy.

#### H3. Where it runs

- **Harness server:** a Mastra server in a Cloudflare Container (Node), at `harness.withchris.uk`. Workers-native hosting is tested in the spike. Moving there later is cheaper but not required.
- **TUI:** a fork or extension of Mastra Code on Chris's laptop. Two modes: **local**, where a Cathy works on a local checkout, and **attached**, where it is a client of a cloud session and Chris can watch, approve and whisper. It authenticates to the server with a Cloudflare Access service token.
- **State:** Postgres for business, learning and harness data (H2). Supabase Storage (or R2) for worksheets and submissions.

#### H4. Jobs run in sandboxes

Cloudflare Sandbox, one per job: clone the repo, run tools, preview URLs, backups to R2, outbound network restricted to an allow list. Inside, use either the Mastra agent's own tools or the Claude Agent SDK for heavy coding. Credentials are injected outside the sandbox, never handed to the model.

#### H5. Models

| Work | Model | Why |
| --- | --- | --- |
| Planning, coding, marking, anything hard | Claude Opus 5.5 ($4 / $20 per million tokens in / out) | Quality matters most |
| Tutoring conversation, staff-room chat | Claude Sonnet 5.5 ($2 / $10) | Good and half the price |
| Routing, summaries, inbox digests, memory upkeep | Claude Haiku 5.5 ($0.10 / $0.50) | Nearly free |

Set effort explicitly per route, keep prompts cache-friendly, and give every session and swarm a hard spending cap.

## Architecture

```
 Chris ── TUI (Mastra Code fork; local or attached)
                │  Access service token
                ▼
 harness.withchris.uk  ── Mastra server (AgentController) in a Cloudflare Container
   • Cathy sessions: threads, modes, approvals, subagents, schedules, signals (whisper)
   • Staff room: directory, 1:1 and group threads, task board
   • Channels later: WhatsApp, web chat, email, GitHub
   • Tools run under the calling principal's short-lived DB token (RLS)
        │                         │                          │
        ▼                         ▼                          ▼
 Supabase Postgres (RLS)   Supabase Storage / R2      Cloudflare Sandbox jobs
 students, portfolios,     worksheets/, submissions/  repo checkout, code, PRs,
 worksheets, submissions,  per-principal policies     preview URLs
 conversations, staffroom,
 staff roles, ledger
        ▲
        │ same database, Chris's staff role
 admin.withchris.uk (admin workstream; Cloudflare Access)
```

## Access model

### Principals and how they authenticate

| Principal | Authenticates with | Token carries |
| --- | --- | --- |
| Chris (owner) | Cloudflare Access (admin, TUI) | `role=staff`, `staff_id`, permissions: all |
| Future staff accounts | Cloudflare Access, mapped to a staff record | `role=staff`, `staff_id`, specific permissions (for example `finance.read`) |
| A Cathy | Minted by the harness server per tool call, valid for minutes | `role=agent`, `agent_id` |
| Student (later) | Magic link (Supabase Auth) | `role=student`, `student_id` |
| Parent (later) | Magic link | `role=guardian`, `guardian_id` |
| Backend jobs | Service role key, server-side only, never inside a model's tools | bypasses RLS; used for migrations and system jobs only |

### What each principal can see (RLS intent)

| Data | Cathy | Student | Parent | Staff |
| --- | --- | --- | --- | --- |
| Student profile | In her portfolio | Own | Their children | By permission |
| Worksheets | Ones she authored or that are shared with her | Assigned to them | Their children's | By permission |
| Submissions | From her portfolio's students | Own | Their children's | By permission |
| Conversations | Ones she's in | Own | Their children's (if policy allows) | By permission |
| Staff room | Rooms she's a member of; every Cathy's public profile | None | None | Read all |
| Lessons, money | None by default | None | Own invoices (later) | `finance.*` |
| Whisper notes | Read only, in her own sessions | Never | Never | Write |

### Stored files

| Path | Read | Write |
| --- | --- | --- |
| `worksheets/{agent_id}/{worksheet_id}/…` | Owner Cathy; Cathys it's shared with; students it's assigned to | Owner Cathy |
| `submissions/{student_id}/{assignment_id}/…` | That student; Cathys with the student in their portfolio; staff | That student; staff |
| `staffroom/{room_id}/…` | Room members | Room members |

## Data model (draft, for the spike)

| Table | Key fields |
| --- | --- |
| `staff` | `id`, `email`, `name`, `permissions[]` |
| `agents` | `id`, `display_name` (Cathy), `status`, `model_profile`, `bio` (public in the staff room) |
| `students` | as in the admin plan, plus `phone_e164`, `consent_ai`, `consent_whatsapp`, `login_email` |
| `guardians`, `student_guardians` | parent contact details and links |
| `agent_students` | `agent_id`, `student_id`, `role` (`lead` / `support`), `since`, `until`: the portfolio |
| `worksheets` | `id`, `author_agent_id`, `title`, `topic`, `level`, `storage_path`, `shared_with[]` |
| `assignments` | `id`, `worksheet_id`, `student_id`, `set_by_agent_id`, `due`, `status` |
| `submissions` | `id`, `assignment_id`, `student_id`, `storage_path`, `submitted_at`, `feedback`, `marked_by_agent_id` |
| `conversations`, `messages` | participants, surface (`tui`, `whatsapp`, `web`), visibility (`all`, `staff_only` for whispers) |
| `rooms`, `room_members`, `room_messages` | the staff room: 1:1 and group threads, task-board items |
| `lessons`, `payments` | the admin's ledger (if H2 is accepted) |

Harness-internal state (Mastra threads, memory, workflow snapshots) lives in its own `harness` schema, written by the server with the service role.

## Staff room and agent-to-agent messaging

- **Directory:** every Cathy's public card (id, bio, specialities, current status, portfolio size, not student names). Any Cathy can list it.
- **Messages:** `ask` (expects a reply), `tell`, `handover` (moves a student to another portfolio; needs Chris's approval), `broadcast` to a room.
- **Swarms:** one Cathy coordinates. Others claim items from a room's task board. Each swarm has a hard cap on concurrency, depth and spending.
- **Trust:** a message from another Cathy is information, never an order. Permissions never travel with a message: a Cathy can't see a student's data by asking a Cathy who can. Sharing a worksheet or submission is an explicit grant written to the database.
- **Standards:** shape messages like A2A (agent cards, task states) so the staff room could be opened to outside agents later. Tools stay on MCP where we need it.

## Phases

0. **Spike, about a week, no production data.** Mastra `AgentController` plus Anthropic models, on our laptop and in a Cloudflare Container. Prove five things:
   1. prompt caching works through the AI SDK provider;
   2. a tool can run a Postgres query under a minted `agent_id` token, and RLS blocks another portfolio;
   3. a Mastra Code fork attaches to a remote session;
   4. approvals and whisper (steering signal) work from the TUI;
   5. idle cost is near zero.
   Write the result into this file. If it fails, switch to Think (H1).
1. **Core:** schema and RLS policies, the Cathy persona, one Cathy per portfolio, TUI attach, approvals, a session cost cap.
2. **Staff room:** directory, 1:1 and room messages, handover, a small swarm (for example, "three Cathys draft a worksheet set").
3. **Channels:** WhatsApp to Chris first (approvals, whispers). Then to parents with templates and consent.
4. **Student workspace:** magic-link login, worksheets and submissions, chat with their Cathy, safeguarding controls.
5. **Jobs:** sandboxed coding, worksheet builds to PR to preview URL to approval to deploy.

## Research backlog

| # | Question | Owner | Status |
| --- | --- | --- | --- |
| R1 | Mastra `AgentController` on Workers vs Containers: what breaks, what it costs | harness | open |
| R2 | AI SDK Anthropic provider: prompt caching, mid-conversation system messages (for whisper), effort, refusal fallbacks | harness | open |
| R3 | Supabase + Hyperdrive from Workers and Containers. Minting per-principal JWTs that Supabase RLS accepts. London region. | harness | open |
| R4 | Mastra memory scoping per Cathy and per student (resource and thread ids), and shared staff-room memory | harness | open |
| R5 | Mastra Code: fork or extend; adding an attach-to-remote mode | harness | open |
| R6 | WhatsApp Business: the January 2026 rule on AI providers (fine for a business tutor); messaging minors; the parent-first default | harness | open |
| R7 | Safeguarding and UK GDPR for AI tutoring of under-18s: consent, retention, audit logs, the ICO children's code | both | open |
| R8 | Moving the admin from D1 to Postgres: effort, Astro + Hyperdrive, Access-to-staff-role mapping | admin | proposed |

## Costs (estimates)

| Item | Monthly |
| --- | --- |
| Cloudflare Workers Paid | $5 |
| Harness container (small, always on) | about $5–15 |
| Supabase Pro (if H2) | $25 |
| Sandbox jobs | a few dollars at this scale |
| Model tokens, Chris plus a few Cathys | about $50–150, capped per session |

Tokens dominate. Every session, job and swarm gets a hard spending cap.

## Risks

- **Prompt injection** through student work, WhatsApp or web pages. Mitigations: RLS, short-lived scoped tokens, approvals on anything outbound, egress allow lists in sandboxes.
- **Framework churn:** Mastra's `AgentController` is new. Keep the Cathy persona, tools and policies in our own package so the harness underneath can be swapped.
- **Minors:** no student-facing features until R7 is answered and consent is recorded.
- **Two providers** if H2 is accepted: more accounts and more secrets. Kept small: Cloudflare for edge, hosting and sandboxes; Supabase for data.

## Coordination

Two Claude workstreams run in parallel on this repo:

| Workstream | Plan file | Inbox | Owns |
| --- | --- | --- | --- |
| Admin | `plans/admin-user-account-plan.md` | `plans/inbox/admin.md` | `admin/`, the admin's database schema and migrations |
| Harness | `plans/harness-plan.md` (this file) | `plans/inbox/harness.md` | `harness/` |

Rules:

1. Read the other workstream's plan before changing anything that touches it. Never edit another workstream's plan or folder; write to its inbox instead.
2. Inbox entries are append-only: date and time, from, subject, body, then `status: open`. The receiver changes it to `ack` or `done` with a one-line reply under the entry.
3. Every 15 minutes while working, `git fetch origin plans` and check your inbox and the other plan for changes.
4. Cross-workstream decisions (like H2) are only final once Chris approves. Record them in both plans.
5. Shared contract changes (database schema, auth, domains) are proposed in an inbox first, and done by the owning workstream.

## Open questions for Chris

1. H1: Mastra as the harness, with a one-week spike first?
2. H2: Postgres (Supabase) with real RLS for everything, including moving the admin off D1 before it goes live? Or stay on D1 with application-level checks?
3. How many Cathys to start with, and how are students assigned: by level, exam board, or by hand?
4. Does each Cathy share one persona and voice, or does each develop her own (her own bio and specialities) over time?
5. Whisper visibility: should a Cathy ever tell a student that Chris steered her, or are whispers always silent?

## Sources

- Mastra: [Agent Controller GA](https://mastra.ai/blog/announcing-agent-controller-ga), [harness channels](https://mastra.ai/blog/introducing-harness-channels), [channels docs](https://mastra.ai/docs/channels), [Mastra Code](https://mastra.ai/docs/mastra-code/overview), [Cloudflare deployer](https://mastra.ai/reference/deployer/cloudflare), [D1 storage](https://mastra.ai/reference/storage/cloudflare-d1.md), [Workers channel bug #19254](https://github.com/mastra-ai/mastra/issues/19254)
- Pi: [repo](https://github.com/earendil-works/pi), [Pi comparison](https://luismori.dev/article/pi-dev-minimal-coding-agent-harness-comparison/), [OpenClaw on Pi](https://docs.openclaw.ai/pi.md)
- Cloudflare: [Project Think](https://blog.cloudflare.com/project-think/), [Sandbox SDK](https://developers.cloudflare.com/sandbox/), [Containers pricing](https://developers.cloudflare.com/containers/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- Anthropic: [Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting)
- Letta: [shared memory blocks](https://docs.letta.com/tutorials/shared-memory-blocks)
- WhatsApp: [Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing/), [general-purpose chatbot ban](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/)
