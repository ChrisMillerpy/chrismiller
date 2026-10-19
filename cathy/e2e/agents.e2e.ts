// End-to-end: sub-agents, driven through admin like Chris does on his phone.
// Usage: npm run dev:cathy, then BASE_URL=http://localhost:8787 OUT=./agents-out node cathy/e2e/agents.e2e.ts
// Env: REAL=1 for real Claude and sandbox (longer waits, plain-English asks); ADMIN_PASSWORD if admin has one;
//      CHROMIUM=/path/to/chrome for a specific browser. Results land in OUT/results.json with a screenshot per step.
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const OUT = resolve(process.env.OUT ?? 'agents-out');
const REAL = process.env.REAL === '1';
const WAIT = REAL ? 300_000 : 30_000;
mkdirSync(OUT, { recursive: true });

type Step = { name: string; ok: boolean; ms: number; detail?: string; shot?: string };
const steps: Step[] = [];
async function step(name: string, page: Page, fn: () => Promise<string | void>) {
  const t = Date.now();
  const shot = `${String(steps.length + 1).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  try {
    const detail = (await fn()) ?? undefined;
    await page.waitForTimeout(500);
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
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const api = async (path: string) => (await page.request.get(BASE + '/api/cathy' + path)).json();
const ask = {
  spawn: REAL
    ? 'Use spawn_agent to start one fresh sub-agent on Haiku with low effort, titled "Demo helper". Its task: run `git log --oneline -1` and report the line. Then end your turn; when its report arrives, tell me what it said in one sentence.'
    : 'Please spawn a helper on haiku',
  fork: REAL ? 'Now use spawn_agent in fork mode, titled "Demo fork", to report in one sentence what I asked you first. End your turn after starting it.' : 'Now spawn a fork',
  child: REAL ? 'Hi, Chris here. Which branch are you on? One line.' : 'Hi helper, Chris here',
};

let parentUrl = '';
let failed = false;
const parentId = () => parentUrl.split('/').pop()!;
const reportsInParent = () => page.locator('.m.cathy').count();

try {
  if (process.env.ADMIN_PASSWORD) {
    await page.goto(BASE + '/cathy');
    await page.locator('#password').fill(process.env.ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/cathy$/);
  }

  await step('Ask Cathy to start a sub-agent on Haiku', page, async () => {
    await page.goto(BASE + '/cathy');
    await page.getByTestId('new-chat').click();
    await page.waitForURL(/\/cathy\/[a-z0-9]+$/);
    parentUrl = page.url();
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached' });
    await page.getByTestId('composer').fill(ask.spawn);
    await page.getByTestId('send').click();
    await page.getByTestId('agent-chip').first().waitFor({ timeout: WAIT });
    const tool = await page.locator('[data-testid=msg-tool]', { hasText: 'spawn_agent' }).first().textContent();
    return `chip "${(await page.getByTestId('agent-chip').first().textContent())?.trim()}" under the header; tool: ${tool?.trim()}`;
  });

  await step('Its report comes back and the parent answers', page, async () => {
    const report = page.locator('.m.cathy').first();
    await report.waitFor({ timeout: WAIT });
    const from = await report.getAttribute('data-from');
    if (!/sub-agent: Demo helper/.test(from ?? '')) throw new Error(`report labelled "${from}"`);
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached', timeout: WAIT });
    await page.waitForFunction(() => {
      const ms = [...document.querySelectorAll('.m')];
      const r = ms.findIndex((m) => m.classList.contains('cathy'));
      return r >= 0 && ms.slice(r + 1).some((m) => m.classList.contains('assistant') && !m.hasAttribute('data-streaming'));
    }, null, { timeout: WAIT });
    const after = (await page.locator('.m.assistant').last().textContent())!.trim();
    return `${from}: "${(await report.textContent())!.replace('Open chat ›', '').trim().slice(0, 140)}" → parent: "${after.slice(0, 140)}"`;
  });

  await step('Open the sub-agent: its own chat, model and branch', page, async () => {
    const kids = (await api('/sessions')).filter((s: any) => s.parent_id === parentId());
    if (kids.length !== 1) throw new Error(`${kids.length} children in the registry`);
    const k = kids[0];
    if (k.model !== 'claude-haiku-5-5' || k.effort !== 'low') throw new Error(`child model ${k.model} ${k.effort}`);
    await page.getByTestId('agent-chip').first().click();
    await page.waitForURL(new RegExp(`/cathy/${k.id}$`));
    await page.getByTestId('parent-link').waitFor();
    const first = page.locator('.m.cathy').first();
    await first.waitFor();
    const label = (await page.getByTestId('reply-label').first().textContent())!.trim();
    if (!/Haiku/.test(label) || !/low effort/.test(label)) throw new Error(`reply label "${label}"`);
    return `header "${(await page.locator('#branch').textContent())!.trim()}"; first message ${await first.getAttribute('data-from')}; reply label "${label}"`;
  });

  await step('Chris talks to the sub-agent directly; nothing is reported up', page, async () => {
    const before = (await api('/sessions')).find((s: any) => s.id === parentId()).last_message;
    const replies = await page.locator('.m.assistant').count();
    await page.getByTestId('composer').fill(ask.child);
    await page.getByTestId('send').click();
    await page.waitForFunction((n) => document.querySelectorAll('.m.assistant:not([data-streaming])').length > n, replies, { timeout: WAIT });
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached', timeout: WAIT });
    await page.waitForTimeout(REAL ? 5000 : 1500);
    const after = (await api('/sessions')).find((s: any) => s.id === parentId()).last_message;
    if (after !== before) throw new Error(`parent got a new message: ${after}`);
    return `sub-agent replied: "${(await page.locator('.m.assistant').last().textContent())!.trim().slice(0, 120)}"; parent unchanged`;
  });

  await step('Fork a second sub-agent', page, async () => {
    await page.goto(parentUrl);
    await page.locator('[data-testid=status][data-status=idle]').waitFor({ state: 'attached', timeout: WAIT });
    const reports = await reportsInParent();
    await page.getByTestId('composer').fill(ask.fork);
    await page.getByTestId('send').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=agent-chip]').length === 2, null, { timeout: WAIT });
    await page.waitForFunction((n) => document.querySelectorAll('.m.cathy').length > n, reports, { timeout: WAIT });
    const kids = (await api('/sessions')).filter((s: any) => s.parent_id === parentId());
    const fork = kids.find((k: any) => k.mode === 'fork');
    if (!fork) throw new Error('no fork in the registry');
    return `chips: ${(await page.getByTestId('agent-chip').allTextContents()).map((s) => s.trim()).join(', ')}; fork ${fork.id} reported back`;
  });

  await step('The chat list nests sub-agents under their parent', page, async () => {
    await page.goto(BASE + '/cathy');
    await page.getByTestId('agent-row').first().waitFor();
    const order = await page.evaluate(() => [...document.querySelectorAll('#chats > li')].map((li) => (li.classList.contains('sub') ? '  ' : '') + li.querySelector('.title')!.textContent));
    const tags = await page.locator('.chats li.sub .tag').allTextContents();
    if (!tags.some((t) => /sub-agent · fresh · Haiku/.test(t))) throw new Error(`tags: ${tags.join(' | ')}`);
    const firstSub = order.findIndex((t) => t.startsWith('  '));
    if (order.filter((t) => t.startsWith('  ')).length < 2 || firstSub < 1) throw new Error(`not nested: ${order.join(' / ')}`);
    return `list: ${order.slice(0, 6).join(' / ')}; tags: ${tags.join(' | ')}`;
  });

  await step('Archiving the parent archives its sub-agents', page, async () => {
    await page.goto(parentUrl);
    await page.locator('#archive').click();
    await page.locator('#archive').click();
    await page.waitForURL(/\/cathy$/);
    const active = (await api('/sessions')).filter((s: any) => s.id === parentId() || s.parent_id === parentId());
    if (active.length) throw new Error(`${active.length} still active`);
    const archived = (await api('/sessions?status=archived')).filter((s: any) => s.parent_id === parentId());
    return `${archived.length} sub-agents archived with it`;
  });
} catch {
  failed = true;
} finally {
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ base: BASE, real: REAL, at: new Date().toISOString(), steps }, null, 2));
  await browser.close();
  process.exit(failed ? 1 : 0);
}
