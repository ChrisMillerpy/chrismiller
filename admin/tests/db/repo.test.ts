// The queries behind the pages, run as Chris through the worker login, under RLS.

import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withStaff, type Tx } from '../../src/lib/db';
import * as repo from '../../src/lib/repo';
import type { LessonInput, StudentInput } from '../../src/lib/validate';
import { ownerSql, resetData, workerSql } from './env';

const TODAY = '2026-10-10';

let owner: postgres.Sql;
let worker: postgres.Sql;
let chris: number;
let reader: number;

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
  const rows = await owner`
    insert into staff (email, name, permissions) values ('chris@example.com', 'Chris', '{*}'), ('reader@example.com', 'Reader', '{students.read}')
    returning id`;
  chris = Number(rows[0].id);
  reader = Number(rows[1].id);
});

const asChris = <T>(fn: (tx: Tx) => Promise<T>) => withStaff(worker, chris, fn);

function student(over: Partial<StudentInput> = {}): StudentInput {
  return {
    name: 'Ada', level: 'A Level', exam_board: 'OCR', student_email: null, parent_name: 'Anne',
    parent_email: 'anne@example.com', parent_phone: null, rate_pence: 4500, status: 'active', notes: null, ...over,
  };
}

function lesson(student_id: number, over: Partial<LessonInput> = {}): LessonInput {
  return {
    student_id, date: '2026-10-01', time: null, minutes: 60, price_pence: 4500,
    covered: null, homework: null, notes: null, paid_on: null, ...over,
  };
}

describe('students', () => {
  it('creates, reads, updates and deletes', async () => {
    await asChris(async (tx) => {
      const id = await repo.createStudent(tx, student());
      expect(await repo.getStudent(tx, id, TODAY)).toMatchObject({ id, name: 'Ada', rate_pence: 4500, status: 'active', owed_pence: 0 });
      expect(await repo.updateStudent(tx, id, student({ name: 'Ada L', status: 'paused' }))).toBe(true);
      expect(await repo.getStudent(tx, id, TODAY)).toMatchObject({ name: 'Ada L', status: 'paused' });
      expect(await repo.deleteStudent(tx, id)).toBe(true);
      expect(await repo.getStudent(tx, id, TODAY)).toBeNull();
      expect(await repo.updateStudent(tx, id, student())).toBe(false);
    });
  });

  it('lists by status with last lesson and amount owed, ignoring future lessons', async () => {
    await asChris(async (tx) => {
      const ada = await repo.createStudent(tx, student());
      const bo = await repo.createStudent(tx, student({ name: 'Bo', status: 'finished' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-01' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-08', price_pence: 3000 }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-20' })); // upcoming, not owed
      await repo.createLesson(tx, lesson(bo, { date: '2026-09-01', paid_on: '2026-09-02' }));

      const active = await repo.listStudents(tx, 'active', TODAY);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ name: 'Ada', last_lesson: '2026-10-08', owed_pence: 7500 });

      const all = await repo.listStudents(tx, 'all', TODAY);
      expect(all.map((s) => s.name)).toEqual(['Ada', 'Bo']);
      expect(all[1]).toMatchObject({ owed_pence: 0, last_lesson: '2026-09-01' });
    });
  });

  it('gives options for the lesson form, active students first', async () => {
    await asChris(async (tx) => {
      await repo.createStudent(tx, student({ name: 'Zed' }));
      await repo.createStudent(tx, student({ name: 'Al', status: 'finished', rate_pence: 1 }));
      expect((await repo.studentOptions(tx)).map((s) => s.name)).toEqual(['Zed', 'Al']);
    });
  });
});

