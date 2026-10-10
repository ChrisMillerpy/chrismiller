// The admin end to end: the production build, a fake Access in front, the real database behind.

import { expect, test, type Page } from '@playwright/test';
import { todayInLondon } from '../../src/lib/taxyear';

const ACCESS = 'http://127.0.0.1:4401';

async function token(email: string, aud?: string) {
  const url = new URL('/token', ACCESS);
  url.searchParams.set('email', email);
  if (aud) url.searchParams.set('aud', aud);
  return (await fetch(url)).text();
}

async function signIn(page: Page, email = 'chris@example.com') {
  await page.context().setExtraHTTPHeaders({ 'cf-access-jwt-assertion': await token(email) });
}

function shiftDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const today = todayInLondon();

test.describe('the door', () => {
  test('refuses a request with no Access token', async ({ request }) => {
    const r = await request.get('/');
    expect(r.status()).toBe(403);
    expect(await r.text()).toContain('Not signed in');
  });

  test('refuses a token for another app', async ({ request }) => {
    const r = await request.get('/', { headers: { 'cf-access-jwt-assertion': await token('chris@example.com', 'other-app') } });
    expect(r.status()).toBe(403);
  });

  test('refuses a signed-in email with no staff record', async ({ request }) => {
    const r = await request.get('/', { headers: { 'cf-access-jwt-assertion': await token('stranger@example.com') } });
    expect(r.status()).toBe(403);
    expect(await r.text()).toContain('no access');
  });

  test('refuses a cross-site form post', async ({ request }) => {
    const r = await request.post('/students/new', {
      headers: { 'cf-access-jwt-assertion': await token('chris@example.com'), origin: 'https://evil.example' },
      form: { name: 'Mallory', rate: '1' },
    });
    expect(r.status()).toBe(403);
  });

  test('sends the hardening headers', async ({ request }) => {
    const r = await request.get('/', { headers: { 'cf-access-jwt-assertion': await token('chris@example.com') } });
    expect(r.status()).toBe(200);
    expect(r.headers()['cache-control']).toBe('no-store');
    expect(r.headers()['x-frame-options']).toBe('DENY');
    expect(r.headers()['referrer-policy']).toBe('same-origin');
    expect(r.headers()['x-robots-tag']).toContain('noindex');
  });
});

