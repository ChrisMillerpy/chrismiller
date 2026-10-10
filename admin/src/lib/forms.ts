// Database rows to form field values, for edit pages.

import { penceToInput } from './money';
import type { LessonInput, StudentInput } from './validate';

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function studentToValues(s: StudentInput): Record<string, string> {
  return {
    name: s.name, level: str(s.level), exam_board: str(s.exam_board), student_email: str(s.student_email),
    parent_name: str(s.parent_name), parent_email: str(s.parent_email), parent_phone: str(s.parent_phone),
    rate: penceToInput(s.rate_pence), status: s.status, notes: str(s.notes),
  };
}

export function lessonToValues(l: LessonInput): Record<string, string> {
  return {
    student_id: str(l.student_id), date: l.date, time: str(l.time), minutes: str(l.minutes),
    price: penceToInput(l.price_pence), covered: str(l.covered), homework: str(l.homework),
    notes: str(l.notes), paid_on: str(l.paid_on),
  };
}
