import { describe, expect, it } from 'vitest';
import { can } from '../../src/lib/permissions';

describe('can', () => {
  it('lets * do anything', () => {
    expect(can({ permissions: ['*'] }, 'finance.write')).toBe(true);
  });
  it('matches exact permissions only', () => {
    const staff = { permissions: ['students.read'] };
    expect(can(staff, 'students.read')).toBe(true);
    expect(can(staff, 'students.write')).toBe(false);
    expect(can(staff, 'finance.read')).toBe(false);
  });
  it('denies when there are no permissions', () => {
    expect(can({ permissions: [] }, 'students.read')).toBe(false);
  });
});
