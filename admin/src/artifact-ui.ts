// The artifact card and full-screen viewer, shared by the chat page and the Artifacts pages.
// Previews load the file from admin's API inside a sandboxed iframe (no same-origin), and
// the file itself is served with a CSP sandbox, so an artifact's scripts can't reach admin.

export const ARTIFACT_CSS = `
  .art { background:var(--bg); border:1px solid var(--line); border-radius:16px; overflow:hidden; box-shadow:var(--shadow); max-width:560px; width:100%; }
  .art .head { display:flex; gap:10px; align-items:center; padding:10px 12px; }
  .art .kind { flex:none; width:34px; height:34px; border-radius:9px; background:var(--cobalt-soft); color:var(--cobalt); display:grid; place-items:center; font:700 10px ui-monospace, monospace; text-transform:uppercase; }
  .art .meta { flex:1; min-width:0; }
  .art .t { font-family:var(--display); font-weight:600; font-size:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .art .s { color:var(--muted); font-size:13px; }
  .art .pv { display:block; width:100%; height:240px; border:0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); background:#fff; cursor:pointer; }
  .art img.pv { object-fit:contain; background:var(--panel); }
  .art .none { height:auto; padding:16px; color:var(--muted); font-size:14px; background:var(--panel); }
  .art .acts { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:10px 12px; }
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:2px; background:var(--panel); }
  .seg button { border:0; background:none; color:var(--muted); font-size:13px; font-weight:600; padding:5px 11px; border-radius:999px; cursor:pointer; }
  .seg button[aria-pressed=true] { background:var(--bg); color:var(--ink); box-shadow:0 1px 2px rgba(0,0,0,.12); }
  .seg button[data-v=link][aria-pressed=true] { color:var(--cobalt); }
  .chip { border:1px solid var(--line); background:var(--bg); color:var(--ink); border-radius:999px; padding:5px 12px; font-size:13px; font-weight:600; cursor:pointer; text-decoration:none; }
  .chip:active { transform:scale(.97); }
  .art .gone { padding:12px; color:var(--muted); font-size:14px; }
  .viewer { position:fixed; inset:0; z-index:50; background:var(--paper); display:flex; flex-direction:column; }
  .viewer .bar { flex:none; display:flex; align-items:center; gap:10px; padding:calc(env(safe-area-inset-top) + 8px) 12px 8px; border-bottom:1px solid var(--line); }
  .viewer .bar .t { flex:1; min-width:0; font-family:var(--display); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .viewer iframe, .viewer img { flex:1; width:100%; border:0; background:#fff; min-height:0; }
  .viewer img { object-fit:contain; background:var(--panel); }
  .toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 90px); transform:translateX(-50%); background:var(--ink); color:var(--paper); padding:8px 14px; border-radius:999px; font-size:14px; z-index:60; pointer-events:none; }
`;

export const ARTIFACT_JS = `
  const ART_API = '/api/cathy/artifacts/';
  const artEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const artSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const artExt = (a) => (a.filename.split('.').pop() || 'file').slice(0, 4);
  const artRaw = (a, v) => ART_API + a.id + '/raw?v=' + (v || a.version);
  const isImg = (m) => /^image\\//.test(m);
  const framed = (m) => /^(text\\/|application\\/pdf|application\\/json)/.test(m) || /svg/.test(m);
  function toast(text) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; document.body.appendChild(t); setTimeout(() => t.remove(), 1600); }
  async function copyText(text) { try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { prompt('Copy this link', text); } }
  function preview(a, v, cls) {
    if (isImg(a.mime)) { const i = document.createElement('img'); i.className = cls; i.src = artRaw(a, v); i.alt = a.title; i.loading = 'lazy'; return i; }
    if (framed(a.mime)) { const f = document.createElement('iframe'); f.className = cls; f.src = artRaw(a, v); f.loading = 'lazy'; f.title = a.title; f.setAttribute('sandbox', 'allow-scripts allow-popups allow-modals allow-downloads'); return f; }
    const d = document.createElement('div'); d.className = cls + ' none'; d.textContent = 'No preview for this type. Download it to open.'; return d;
  }
  function openViewer(a, v) {
    const w = document.createElement('div'); w.className = 'viewer'; w.dataset.testid = 'viewer';
    w.innerHTML = '<div class="bar"><button class="chip" data-x>Close</button><div class="t"></div><a class="chip" data-dl>Download</a><a class="chip" data-tab target="_blank" rel="noopener">New tab</a></div>';
    w.querySelector('.t').textContent = a.title + (v && v !== a.version ? ' (v' + v + ')' : '');
    w.querySelector('[data-dl]').href = artRaw(a, v) + '&download';
    w.querySelector('[data-tab]').href = artRaw(a, v);
    w.appendChild(preview(a, v, ''));
    w.querySelector('[data-x]').onclick = () => { w.remove(); removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') w.querySelector('[data-x]').click(); };
    addEventListener('keydown', esc);
    document.body.appendChild(w);
  }
  async function setVisibility(a, v) {
    const r = await fetch(ART_API + a.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visibility: v }) });
    if (!r.ok) { toast('Could not change: ' + ((await r.json().catch(() => ({}))).error || r.status)); return a; }
    return r.json();
  }
  /** A card for one artifact. Loads its current state (it may have been shared, updated or deleted since). */
  function artifactCard(snapshot, opts = {}) {
    const card = document.createElement('div'); card.className = 'art'; card.dataset.testid = 'artifact'; card.dataset.id = snapshot.id;
    let a = snapshot;
    function render() {
      card.dataset.visibility = a.visibility;
      card.innerHTML = '<div class="head"><div class="kind"></div><div class="meta"><div class="t"></div><div class="s"></div></div></div>';
      card.querySelector('.kind').textContent = artExt(a);
      card.querySelector('.t').textContent = a.title;
      card.querySelector('.s').textContent = 'v' + a.version + ' · ' + artSize(a.size) + ' · ' + (a.visibility === 'link' ? 'Anyone with the link' : 'Private');
      if (opts.preview !== false) { const p = preview(a, a.version, 'pv'); p.addEventListener('click', () => openViewer(a)); card.appendChild(p); }
      const acts = document.createElement('div'); acts.className = 'acts';
      acts.innerHTML = '<div class="seg" role="group" aria-label="Who can open it"><button data-v="private">Private</button><button data-v="link">Link</button></div>' +
        '<button class="chip" data-copy>Copy link</button><button class="chip" data-open>Open</button>' + (opts.manage ? '' : '<a class="chip" data-more>Details</a>');
      acts.querySelectorAll('.seg button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.v === a.visibility));
        b.onclick = async () => { if (b.dataset.v === a.visibility) return; a = await setVisibility(a, b.dataset.v); render(); opts.onChange?.(a); if (a.visibility === 'link') copyText(a.share_url); };
      });
      const copy = acts.querySelector('[data-copy]'); copy.hidden = a.visibility !== 'link'; copy.onclick = () => copyText(a.share_url);
      acts.querySelector('[data-open]').onclick = () => openViewer(a);
      const more = acts.querySelector('[data-more]'); if (more) more.href = '/artifacts/' + a.id;
      card.appendChild(acts);
    }
    render();
    if (opts.refresh !== false) fetch(ART_API + snapshot.id).then(async (r) => {
      if (r.status === 404) { card.innerHTML = '<div class="gone"></div>'; card.firstChild.textContent = snapshot.title + ' was deleted.'; return; }
      if (r.ok) { a = await r.json(); render(); }
    });
    return card;
  }
`;
