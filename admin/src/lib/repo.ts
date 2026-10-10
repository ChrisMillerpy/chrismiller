// The queries behind the pages. Every function takes a transaction that already runs under a
// staff member's claims (see db.ts), so RLS decides what each one can see or change.
// Dates come back as 'YYYY-MM-DD' strings, times as 'HH:MM', money as integer pence.

import type { Tx } from './db';
import type { LessonInput, StudentInput } from './validate';
import { monthRange, taxYearOf, taxYearRange } from './taxyear';

export type StudentFilter = 'active' | 'paused' | 'finished' | 'all';
export type LessonView = 'taught' | 'upcoming' | 'unpaid';

export interface StudentRow extends StudentInput {
  id: number;
}

export interface StudentListRow {
  id: number;
  name: string;
  level: string | null;
  parent_name: string | null;
  status: string;
  last_lesson: string | null;
  owed_pence: number;
}

export interface LessonRow {
  id: number;
  student_id: number;
  student_name: string;
  date: string;
  time: string | null;
  minutes: number;
  price_pence: number;
  covered: string | null;
  homework: string | null;
  notes: string | null;
  paid_on: string | null;
}

const STUDENT_COLS = (tx: Tx) => tx`
  s.id::int, s.name, s.level, s.exam_board, s.student_email, s.parent_name, s.parent_email,
  s.parent_phone, s.rate_pence, s.status::text, s.notes`;

const LESSON_COLS = (tx: Tx) => tx`
  l.id::int, l.student_id::int, s.name as student_name, l.date::text, to_char(l.time, 'HH24:MI') as time,
  l.minutes, l.price_pence, l.covered, l.homework, l.notes, l.paid_on::text`;

// Students -----------------------------------------------------------------------------------

export async function listStudents(tx: Tx, filter: StudentFilter, today: string): Promise<StudentListRow[]> {
  return tx<StudentListRow[]>`
    select s.id::int, s.name, s.level, s.parent_name, s.status::text,
           max(l.date) filter (where l.date <= ${today})::text as last_lesson,
           coalesce(sum(l.price_pence) filter (where l.paid_on is null and l.date <= ${today}), 0)::int as owed_pence
    from students s left join lessons l on l.student_id = s.id
    where ${filter === 'all' ? tx`true` : tx`s.status = ${filter}::student_status`}
    group by s.id
    order by lower(s.name), s.id`;
}

export async function getStudent(tx: Tx, id: number, today: string) {
  const [row] = await tx<(StudentRow & { owed_pence: number; paid_pence: number; lesson_count: number })[]>`
    select ${STUDENT_COLS(tx)},
           coalesce(sum(l.price_pence) filter (where l.paid_on is null and l.date <= ${today}), 0)::int as owed_pence,
           coalesce(sum(l.price_pence) filter (where l.paid_on is not null), 0)::int as paid_pence,
           count(l.id) filter (where l.date <= ${today})::int as lesson_count
    from students s left join lessons l on l.student_id = s.id
    where s.id = ${id}
    group by s.id`;
  return row ?? null;
}

export async function studentOptions(tx: Tx) {
  return tx<{ id: number; name: string; rate_pence: number; status: string }[]>`
    select id::int, name, rate_pence, status::text from students
    order by status = 'active' desc, lower(name), id`;
}

export async function createStudent(tx: Tx, s: StudentInput): Promise<number> {
  const [row] = await tx`insert into students ${tx(s as never)} returning id::int`;
  return row.id;
}

export async function updateStudent(tx: Tx, id: number, s: StudentInput): Promise<boolean> {
  const rows = await tx`update students set ${tx(s as never)} where id = ${id} returning id`;
  return rows.length === 1;
}

export async function deleteStudent(tx: Tx, id: number): Promise<boolean> {
  const rows = await tx`delete from students where id = ${id} returning id`;
  return rows.length === 1;
}

// Lessons ------------------------------------------------------------------------------------

