// Row-level security, tested as each kind of caller. These are the real access rules:
// the app's own permission checks only decide what to show.

import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lookupStaff, withClaims, withStaff } from '../../src/lib/db';
import { ownerSql, resetData, workerSql } from './env';

let owner: postgres.Sql;
let worker: postgres.Sql;
const ids: Record<string, number> = {};

beforeAll(() => {
  owner = ownerSql();
  worker = workerSql();
});
afterAll(async () => {
  await owner.end();
  await worker.end();
});

beforeEach(async () => {
  await resetData(owner);
  const staff = await owner`
    insert into staff (email, name, permissions, active) values
      ('chris@example.com', 'Chris', '{*}', true),
      ('reader@example.com', 'Reader', '{students.read}', true),
      ('books@example.com', 'Bookkeeper', '{finance.read}', true),
      ('nobody@example.com', 'Nobody', '{}', true),
      ('gone@example.com', 'Gone', '{*}', false)
    returning id, email`;
  for (const s of staff) ids[s.email.split('@')[0]] = Number(s.id);
  const [student] = await owner`insert into students (name, rate_pence) values ('Ada', 4500) returning id`;
  ids.student = Number(student.id);
  await owner`insert into lessons (student_id, date, price_pence) values (${ids.student}, '2026-10-01', 4500)`;
});

const count = (rows: readonly unknown[]) => rows.length;

describe('the worker login itself', () => {
  it('has no table rights before switching role', async () => {
    await expect(worker`select * from students`).rejects.toThrow(/permission denied/);
  });

  it('cannot switch to a privileged role', async () => {
    for (const role of ['service_role', 'postgres']) {
      await expect(worker.begin((tx) => tx.unsafe(`set local role ${role}`))).rejects.toThrow();
    }
  });

  it('cannot read the audit log or staff directly', async () => {
    await expect(worker`select * from audit_log`).rejects.toThrow(/permission denied/);
    await expect(worker`select * from staff`).rejects.toThrow(/permission denied/);
  });
});

describe('anon', () => {
  it('cannot touch any table', async () => {
    for (const table of ['staff', 'students', 'lessons', 'audit_log']) {
      await expect(owner.begin(async (tx) => {
        await tx`set local role anon`;
        return tx.unsafe(`select * from ${table}`);
      })).rejects.toThrow(/permission denied/);
    }
  });
});

describe('lookupStaff', () => {
  it('finds active staff by email, ignoring case', async () => {
    expect(await lookupStaff(worker, 'CHRIS@example.com')).toEqual({ id: ids.chris, name: 'Chris', permissions: ['*'] });
  });
  it('does not find inactive or unknown staff', async () => {
    expect(await lookupStaff(worker, 'gone@example.com')).toBeNull();
    expect(await lookupStaff(worker, 'who@example.com')).toBeNull();
  });
});

describe('Chris (*)', () => {
  it('reads everything', async () => {
    await withStaff(worker, ids.chris, async (tx) => {
      expect(count(await tx`select * from students`)).toBe(1);
      expect(count(await tx`select * from lessons`)).toBe(1);
      expect(count(await tx`select * from staff`)).toBe(5);
    });
  });

  it('writes students and lessons, and deleting a student deletes their lessons', async () => {
    await withStaff(worker, ids.chris, async (tx) => {
      const [s] = await tx`insert into students (name, rate_pence) values ('Bo', 4000) returning id`;
      await tx`insert into lessons (student_id, date, price_pence) values (${s.id}, '2026-10-02', 4000)`;
      await tx`update students set notes = 'x' where id = ${s.id}`;
      await tx`delete from students where id = ${s.id}`;
      expect(count(await tx`select * from lessons where student_id = ${s.id}`)).toBe(0);
    });
  });
});

