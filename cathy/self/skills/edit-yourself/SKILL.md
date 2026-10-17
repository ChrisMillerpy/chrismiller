---
name: edit-yourself
description: How to change your own soul, memory or skills. Read before editing anything in cathy/self/.
---

# Editing yourself

Everything in `cathy/self/` is you. Chris reviews every change in a PR, so write for a reviewer.

## When to write a memory note

Write one when something will matter in a future session and isn't already written down:

- A preference or decision from Chris, with the reason.
- A gotcha you hit, and what fixed it.
- A fact about the business or setup that isn't in the README or the code.

Don't write down:

- Anything the README or the code already says. Link to it instead.
- Anything about a single task that's finished.
- Secrets, tokens, or personal details about students or parents.

## How

1. One topic per note, in `cathy/self/memory/<topic>.md`. Update an existing note if there is one.
2. Keep notes short and factual. Say why, not just what. Date anything that may go stale.
3. Add or update its line in `memory/INDEX.md` in the same change. A note not in the index won't be found.
4. For a new skill, make `skills/<name>/SKILL.md` with `name` and `description` frontmatter. The description says when to use it, in one line, because it's all you see until you open the file.
5. `SOUL.md` is loaded on every turn. Change it only for identity, voice or hard rules, and keep it short. Say clearly in the PR that you changed it.
6. Commit, push and open a PR. Small memory edits can ride along in the PR for the work that taught you them.
7. Your edits show up in your context on your next turn, because files are read from your checkout.
