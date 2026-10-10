// The queries behind the pages, on D1. Every value is bound; the only text spliced into SQL is
// the constant fragments below. Dates are 'YYYY-MM-DD' strings, times 'HH:MM', money integer pence.

import { penceToInput } from './money';
import type { LessonInput, StudentInput } from './validate';
import { monthRange, taxYearOf, taxYearRange } from './taxyear';

export type StudentFilter = 'active' | 'paused' | 'finished' | 'all';
export type LessonView = 'taught' | 'upcoming' | 'unpaid';

export interface StudentRow extends StudentInput {
  id: number;
}

export interface StudentListRow {
  id: number; name: string; level: string | null; parent_name: string | null; status: string;
  last_lesson: string | null; owed_pence: number;
}

export interface LessonRow {
  id: number; student_id: number; student_name: string; date: string; time: string | null; minutes: number;
  price_pence: number; covered: string | null; homework: string | null; notes: string | null; paid_on: string | null;
}

const STUDENT_COLS = `s.id, s.name, s.level, s.exam_board, s.student_email, s.parent_name, s.parent_email,
  s.parent_phone, s.rate_pence, s.status, s.notes`;

const LESSON_SELECT = `select l.id, l.student_id, s.name as student_name, l.date, l.time, l.minutes, l.price_pence,
  l.covered, l.homework, l.notes, l.paid_on from lessons l join students s on s.id = l.student_id`;

const now = () => new Date().toISOString();

export async function listStudents(db: D1Database, filter: StudentFilter, today: string): Promise<StudentListRow[]> {
  const { results } = await db.prepare(`
    select s.id, s.name, s.level, s.parent_name, s.status,
           max(l.date) filter (where l.date <= ?1) as last_lesson,
           coalesce(sum(l.price_pence) filter (where l.paid_on is null and l.date <= ?1), 0) as owed_pence
    from students s left join lessons l on l.student_id = s.id
    where ?2 = 'all' or s.status = ?2
    group by s.id
    order by lower(s.name), s.id`).bind(today, filter).all<StudentListRow>();
  return results;
}

export async function getStudent(db: D1Database, id: number, today: string) {
  return db.prepare(`
    select ${STUDENT_COLS},
           coalesce(sum(l.price_pence) filter (where l.paid_on is null and l.date <= ?2), 0) as owed_pence,
           coalesce(sum(l.price_pence) filter (where l.paid_on is not null), 0) as paid_pence,
           count(l.id) filter (where l.date <= ?2) as lesson_count
    from students s left join lessons l on l.student_id = s.id
    where s.id = ?1
    group by s.id`).bind(id, today).first<StudentRow & { owed_pence: number; paid_pence: number; lesson_count: number }>();
}

export async function studentOptions(db: D1Database) {
  const { results } = await db.prepare(`
    select id, name, rate_pence, status from students
    order by status = 'active' desc, lower(name), id`).all<{ id: number; name: string; rate_pence: number; status: string }>();
  return results;
}

const studentValues = (s: StudentInput) => [
  s.name, s.level, s.exam_board, s.student_email, s.parent_name, s.parent_email, s.parent_phone, s.rate_pence, s.status, s.notes,
];

