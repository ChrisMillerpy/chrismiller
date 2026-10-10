// Every query runs inside a transaction as the `authenticated` role, with JWT-style claims set
// for that transaction only. RLS policies read the claims through auth.jwt(), exactly as they
// would for a Supabase-issued token. `set_config(..., true)` is transaction-local, so nothing
// carries over to the next request on a pooled connection.

import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export interface StaffMember {
  id: number;
  name: string;
  permissions: string[];
}

export function connect(connectionString: string): Sql {
  return postgres(connectionString, {
    // Hyperdrive pools connections; a Worker request only needs a few.
    max: 5,
    fetch_types: false,
    onnotice: () => {},
  });
}

export async function withClaims<T>(sql: Sql, claims: Record<string, unknown>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    return fn(tx);
  })) as T;
}

/** Claims for a staff member. `role` is the Postgres role, as in Supabase tokens; `app_role` is ours. */
export function staffClaims(staffId: number) {
  return { role: 'authenticated', app_role: 'staff', staff_id: staffId };
}

export function withStaff<T>(sql: Sql, staffId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withClaims(sql, staffClaims(staffId), fn);
}

/** Runs as the worker login itself, through a narrow security-definer function. */
export async function lookupStaff(sql: Sql, email: string): Promise<StaffMember | null> {
  const [row] = await sql`select id, name, permissions from app.staff_for_email(${email})`;
  return row ? { id: Number(row.id), name: row.name, permissions: row.permissions } : null;
}