export async function listLessons(tx: Tx, view: LessonView, today: string, limit = 500): Promise<LessonRow[]> {
  const where = {
    taught: tx`l.date <= ${today}`,
    upcoming: tx`l.date > ${today}`,
    unpaid: tx`l.paid_on is null and l.date <= ${today}`,
  }[view];
  const order = view === 'taught' ? tx`l.date desc, l.time desc nulls last, l.id desc` : tx`l.date, l.time nulls last, l.id`;
  return tx<LessonRow[]>`
    select ${LESSON_COLS(tx)} from lessons l join students s on s.id = l.student_id
    where ${where} order by ${order} limit ${limit}`;
}

export async function lessonsForStudent(tx: Tx, studentId: number): Promise<LessonRow[]> {
  return tx<LessonRow[]>`
    select ${LESSON_COLS(tx)} from lessons l join students s on s.id = l.student_id
    where l.student_id = ${studentId} order by l.date desc, l.time desc nulls last, l.id desc`;
}

export async function getLesson(tx: Tx, id: number): Promise<LessonRow | null> {
  const [row] = await tx<LessonRow[]>`
    select ${LESSON_COLS(tx)} from lessons l join students s on s.id = l.student_id where l.id = ${id}`;
  return row ?? null;
}

export async function createLesson(tx: Tx, l: LessonInput): Promise<number> {
  const [row] = await tx`insert into lessons ${tx(l as never)} returning id::int`;
  return row.id;
}

export async function updateLesson(tx: Tx, id: number, l: LessonInput): Promise<boolean> {
  const rows = await tx`update lessons set ${tx(l as never)} where id = ${id} returning id`;
  return rows.length === 1;
}

export async function deleteLesson(tx: Tx, id: number): Promise<boolean> {
  const rows = await tx`delete from lessons where id = ${id} returning id`;
  return rows.length === 1;
}

/** Marks an unpaid lesson paid. False if it doesn't exist or was already paid. */
export async function markPaid(tx: Tx, id: number, paidOn: string): Promise<boolean> {
  const rows = await tx`update lessons set paid_on = ${paidOn} where id = ${id} and paid_on is null returning id`;
  return rows.length === 1;
}

/** Marks every past unpaid lesson for a student paid on `today`. Upcoming lessons are left alone. */
export async function markAllPaid(tx: Tx, studentId: number, today: string): Promise<number> {
  const rows = await tx`
    update lessons set paid_on = ${today}
    where student_id = ${studentId} and paid_on is null and date <= ${today} returning id`;
  return rows.length;
}

// Overview -----------------------------------------------------------------------------------

export async function overview(tx: Tx, today: string) {
  const month = monthRange(today);
  const year = taxYearRange(taxYearOf(today));
  const [totals] = await tx`
    select
      coalesce(sum(price_pence) filter (where date between ${month.from} and ${today}), 0)::int as taught_month_pence,
      coalesce(sum(price_pence) filter (where date between ${year.from} and ${today}), 0)::int as taught_tax_year_pence,
      coalesce(sum(price_pence) filter (where paid_on between ${year.from} and ${year.to}), 0)::int as received_tax_year_pence,
      coalesce(sum(price_pence) filter (where paid_on is null and date <= ${today}), 0)::int as owed_pence
    from lessons`;
  return {
    taught_month_pence: totals.taught_month_pence as number,
    taught_tax_year_pence: totals.taught_tax_year_pence as number,
    received_tax_year_pence: totals.received_tax_year_pence as number,
    owed_pence: totals.owed_pence as number,
    upcoming: await listLessons(tx, 'upcoming', today, 10),
    unpaid: await listLessons(tx, 'unpaid', today, 100),
  };
}

// Export -------------------------------------------------------------------------------------

export const EXPORT_COLUMNS = [
  'date', 'time', 'student', 'level', 'minutes', 'price', 'paid_on', 'covered', 'homework',
];

export async function exportLessons(tx: Tx, from: string | null, to: string | null) {
  return tx`
    select l.date::text as date, to_char(l.time, 'HH24:MI') as time, s.name as student, s.level,
           l.minutes, to_char(l.price_pence / 100.0, 'FM999999990.00') as price, l.paid_on::text as paid_on,
           l.covered, l.homework
    from lessons l join students s on s.id = l.student_id
    where (${from}::date is null or l.date >= ${from}::date) and (${to}::date is null or l.date <= ${to}::date)
    order by l.date, l.time nulls last, l.id`;
}
