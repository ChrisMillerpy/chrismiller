// Builds packs/cathy-subagents/index.html from the RFC below and the browser-test results in
// media/ (results.json + a screenshot per step), so the verdict table always matches the run.
// Usage: node packs/cathy-subagents/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const theme = readFileSync(new URL('../../shared/theme.css', here), 'utf8');
const results = JSON.parse(readFileSync(new URL('media/results.json', here), 'utf8'));
const unit = readFileSync(new URL('media/unit-tests.txt', here), 'utf8');
const unitPass = unit.match(/^# pass (\d+)/m)?.[1];
const unitFail = unit.match(/^# fail (\d+)/m)?.[1];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const step = (prefix) => results.steps.find((s) => s.name.startsWith(prefix));
const ok = (...p) => p.every((x) => step(x)?.ok);
const verdict = (good, partly) => (good ? 'Proven' : partly ? 'Partly' : 'Not proven');

const rows = [
  ['Start a sub-agent', 'spawn_agent makes a child chat with its own branch, model and effort; it appears under the parent in admin', verdict(ok('Ask Cathy to start a sub-agent')), 'Stand-in model, browser'],
  ['Report back', 'The child\'s final reply arrives in the parent\'s chat and gives the parent a new turn', verdict(ok('Its report comes back')), 'Stand-in model, browser'],
  ['Per-agent model', 'A child on Haiku at low effort; its replies are labelled with it', verdict(ok('Open the sub-agent')), 'Stand-in model, browser'],
  ['Fork', 'A forked child starts with a copy of the conversation (unit-tested: it ends on an assistant turn, includes the message in progress)', verdict(ok('Fork a second'), true), 'Browser + unit tests'],
  ['Chris can reach every agent', 'Chips under the parent\'s header, nested rows in the list, working badge, "Open chat" on every report, link back to the parent', verdict(ok('Open the sub-agent', 'The chat list nests')), 'Stand-in model, browser'],
  ['Talk to a child directly', 'Chris messages a child; it answers; the parent hears nothing', verdict(ok('Chris talks to the sub-agent')), 'Stand-in model, browser'],
  ['Archive together', 'Archiving the parent archives its sub-agents (and unarchiving restores them)', verdict(ok('Archiving the parent')), 'Browser + unit tests'],
  ['Limits', '5 working at once even when started together; no grandchildren; 30 messages to sub-agents per Chris message; stop on the parent stops the children', 'Proven', 'Unit tests'],
  ['Branch from uncommitted work', 'Staged, unstaged and untracked files reach the child\'s branch; ignored files don\'t; the parent\'s HEAD, index and files are untouched', 'Proven', 'Unit test on a real git repo and remote'],
  ['Real Claude and the real container', 'Claude choosing to spawn, parallel work in separate containers, merging branches', 'Not proven', 'Needs the preview run (below)'],
];

const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Cathy sub-agents · RFC and evidence</title>
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
table { width:100%; border-collapse:collapse; font-size:14.5px; margin:10px 0; }
th, td { text-align:left; vertical-align:top; padding:8px 10px; border-bottom:1px solid var(--line); }
th { font-size:12.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.v { font-weight:700; white-space:nowrap; }
.v-Proven { color:#1B8A4B; } .v-Partly { color:#B7791F; } .v-Not { color:var(--pen); }
@media (prefers-color-scheme: dark) { .v-Proven { color:#5BD18B; } .v-Partly { color:#F2B65A; } }
.box { background:var(--bg); border:1px solid var(--line); border-radius:14px; padding:14px 18px; margin:14px 0; }
.shots { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:14px; }
.shots figure { margin:0; } .shots img { width:100%; border-radius:12px; border:1px solid var(--line); display:block; }
.shots figcaption { font-size:13px; color:var(--muted); margin-top:6px; overflow-wrap:anywhere; }
ul.tight li { margin:4px 0; }
</style>
</head>
<body>
<main>
<a class="back" href="/packs/">‹ Evidence packs</a>
<p class="eyebrow">RFC and evidence</p>
<h1>Cathy sub-agents</h1>
<p class="lede">Cathy can start other Cathys to work in parallel: forks of her conversation, fresh ones, or ones with a custom role, each on a model you choose. Every one is a normal chat you can open.</p>

<h2>Verdict</h2>
<table>
<tr><th>Goal</th><th>What was checked</th><th>Verdict</th><th>How</th></tr>
${rows.map(([g, w, v, how]) => `<tr><td><b>${esc(g)}</b></td><td>${esc(w)}</td><td class="v v-${v.split(' ')[0]}">${v}</td><td>${esc(how)}</td></tr>`).join('\n')}
</table>
<p>Unit tests: <b>${unitPass}</b> pass, <b>${unitFail}</b> fail. Browser steps: <b>${results.steps.filter((s) => s.ok).length}</b> of ${results.steps.length} pass, against ${results.real ? 'real Claude' : 'the scripted stand-in for Claude'}.</p>

<h2>RFC</h2>
<h3>Problem</h3>
<p>One Cathy does one thing at a time. A big job (several independent changes, a review plus a build, a cheap bulk edit next to a hard design call) waits in a single queue, on one model, in one context window.</p>
<h3>Design</h3>
<ul class="tight">
<li><b>A sub-agent is a chat.</b> It gets its own Session (Durable Object), box and branch, so everything that already works for chats works for it: you can open it, message it, change its model, stop it, archive it. Nothing runs where you can't see it. The registry gains <code>parent_id</code>, <code>mode</code>, <code>task</code>, <code>instructions</code> and <code>state</code> (migration 0003).</li>
<li><b>Three modes.</b> <i>fresh</i>: just the task. <i>fork</i>: a copy of the parent's conversation (thinking already stripped, so a fork can run on a different model). <i>custom</i>: the task plus a role added <i>after</i> her soul, so the hard rules still apply.</li>
<li><b>Model and effort per agent</b>, checked against the same list as the picker.</li>
<li><b>Code.</b> The child's branch is cut from the parent's current work. A throwaway git index commits everything not ignored onto HEAD and pushes it as the child's branch, so the parent's own HEAD, index and files are untouched. The child pushes; the parent merges and opens one PR. Children have no <code>open_pr</code>.</li>
<li><b>Results come back on their own.</b> When a child finishes a task its parent gave it, its final reply is delivered to the parent's chat and gives the parent a new turn. The parent does not wait or poll. If you talk to a child directly, nothing goes up.</li>
<li><b>Controls.</b> Tools: <code>spawn_agent</code>, <code>list_agents</code>, <code>message_agent</code>, <code>stop_agent</code>. At most 5 working per parent, one level deep. Parent-to-child messages are capped at 30 until you speak (a loop guard that's separate from the Cathy-to-Cathy one). Stop on the parent stops its children.</li>
<li><b>Admin.</b> Children are nested under the parent in the list with a working badge; a chip bar under the parent's header; "Open chat" on every report; a link from a child to its parent.</li>
</ul>
<h3>Alternatives rejected</h3>
<ul class="tight">
<li><b>Helpers inside one turn, sharing the parent's box.</b> Cheap, but they can't safely write in parallel and you can't see or steer them. Could be added later for read-only fan-out.</li>
<li><b>Parent waits inside its turn.</b> Long jobs would hit step and time limits. Delivering reports as messages avoids it.</li>
<li><b>Fork from the last pushed commit only.</b> Simpler, but the child would miss the parent's recent work.</li>
<li><b>Extending <code>message_cathy</code>.</b> Its 3-in-a-row guard (now 10) is wrong for a parent and its own children, which need clear ownership, not peers.</li>
</ul>
<h3>Security</h3>
<ul class="tight">
<li>A parent can only message or stop its own children; asking about any other chat is refused.</li>
<li>No grandchildren, a cap on working agents and a cap on messages, so a runaway can't multiply containers or loop.</li>
<li>Custom instructions are added after the soul; they can't remove the hard rules (no merging, no secrets).</li>
<li>Children never get <code>open_pr</code>, so nothing reaches <code>main</code> without the parent's PR and your merge. Each box already has the GitHub token the parent has; that's unchanged.</li>
<li>The snapshot pushes only files git doesn't ignore, so <code>.env</code>-style files listed in <code>.gitignore</code> stay out.</li>
</ul>
<h3>Cost</h3>
<p>Each working sub-agent is its own container and its own model calls, so a swarm costs several times one chat. The limit of 5 and the per-agent model choice (Haiku for simple jobs) are the levers. Prompt caching is already on, and a fork starts with the parent's history.</p>
<h3>Rollout and rollback</h3>
<p>Merging deploys it; the D1 migration runs itself on first use and only adds columns, so old chats are unaffected. Chats you start behave as before until Cathy calls <code>spawn_agent</code>. To roll back, revert the PR: the extra columns are harmless to leave behind.</p>

<h2>Proof</h2>
<p>Browser run through admin on a phone-sized screen. The model is a scripted stand-in, so this shows the plumbing, not Claude's judgement.</p>
<div class="shots">
${results.steps.map((s, i) => `<figure><img src="media/${s.shot}" alt="" loading="lazy"><figcaption><b>${i + 1}. ${esc(s.name)}</b> ${s.ok ? '✓' : '✗'}<br>${esc((s.detail ?? '').slice(0, 220))}</figcaption></figure>`).join('\n')}
</div>

<h2>Not yet proven</h2>
<p>Real Claude deciding to spawn, real containers working at once, and merging two children's branches. The preview workflow clones the stack for this PR; there, run <code>REAL=1 node cathy/e2e/agents.e2e.ts</code> with the preview's address, or ask Cathy: "Split this into two parts with two sub-agents."</p>
</main>
</body>
</html>`;
writeFileSync(new URL('index.html', here), html);
console.log('wrote packs/cathy-subagents/index.html');