test.describe('running the business as Chris', () => {
  test.describe.configure({ mode: 'serial' });

  test('adds a student, with validation', async ({ page }) => {
    await signIn(page);
    await page.goto('/students');
    await expect(page.getByText('No active students yet.')).toBeVisible();
    await page.getByRole('link', { name: 'Add a student' }).click();

    await page.getByLabel('Rate per lesson (£)').fill('45');
    await page.getByRole('button', { name: 'Add student' }).click();
    await expect(page.locator('#f-name-error')).toHaveText('Required.');

    await page.getByLabel('Name', { exact: true }).fill('Ada Lovelace');
    await page.getByLabel('Level').selectOption('A Level');
    await page.getByLabel('Exam board').fill('OCR MEI');
    await page.getByLabel('Parent name').fill('Anne');
    await page.getByLabel('Parent email').fill('anne@example.com');
    await page.getByLabel('Notes').fill('=HYPERLINK("http://evil")');
    await page.getByRole('button', { name: 'Add student' }).click();

    await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Student saved.');
    await expect(page.getByText('£45.00')).toBeVisible();
  });

  test('logs past, upcoming and discounted lessons; the rate fills in', async ({ page }) => {
    await signIn(page);
    await page.goto('/students');
    await page.getByRole('link', { name: 'Ada Lovelace' }).click();
    await page.getByRole('link', { name: 'Log a lesson' }).click();
    await expect(page.getByLabel('Price (£)')).toHaveValue('45.00');

    // A second student, to check the rate changes when the student does.
    await page.goto('/students/new');
    await page.getByLabel('Name', { exact: true }).fill('Bo, "the quick"');
    await page.getByLabel('Rate per lesson (£)').fill('30');
    await page.getByRole('button', { name: 'Add student' }).click();

    await page.goto('/lessons/new');
    await page.getByLabel('Student').selectOption({ label: 'Ada Lovelace' });
    await expect(page.getByLabel('Price (£)')).toHaveValue('45.00');
    await page.getByLabel('Student').selectOption({ label: 'Bo, "the quick"' });
    await expect(page.getByLabel('Price (£)')).toHaveValue('30.00');
    await page.getByLabel('Student').selectOption({ label: 'Ada Lovelace' });
    await page.getByLabel('Date').fill(shiftDays(today, -2));
    await page.getByLabel('Covered').fill('Integration, by parts');
    await page.getByRole('button', { name: 'Save lesson' }).click();
    await expect(page.getByRole('status')).toHaveText('Lesson saved.');

    await page.goto('/lessons/new');
    await page.getByLabel('Student').selectOption({ label: 'Ada Lovelace' });
    await page.getByLabel('Date').fill(shiftDays(today, -1));
    await page.getByLabel('Price (£)').fill('40');
    await page.getByLabel('Student').selectOption({ label: 'Ada Lovelace' }); // typed price is kept
    await expect(page.getByLabel('Price (£)')).toHaveValue('40');
    await page.getByRole('button', { name: 'Save lesson' }).click();

    await page.goto('/lessons/new?student=999');
    await page.getByLabel('Student').selectOption({ label: 'Bo, "the quick"' });
    await page.getByLabel('Date').fill(shiftDays(today, 7));
    await page.getByLabel('Time').fill('16:30');
    await page.getByRole('button', { name: 'Save lesson' }).click();

    // Validation on the lesson form.
    await page.goto('/lessons/new');
    await page.getByLabel('Date').fill('');
    await page.getByRole('button', { name: 'Save lesson' }).click();
    await expect(page.locator('#f-date-error')).toHaveText('Required.');
  });

  test('the overview adds up, and upcoming lessons are not owed', async ({ page }) => {
    await signIn(page);
    await page.goto('/');
    await expect(page.getByTestId('owed')).toHaveText('£85.00');
    await expect(page.getByTestId('received-year')).toHaveText('£0.00');
    await expect(page.getByRole('cell', { name: 'upcoming' })).toBeVisible();
  });

  test('marks one lesson paid, then the rest', async ({ page }) => {
    await signIn(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Mark paid' }).first().click();
    await expect(page.getByRole('status')).toHaveText('Marked as paid.');
    await expect(page.getByTestId('owed')).not.toHaveText('£85.00');

    await page.goto('/students');
    await page.getByRole('link', { name: 'Ada Lovelace' }).click();
    await page.getByRole('button', { name: 'Mark all paid' }).click();
    await expect(page.getByRole('status')).toHaveText('All past lessons marked as paid.');
    await expect(page.getByTestId('student-owed')).toHaveText('£0.00');

    await page.goto('/');
    await expect(page.getByTestId('owed')).toHaveText('£0.00');
    await expect(page.getByTestId('received-year')).toHaveText('£85.00');
  });

  test('edits a lesson', async ({ page }) => {
    await signIn(page);
    await page.goto('/lessons?view=upcoming');
    await page.getByRole('link', { name: /Edit lesson/ }).first().click();
    await page.getByLabel('Price (£)').fill('25');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Lesson saved.');
    await expect(page.getByRole('cell', { name: '£25.00' })).toBeVisible();
  });

  test('exports CSV with quoting and formula protection, and no private notes', async ({ page }) => {
    await signIn(page);
    const r = await page.request.get('/export.csv');
    expect(r.status()).toBe(200);
    expect(r.headers()['content-disposition']).toContain('lessons-all.csv');
    const csv = await r.text();
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('date,time,student,level,minutes,price,paid_on,covered,homework');
    expect(lines).toHaveLength(4);
    expect(csv).toContain('"Integration, by parts"');
    expect(csv).toContain('"Bo, ""the quick"""');
    expect(csv).not.toContain('HYPERLINK');

    const bad = await page.request.get('/export.csv?from=2026-10-10&to=2026-01-01');
    expect(bad.status()).toBe(400);
  });

  test('edits a student, then deletes them with their lessons', async ({ page }) => {
    await signIn(page);
    await page.goto('/students');
    await page.getByRole('link', { name: 'Bo, "the quick"' }).click();
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Status').selectOption('finished');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('finished')).toBeVisible();

    await page.goto('/students?status=finished');
    await page.getByRole('link', { name: 'Bo, "the quick"' }).click();
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete student and lessons' }).click();
    await expect(page.getByRole('status')).toHaveText('Student and their lessons deleted.');

    const csv = await (await page.request.get('/export.csv')).text();
    expect(csv).not.toContain('the quick');
  });

  test('a missing student is a 404', async ({ page }) => {
    await signIn(page);
    expect((await page.goto('/students/999999'))?.status()).toBe(404);
    expect((await page.goto('/students/abc'))?.status()).toBe(404);
  });

  test('no horizontal scrolling at phone width', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of ['/', '/students', '/lessons', '/lessons/new', '/students/new']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('a staff member with students.read only', () => {
  test('sees students but no money, and cannot change anything', async ({ page }) => {
    await signIn(page, 'reader@example.com');
    await page.goto('/');
    await expect(page).toHaveURL(/\/students$/);
    await expect(page.getByRole('link', { name: 'Ada Lovelace' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lessons' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Owed' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Add a student' })).toHaveCount(0);

    expect((await page.goto('/lessons'))?.status()).toBe(403);
    expect((await page.goto('/students/new'))?.status()).toBe(403);
    expect((await page.request.get('/export.csv')).status()).toBe(403);
  });
});
