// The Artifacts pages: everything Cathy has published (/artifacts) and one artifact
// with its versions (/artifacts/:id). Both talk to /api/cathy/artifacts/*.
import { page } from './layout.ts';
import { ARTIFACT_CSS, ARTIFACT_JS } from './artifact-ui.ts';

const LIST_CSS = `
  ${ARTIFACT_CSS}
  .tools { display:flex; gap:8px; flex-wrap:wrap; margin:0 4px 16px; }
  .search { flex:1; min-width:180px; font:16px var(--ui); padding:10px 14px; border-radius:12px; border:1px solid var(--line); background:var(--bg); color:var(--ink); }
  .grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fill, minmax(min(100%, 320px), 1fr)); }
  .grid .art { max-width:none; }
  .from { color:var(--muted); font-size:12.5px; padding:0 12px 10px; }
  .from a { color:var(--cobalt); text-decoration:none; }
  .empty, .error { color:var(--muted); padding:24px 4px; }
`;

const LIST_JS = `
  ${ARTIFACT_JS}
  const grid = document.getElementById('grid'), q = document.getElementById('q'), seg = document.getElementById('filter');
  let all = [], filter = '';
  function draw() {
    const term = q.value.trim().toLowerCase();
    const shown = all.filter((a) => (!filter || a.visibility === filter) && (!term || (a.title + ' ' + a.filename + ' ' + a.session_title).toLowerCase().includes(term)));
    grid.replaceChildren(...shown.map((a) => {
      const card = artifactCard(a, { refresh: false, onChange: (n) => { Object.assign(a, n); } });
      const from = document.createElement('div'); from.className = 'from';
      from.innerHTML = 'From <a></a> · ' + new Date(a.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      from.querySelector('a').href = '/cathy/' + a.session_id; from.querySelector('a').textContent = a.session_title || 'a chat';
      card.appendChild(from); return card;
    }));
    if (!shown.length) grid.innerHTML = '<div class="empty">' + (all.length ? 'Nothing matches.' : 'No artifacts yet. Ask Cathy to make something.') + '</div>';
  }
  async function load() {
    try { const r = await fetch('/api/cathy/artifacts'); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); all = await r.json(); draw(); }
    catch (e) { grid.innerHTML = '<div class="error"></div>'; grid.firstChild.textContent = 'Could not load artifacts: ' + e.message; }
  }
  q.addEventListener('input', draw);
  seg.querySelectorAll('button').forEach((b) => b.onclick = () => { filter = b.dataset.f; seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); });
  load();
`;

export const artifactsPage = () =>
  page({
    title: 'Artifacts',
    css: LIST_CSS,
    body: `<main>
  <a class="back" href="/">‹ Admin</a>
  <p class="eyebrow">Made by Cathy</p><h1>Artifacts</h1>
  <div class="tools"><input class="search" id="q" type="search" placeholder="Search artifacts" data-testid="artifact-search">
    <div class="seg" id="filter"><button data-f="" aria-pressed="true">All</button><button data-f="private" aria-pressed="false">Private</button><button data-f="link" aria-pressed="false">Shared</button></div></div>
  <div class="grid" id="grid"><div class="empty">Loading…</div></div>
</main>`,
    script: LIST_JS,
  });

const ONE_CSS = `
  ${ARTIFACT_CSS}
  .art { max-width:none; }
  .art .pv { height:min(70vh, 720px); }
  h1[contenteditable] { outline:none; border-radius:8px; cursor:text; }
  h1[contenteditable]:focus { box-shadow:0 0 0 2px var(--cobalt); }
  .info { color:var(--muted); font-size:14px; margin:-14px 4px 18px; }
  .info a { color:var(--cobalt); }
  .share { margin:14px 4px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .share code { font:13px ui-monospace, monospace; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:6px 10px; overflow-wrap:anywhere; }
  h2 { font-family:var(--display); font-size:20px; margin:28px 4px 10px; }
  .versions { list-style:none; margin:0; padding:0; display:grid; gap:6px; }
  .versions li { display:flex; gap:10px; align-items:center; padding:8px 12px; background:var(--bg); border:1px solid var(--line); border-radius:12px; font-size:14px; }
  .versions li span { flex:1; color:var(--muted); }
  .danger { margin-top:28px; color:var(--pen); border-color:color-mix(in srgb, var(--pen) 40%, var(--line)); }
`;

