import { describe, expect, it } from 'vitest';
import { lessonToValues, studentToValues } from '../../src/lib/forms';
import { parseLessonForm, parseStudentForm } from '../../src/lib/validate';

function toForm(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe('form values round-trip through the parsers', () => {
  it('students', () => {
    const s = {
      name: 'Ada', level: 'GCSE' as const, exam_board: null, student_email: 'a@b.co', parent_name: null,
      parent_email: null, parent_phone: null, rate_pence: 4550, status: 'paused' as const, notes: 'n',
    };
    const r = parseStudentForm(toForm(studentToValues(s)));
    expect(r.ok && r.value).toEqual(s);
  });

  it('lessons', () => {
    const l = {
      student_id: 7, date: '2026-10-01', time: '09:15', minutes: 45, price_pence: 3000,
      covered: 'c', homework: null, notes: null, paid_on: '2026-10-02',
    };
    const r = parseLessonForm(toForm(lessonToValues(l)));
    expect(r.ok && r.value).toEqual(l);
  });
});