export async function createStudent(db: D1Database, s: StudentInput): Promise<number> {
  const { meta } = await db.prepare(`
    insert into students (name, level, exam_board, student_email, parent_name, parent_email, parent_phone, rate_pence, status, notes)
    values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(...studentValues(s)).run();
  return meta.last_row_id;
}

export async function updateStudent(db: D1Database, id: number, s: StudentInput): Promise<boolean> {
  const { meta } = await db.prepare(`
    update students set name = ?1, level = ?2, exam_board = ?3, student_email = ?4, parent_name = ?5, parent_email = ?6,
      parent_phone = ?7, rate_pence = ?8, status = ?9, notes = ?10, updated_at = ?11
    where id = ?12`).bind(...studentValues(s), now(), id).run();
  return meta.changes === 1;
}

/** Deletes the student and, through the foreign key, all their lessons. */
export async function deleteStudent(db: D1Database, id: number): Promise<boolean> {
  const { meta } = await db.prepare('delete from students where id = ?1').bind(id).run();
  return meta.changes === 1;
}

const LESSON_VIEWS: Record<LessonView, string> = {
  taught: 'l.date <= ?1 order by l.date desc, l.time desc nulls last, l.id desc',
  upcoming: 'l.date > ?1 order by l.date, l.time nulls last, l.id',
  unpaid: 'l.paid_on is null and l.date <= ?1 order by l.date, l.time nulls last, l.id',
};

export async function listLessons(db: D1Database, view: LessonView, today: string, limit = 500): Promise<LessonRow[]> {
  const { results } = await db.prepare(`${LESSON_SELECT} where ${LESSON_VIEWS[view]} limit ?2`).bind(today, limit).all<LessonRow>();
  return results;
}

export async function lessonsForStudent(db: D1Database, studentId: number): Promise<LessonRow[]> {
  const { results } = await db.prepare(`${LESSON_SELECT} where l.student_id = ?1
    order by l.date desc, l.time desc nulls last, l.id desc`).bind(studentId).all<LessonRow>();
  return results;
}

export async function getLesson(db: D1Database, id: number): Promise<LessonRow | null> {
  return db.prepare(`${LESSON_SELECT} where l.id = ?1`).bind(id).first<LessonRow>();
}

const lessonValues = (l: LessonInput) => [
  l.student_id, l.date, l.time, l.minutes, l.price_pence, l.covered, l.homework, l.notes, l.paid_on,
];

export async function createLesson(db: D1Database, l: LessonInput): Promise<number> {
  const { meta } = await db.prepare(`
    insert into lessons (student_id, date, time, minutes, price_pence, covered, homework, notes, paid_on)
    values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`).bind(...lessonValues(l)).run();
  return meta.last_row_id;
}

export async function updateLesson(db: D1Database, id: number, l: LessonInput): Promise<boolean> {
  const { meta } = await db.prepare(`
    update lessons set student_id = ?1, date = ?2, time = ?3, minutes = ?4, price_pence = ?5, covered = ?6,
      homework = ?7, notes = ?8, paid_on = ?9, updated_at = ?10
    where id = ?11`).bind(...lessonValues(l), now(), id).run();
  return meta.changes === 1;
}

export async function deleteLesson(db: D1Database, id: number): Promise<boolean> {
  const { meta } = await db.prepare('delete from lessons where id = ?1').bind(id).run();
  return meta.changes === 1;
}

/** Marks an unpaid lesson paid. False if it doesn't exist or was already paid. */
export async function markPaid(db: D1Database, id: number, paidOn: string): Promise<boolean> {
  const { meta } = await db.prepare('update lessons set paid_on = ?2, updated_at = ?3 where id = ?1 and paid_on is null')
    .bind(id, paidOn, now()).run();
  return meta.changes === 1;
}

/** Marks every past unpaid lesson for a student paid on `today`. Upcoming lessons are left alone. */
export async function markAllPaid(db: D1Database, studentId: number, today: string): Promise<number> {
  const { meta } = await db.prepare(`
    update lessons set paid_on = ?2, updated_at = ?3
    where student_id = ?1 and paid_on is null and date <= ?2`).bind(studentId, today, now()).run();
  return meta.changes;
}

type Totals = Record<'taught_month_pence' | 'taught_tax_year_pence' | 'received_tax_year_pence' | 'owed_pence', number>;

export async function overview(db: D1Database, today: string) {
  const month = monthRange(today);
  const year = taxYearRange(taxYearOf(today));
  const [totals, upcoming, unpaid] = await Promise.all([
    db.prepare(`
      select
        coalesce(sum(price_pence) filter (where date between ?1 and ?2), 0) as taught_month_pence,
        coalesce(sum(price_pence) filter (where date between ?3 and ?2), 0) as taught_tax_year_pence,
        coalesce(sum(price_pence) filter (where paid_on between ?3 and ?4), 0) as received_tax_year_pence,
        coalesce(sum(price_pence) filter (where paid_on is null and date <= ?2), 0) as owed_pence
      from lessons`).bind(month.from, today, year.from, year.to).first<Totals>(),
    listLessons(db, 'upcoming', today, 10),
    listLessons(db, 'unpaid', today, 100),
  ]);
  // An aggregate with no group by always returns exactly one row.
  return { ...totals!, upcoming, unpaid };
}

export const EXPORT_COLUMNS = [
  'date', 'time', 'student', 'level', 'minutes', 'price', 'paid_on', 'covered', 'homework',
] as const;

export async function exportLessons(db: D1Database, from: string | null, to: string | null) {
  const { results } = await db.prepare(`
    select l.date, l.time, s.name as student, s.level, l.minutes, l.price_pence, l.paid_on, l.covered, l.homework
    from lessons l join students s on s.id = l.student_id
    where (?1 is null or l.date >= ?1) and (?2 is null or l.date <= ?2)
    order by l.date, l.time nulls last, l.id`).bind(from, to)
    .all<Omit<Record<(typeof EXPORT_COLUMNS)[number], string | number | null>, 'price'> & { price_pence: number }>();
  return results.map(({ price_pence, ...r }) => ({ ...r, price: penceToInput(price_pence) }));
}
