// A user walkthrough of the agent-manager features, recorded for the evidence pack.
// Slower than the test, with a caption bar saying what's happening. Runs against the local
// stack (stand-in model), so it's the same every time.
// Usage: npm run dev:cathy; npx wrangler dev -c share/wrangler.jsonc --port 8788;
//        BASE_URL=http://localhost:8787 OUT=/tmp/walk node packs/cathy-agent-manager/walkthrough.ts
import { chromium, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const OUT = resolve(process.env.OUT ?? 'walk-out');
const FRAMES = join(OUT, 'frames');
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const page = await context.newPage();

// Video: 2x screenshots taken in a loop (about 8 a second), stitched with ffmpeg after.
// Crisper than recordVideo or the CDP screencast, which both give 1x frames.
const frames: { file: string; t: number }[] = [];
let filming = true;
const filmed = (async () => {
  while (filming) {
    const t = Date.now() / 1000;
    const file = join(FRAMES, `${String(frames.length).padStart(5, '0')}.jpg`);
    try {
      writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 82, animations: 'allow', caret: 'initial', timeout: 2000 }));
      frames.push({ file, t });
    } catch {}
    await new Promise((r) => setTimeout(r, 60));
  }
})();

// A caption bar over the top of the page, re-added after each navigation.
const CAPTION = `(() => {
  if (document.getElementById('__cap')) return;
  const d = document.createElement('div'); d.id = '__cap';
  d.style.cssText = 'position:fixed;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom) + 118px);z-index:99999;background:rgba(24,32,58,.92);color:#fff;font:600 15px/1.35 system-ui,sans-serif;padding:10px 14px;border-radius:14px;pointer-events:none;transition:opacity .25s;opacity:0;box-shadow:0 6px 24px rgba(0,0,0,.25)';
  document.documentElement.appendChild(d);
})()`;
async function say(text: string, ms = 2600) {
  await page.evaluate(CAPTION).catch(() => {});
  await page.evaluate((t) => { const d = document.getElementById('__cap')!; d.textContent = t; d.style.opacity = t ? '1' : '0'; }, text).catch(() => {});
  await page.waitForTimeout(ms);
}
const hush = () => say('', 300);
const idle = () => page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached', timeout: 30_000 });
async function typeSlow(text: string) {
  await page.getByTestId('composer').click();
  await page.keyboard.type(text, { delay: 35 });
}
const send = async (text: string) => {
  await typeSlow(text);
  await page.waitForTimeout(400);
  await page.getByTestId('send').click();
};

// A picture of a maths question to attach, drawn by the browser.
async function questionImage() {
  const p = await context.newPage();
  await p.setViewportSize({ width: 480, height: 300 });
  await p.setContent(`<body style="margin:0;display:grid;place-items:center;height:100vh;background:#fffbea;font:28px Georgia,serif;color:#222">
    <div style="text-align:center"><div style="font-size:18px;color:#a16207;letter-spacing:.1em">QUESTION 4</div><div style="margin-top:14px">Solve&nbsp;&nbsp;<i>x</i>² − 5<i>x</i> + 6 = 0</div></div></body>`);
  const buf = await p.screenshot();
  await p.close();
  return buf;
}

