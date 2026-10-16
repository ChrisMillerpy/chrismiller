import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Registry } from './registry.ts';

const SCHEMA = readFileSync(new URL('../../../d1/migrations/0001_sessions.sql', import.meta.url), 'utf8');

// Just enough of the D1 API, backed by an in-memory SQLite database.
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => ((args = a), stmt),
      all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
      first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
      run: async () => (db.prepare(sql).run(...(args as any[])), { success: true }),
    };
    return stmt;
  };
  return { prepare, exec: async (sql: string) => db.exec(sql) } as any;
}

test('create makes an active session with a cathy/<id> branch', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const s = await reg.create('Fix the blog header', 1000);
  assert.match(s.id, /^[a-z0-9]{6}$/);
  assert.equal(s.branch, `cathy/${s.id}`);
  assert.deepEqual(await reg.get(s.id), { ...s });
});

test('list shows active sessions, most recently used first', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const a = await reg.create('a', 1000);
  const b = await reg.create('b', 2000);
  await reg.touch(a.id, 'latest message', 3000);
  const list = await reg.list();
  assert.deepEqual(list.map((s) => s.id), [a.id, b.id]);
  assert.equal(list[0].last_message, 'latest message');
});

test('archived sessions leave the list', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const a = await reg.create('a', 1000);
  await reg.archive(a.id);
  assert.deepEqual(await reg.list(), []);
});

test('touch trims long previews and sets a title on untitled chats', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const a = await reg.create('', 1000);
  await reg.touch(a.id, 'x'.repeat(500), 2000);
  const s = (await reg.get(a.id))!;
  assert.ok(s.last_message!.length <= 140);
  assert.ok(s.title.length > 0 && s.title.length <= 60);
});

test('the schema is applied once, even with many calls', async () => {
  const d1 = fakeD1();
  let execs = 0;
  const exec = d1.exec;
  d1.exec = async (sql: string) => (execs++, exec(sql));
  const reg = new Registry(d1, SCHEMA);
  await Promise.all([reg.list(), reg.list(), reg.create('x', 1)]);
  assert.equal(execs, 1);
});
