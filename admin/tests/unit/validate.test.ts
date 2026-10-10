import { describe, expect, it } from 'vitest';
import { LEVELS, parseLessonForm, parseStudentForm } from '../../src/lib/validate';

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe('parseStudentForm', () => {
  const good = {
    name: '  Ada Lovelace ',
    level: 'A Level',
    exam_board: 'OCR MEI',
    student_email: 'ada@example.com',
    parent_name: 'Anne',
    parent_email: 'ANNE@Example.com',
    parent_phone: '07700 900123',
    rate: '45',
    status: 'active',
    notes: 'Mechanics',
  };

  it('accepts a full form and normalises it', () => {
    const r = parseStudentForm(form(good));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      name: 'Ada Lovelace',
      level: 'A Level',
      exam_board: 'OCR MEI',
      student_email: 'ada@example.com',
      parent_name: 'Anne',
      parent_email: 'anne@example.com',
      parent_phone: '07700 900123',
      rate_pence: 4500,
      status: 'active',
      notes: 'Mechanics',
    });
  });

  it('turns empty optional fields into null', () => {
    const r = parseStudentForm(form({ name: 'Bo', rate: '40', status: 'active' }));
    expect(r.ok && r.value).toMatchObject({ level: null, student_email: null, parent_email: null, notes: null });
  });

  it('requires a name', () => {
    const r = parseStudentForm(form({ ...good, name: '   ' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.name).toBeTruthy();
    expect(r.values.name).toBe('   ');
  });

  it('rejects a bad email, rate, level or status', () => {
    const r = parseStudentForm(form({ ...good, parent_email: 'nope', rate: 'lots', level: 'PhD', status: 'gone' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['level', 'parent_email', 'rate', 'status']);
  });

  it('caps long fields', () => {
    const r = parseStudentForm(form({ ...good, notes: 'x'.repeat(10_001) }));
    expect(r.ok).toBe(false);
  });

  it('exposes the levels for the form', () => {
    expect(LEVELS).toContain('GCSE');
  });
});

describe('parseLessonForm', () => {
  const good = {
    student_id: '3',
    date: '2026-10-09',
    time: '16:30',
    minutes: '90',
    price: '67.50',
    covered: 'Integration by parts',
    homework: 'Ex 4B',
    notes: '',
    paid_on: '',
  };

  it('accepts a full form', () => {
    const r = parseLessonForm(form(good), [3]);
    expect(r.ok && r.value).toEqual({
      student_id: 3,
      date: '2026-10-09',
      time: '16:30',
      minutes: 90,
      price_pence: 6750,
      covered: 'Integration by parts',
      homework: 'Ex 4B',
      notes: null,
      paid_on: null,
    });
  });

  it('defaults minutes to 60 and time to null', () => {
    const r = parseLessonForm(form({ ...good, minutes: '', time: '' }), [3]);
    expect(r.ok && r.value).toMatchObject({ minutes: 60, time: null });
  });

  it.each([
    ['student_id', '0'],
    ['student_id', 'x'],
    ['student_id', '4'],
    ['date', '2026-02-30'],
    ['date', '09/10/2026'],
    ['time', '25:00'],
    ['minutes', '0'],
    ['minutes', '1000'],
    ['price', ''],
    ['paid_on', 'yesterday'],
  ])('rejects %s = %j', (field, value) => {
    const r = parseLessonForm(form({ ...good, [field]: value }), [3]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[field]).toBeTruthy();
  });
});
