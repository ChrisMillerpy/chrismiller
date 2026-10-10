# Inbox: harness

Append-only. Each entry: date and time, from, subject, body, then `status: open`. The harness workstream changes the status to `ack` or `done` and adds a one-line reply under the entry.

---

## 2026-10-10 · from: admin · subject: admin goes first; shared foundations; housekeeping

Chris has decided the order: **the admin is built first, on its own, and the harness comes after.** Nothing here needs an answer before you start. These are waiting for you when you do.

**What the admin is setting up that you'll build on**

- **Database:** Supabase Postgres in London, one prod project and one staging project, in a new withchris org (pending Chris's OK). This is your H2, adopted by the admin. D1 will be deleted. **Built:** `supabase/migrations/20261010120000_admin_core.sql`.
- **Migrations:** one history in `supabase/migrations/`. The admin owns `staff`, `students`, `lessons`, `audit_log`. You own the `harness` schema and the agent, worksheet, assignment, submission, conversation and staff-room tables.
- **Claims:** RLS reads `auth.jwt()`. The admin sets `request.jwt.claims` per transaction as `{"role":"authenticated","app_role":"staff","staff_id":N}` through Hyperdrive, with no service role and no signing secret. `role` must stay the Postgres role, because Supabase's API switches to it, so ours is `app_role`. Permissions are read from `staff` by `app.has_permission()`, not from the claims. For Cathys, please mint `{"role":"authenticated","app_role":"agent","agent_id":N}`. The admin's policies already refuse it, and `admin/tests/db/rls.test.ts` checks that.
- **Infra:** Terraform/OpenTofu in `infra/`, owned by the admin for now. See `plans/infra-plan.md`. The layout leaves room for `modules/harness/`.

**Questions for when you start**

1. Columns you want on `students` (your draft has `phone_e164`, `consent_ai`, `consent_whatsapp`, `login_email`) and the `guardians` / `student_guardians` design. Propose them in `plans/inbox/admin.md`; the admin writes the migration.
2. Which infra you need (`harness.withchris.uk`, an Access app with a service token for the TUI, R2 buckets, Container settings, Hyperdrive), and for which environment. Spike resources go in staging only.
3. Does R3 (Cathy JWTs that Supabase accepts) fit the per-transaction claims approach above, or do you need signed tokens via the Data API? If signed, we need to agree on the Supabase JWT signing-key setup in `infra/`.

**Housekeeping in your files (yours to change, not ours)**

4. `harness-plan.md` sits at the repo root but calls itself `plans/harness-plan.md`. Its link to `admin-user-account-plan.md` is broken from the root. Suggest moving it to `plans/`.
5. Rule 3 says `git fetch origin plans`. The `plans` branch is stale (last commit 8df3f50), and all work merges through `main`. Also, a local branch literally named `origin/plans` makes `origin/plans` ambiguous. Suggest syncing through `main`.
6. Your plan says Workers Paid; the old admin plan said free. Resolved: the admin plan now moves to Workers Paid with you (pending Chris's OK).
7. `plan.md` ("hello") and `plans/adminuseraccount` ("hello adminuseraccount") are leftovers. OK to delete?

status: open
