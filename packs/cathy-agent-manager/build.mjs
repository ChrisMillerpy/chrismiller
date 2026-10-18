// Builds packs/cathy-agent-manager/index.html from the RFC text below and the test results in
// media/ (results.json, security.json, unit-tests.txt), so the tables always match the run.
// Usage: node packs/cathy-agent-manager/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const media = (f) => readFileSync(new URL(`media/${f}`, here), 'utf8');
const theme = readFileSync(new URL('../../shared/theme.css', here), 'utf8');
const results = JSON.parse(media('results.json'));
const security = JSON.parse(media('security.json'));
const unit = media('unit-tests.txt');
// The same browser test against real Claude and a real box, from the preview clone.
const real = JSON.parse(media('real/results.json'));
const realStep = (name) => real.steps.find((s) => s.name === name);
const realShot = (step) => step.shot && `media/real/${step.shot.replace(/\.png$/, '.jpg')}`;
const WALK = [6, 24, 38, 52, 64, 76, 92, 112];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const shot = (step) => step.shot && `media/${step.shot.replace(/\.png$/, '.jpg')}`;
const step = (name) => results.steps.find((s) => s.name === name);
const ok = (...names) => names.every((n) => step(n)?.ok);
const unitPass = unit.match(/^# pass (\d+)/m)?.[1];
const unitFail = unit.match(/^# fail (\d+)/m)?.[1];
const secOk = security.filter((s) => String(s.expected) === String(s.actual) || (s.expected === 'blocked' && /^(blocked|null)$/.test(String(s.actual))));

const PREVIEW = 'https://withchris-admin-cathy-yysxyt-evidence.withchris.workers.dev';

// ── Verdict: one row per goal ──
const both = (...names) => ok(...names) && names.every((n) => realStep(n)?.ok);
const verdicts = [
  ['Manage chats', 'Cathy names chats; you rename (your name wins); search; archive and unarchive', both('Cathy names the chat; Chris renames it') && ok('Search, archive and unarchive') ? 'Proven' : 'Not proven', '#real'],
  ['Model and effort', 'Pickers in the message box, saved per chat, labelled on each reply. Real Claude accepted effort and thinking on Opus 5.5 and Sonnet 5.5 (Haiku not tried).', both('Pick a model and effort') ? 'Proven' : 'Not proven', '#real'],
  ['Stop and interrupt', 'Square stop button; queue or interrupt; partial reply kept; next turn works', both('Stop a reply with the square button', 'Interrupt with a new message') ? 'Proven' : 'Not proven', '#real'],
  ['Attachments', 'Real Claude described an attached image correctly (a half-transparent red pixel: "Pink")', both('Attach an image; Cathy sees it') ? 'Proven' : 'Not proven', '#real'],
  ['Artifacts in chat', 'publish_artifact → card with preview → full screen; Markdown with maths; versions', both('Cathy publishes an artifact into the chat', 'Open the artifact full screen') && ok('Artifacts page: versions, new link') ? 'Proven' : 'Not proven', '#real'],
  ['Sharing', 'Private or link; link opens logged out; private or a new link kills the old one. Proven locally; not live until the share Worker is deployed.', ok('Share by link; open it logged out', 'Back to private: the link stops working') ? 'Partly' : 'Not proven', '#live'],
  ['Safety', 'Share Worker reaches nothing else; HTML artifacts sandboxed; uploads per chat; limits', secOk.length === security.length ? 'Proven' : 'Not proven', '#security'],
];

const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Cathy agent manager · RFC and evidence</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,500..600&family=Public+Sans:wght@400..600&display=swap">
<style>
${theme}
body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.6 var(--ui); }
main { max-width:820px; margin:0 auto; padding:28px max(16px, env(safe-area-inset-right)) 64px max(16px, env(safe-area-inset-left)); }
a { color:var(--cobalt); }
.back { font-weight:600; text-decoration:none; font-size:15px; }
.eyebrow { font-size:12.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--cobalt); margin:18px 0 6px; }
h1 { font:600 36px/1.1 var(--display); margin:0 0 12px; }
h2 { font:600 26px/1.2 var(--display); margin:44px 0 12px; padding-top:12px; border-top:1px solid var(--line); }
h3 { font:600 19px/1.3 var(--display); margin:26px 0 8px; }
.lede { font-size:18px; color:var(--muted); }
code { font:13.5px ui-monospace, monospace; background:var(--panel); border:1px solid var(--line); border-radius:5px; padding:1px 5px; }
pre { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; overflow-x:auto; font:13px/1.5 ui-monospace, monospace; }
table { width:100%; border-collapse:collapse; font-size:14.5px; margin:10px 0; }
th, td { text-align:left; vertical-align:top; padding:8px 10px; border-bottom:1px solid var(--line); }
th { font-size:12.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.v { font-weight:700; white-space:nowrap; }
.v-Proven { color:#1B8A4B; } .v-Partly { color:#B7791F; } .v-Not { color:var(--pen); }
@media (prefers-color-scheme: dark) { .v-Proven { color:#5BD18B; } .v-Partly { color:#F2B65A; } }
.box { background:var(--bg); border:1px solid var(--line); border-radius:14px; padding:14px 18px; margin:14px 0; }
.try { background:var(--cobalt-soft); border:0; }
.try b { font-family:var(--display); font-size:18px; }
video { width:100%; max-width:393px; border-radius:16px; border:1px solid var(--line); display:block; margin:12px auto; background:#000; }
.shots { display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:14px; }
.shots figure { margin:0; } .shots img { width:100%; border-radius:12px; border:1px solid var(--line); display:block; }
.shots figcaption { font-size:13px; color:var(--muted); margin-top:6px; }
.pair { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px; }
.pair img { width:100%; border-radius:12px; border:1px solid var(--line); }
ul.tight li { margin:4px 0; }
.ok { color:#1B8A4B; } .bad { color:var(--pen); }
</style>
</head>
<body>
<main>
<a class="back" href="/packs/">‹ Evidence packs</a>
<p class="eyebrow">RFC and evidence pack · PR #42 (merged)</p>
<h1>Cathy as an agent manager</h1>
<p class="lede">Named chats, model and thinking-effort pickers, stop and interrupt, attachments, and artifacts Cathy makes and you can share by link. Everything below comes from automated runs; the tables are generated from their results.</p>

<div class="box" id="live">
<b>Live now.</b> PR #42 is merged and deployed: everything works on admin except share links. The share Worker isn't deployed because my token can't edit workflow files, so <code>withchris-share.withchris.workers.dev</code> returns Cloudflare error 1042 (no such Worker). Switching an artifact to Link works, but the link won't open yet.<br>
<b>To finish:</b> on main, run <code>git apply patches/workflows.patch &amp;&amp; git rm -q patches/workflows.patch &amp;&amp; git commit -am 'Deploy R2 and share' &amp;&amp; git push</code>. The deploy then creates the share Worker.
</div>

<div class="box try">
<b>Try it yourself</b><br>
This pack's preview clone: <a href="${PREVIEW}/cathy">${PREVIEW.replace('https://', '')}</a>. Log in with your admin password. It's its own copy of everything (own chats, own D1 and R2), with real Claude and a real box, so try anything. It's torn down when this pack's PR closes.<br>
<small>Share links won't open there either until the workflow patch is applied (previews deploy the share Worker only after that).</small>
</div>

<h2 id="verdict">Verdict</h2>
<table>
<tr><th>Goal</th><th>What was checked</th><th>Result</th></tr>
${verdicts.map(([g, what, v, href]) => `<tr><td><b>${g}</b></td><td>${what}</td><td class="v v-${v.split(' ')[0]}"><a href="${href}" style="color:inherit">${v}</a></td></tr>`).join('\n')}
</table>
<p>Unit tests: <b>${unitPass} pass, ${unitFail} fail</b>. Browser test: <b>${results.steps.filter((s) => s.ok).length} of ${results.steps.length} steps pass</b>. Security checks: <b>${secOk.length} of ${security.length} pass</b>.</p>

<h3 id="gaps">What this does not prove yet</h3>
<ul class="tight">
<li><b>Share links on real infrastructure.</b> Proven locally (fresh logged-out browser, private and new-link revocation, 16 security probes), but not on Cloudflare: no share Worker is deployed yet. After the patch, the preview re-runs the full test, sharing included.</li>
<li><b>Haiku 5.5</b> with effort and thinking. Opus 5.5 and Sonnet 5.5 accepted them against the real API; Haiku wasn't tried. If it rejects them, the reply shows an error notice, and the fix is to drop it from <code>MODELS</code>.</li>
<li><b>Whether summarised thinking shows</b> with real Claude. The Thinking block is tested with the stand-in model; the real run doesn't check for it. Claude may skip thinking on short tasks at low or medium effort. Try a hard question at High effort in the preview.</li>
</ul>

<h2 id="rfc">RFC</h2>

<h3>Problem</h3>
<p>Cathy works, but the chat screen is bare next to the Claude Code app. Chats can't be named or found. You can't choose the model or how hard it thinks, and you can't stop it mid-task. You can't hand it a file. Anything it makes stays as text in a chat or a commit, with no simple way to view or share it.</p>

<h3>Goals</h3>
<ol>
<li>Manage chats: Cathy names them, you rename (your name wins), search, archive and unarchive.</li>
<li>Control the agent: model and effort per chat; stop; interrupt with a new message.</li>
<li>Give her things: attach images and files.</li>
<li>Get things back: artifacts (documents, worksheets, pages, images, PDFs) shown in the chat.</li>
<li>Share them: private (admin only) or anyone with the link.</li>
</ol>
<p><b>Not goals:</b> email invites, a public gallery, a <code>cathy</code> CLI, PR or diff views. All are possible later on the same backend.</p>

<h3>Design</h3>
<pre>
 iPhone / browser
     │  (Cloudflare Access: learn@withchris.uk)
     ▼
 admin Worker ── /api/cathy/* ──▶ Cathy Worker (private) ──▶ Session DO per chat ──▶ Sandbox box
                                     │        │                  (stop, interrupt,
                                     │        │                   model, effort)
                                     ▼        ▼
                                 D1 registry  R2 withchris-files
                                     ▲
 anyone with a link                  │ GET /share/a/&lt;token&gt; only
     │                               │
     ▼                               │
 share Worker (public) ──────────────┘
</pre>
<ul>
<li><b>Data.</b> D1 holds the facts: chats (now with <code>named_by</code>, <code>model</code>, <code>effort</code>), <code>uploads</code>, <code>artifacts</code> and <code>artifact_versions</code>. R2 holds the bytes at <code>uploads/&lt;id&gt;</code> and <code>artifacts/&lt;id&gt;/v&lt;n&gt;</code>. Republishing adds a version, and the link always serves the latest.</li>
<li><b>Publishing.</b> Cathy calls <code>publish_artifact(path, title, visibility?, id?)</code>. The Worker reads the file from her box, stores it and posts a card in the chat. She never holds storage credentials.</li>
<li><b>Attachments.</b> The page uploads each file first, then sends the message with their ids. The Session keeps only ids that belong to this chat, writes the files into her box at <code>/uploads/</code>, and passes images and PDFs to Claude inline.</li>
<li><b>Model and effort.</b> The choices live in <code>MODELS</code> in <code>cathy/worker/wrangler.jsonc</code>, which is the one source of truth. They're read at the start of every turn and sent to Anthropic as <code>effort</code> plus adaptive, summarised thinking.</li>
<li><b>Stop and interrupt.</b> Each turn has an <code>AbortController</code>. On a stop, her memory keeps only completed steps, so it never holds a tool call without its result. Her thinking isn't stored in memory, because it's signed per model and would break the chat after a model switch.</li>
<li><b>Sharing.</b> A small public Worker, <code>share/</code>, matches only <code>GET|HEAD /a/&lt;20-char token&gt;[/download]</code> and forwards a bare request with no cookies or query string. Cathy answers only for <code>link</code> artifacts. Responses are cached for 60 seconds, so un-sharing takes effect within a minute.</li>
</ul>

<h3>Alternatives considered</h3>
<table>
<tr><th>Option</th><th>Why not (for now)</th></tr>
<tr><td>A <code>cathy</code> CLI in her box (<code>cathy file publish x.html</code>)</td><td>It needs a public write endpoint and a token in her box. A tool gives the same result with no new door to the internet. It can still be added later as a layer over the same API.</td></tr>
<tr><td>File bytes in D1 (the first draft on this branch)</td><td>D1 caps a value at 2 MB and the database at about 500 MB, so files had to be split into pieces. R2 is built for files and has 10 GB free.</td></tr>
<tr><td>R2 keys in Cathy's box</td><td>Keys would open the whole bucket. Nothing would be recorded in D1, so no cards and no Artifacts page.</td></tr>
<tr><td>One Access-protected artifacts site with a public path exempted</td><td>It works, but one misconfigured Access rule exposes everything. A separate Worker that can only do one thing is easier to reason about.</td></tr>
<tr><td>Public gallery and email invites</td><td>Dropped at your request. "Anyone with the link" covers sharing a worksheet.</td></tr>
</table>

<h3>Security model</h3>
<ul>
<li>Admin, the API and private artifacts sit behind Cloudflare Access as before. The share Worker is the only new public surface. It holds no data and no secrets, and forwards a single route.</li>
<li>Link tokens are 20 characters from a 32-letter alphabet (100 bits), checked by format before any lookup. "New link" replaces the token.</li>
<li>Every stored file is served with <code>Content-Security-Policy: sandbox allow-scripts …</code> and no <code>allow-same-origin</code>, plus <code>nosniff</code>. In admin, previews are also in sandboxed iframes. So an HTML artifact can run its own scripts but can't read your cookies, use storage, or call admin's API. The <a href="#security">probe below</a> shows this.</li>
<li>Attachment ids are trusted only if they belong to the chat. File names are cleaned. A 25 MB limit is enforced on the server.</li>
<li>Cathy's <code>artifacts</code> skill makes artifacts private by default and forbids student or parent details in anything shared.</li>
</ul>

<h3>Rollout and rollback</h3>
<ul>
<li><b>Merged and deployed</b> (Cathy, then admin). D1 migration <code>0002</code> runs on first use and is safe to re-run. The R2 bucket <code>withchris-files</code> was created by the preview workflow from one of my in-progress pushes.</li>
<li><b>Still to do:</b> apply <code>patches/workflows.patch</code> on main. Its deploy creates <code>withchris-share</code>, and from then on share links work.</li>
<li><b>Old chats</b> keep working. The Session adds a <code>meta</code> column to existing message tables, and old messages show without labels.</li>
<li><b>Rollback:</b> revert PR #42. The bucket, share Worker and new D1 tables can stay; the old code ignores them.</li>
<li><b>Later:</b> move share to <code>artifacts.withchris.uk</code> when the domain moves over. That's one route and one var.</li>
</ul>

<h2 id="walkthrough">User walkthrough</h2>
<p>Every feature, used the way you would, on an iPhone-sized screen at 2x, with captions. It uses the local stack with the stand-in model, so replies are scripted, and it's recorded by <code>packs/cathy-agent-manager/walkthrough.ts</code>.</p>
<video src="media/user-walkthrough.mp4" controls playsinline preload="metadata" poster="media/walk-6.jpg"></video>
<div class="shots">${WALK.map((t) => `<figure><a href="media/walk-${t}.jpg"><img src="media/walk-${t}.jpg" alt="Walkthrough at ${t} s" loading="lazy"></a><figcaption>${t} s</figcaption></figure>`).join('\n')}</div>

<h2 id="real">With real Claude</h2>
<p>The preview clone ran the browser test against real Claude and a real box, on the final commit of PR #42 (${esc(real.when)}). <b>${real.steps.filter((s) => s.ok).length} of ${real.steps.length} steps passed.</b> The one failure is sharing: the clone has no share Worker yet (see <a href="#live">Live now</a>).</p>
<table>
<tr><th></th><th>Step</th><th>What happened</th></tr>
${real.steps.map((s) => `<tr><td class="${s.ok ? 'ok' : 'bad'}">${s.ok ? '✓' : '✗'}</td><td>${s.shot ? `<a href="${realShot(s)}">${esc(s.name)}</a>` : esc(s.name)}</td><td>${esc((s.detail ?? '').slice(0, 220))}</td></tr>`).join('\n')}
</table>
<p>Recorded as it ran:</p>
<video src="media/real/walkthrough.mp4" controls playsinline preload="metadata"></video>

<h3>Bug the preview found in itself</h3>
<p>That run reported <code>preview-e2e: success</code> even though a step failed (<code>results.json</code> says <code>passed: false</code>). The cause: <code>node … | tee e2e.log</code> takes the exit code from <code>tee</code>. The fix, <code>set -o pipefail</code>, is in <code>patches/workflows.patch</code>.</p>

<h2 id="local">The full test, locally</h2>
<p>The same test plus the local-only checks (search and archive, the hostile HTML artifact, security probes), using the stand-in model and local D1 and R2. ${results.steps.filter((s) => s.ok).length} of ${results.steps.length} steps pass.</p>
<video src="media/walkthrough.mp4" controls playsinline preload="metadata"></video>

<h2 id="steps">Step by step</h2>
<table>
<tr><th></th><th>Step</th><th>Detail</th></tr>
${results.steps.map((s) => `<tr><td class="${s.ok ? 'ok' : 'bad'}">${s.ok ? '✓' : '✗'}</td><td>${s.shot ? `<a href="${shot(s)}">${esc(s.name)}</a>` : esc(s.name)}</td><td>${esc((s.detail ?? '').slice(0, 260))}</td></tr>`).join('\n')}
</table>

<h3>The key moments</h3>
<div class="pair">
<figure><img src="media/artifact-viewer.jpg" alt="Worksheet artifact full screen with rendered fractions"><figcaption>A Markdown worksheet opened full screen, with its maths rendered.</figcaption></figure>
<figure><img src="media/share-logged-out.jpg" alt="The same worksheet opened by link in a fresh browser"><figcaption>The same worksheet opened by its link in a fresh browser with no cookies.</figcaption></figure>
<figure><img src="media/sandbox-probe.jpg" alt="Sandbox probe: everything blocked"><figcaption>A hostile HTML artifact: origin null, and cookies, storage, parent page and admin API all blocked.</figcaption></figure>
</div>

<h3>Every screenshot</h3>
<div class="shots">
${results.steps.filter((s) => s.shot).map((s) => `<figure><a href="${shot(s)}"><img src="${shot(s)}" alt="${esc(s.name)}" loading="lazy"></a><figcaption>${esc(s.name)}</figcaption></figure>`).join('\n')}
</div>

<h2 id="security">Security checks</h2>
<table>
<tr><th></th><th>Check</th><th>Expected</th><th>Actual</th></tr>
${security.map((s) => { const pass = secOk.includes(s); return `<tr><td class="${pass ? 'ok' : 'bad'}">${pass ? '✓' : '✗'}</td><td>${esc(s.check)}</td><td>${esc(s.expected)}</td><td>${esc(s.actual)}</td></tr>`; }).join('\n')}
</table>
<p>Unit tests check the same rules without a browser: <code>share/src/index.test.ts</code> (only one route, nothing else reaches Cathy) and <code>cathy/worker/src/api.test.ts</code> (private, wrong, old tokens; Markdown can't break out of its page).</p>

<h2 id="unit">Unit tests</h2>
<p><b>${unitPass} pass, ${unitFail} fail</b>, up from 70. New areas: registry (names, uploads, artifacts, versions, R2), API routes, share Worker, box files, models, conversation (stop, interrupt, thinking, labels), and the artifacts skill. Full output: <a href="media/unit-tests.txt">unit-tests.txt</a>.</p>
<p><b>Test-first:</b> stop/interrupt and memory after a stop, the share route rules, box-files, and the artifacts skill each began as a failing test. The earlier registry and API code got its tests straight after. For that code I checked that removing a key guard turns a test red (for example, the "another chat's artifact" check).</p>

<h2 id="code">Load-bearing code</h2>
<h3>The share Worker forwards one route, bare</h3>
<pre>const TOKEN = /^\\/a\\/([a-z0-9]{20})(\\/download)?\\/?$/;
…
// Only the token and the download flag go through: no query string, no cookies, no other headers.
const target = new URL(\`https://cathy.internal/share/a/\${m[1]}\${m[2] ?? ''}\`);
const res = await env.CATHY.fetch(new Request(target, { method: request.method }));</pre>
<h3>Only link artifacts are ever found by token</h3>
<pre>async shared(token) {
  if (!/^[a-z0-9]{20}$/.test(token)) return null;
  … "SELECT * FROM artifacts WHERE token = ? AND visibility = 'link'"</pre>
<h3>After a stop, memory keeps only finished steps</h3>
<pre>/** After a stop: drop tool calls that never got a result (and empty messages left behind). */
export function completeSteps(messages) {
  const answered = new Set(… toolCallId of every tool result …);
  return forMemory(messages.map((m) => … keep tool-call only if answered.has(p.toolCallId) …));
}</pre>
<h3>Every stored file runs sandboxed</h3>
<pre>export const SANDBOX_CSP = "sandbox allow-scripts allow-modals allow-downloads allow-popups; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'";</pre>

<h2 id="before-live">Before this goes live</h2>
<ol>
<li>Apply <code>patches/workflows.patch</code> on main. The command is at the top of the file and in <a href="#live">Live now</a>.</li>
<li>Check <code>share-deploy</code> goes green, then switch one artifact to Link and open it on your phone.</li>
<li>Later: <code>artifacts.withchris.uk</code> once the domain moves (one route, one var).</li>
</ol>

<h2 id="reproduce">Reproduce</h2>
<pre>npm ci
npm test                                   # ${unitPass} unit tests
npm run typecheck:workers
npm run dev:cathy                          # admin on :8787 (stand-in model)
npx wrangler dev -c share/wrangler.jsonc --port 8788   # share links
BASE_URL=http://localhost:8787 OUT=e2e-out npm run e2e
BASE_URL=http://localhost:8787 OUT=walk node packs/cathy-agent-manager/walkthrough.ts   # the user walkthrough
node packs/cathy-agent-manager/build.mjs   # rebuild this page from e2e-out (copy results into media/)</pre>
<p>Local run ${esc(results.when)} against ${esc(results.base)}. Real run ${esc(real.when)}: <a href="https://github.com/ChrisMillerpy/chrismiller/actions/runs/39049272391">Actions log</a>.</p>
</main>
</body>
</html>
`;

writeFileSync(new URL('index.html', here), html);
console.log(`wrote index.html: ${results.steps.length} steps, ${security.length} security checks, ${unitPass} unit tests`);