const ONE_JS = `
  ${ARTIFACT_JS}
  const id = location.pathname.split('/').pop();
  const slot = document.getElementById('card'), title = document.getElementById('title'), info = document.getElementById('info'), versions = document.getElementById('versions'), share = document.getElementById('share');
  let a;
  function drawShare() {
    share.innerHTML = '';
    if (a.visibility !== 'link') { share.innerHTML = '<span class="info" style="margin:0">Private: only you can open it, from admin.</span>'; return; }
    share.innerHTML = '<code data-testid="share-url"></code><button class="chip" data-c>Copy</button><button class="chip" data-n>New link</button>';
    share.querySelector('code').textContent = a.share_url;
    share.querySelector('[data-c]').onclick = () => copyText(a.share_url);
    share.querySelector('[data-n]').onclick = async (e) => {
      const b = e.currentTarget;
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Old link stops working. Tap again'; return; }
      const r = await fetch(ART_API + id + '/new-link', { method: 'POST' }); if (r.ok) { a = await r.json(); drawShare(); toast('New link made'); }
    };
  }
  function draw() {
    document.title = a.title + ' · Artifacts';
    title.textContent = a.title;
    info.innerHTML = 'From <a></a> · ' + artEsc(a.filename) + ' · ' + artSize(a.size);
    info.querySelector('a').href = '/cathy/' + a.session_id; info.querySelector('a').textContent = a.session_title || 'a chat';
    slot.replaceChildren(artifactCard(a, { refresh: false, manage: true, onChange: (n) => { a = { ...a, ...n }; drawShare(); } }));
    drawShare();
    versions.replaceChildren(...a.versions.map((v) => {
      const li = document.createElement('li');
      li.innerHTML = '<b></b><span></span><button class="chip">View</button>';
      li.querySelector('b').textContent = 'v' + v.version + (v.version === a.version ? ' (latest)' : '');
      li.querySelector('span').textContent = v.filename + ' · ' + artSize(v.size) + ' · ' + new Date(v.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      li.querySelector('button').onclick = () => openViewer(a, v.version);
      return li;
    }));
  }
  async function load() {
    const r = await fetch(ART_API + id);
    if (!r.ok) { title.textContent = 'Not found'; info.textContent = 'This artifact was deleted, or never existed.'; return; }
    a = await r.json(); draw();
  }
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('blur', async () => {
    const t = title.textContent.trim(); if (!a || !t || t === a.title) { if (a) title.textContent = a.title; return; }
    const r = await fetch(ART_API + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: t }) });
    if (r.ok) { a = { ...a, ...(await r.json()) }; draw(); toast('Renamed'); }
  });
  document.getElementById('delete').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Delete for good? Tap again'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Delete'; }, 3000); return; }
    await fetch(ART_API + id, { method: 'DELETE' }); location.href = '/artifacts';
  });
  load();
`;

export const artifactPage = () =>
  page({
    title: 'Artifact',
    css: ONE_CSS,
    body: `<main>
  <a class="back" href="/artifacts">‹ Artifacts</a>
  <p class="eyebrow">Artifact</p><h1 id="title" contenteditable="plaintext-only" spellcheck="false" data-testid="artifact-title">Loading…</h1>
  <p class="info" id="info"></p>
  <div id="card"></div>
  <div class="share" id="share"></div>
  <h2>Versions</h2><ul class="versions" id="versions"></ul>
  <button class="chip danger" id="delete">Delete</button>
</main>`,
    script: ONE_JS,
  });
