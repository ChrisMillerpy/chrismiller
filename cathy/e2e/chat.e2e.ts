// End-to-end: drive admin → Cathy like Chris does on his phone, record video and screenshots.
// Usage: BASE_URL=http://localhost:8787 OUT=./e2e-out node cathy/e2e/chat.e2e.ts
// Env: REAL=1 for real Claude and sandbox (longer waits, asks for a real command);
//      CHROMIUM=/path/to/chrome to use a specific browser; ADMIN_PASSWORD if admin has one.
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const OUT = process.env.OUT ?? 'e2e-out';
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
  httpCredentials: process.env.ADMIN_PASSWORD ? { username: 'chris', password: process.env.ADMIN_PASSWORD } : undefined,
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
let failed = false;

try {
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
    await page.locator('[data-testid=status][data-status=idle]').waitFor();
    return `chat ${chatUrl.split('/').pop()}, branch ${await page.locator('#branch').textContent()}`;
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
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ timeout: REPLY_TIMEOUT });
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
    await page.getByText('‹ Chats').click();
    await page.waitForURL(/\/cathy$/);
    const row = page.getByTestId('chat-row').filter({ hasText: chatUrl.split('/').pop()! });
    await row.waitFor();
    // Phones zoom out to fit wide pages, so compare with the real screen width, not innerWidth.
    const screenWidth = page.viewportSize()!.width;
    const widest = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('.chat')].map((e) => e.getBoundingClientRect().right)));
    if (widest > screenWidth) throw new Error(`page is ${Math.round(widest - screenWidth)}px wider than the screen`);
    return (await row.textContent())!.replace(/\s+/g, ' ').trim().slice(0, 160);
  });

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
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ base: BASE, real: REAL, when: new Date().toISOString(), passed: !failed, steps }, null, 2));
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
