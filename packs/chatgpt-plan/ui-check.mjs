// Drives the admin ChatGPT plan page on a phone-sized screen against the local stack
// (npm run dev:cathy). Not-connected states hit the real local Worker; connected states mock the
// API, because signing in to OpenAI can't be done from a test box.
// Usage: node packs/chatgpt-plan/ui-check.mjs   (writes screenshots to packs/chatgpt-plan/shots/)
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const OUT = new URL('./shots/', import.meta.url).pathname;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/status of 400/.test(m.text()) && errors.push(m.text()));
const results = [];
const ok = (name, cond) => { results.push({ name, ok: !!cond }); console.log((cond ? '✓ ' : '✗ ') + name); if (!cond) process.exitCode = 1; };
const status = () => page.textContent('[data-testid=chatgpt-status]');

await page.goto(BASE + '/');
ok('home has a ChatGPT plan card', await page.isVisible('[data-id=chatgpt]'));
await page.screenshot({ path: OUT + '0-home.png' });

await page.goto(BASE + '/chatgpt');
await page.waitForFunction(() => document.querySelector('[data-testid=chatgpt-status]').textContent !== 'Checking…');
ok('shows Not connected (real local Worker)', (await status()) === 'Not connected');
ok('only the connect card shows', (await page.isVisible('#connect')) && !(await page.isVisible('#connected')) && !(await page.isVisible('#manage')));
await page.screenshot({ path: OUT + '1-not-connected.png', fullPage: true });

await page.click('[data-testid=chatgpt-start]');
await page.waitForSelector('#open:not([hidden])');
ok('Open ChatGPT goes to auth.openai.com', (await page.getAttribute('#open', 'href')).startsWith('https://auth.openai.com/oauth/authorize?'));
ok('it opens in a new tab with noopener', (await page.getAttribute('#open', 'rel')).includes('noopener'));
ok('the paste box appears', await page.isVisible('[data-testid=chatgpt-paste]'));
await page.screenshot({ path: OUT + '2-started.png', fullPage: true });

await page.fill('[data-testid=chatgpt-paste]', 'http://localhost:1455/auth/callback?code=abc&state=wrong');
await page.click('[data-testid=chatgpt-finish]');
await page.waitForSelector('#connect-error:not([hidden])');
ok('a wrong address gets a plain reason (real local Worker)', /doesn't match/.test(await page.textContent('#connect-error')));
await page.screenshot({ path: OUT + '3-wrong-address.png', fullPage: true });

await page.route('**/api/cathy/chatgpt', (r) => r.request().method() === 'GET'
  ? r.fulfill({ json: { connected: true, email: 'chris@example.com', plan: 'plus', models: ['chatgpt/gpt-6.1-sol', 'chatgpt/gpt-6-astra'] } })
  : r.fulfill({ json: { ok: true } }));
let testReply = { ok: true, model: 'chatgpt/gpt-6.1-sol', reply: 'ready' };
await page.route('**/api/cathy/chatgpt/test', (r) => r.fulfill({ json: testReply }));
await page.goto(BASE + '/chatgpt');
await page.waitForFunction(() => document.querySelector('[data-testid=chatgpt-status]').textContent === 'Connected');
ok('shows who is connected', /chris@example.com · Plus plan/.test(await page.textContent('#who')));
ok('connect card hidden once connected', !(await page.isVisible('#connect')));
ok('model picker lists the plan models', (await page.$$eval('#model option', (o) => o.map((x) => x.textContent))).join() === 'gpt-6.1-sol,gpt-6-astra');
await page.click('[data-testid=chatgpt-test]');
await page.waitForFunction(() => /It works/.test(document.querySelector('#test-result').textContent));
await page.screenshot({ path: OUT + '4-connected-tested.png', fullPage: true });

testReply = { ok: false, model: 'x', error: "ChatGPT answered 400: The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account." };
await page.click('[data-testid=chatgpt-test]');
await page.waitForFunction(() => /not supported/.test(document.querySelector('#test-result').textContent));
ok('a refusal is shown in words, marked as an error', (await page.getAttribute('#test-result', 'class')).includes('bad'));
await page.screenshot({ path: OUT + '5-refused.png', fullPage: true });

testReply = { ok: false, error: '<img src=x onerror="window.__pwned=1"><b>hi</b>' };
await page.click('[data-testid=chatgpt-test]');
await page.waitForFunction(() => /<img/.test(document.querySelector('#test-result').textContent));
ok('hostile text from the server shows as text and runs nothing', !(await page.evaluate(() => window.__pwned)) && (await page.$$('#test-result img, #test-result b')).length === 0);

let asked = '';
page.on('dialog', async (d) => { asked = d.message(); await d.dismiss(); });
await page.click('[data-testid=chatgpt-disconnect]');
ok('disconnect asks first; cancelling keeps it connected', /Disconnect ChatGPT\?/.test(asked) && (await status()) === 'Connected');
ok('no sideways scrolling on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
ok('buttons are big enough to tap (44px+)', await page.$$eval('.btn', (bs) => bs.filter((x) => x.offsetHeight > 0).every((x) => x.offsetHeight >= 44)));
await page.emulateMedia({ colorScheme: 'dark' });
await page.screenshot({ path: OUT + '6-dark.png', fullPage: true });
ok('no browser errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, total: results.length }));
