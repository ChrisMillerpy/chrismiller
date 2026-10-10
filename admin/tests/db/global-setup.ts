import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { SERVER_URL, SUPABASE_MODE, TEST_DB, WORKER_PASSWORD } from './env';

const migrationsDir = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
const shim = fileURLToPath(new URL('./supabase-shim.sql', import.meta.url));

// Locally: a fresh database, the Supabase shim, then every migration in order.
// Against Supabase: `supabase db reset` has already applied the migrations.
export default async function setup() {
  const server = postgres(SERVER_URL, { max: 1, onnotice: () => {} });
  try {
    if (!SUPABASE_MODE) {
      await server.unsafe(`drop database if exists ${TEST_DB} with (force)`);
      await server.unsafe(`create database ${TEST_DB}`);
    }
  } finally {
    await server.end();
  }

  const u = new URL(SERVER_URL);
  u.pathname = `/${TEST_DB}`;
  const db = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try {
    if (!SUPABASE_MODE) {
      await db.unsafe(readFileSync(shim, 'utf8'));
      for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
        await db.unsafe(readFileSync(migrationsDir + file, 'utf8'));
      }
    }
    // In production the password is set by hand (see README); never in a migration.
    await db.unsafe(`alter role admin_worker login password '${WORKER_PASSWORD}'`);
  } finally {
    await db.end();
  }
}
