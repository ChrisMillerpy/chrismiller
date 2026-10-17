// End-to-end: drive admin → Cathy like Chris does on his phone, record video and screenshots.
// Usage: BASE_URL=http://localhost:8787 OUT=./e2e-out node cathy/e2e/chat.e2e.ts
// Env: REAL=1 for real Claude and sandbox (longer waits, asks for a real command);
//      CHROMIUM=/path/to/chrome to use a specific browser; ADMIN_PASSWORD if admin has one;
//      E2E_PR=1 (with REAL=1) also asks Cathy to open a PR and records its link (CI closes it after).
//      Share links are opened from a fresh, logged-out browser; security probes land in security.json.
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const OUT = resolve(process.env.OUT ?? 'e2e-out'); // absolute, so ffmpeg's frame list works from any folder
const REAL = process.env.REAL === '1';
const REPLY_TIMEOUT = REAL ? 180_000 : 20_000;
mkdirSync(OUT, { recursive: true });

type Step = { name: string; ok: boolean; ms: number; detail?: string; shot?: string };
const steps: Step[] = [];

async function step(name: string, page: Page, fn: () => Promise<string | void>) {
  const t = Date.now();
  const shot = `${String(steps.length + 1).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  try {
    const detail = (await fn()) ?? undefined;
    await pause();
    await page.screenshot({ path: join(OUT, shot) });
    steps.push({ name, ok: true, ms: Date.now() - t, detail, shot });
    console.log(`✓ ${name} (${Date.now() - t} ms)${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    await page.screenshot({ path: join(OUT, shot) }).catch(() => {});
    steps.push({ name, ok: false, ms: Date.now() - t, detail: String(err), shot });
    console.log(`✗ ${name}: ${err}`);
    throw err;
  }
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const context = await browser.newContext({
  viewport: { width: 393, height: 852 }, // iPhone 15 Pro
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

// Video: record frames straight from the browser, then stitch them into an MP4 with ffmpeg.
const FRAMES = join(OUT, 'frames');
mkdirSync(FRAMES, { recursive: true });
const frames: { file: string; t: number }[] = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', async (f: any) => {
  const file = join(FRAMES, `${String(frames.length).padStart(5, '0')}.jpg`);
  writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file, t: f.metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 786, maxHeight: 1704 });
const pause = () => page.waitForTimeout(700); // so each step is visible in the video
const firstMessage = REAL ? 'Hi Cathy. Run git status and tell me which branch you are on, in one sentence.' : 'Hello Cathy, what branch are you on?';
let chatUrl = '';
let sentAt = 0;
let prUrl = '';
let failed = false;
let artifactId = '';
let shareUrl = '';
const security: { check: string; expected: unknown; actual: unknown }[] = [];
const chatId = () => chatUrl.split('/').pop()!;
// A 1×1 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// Fetch with no cookies and no cache, as a stranger would.
const fetchFresh = (url: string) => fetch(url, { cache: 'no-store', redirect: 'manual' }).then((r) => r.status).catch(() => 0);

try {
  if (process.env.ADMIN_PASSWORD) {
    await step('Log in once', page, async () => {
      await page.goto(BASE + '/cathy');
      await page.waitForURL(/\/login\?next=%2Fcathy$/);
      await page.locator('#password').fill(process.env.ADMIN_PASSWORD!);
      await page.getByRole('button', { name: 'Log in' }).click();
      await page.waitForURL(/\/cathy$/);
      const cookie = (await context.cookies()).find((c) => c.name === 'admin');
      if (!cookie) throw new Error('no login cookie');
      const days = Math.round((cookie.expires * 1000 - Date.now()) / 86_400_000);
      if (days < 300) throw new Error(`cookie only lasts ${days} days`);
      return `remembered for ${days} days`;
    });
  }

  await step('Admin home', page, async () => {
    await page.goto(BASE + '/');
    await page.getByText('Hi Chris').waitFor();
  });

  await step('Open Cathy', page, async () => {
    await page.locator('[data-id=cathy]').click();
    await page.waitForURL(/\/cathy$/);
    await page.getByRole('heading', { name: 'Cathy' }).waitFor();
  });

  await step('Start a new chat', page, async () => {
    await page.getByTestId('new-chat').click();
    await page.waitForURL(/\/cathy\/[a-z0-9]+$/);
    chatUrl = page.url();
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached' });
    return `chat ${chatUrl.split('/').pop()}, branch ${await page.locator('#branch').textContent()}`;
  });

  await step('Chat box fits the phone', page, async () => {
    // iOS zooms into any text box under 16px; maximum-scale=1 stops the zoom on focus.
    const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
    if (!/maximum-scale=1/.test(viewport ?? '')) throw new Error(`viewport meta lacks maximum-scale=1: ${viewport}`);
    await page.getByTestId('composer').tap();
    const m = await page.evaluate(() => {
      const t = document.querySelector('[data-testid=composer]')!, s = document.querySelector('[data-testid=send]')!;
      return { font: parseFloat(getComputedStyle(t).fontSize), sendRight: s.getBoundingClientRect().right, sendDisabled: (s as HTMLButtonElement).disabled };
    });
    const screenWidth = page.viewportSize()!.width;
    if (m.font < 16) throw new Error(`text box font is ${m.font}px; iOS will zoom`);
    if (m.sendRight > screenWidth) throw new Error(`Send is cut off (${Math.round(m.sendRight)} > ${screenWidth})`);
    if (!m.sendDisabled) throw new Error('Send should be disabled while the box is empty');
    return `font ${m.font}px, Send fully on screen, disabled while empty`;
  });

  await step('Send a message', page, async () => {
    await page.getByTestId('composer').fill(firstMessage);
    await page.getByTestId('send').click();
    sentAt = Date.now();
    await page.getByTestId('msg-user').first().waitFor();
    await page.locator('[data-testid=status][data-status=thinking]').waitFor({ timeout: 10_000 });
  });

  await step('Cathy uses a tool and replies', page, async () => {
    await page.getByTestId('msg-assistant').first().waitFor({ timeout: REPLY_TIMEOUT });
    const replyMs = Date.now() - sentAt;
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached', timeout: REPLY_TIMEOUT });
    const tools = await page.getByTestId('msg-tool').allTextContents();
    const reply = (await page.getByTestId('msg-assistant').first().textContent())!.trim();
    if (!tools.length) throw new Error('no tool use shown');
    return `reply ${replyMs} ms after sending; tools: ${tools.join(' | ')}; reply: "${reply.slice(0, 160)}"`;
  });

  await step('Chat survives a reload', page, async () => {
    await page.reload();
    await page.getByTestId('msg-assistant').first().waitFor();
    const n = await page.locator('.m').count();
    if (n < 3) throw new Error(`only ${n} messages after reload`);
    return `${n} messages restored`;
  });

  await step('Chat is listed with a preview', page, async () => {
    await page.getByRole('link', { name: 'Back to chats' }).click();
    await page.waitForURL(/\/cathy$/);
    const row = page.getByTestId('chat-row').filter({ hasText: chatUrl.split('/').pop()! });
    await row.waitFor();
    // Phones zoom out to fit wide pages, so compare with the real screen width, not innerWidth.
    const screenWidth = page.viewportSize()!.width;
    const widest = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('.chat')].map((e) => e.getBoundingClientRect().right)));
    if (widest > screenWidth) throw new Error(`page is ${Math.round(widest - screenWidth)}px wider than the screen`);
    return (await row.textContent())!.replace(/\s+/g, ' ').trim().slice(0, 160);
  });

  // ── Agent manager features ──────────────────────────────────────────

  await step('Cathy names the chat; Chris renames it', page, async () => {
    await page.goto(chatUrl);
    const title = page.getByTestId('chat-title');
    await page.waitForFunction(() => !/^(Cathy|New chat)$/.test(document.querySelector('[data-testid=chat-title]')!.textContent!.trim()), null, { timeout: REPLY_TIMEOUT });
    const hers = (await title.textContent())!.trim();
    await title.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('E2E renamed chat');
    await page.keyboard.press('Enter');
    await page.waitForResponse((r) => r.url().endsWith('/api/cathy/sessions/' + chatId()) && r.request().method() === 'PATCH');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-testid=chat-title]')!.textContent === 'E2E renamed chat');
    return `Cathy named it "${hers}"; renamed to "E2E renamed chat", kept after reload`;
  });

  await step('Pick a model and effort', page, async () => {
    await page.getByTestId('model').selectOption({ index: 1 });
    await page.waitForResponse((r) => r.request().method() === 'PATCH');
    await page.getByTestId('effort').selectOption('low');
    await page.waitForResponse((r) => r.request().method() === 'PATCH');
    const label = await page.getByTestId('model').evaluate((s: HTMLSelectElement) => s.selectedOptions[0].text);
    await page.reload();
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached' });
    await page.waitForFunction(() => (document.querySelector('[data-testid=effort]') as HTMLSelectElement).value === 'low');
    const kept = await page.getByTestId('model').evaluate((s: HTMLSelectElement) => s.selectedOptions[0].text);
    if (kept !== label) throw new Error(`model not kept: ${kept}`);
    return `${label}, low effort; kept after reload`;
  });

  await step('Attach an image; Cathy sees it', page, async () => {
    const before = await page.getByTestId('msg-assistant').count();
    await page.getByTestId('file-input').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
    await page.getByTestId('pending-file').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid=pending-file]')?.getAttribute('data-state') !== 'uploading');
    await page.getByTestId('composer').fill(REAL ? 'What colour is this image? One word.' : 'What is in this image?');
    await page.getByTestId('send').click();
    await page.getByTestId('attachment').first().waitFor();
    await page.getByTestId('msg-assistant').nth(before).waitFor({ timeout: REPLY_TIMEOUT });
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached', timeout: REPLY_TIMEOUT });
    const reply = (await page.getByTestId('msg-assistant').nth(before).textContent())!.trim();
    const label = (await page.getByTestId('reply-label').last().textContent())!.trim();
    if (!REAL && !/I can see 1 image/.test(reply)) throw new Error(`model did not get the image: ${reply}`);
    return `reply: "${reply.slice(0, 120)}"; label: ${label}`;
  });

  await step('Stop a reply with the square button', page, async () => {
    const before = await page.getByTestId('msg-assistant').count();
    await page.getByTestId('composer').fill(REAL ? 'Write a 600-word essay on the history of the number zero.' : 'Give me a long answer');
    await page.getByTestId('send').click();
    await page.getByTestId('stop').waitFor({ timeout: 15_000 });
    await page.getByTestId('msg-streaming').waitFor({ timeout: REPLY_TIMEOUT });
    await page.waitForTimeout(REAL ? 2500 : 700);
    await page.getByTestId('stop').click();
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached', timeout: 30_000 });
    const msg = page.getByTestId('msg-assistant').nth(before);
    const label = (await msg.getByTestId('reply-label').textContent()) ?? '';
    if (!/Stopped/.test(label)) throw new Error(`no Stopped label: ${label}`);
    const words = ((await msg.textContent()) ?? '').split(/\s+/).length;
    return `stopped after ~${words} words; label "${label.trim()}"`;
  });

  await step('Interrupt with a new message', page, async () => {
    const before = await page.getByTestId('msg-assistant').count();
    await page.getByTestId('composer').fill(REAL ? 'Write a 600-word essay on the history of pi.' : 'Another long answer please');
    await page.getByTestId('send').click();
    await page.getByTestId('msg-streaming').waitFor({ timeout: REPLY_TIMEOUT });
    await page.getByTestId('composer').fill(REAL ? 'Stop that. Just say "interrupted ok".' : 'Short one instead');
    await page.getByTestId('interrupt').waitFor();
    await page.getByTestId('interrupt').click();
    await page.getByTestId('msg-assistant').nth(before + 1).waitFor({ timeout: REPLY_TIMEOUT });
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached', timeout: REPLY_TIMEOUT });
    const first = (await page.getByTestId('msg-assistant').nth(before).getByTestId('reply-label').textContent()) ?? '';
    const second = (await page.getByTestId('msg-assistant').nth(before + 1).textContent())!.trim();
    if (!/Stopped/.test(first)) throw new Error('first reply was not stopped');
    return `first reply stopped; then: "${second.slice(0, 100)}"`;
  });

  await step('Cathy publishes an artifact into the chat', page, async () => {
    await page.getByTestId('composer').fill(
      REAL
        ? 'Make a short Markdown worksheet with three fraction questions (use $...$ for maths) in /tmp/fractions.md, publish it with publish_artifact as "Fractions worksheet", private. Reply in one sentence.'
        : 'Please publish the worksheet',
    );
    await page.getByTestId('send').click();
    await page.getByTestId('artifact').first().waitFor({ timeout: REAL ? 300_000 : REPLY_TIMEOUT });
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached', timeout: REAL ? 300_000 : REPLY_TIMEOUT });
    const card = page.getByTestId('artifact').first();
    artifactId = (await card.getAttribute('data-id'))!;
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500); // let the preview render
    return `artifact ${artifactId}: ${(await card.locator('.t').textContent())} (${await card.getAttribute('data-visibility')})`;
  });

  await step('Open the artifact full screen', page, async () => {
    await page.getByTestId('artifact').first().getByRole('button', { name: 'Open' }).click();
    await page.getByTestId('viewer').waitFor();
    await page.waitForTimeout(1500);
    const maths = await page.frameLocator('[data-testid=viewer] iframe').locator('.katex').count();
    await page.getByTestId('viewer').getByRole('button', { name: 'Close' }).click();
    if (!REAL && maths < 2) throw new Error(`maths not rendered (${maths} KaTeX blocks)`);
    return `${maths} maths expressions rendered`;
  });

  await step('Share by link; open it logged out', page, async () => {
    const card = page.getByTestId('artifact').first();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await card.getByRole('button', { name: 'Link' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid=artifact]')?.getAttribute('data-visibility') === 'link');
    const a = await (await page.request.get(`${BASE}/api/cathy/artifacts/${artifactId}`)).json();
    shareUrl = a.share_url;
    const stranger = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true });
    const sp = await stranger.newPage();
    const res = await sp.goto(shareUrl);
    await sp.waitForTimeout(1500);
    await sp.screenshot({ path: join(OUT, 'share-logged-out.png') });
    const cookies = await stranger.cookies();
    await stranger.close();
    if (res?.status() !== 200) throw new Error(`share link gave ${res?.status()}`);
    return `${shareUrl} → 200 in a fresh browser with ${cookies.length} cookies`;
  });

  await step('Back to private: the link stops working', page, async () => {
    await page.getByTestId('artifact').first().getByRole('button', { name: 'Private' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid=artifact]')?.getAttribute('data-visibility') === 'private');
    const status = await fetchFresh(shareUrl);
    if (status !== 404) throw new Error(`still ${status}`);
    security.push({ check: 'Private artifact via its old share link', expected: 404, actual: status });
    return `${shareUrl} → ${status}`;
  });

  await step('Artifacts page: versions, new link', page, async () => {
    await page.goto(`${BASE}/artifacts`);
    await page.getByTestId('artifact').first().waitFor();
    await page.goto(`${BASE}/artifacts/${artifactId}`);
    await page.getByTestId('artifact-title').waitFor();
    await page.getByTestId('artifact').getByRole('button', { name: 'Link' }).click();
    await page.getByTestId('share-url').waitFor();
    const oldUrl = (await page.getByTestId('share-url').textContent())!;
    await page.getByRole('button', { name: 'New link' }).click();
    await page.getByRole('button', { name: /Tap again/ }).click();
    await page.waitForFunction((u) => document.querySelector('[data-testid=share-url]')?.textContent !== u, oldUrl);
    const newUrl = (await page.getByTestId('share-url').textContent())!;
    const [o, n] = [await fetchFresh(oldUrl), await fetchFresh(newUrl)];
    security.push({ check: 'Old link after "New link"', expected: 404, actual: o }, { check: 'New link', expected: 200, actual: n });
    if (o !== 404 || n !== 200) throw new Error(`old ${o}, new ${n}`);
    return `old link ${o}, new link ${n}`;
  });

  if (!REAL) {
    await step('A hostile HTML artifact is sandboxed', page, async () => {
      await page.goto(chatUrl);
      await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached' });
      const n = await page.getByTestId('artifact').count();
      await page.getByTestId('composer').fill('Please publish the probe');
      await page.getByTestId('send').click();
      await page.getByTestId('artifact').nth(n).waitFor({ timeout: REPLY_TIMEOUT });
      await page.getByTestId('artifact').nth(n).getByRole('button', { name: 'Open' }).click();
      const frame = page.frameLocator('[data-testid=viewer] iframe');
      await frame.locator('li[data-k="admin API"]').waitFor({ timeout: 10_000 });
      const lines = await frame.locator('li').allTextContents();
      await page.waitForTimeout(500);
      const bad = lines.filter((l) => /REACHED|VISIBLE|ALLOWED/.test(l));
      for (const l of lines) security.push({ check: `HTML artifact in admin: ${l.split(':')[0]}`, expected: 'blocked', actual: l.split(': ')[1] });
      await page.getByTestId('viewer').getByRole('button', { name: 'Close' }).click();
      if (bad.length) throw new Error(`escaped the sandbox: ${bad.join('; ')}`);
      return lines.join('; ');
    });
  }

  await step('Search, archive and unarchive', page, async () => {
    await page.goto(`${BASE}/cathy`);
    await page.getByTestId('chat-row').first().waitFor();
    await page.getByTestId('chat-search').fill(chatId());
    await page.waitForTimeout(300);
    const n = await page.getByTestId('chat-row').count();
    if (n !== 1) throw new Error(`search for ${chatId()} found ${n}`);
    await page.getByTestId('chat-search').fill('zzz-no-such-chat');
    if (await page.getByTestId('chat-row').count()) throw new Error('search did not filter');
    await page.goto(chatUrl);
    await page.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: 'Tap again to archive' }).click();
    await page.waitForURL(/\/cathy$/);
    await page.getByTestId('archived-tab').click();
    const row = page.locator('li').filter({ has: page.locator(`a[href='/cathy/${chatId()}']`) });
    await row.waitFor();
    await row.getByTestId('unarchive').click();
    await page.getByRole('button', { name: 'Active' }).click();
    await page.locator(`a[href='/cathy/${chatId()}']`).waitFor();
    return 'found by search; archived, then back in Active';
  });

  await step('Security probes', page, async () => {
    const share = new URL(shareUrl).origin;
    const probes: [string, string, number][] = [
      ['Share: wrong token', `${share}/a/aaaaaaaaaaaaaaaaaaaa`, 404],
      ['Share: admin API path', `${share}/api/cathy/sessions`, 404],
      ['Share: Cathy share path directly', `${share}/share/a/aaaaaaaaaaaaaaaaaaaa`, 404],
      ['Share: path traversal', `${share}/a/../api/cathy/artifacts`, 404],
    ];
    for (const [check, url, expected] of probes) security.push({ check, expected, actual: await fetchFresh(url) });
    const post = await fetch(`${share}/a/aaaaaaaaaaaaaaaaaaaa`, { method: 'POST', body: 'x' }).then((r) => r.status).catch(() => 0);
    security.push({ check: 'Share: POST', expected: 405, actual: post });
    // Another chat's upload, through admin.
    const other = await (await page.request.post(`${BASE}/api/cathy/sessions`, { data: {} })).json();
    const mine = await (await page.request.post(`${BASE}/api/cathy/sessions/${other.id}/uploads`, { headers: { 'content-type': 'text/plain', 'x-filename': 'a.txt' }, data: 'hi' })).json();
    security.push({ check: "Reading another chat's upload", expected: 404, actual: (await page.request.get(`${BASE}/api/cathy/sessions/${chatId()}/uploads/${mine.id}`)).status() });
    const big = await page.request.post(`${BASE}/api/cathy/sessions/${other.id}/uploads`, { headers: { 'x-filename': 'big.bin' }, data: Buffer.alloc(26 * 1024 * 1024) });
    security.push({ check: '26 MB upload', expected: 413, actual: big.status() });
    const evil = await (await page.request.post(`${BASE}/api/cathy/sessions/${other.id}/uploads`, { headers: { 'x-filename': encodeURIComponent('../../etc/passwd'), 'content-type': 'text/plain' }, data: 'x' })).json();
    security.push({ check: 'Path-traversal file name is cleaned', expected: 'passwd', actual: evil.name });
    await page.request.post(`${BASE}/api/cathy/sessions/${other.id}/archive`);
    const failedChecks = security.filter((s) => String(s.expected) !== String(s.actual) && !(s.expected === 'blocked' && /^(blocked|none visible|null|refused)/.test(String(s.actual))));
    if (failedChecks.length) throw new Error(failedChecks.map((f) => `${f.check}: ${f.actual}`).join('; '));
    return `${security.length} checks passed`;
  });

  if (REAL && process.env.E2E_PR === '1') {
    await step('Cathy opens a PR', page, async () => {
      await page.goto(chatUrl);
      await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached' });
      const id = chatUrl.split('/').pop();
      const before = await page.getByTestId('msg-assistant').count();
      await page.getByTestId('composer').fill(
        `Test task: create the file e2e/cathy-check-${id}.txt containing the word hello, then use open_pr with the title "e2e: Cathy check ${id}". Reply with just the PR link.`,
      );
      await page.getByTestId('send').click();
      await page.getByTestId('msg-assistant').nth(before).waitFor({ timeout: 300_000 });
      await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached', timeout: 300_000 });
      const reply = (await page.getByTestId('msg-assistant').nth(before).textContent()) ?? '';
      prUrl = reply.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/)?.[0] ?? '';
      if (!prUrl) throw new Error(`no PR link in reply: ${reply.slice(0, 200)}`);
      return prUrl;
    });
  }

  await page.emulateMedia({ colorScheme: 'dark' });
  await step('Dark mode', page, async () => {
    await page.goto(chatUrl);
    await page.getByTestId('msg-assistant').first().waitFor();
  });
} catch {
  failed = true;
} finally {
  await cdp.send('Page.stopScreencast').catch(() => {});
  await context.close();
  await browser.close();
  makeVideo();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ base: BASE, real: REAL, when: new Date().toISOString(), passed: !failed, pr: prUrl || undefined, steps }, null, 2));
  writeFileSync(join(OUT, 'security.json'), JSON.stringify(security, null, 2));
  console.log(failed ? 'FAILED' : 'PASSED', `→ ${OUT}`);
  process.exit(failed ? 1 : 0);
}

// Variable-rate frames → MP4 that plays on iPhone (H.264, yuv420p, faststart).
function makeVideo() {
  if (frames.length < 2) return console.log('(no video: no frames)');
  const lines: string[] = [];
  frames.forEach((f, i) => {
    const next = frames[i + 1]?.t ?? f.t + 1.5;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.04, next - f.t).toFixed(3)}`);
  });
  lines.push(`file '${frames.at(-1)!.file}'`);
  const list = join(FRAMES, 'list.txt');
  writeFileSync(list, lines.join('\n'));
  try {
    execFileSync(process.env.FFMPEG ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=25', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', join(OUT, 'walkthrough.mp4')]);
    rmSync(FRAMES, { recursive: true, force: true });
    console.log(`video: ${frames.length} frames → walkthrough.mp4`);
  } catch (err) {
    console.log(`(no video: ${err})`);
  }
}
