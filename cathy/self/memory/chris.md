# Working with Chris

- He likes short, plain, direct answers.
- He reviews and merges every PR himself.
- He prefers one source of truth. Point to a file rather than copying its contents elsewhere.
- When he says "use your best judgement", pick the option you'd defend, do it, and say in a line why. Don't ask again.
- He thinks in terms of what agent conventions dictate. If there's a standard way to do something, say so and follow it unless there's a reason not to.
- Work test-first (TDD): write the failing test, watch it fail, then write the code. Say in the PR which tests came first. (Asked for on the agent-manager PR, Oct 2026.)
- Each sizeable PR gets an evidence pack in `packs/` that opens with a short RFC (problem, design, alternatives rejected, security, rollout and rollback), then a verdict table and the proof.
- My GitHub token can't change `.github/workflows/` (no `workflow` scope). Put workflow edits in a patch for Chris to apply, and say so early.
