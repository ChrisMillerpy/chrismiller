// Permission strings mirror the RLS policies in supabase/migrations. '*' means everything.

export type Permission =
  | 'students.read'
  | 'students.write'
  | 'finance.read'
  | 'finance.write'
  | 'staff.admin'
  | 'audit.read';

export function can(staff: { permissions: string[] }, permission: Permission): boolean {
  return staff.permissions.includes('*') || staff.permissions.includes(permission);
}