describe('lessons', () => {
  let ada: number;
  beforeEach(async () => {
    ada = await asChris((tx) => repo.createStudent(tx, student()));
  });

  it('creates, reads, updates and deletes, with dates and times as plain strings', async () => {
    await asChris(async (tx) => {
      const id = await repo.createLesson(tx, lesson(ada, { time: '16:30', covered: 'Vectors' }));
      expect(await repo.getLesson(tx, id)).toMatchObject({
        id, student_id: ada, student_name: 'Ada', date: '2026-10-01', time: '16:30', minutes: 60, price_pence: 4500, covered: 'Vectors', paid_on: null,
      });
      expect(await repo.updateLesson(tx, id, lesson(ada, { date: '2026-10-02', paid_on: '2026-10-03' }))).toBe(true);
      expect(await repo.getLesson(tx, id)).toMatchObject({ date: '2026-10-02', time: null, paid_on: '2026-10-03' });
      expect(await repo.deleteLesson(tx, id)).toBe(true);
      expect(await repo.getLesson(tx, id)).toBeNull();
    });
  });

  it('lists taught (newest first), upcoming (soonest first) and unpaid', async () => {
    await asChris(async (tx) => {
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-01' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-10', paid_on: '2026-10-10' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-30' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-11' }));
      const dates = async (view: repo.LessonView) => (await repo.listLessons(tx, view, TODAY)).map((l) => l.date);
      expect(await dates('taught')).toEqual(['2026-10-10', '2026-10-01']);
      expect(await dates('upcoming')).toEqual(['2026-10-11', '2026-10-30']);
      expect(await dates('unpaid')).toEqual(['2026-10-01']);
    });
  });

  it('marks one lesson paid, once', async () => {
    await asChris(async (tx) => {
      const id = await repo.createLesson(tx, lesson(ada));
      expect(await repo.markPaid(tx, id, TODAY)).toBe(true);
      expect(await repo.markPaid(tx, id, '2026-12-01')).toBe(false);
      expect((await repo.getLesson(tx, id))?.paid_on).toBe(TODAY);
    });
  });

  it('marks all of a student\'s past unpaid lessons paid, leaving upcoming ones', async () => {
    await asChris(async (tx) => {
      const bo = await repo.createStudent(tx, student({ name: 'Bo' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-01' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-05' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-20' }));
      await repo.createLesson(tx, lesson(bo, { date: '2026-10-01' }));
      expect(await repo.markAllPaid(tx, ada, TODAY)).toBe(2);
      expect((await repo.listLessons(tx, 'unpaid', TODAY)).map((l) => l.student_name)).toEqual(['Bo']);
    });
  });

  it('lists a student\'s lessons, newest first', async () => {
    await asChris(async (tx) => {
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-01' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-20' }));
      expect((await repo.lessonsForStudent(tx, ada)).map((l) => l.date)).toEqual(['2026-10-20', '2026-10-01']);
    });
  });
});

describe('overview', () => {
  it('adds up the month, the tax year, what is owed and what has been received', async () => {
    await asChris(async (tx) => {
      const ada = await repo.createStudent(tx, student());
      await repo.createLesson(tx, lesson(ada, { date: '2026-04-05', price_pence: 1000, paid_on: '2026-04-05' })); // last tax year
      await repo.createLesson(tx, lesson(ada, { date: '2026-04-06', price_pence: 2000, paid_on: '2026-04-07' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-09-30', price_pence: 4000 })); // owed
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-02', price_pence: 5000, paid_on: '2026-10-02' }));
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-09', price_pence: 3000 })); // owed
      await repo.createLesson(tx, lesson(ada, { date: '2026-10-25', price_pence: 9900 })); // upcoming

      const o = await repo.overview(tx, TODAY);
      expect(o.taught_month_pence).toBe(8000);
      expect(o.owed_pence).toBe(7000);
      expect(o.taught_tax_year_pence).toBe(14000);
      expect(o.received_tax_year_pence).toBe(7000);
      expect(o.upcoming.map((l) => l.date)).toEqual(['2026-10-25']);
      expect(o.unpaid.map((l) => l.date)).toEqual(['2026-09-30', '2026-10-09']);
    });
  });
});

describe('export', () => {
  it('returns lessons in a date range, oldest first, or everything', async () => {
    await asChris(async (tx) => {
      const ada = await repo.createStudent(tx, student());
      for (const date of ['2026-03-01', '2026-05-01', '2027-05-01']) await repo.createLesson(tx, lesson(ada, { date }));
      expect((await repo.exportLessons(tx, '2026-04-06', '2027-04-05')).map((l) => l.date)).toEqual(['2026-05-01']);
      expect(await repo.exportLessons(tx, null, null)).toHaveLength(3);
      expect(Object.keys((await repo.exportLessons(tx, null, null))[0])).toEqual(repo.EXPORT_COLUMNS);
    });
  });
});

describe('under RLS', () => {
  it('a students.read member sees students but no money', async () => {
    await asChris(async (tx) => {
      const ada = await repo.createStudent(tx, student());
      await repo.createLesson(tx, lesson(ada));
    });
    await withStaff(worker, reader, async (tx) => {
      const [s] = await repo.listStudents(tx, 'all', TODAY);
      expect(s).toMatchObject({ name: 'Ada', owed_pence: 0, last_lesson: null });
      expect(await repo.listLessons(tx, 'taught', TODAY)).toEqual([]);
    });
  });
});
