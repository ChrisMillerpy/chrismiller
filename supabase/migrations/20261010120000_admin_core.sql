-- Admin core: staff, students, lessons and the audit log, locked down with row-level security.
--
-- Callers:
--   admin_worker   the admin Worker's login. No table rights of its own. Per request it switches
--                  to `authenticated` and sets request.jwt.claims for that transaction only.
--   authenticated  anything with claims. Policies decide from the claims what it sees:
--                  {"app_role":"staff","staff_id":N} gets what staff row N's permissions allow.
--                  Any other app_role (for example a future agent) gets nothing from these tables.
--   anon           nothing.
-- Permissions live in staff.permissions and are read from the table on every check, so
-- removing one takes effect immediately. '*' means everything.

-- The worker login. Its password is set by hand, never in a migration (see admin/README.md).
do $$
begin
  if not exists (select from pg_roles where rolname = 'admin_worker') then
    create role admin_worker nologin noinherit;
  end if;
end $$;
grant authenticated to admin_worker;

-- Private helpers. Not in an API-exposed schema.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, admin_worker;

-- Tables ------------------------------------------------------------------------------------

create table public.staff (
  id bigint generated always as identity primary key,
  email text not null unique check (email = lower(email) and length(email) <= 254),
  name text not null check (length(name) between 1 and 200),
  permissions text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.student_status as enum ('active', 'paused', 'finished');

create table public.students (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 200),
  level text check (level in ('GCSE', 'A Level', 'A Level + Further', 'Admissions test', 'Other')),
  exam_board text check (length(exam_board) <= 50),
  student_email text check (length(student_email) <= 254),
  parent_name text check (length(parent_name) <= 200),
  parent_email text check (length(parent_email) <= 254),
  parent_phone text check (length(parent_phone) <= 40),
  rate_pence integer not null default 0 check (rate_pence >= 0),
  status public.student_status not null default 'active',
  notes text check (length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lessons (
  id bigint generated always as identity primary key,
  student_id bigint not null references public.students (id) on delete cascade,
  date date not null,
  time time,
  minutes integer not null default 60 check (minutes between 5 and 600),
  price_pence integer not null check (price_pence >= 0),
  covered text check (length(covered) <= 10000),
  homework text check (length(homework) <= 10000),
  notes text check (length(notes) <= 10000),
  paid_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lessons_student_date on public.lessons (student_id, date desc);
create index lessons_date on public.lessons (date);
create index lessons_unpaid on public.lessons (date) where paid_on is null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  staff_id bigint,
  claims jsonb,
  action text not null,
  table_name text not null,
  row_id bigint,
  changes jsonb
);

create index audit_log_row on public.audit_log (table_name, row_id);

-- Privileges --------------------------------------------------------------------------------
-- Supabase grants everything in `public` to anon and authenticated by default. Undo that, then
-- grant only what the policies below are written for.

revoke all on public.staff, public.students, public.lessons, public.audit_log from anon, authenticated, public;
grant select, insert, update, delete on public.staff, public.students, public.lessons to authenticated;
grant select on public.audit_log to authenticated;

-- Helpers -----------------------------------------------------------------------------------

-- The staff id from the claims, or null if the caller isn't staff.
create function app.claimed_staff_id() returns bigint
language sql stable set search_path = '' as $$
  select case
    when auth.jwt() ->> 'app_role' = 'staff' and (auth.jwt() ->> 'staff_id') ~ '^[0-9]{1,18}$'
    then (auth.jwt() ->> 'staff_id')::bigint
  end
$$;

-- Does the calling staff member hold this permission right now? Reads the staff table directly
-- (security definer), so policies on `staff` itself don't recurse.
create function app.has_permission(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.id = app.claimed_staff_id()
      and s.active
      and ('*' = any (s.permissions) or p = any (s.permissions))
  )
$$;

create function app.is_active_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.id = app.claimed_staff_id() and s.active)
$$;

-- Used by the worker before any claims exist: maps a verified Access email to a staff member.
create function app.staff_for_email(p_email text)
returns table (id bigint, name text, permissions text[])
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.permissions from public.staff s where s.email = lower(p_email) and s.active
$$;

revoke all on function app.claimed_staff_id(), app.has_permission(text), app.is_active_staff(), app.staff_for_email(text) from public;
grant execute on function app.claimed_staff_id(), app.has_permission(text), app.is_active_staff() to authenticated;
grant execute on function app.staff_for_email(text) to admin_worker;

-- Policies ----------------------------------------------------------------------------------

alter table public.staff enable row level security;
alter table public.students enable row level security;
alter table public.lessons enable row level security;
alter table public.audit_log enable row level security;

create policy staff_read on public.staff for select to authenticated
  using ((id = app.claimed_staff_id() and app.is_active_staff()) or app.has_permission('staff.admin'));
create policy staff_insert on public.staff for insert to authenticated
  with check (app.has_permission('staff.admin'));
create policy staff_update on public.staff for update to authenticated
  using (app.has_permission('staff.admin')) with check (app.has_permission('staff.admin'));
create policy staff_delete on public.staff for delete to authenticated
  using (app.has_permission('staff.admin'));

create policy students_read on public.students for select to authenticated
  using (app.has_permission('students.read'));
create policy students_insert on public.students for insert to authenticated
  with check (app.has_permission('students.write'));
create policy students_update on public.students for update to authenticated
  using (app.has_permission('students.write')) with check (app.has_permission('students.write'));
create policy students_delete on public.students for delete to authenticated
  using (app.has_permission('students.write'));

create policy lessons_read on public.lessons for select to authenticated
  using (app.has_permission('finance.read'));
create policy lessons_insert on public.lessons for insert to authenticated
  with check (app.has_permission('finance.write'));
create policy lessons_update on public.lessons for update to authenticated
  using (app.has_permission('finance.write')) with check (app.has_permission('finance.write'));
create policy lessons_delete on public.lessons for delete to authenticated
  using (app.has_permission('finance.write'));

create policy audit_read on public.audit_log for select to authenticated
  using (app.has_permission('audit.read'));

-- Triggers ----------------------------------------------------------------------------------

create function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Writes one audit row per changed row. On update, only the changed columns, as {"col": {"old", "new"}}.
create function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  diff jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('old', old_j -> k, 'new', new_j -> k)), '{}')
      into diff
      from jsonb_object_keys(new_j) k
      where k <> 'updated_at' and (old_j -> k) is distinct from (new_j -> k);
    if diff = '{}' then return new; end if;
  else
    diff := coalesce(new_j, old_j);
  end if;

  insert into public.audit_log (staff_id, claims, action, table_name, row_id, changes)
  values (app.claimed_staff_id(), auth.jwt(), lower(tg_op), tg_table_name, (coalesce(new_j, old_j) ->> 'id')::bigint, diff);
  return coalesce(new, old);
end $$;

revoke all on function app.touch_updated_at(), app.audit() from public;

create trigger touch before update on public.staff for each row execute function app.touch_updated_at();
create trigger touch before update on public.students for each row execute function app.touch_updated_at();
create trigger touch before update on public.lessons for each row execute function app.touch_updated_at();

create trigger audit after insert or update or delete on public.staff for each row execute function app.audit();
create trigger audit after insert or update or delete on public.students for each row execute function app.audit();
create trigger audit after insert or update or delete on public.lessons for each row execute function app.audit();