describe('limited staff', () => {
  it('students.read can read students but not write them or see lessons', async () => {
    await withStaff(worker, ids.reader, async (tx) => {
      expect(count(await tx`select * from students`)).toBe(1);
      expect(count(await tx`select * from lessons`)).toBe(0);
      expect(count(await tx`update students set notes = 'x' returning id`)).toBe(0);
    });
    await expect(withStaff(worker, ids.reader, (tx) => tx`insert into students (name, rate_pence) values ('Bo', 1)`))
      .rejects.toThrow(/row-level security/);
  });

  it('finance.read can read lessons but not change them', async () => {
    await withStaff(worker, ids.books, async (tx) => {
      expect(count(await tx`select * from lessons`)).toBe(1);
      expect(count(await tx`update lessons set paid_on = '2026-10-05' returning id`)).toBe(0);
      expect(count(await tx`delete from lessons returning id`)).toBe(0);
    });
  });

  it('staff with no permissions see only their own staff row', async () => {
    await withStaff(worker, ids.nobody, async (tx) => {
      expect(count(await tx`select * from students`)).toBe(0);
      expect(count(await tx`select * from lessons`)).toBe(0);
      expect((await tx`select email from staff`).map((r) => r.email)).toEqual(['nobody@example.com']);
    });
  });

  it('cannot grant themselves permissions', async () => {
    await withStaff(worker, ids.nobody, async (tx) => {
      expect(count(await tx`update staff set permissions = '{*}' where id = ${ids.nobody} returning id`)).toBe(0);
    });
    const [row] = await owner`select permissions from staff where id = ${ids.nobody}`;
    expect(row.permissions).toEqual([]);
  });

  it('inactive staff get nothing, even with *', async () => {
    await withStaff(worker, ids.gone, async (tx) => {
      expect(count(await tx`select * from students`)).toBe(0);
    });
  });
});

describe('claims that are not a staff member', () => {
  it.each([
    ['no claims', {}],
    ['an agent', { role: 'authenticated', app_role: 'agent', agent_id: 1 }],
    ["Chris's staff_id without app_role", { role: 'authenticated', get staff_id() { return ids.chris; } }],
    ['a non-numeric staff_id', { role: 'authenticated', app_role: 'staff', staff_id: '1 or true' }],
  ])('%s sees nothing', async (_, claims) => {
    await withClaims(worker, { ...claims }, async (tx) => {
      expect(count(await tx`select * from students`)).toBe(0);
      expect(count(await tx`select * from lessons`)).toBe(0);
      expect(count(await tx`select * from staff`)).toBe(0);
    });
  });
});

describe('audit log', () => {
  it('records who changed what, through a trigger', async () => {
    const bo = await withStaff(worker, ids.chris, async (tx) => {
      const [s] = await tx`insert into students (name, rate_pence) values ('Bo', 4000) returning id`;
      await tx`update students set rate_pence = 4200 where id = ${s.id}`;
      await tx`update students set rate_pence = 4200 where id = ${s.id}`; // no change, no row
      await tx`delete from students where id = ${s.id}`;
      return s.id;
    });
    const rows = await owner`select staff_id, action, table_name, changes from audit_log where table_name = 'students' and row_id = ${bo} order by id`;
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update', 'delete']);
    expect(rows.every((r) => Number(r.staff_id) === ids.chris)).toBe(true);
    expect(rows[1].changes).toMatchObject({ rate_pence: { old: 4000, new: 4200 } });
  });

  it('is readable by * but cannot be changed by anyone through the worker', async () => {
    await withStaff(worker, ids.chris, async (tx) => {
      await tx`update students set notes = 'n'`;
      expect(count(await tx`select * from audit_log`)).toBeGreaterThan(0);
    });
    await expect(withStaff(worker, ids.chris, (tx) => tx`delete from audit_log`)).rejects.toThrow(/permission denied/);
    await expect(withStaff(worker, ids.chris, (tx) => tx`update audit_log set action = 'x'`)).rejects.toThrow(/permission denied/);
    await expect(withStaff(worker, ids.chris, (tx) => tx`insert into audit_log (action, table_name) values ('x', 'y')`))
      .rejects.toThrow(/permission denied/);
  });

  it('is hidden from staff without audit.read', async () => {
    await withStaff(worker, ids.reader, async (tx) => {
      expect(count(await tx`select * from audit_log`)).toBe(0);
    });
  });
});

describe('claims do not leak between transactions', () => {
  it('a later transaction on the same connection starts with no claims', async () => {
    const single = workerSql();
    try {
      await withStaff(single, ids.chris, (tx) => tx`select 1`);
      await expect(single`select * from students`).rejects.toThrow(/permission denied/);
      const [r] = await single`select current_setting('request.jwt.claims', true) as c`;
      expect(r.c ?? '').toBe('');
    } finally {
      await single.end();
    }
  });
});
