import postgres from 'postgres';
import dbSetup from '../db/global-setup';
import { resetData, SERVER_URL, TEST_DB } from '../db/env';

// A fresh test database, then two staff members: Chris with everything, and a reader.
export default async function setup() {
  await dbSetup();
  const u = new URL(SERVER_URL);
  u.pathname = `/${TEST_DB}`;
  const sql = postgres(u.toString(), { max: 1, onnotice: () => {} });
  await resetData(sql);
  await sql`insert into staff (email, name, permissions) values
    ('chris@example.com', 'Chris', '{*}'),
    ('reader@example.com', 'Reader', '{students.read}')`;
  await sql.end();
}