try {
  if (process.env.ADMIN_PASSWORD) {
    await page.goto(BASE + '/login');
    await page.locator('#password').fill(process.env.ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
  }
  await page.goto(BASE + '/');
  await say('Admin home. Cathy now sits next to a new Artifacts page.', 3200);

  await page.locator('[data-id=cathy]').click();
  await page.waitForURL(/\/cathy$/);
  await say('Chats can be searched, and archived chats have their own tab.');

  await page.getByTestId('new-chat').click();
  await page.waitForURL(/\/cathy\/[a-z0-9]+$/);
  await idle();
  await say('A new chat. The model and thinking effort pickers sit in the message box.', 3200);

  await send('Hi Cathy, can you help me plan a quadratics lesson?');
  await say('Cathy works: tool calls show as she goes…', 1800);
  await page.waitForFunction(() => !/^(Cathy|New chat)$/.test(document.querySelector('[data-testid=chat-title]')!.textContent!.trim()), null, { timeout: 30_000 });
  await idle();
  await say('…and she names the chat herself on her first reply (top of the screen).', 3200);

  const title = page.getByTestId('chat-title');
  await title.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Quadratics lesson', { delay: 45 });
  await page.keyboard.press('Enter');
  await say('Tap the title to rename it. Your name always wins over hers.', 3000);

  await page.getByTestId('model').selectOption('claude-sonnet-5-5');
  await say('Switch model for this chat…', 1800);
  await page.getByTestId('effort').selectOption('high');
  await say('…and thinking effort. Both are saved on the chat and used from the next turn.', 3200);

  await page.getByTestId('file-input').setInputFiles({ name: 'question-4.png', mimeType: 'image/png', buffer: await questionImage() });
  await page.getByTestId('pending-file').waitFor();
  await say('Attach files with the paperclip, paste or drag and drop. Images go straight to Claude.', 3200);
  await send('What does this question ask?');
  await page.getByTestId('attachment').first().waitFor();
  await idle();
  await say('Each reply is labelled with the model and effort that wrote it.', 3200);

  await send('Give me a long answer about the history of quadratics');
  await page.getByTestId('msg-streaming').waitFor({ timeout: 20_000 });
  await say('While she works, Send turns into a white square…', 2200);
  await page.getByTestId('stop').click();
  await idle();
  await say('…tap it to stop. What she wrote so far stays, marked Stopped.', 3200);

  await send('Another long answer please');
  await page.getByTestId('msg-streaming').waitFor({ timeout: 20_000 });
  await typeSlow('Actually, just a short one');
  await page.getByTestId('interrupt').waitFor();
  await say('Type while she works and you choose: Queue it, or Interrupt her.', 3000);
  await page.getByTestId('interrupt').click();
  await page.waitForTimeout(800);
  await idle();
  await say('Interrupt stops the current reply and answers the new message straight away.', 3200);

  await send('Please publish the worksheet');
  await page.getByTestId('artifact').first().waitFor({ timeout: 30_000 });
  await idle();
  await page.getByTestId('artifact').first().scrollIntoViewIfNeeded();
  await say('Cathy publishes an artifact: a card in the chat with a live preview.', 3400);

  await page.getByTestId('artifact').first().getByRole('button', { name: 'Open' }).click();
  await page.getByTestId('viewer').waitFor();
  await say('Open it full screen. Markdown worksheets render with maths.', 3400);
  await page.getByTestId('viewer').getByRole('button', { name: 'Close' }).click();

  const card = page.getByTestId('artifact').first();
  await card.getByRole('button', { name: 'Link' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=artifact]')?.getAttribute('data-visibility') === 'link');
  await say('Private by default. Switch to Link and the share link is copied for you.', 3200);
  const id = (await card.getAttribute('data-id'))!;
  const a = await (await page.request.get(`${BASE}/api/cathy/artifacts/${id}`)).json();
  const chat = page.url();

  await page.goto(a.share_url);
  await say('Anyone with the link can open it. No login, nothing else reachable.', 3600);
  await page.goto(chat);
  await idle();
  await page.getByTestId('artifact').first().scrollIntoViewIfNeeded();
  await page.getByTestId('artifact').first().getByRole('button', { name: 'Private' }).click();
  await say('Switch back to Private…', 1800);
  await page.goto(a.share_url);
  await say('…and the same link stops working.', 3000);

  await page.goto(`${BASE}/artifacts`);
  await page.getByTestId('artifact').first().waitFor();
  await say('The Artifacts page: everything Cathy has made, searchable, with Private / Shared filters.', 3400);
  await page.goto(`${BASE}/artifacts/${id}`);
  await page.getByTestId('artifact-title').waitFor();
  await page.waitForTimeout(800);
  await say('Each artifact: rename, preview, copy or replace its link, every version, delete.', 3400);

  await page.goto(chat);
  await idle();
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Tap again to archive' }).click();
  await page.waitForURL(/\/cathy$/);
  await page.getByTestId('archived-tab').click();
  await page.getByTestId('chat-row').first().waitFor();
  await say('Archived chats move here, and come back with Unarchive.', 3000);
  await page.getByTestId('unarchive').first().click();
  await page.getByRole('button', { name: 'Active' }).click();
  await page.getByTestId('chat-row').first().waitFor();

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(chat);
  await idle();
  await say('All of it works in dark mode too.', 3000);
  await hush();
  console.log('walkthrough recorded');
} finally {
  filming = false;
  await filmed;
  await context.close();
  await browser.close();
  // Variable-rate frames → MP4 that plays on iPhone (H.264, yuv420p, faststart).
  const lines: string[] = [];
  frames.forEach((f, i) => lines.push(`file '${f.file}'`, `duration ${Math.max(0.033, (frames[i + 1]?.t ?? f.t + 1.5) - f.t).toFixed(3)}`));
  lines.push(`file '${frames.at(-1)!.file}'`);
  writeFileSync(join(FRAMES, 'list.txt'), lines.join('\n'));
  execFileSync(process.env.FFMPEG ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(FRAMES, 'list.txt'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '26', '-movflags', '+faststart', join(OUT, 'user-walkthrough.mp4')]);
  rmSync(FRAMES, { recursive: true, force: true });
  console.log(`→ ${join(OUT, 'user-walkthrough.mp4')} (${frames.length} frames)`);
}
