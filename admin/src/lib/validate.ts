// Form parsing. Each parser returns either clean values ready for the database,
// or per-field errors plus the raw values so the form can be shown again.

import { parsePounds } from './money';

export const LEVELS = ['GCSE', 'A Level', 'A Level + Further', 'Admissions test', 'Other'] as const;
export const STATUSES = ['active', 'paused', 'finished'] as const;

export type Level = (typeof LEVELS)[number];
export type Status = (typeof STATUSES)[number];

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string>; values: Record<string, string> };

export interface StudentInput {
  name: string;
  level: Level | null;
  exam_board: string | null;
  student_email: string | null;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  rate_pence: number;
  status: Status;
  notes: string | null;
}

export interface LessonInput {
  student_id: number;
  date: string;
  time: string | null;
  minutes: number;
  price_pence: number;
  covered: string | null;
  homework: string | null;
  notes: string | null;
  paid_on: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

class Reader {
  errors: Record<string, string> = {};
  values: Record<string, string> = {};

  constructor(form: FormData) {
    for (const [k, v] of form.entries()) if (typeof v === 'string') this.values[k] = v;
  }

  raw(field: string): string {
    return (this.values[field] ?? '').trim();
  }

  text(field: string, max: number, required = false): string | null {
    const v = this.raw(field);
    if (!v) {
      if (required) this.errors[field] = 'Required.';
      return null;
    }
    if (v.length > max) this.errors[field] = `At most ${max} characters.`;
    return v;
  }

  email(field: string): string | null {
    const v = this.raw(field).toLowerCase();
    if (!v) return null;
    if (v.length > 254 || !EMAIL.test(v)) this.errors[field] = 'Not a valid email address.';
    return v;
  }

  oneOf<T extends string>(field: string, options: readonly T[], fallback: T | null): T | null {
    const v = this.raw(field);
    if (!v) return fallback;
    if (!(options as readonly string[]).includes(v)) this.errors[field] = 'Pick one of the options.';
    return v as T;
  }

  pence(field: string): number {
    const v = parsePounds(this.raw(field));
    if (v === null) this.errors[field] = 'Enter an amount in pounds, like 45 or 45.50.';
    return v ?? 0;
  }

  int(field: string, min: number, max: number, fallback?: number): number {
    const v = this.raw(field);
    if (!v && fallback !== undefined) return fallback;
    const n = /^\d+$/.test(v) ? Number(v) : NaN;
    if (!(n >= min && n <= max)) this.errors[field] = `A whole number from ${min} to ${max}.`;
    return n;
  }

  date(field: string, required: boolean): string | null {
    const v = this.raw(field);
    if (!v) {
      if (required) this.errors[field] = 'Required.';
      return null;
    }
    if (!isIsoDate(v)) this.errors[field] = 'Not a valid date.';
    return v;
  }

  time(field: string): string | null {
    const v = this.raw(field);
    if (!v) return null;
    if (!TIME.test(v)) this.errors[field] = 'Not a valid time.';
    return v;
  }

  result<T>(value: T): Parsed<T> {
    return Object.keys(this.errors).length
      ? { ok: false, errors: this.errors, values: this.values }
      : { ok: true, value };
  }
}

export function parseStudentForm(form: FormData): Parsed<StudentInput> {
  const r = new Reader(form);
  return r.result({
    name: r.text('name', 200, true) ?? '',
    level: r.oneOf('level', LEVELS, null),
    exam_board: r.text('exam_board', 50),
    student_email: r.email('student_email'),
    parent_name: r.text('parent_name', 200),
    parent_email: r.email('parent_email'),
    parent_phone: r.text('parent_phone', 40),
    rate_pence: r.pence('rate'),
    status: r.oneOf('status', STATUSES, 'active') ?? 'active',
    notes: r.text('notes', 10_000),
  });
}

/** `studentIds` are the students offered in the form; any other id would fail the foreign key. */
export function parseLessonForm(form: FormData, studentIds: number[]): Parsed<LessonInput> {
  const r = new Reader(form);
  const student_id = r.int('student_id', 1, Number.MAX_SAFE_INTEGER);
  if (!studentIds.includes(student_id)) r.errors.student_id = 'Pick a student.';
  return r.result({
    student_id,
    date: r.date('date', true) ?? '',
    time: r.time('time'),
    minutes: r.int('minutes', 5, 600, 60),
    price_pence: r.pence('price'),
    covered: r.text('covered', 10_000),
    homework: r.text('homework', 10_000),
    notes: r.text('notes', 10_000),
    paid_on: r.date('paid_on', false),
  });
}
