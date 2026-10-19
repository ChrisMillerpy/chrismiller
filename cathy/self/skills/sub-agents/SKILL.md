---
name: sub-agents
description: Splitting work across sub-agents (other Cathys working in parallel on their own branches), choosing mode and model, and merging their work. Read before using spawn_agent.
---

# Sub-agents

A sub-agent is another Cathy with her own chat, box and branch. Chris can open any of them in admin, talk to them, change their model or stop them. You start them with `spawn_agent`.

## When to split

Split when the parts are independent and each is big enough to be worth a container: separate pages or folders, a build plus a review, a long search next to an edit. Don't split small jobs, tightly linked changes, or anything where the parts keep needing each other's results. One careful Cathy beats a swarm that collides.

## Starting one

`spawn_agent` takes a `task`, a short `title`, and optionally a `mode`, `model` and `effort`.

- **fresh** (default): she starts with only your task. Write it so it stands alone: the goal, the files she owns, how to check it works (which test or command), and what to put in her report.
- **fork**: she starts with a copy of this conversation, so she already knows the background. Use it when the context is long and hard to restate. The task says which part is hers.
- **custom**: you give `instructions`, her role, added after her normal self (for example: "You are a strict reviewer. Read only; do not edit files."). The rules in SOUL.md still apply.

Her branch starts from your current work, including changes you haven't committed.

## Choosing the model

Pick per job from the models Chris offers. Use a cheaper, faster model with lower effort for well-specified work (renames, bulk edits, running tests, summaries). Keep the strongest model for design, tricky debugging and review. If unsure, leave it unset for the default.

## Keeping them apart

Give parallel agents separate files or folders and say so in each task ("you own `blog/`; don't touch `shared/`"). If two agents need the same file, don't run them at once. Sub-agents can't start their own, and you can have 5 working at once.

## Their reports

You don't need to wait or poll. When a sub-agent finishes, her final reply arrives as a "[Report from your sub-agent …]" message and you get a new turn. After starting them, tell Chris what you started (one line each), then end your turn. Use `list_agents` to see who is still working, `message_agent` to correct or extend one, and `stop_agent` if one goes wrong.

## Merging and the PR

Sub-agents push their own branch; they can't open PRs. When the reports are in:

1. `git fetch origin <her branch> && git merge FETCH_HEAD` for each, in your branch.
2. Fix conflicts, run `npm test` and the build.
3. Open one PR yourself with `open_pr`, and say in it what each sub-agent did.

Never merge to `main`. Read each report critically: she may say it works without having proved it, so check the diff and run the tests yourself.

## Rules

- Tell Chris when you start sub-agents and why; he pays for each container.
- Never put student or parent details in a task or instructions. Sub-agents' chats are stored like any other.
- Messages to sub-agents are capped until Chris speaks again. If you hit the cap, report where things stand and wait for him.
