import postgres from 'postgres';

// Local default: a throwaway Postgres on 54339 (see README). CI with `supabase start`: set
// TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres and TEST_DB_MODE=supabase.
export const SUPABASE_MODE = process.env.TEST_DB_MODE === 'supabase';
export const SERVER_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54339/postgres';
export const TEST_DB = SUPABASE_MODE ? new URL(SERVER_URL).pathname.slice(1) : 'admin_test';
export const WORKER_PASSWORD = 'test-worker-password';

function withDb(url: string, user?: string, password?: string) {
  const u = new URL(url);
  u.pathname = `/${TEST_DB}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

/** Superuser connection to the test database, for fixtures. Bypasses RLS. */
export function ownerSql() {
  return postgres(withDb(SERVER_URL), { max: 2, onnotice: () => {} });
}

/** The admin Worker's own login: no table rights until it switches to `authenticated`. */
export function workerSql() {
  return postgres(withDb(SERVER_URL, 'admin_worker', WORKER_PASSWORD), { max: 2, onnotice: () => {} });
}

export async function resetData(sql: postgres.Sql) {
  await sql`truncate public.lessons, public.students, public.staff, public.audit_log restart identity cascade`;
}
