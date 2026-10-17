// Cathy's pages: the chat explorer (/cathy) and a chat (/cathy/:id).
// Both talk to the Cathy Worker through /api/cathy/*, which admin forwards.
import { page } from './layout.ts';
import { ARTIFACT_CSS, ARTIFACT_JS } from './artifact-ui.ts';

const EXPLORER_CSS = `
  .top { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:16px; }
  .top h1 { margin-bottom:0; }
  .new { background:var(--fill); color:#fff; border:0; border-radius:10px; padding:11px 16px; font-weight:600; cursor:pointer; box-shadow:0 2px 0 var(--fill-shadow); }
  .new:active { transform:translateY(1px); }
  .new[disabled] { opacity:.6; }
  .tools { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:0 0 14px; }
  .search { flex:1; min-width:160px; font:16px var(--ui); padding:10px 14px; border-radius:12px; border:1px solid var(--line); background:var(--bg); color:var(--ink); }
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:2px; background:var(--panel); }
  .seg button { border:0; background:none; color:var(--muted); font-size:14px; font-weight:600; padding:6px 13px; border-radius:999px; cursor:pointer; }
  .seg button[aria-pressed=true] { background:var(--bg); color:var(--ink); box-shadow:0 1px 2px rgba(0,0,0,.12); }
  .chats { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:minmax(0,1fr); gap:10px; }
  .chats li { min-width:0; position:relative; }
  .chat { display:block; background:var(--bg); border:1px solid var(--line); border-radius:14px; padding:14px 16px; color:var(--ink); text-decoration:none; box-shadow:var(--shadow); }
  .chat:active { transform:scale(.99); }
  @media (hover:hover) { .chat:hover { border-color:var(--cobalt); } }
  .chat .row { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
  .chat .title { font-family:var(--display); font-weight:600; font-size:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chat .when { color:var(--muted); font-size:13px; flex:none; }
  .chat .preview { color:var(--muted); font-size:15px; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chat .branch { font:12px var(--mono, ui-monospace, monospace); color:var(--cobalt); margin-top:6px; }
  .restore { position:absolute; right:12px; bottom:10px; border:1px solid var(--line); background:var(--bg); color:var(--cobalt); border-radius:999px; padding:4px 12px; font-size:13px; font-weight:600; cursor:pointer; }
  .empty, .error { color:var(--muted); padding:24px 4px; }
  .error { color:var(--pen); }
`;

const EXPLORER_JS = `
  const list = document.getElementById('chats'), q = document.getElementById('q'), tabs = document.getElementById('tabs');
  let status = 'active', sessions = [];
  const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  function row(s) {
    const a = document.createElement('a');
    a.className = 'chat'; a.href = '/cathy/' + s.id; a.dataset.testid = 'chat-row';
    a.innerHTML = '<div class="row"><div class="title"></div><div class="when"></div></div><div class="preview"></div><div class="branch"></div>';
    a.querySelector('.title').textContent = s.title || 'New chat';
    a.querySelector('.when').textContent = ago(s.updated_at);
    a.querySelector('.preview').textContent = s.last_message || 'No messages yet';
    a.querySelector('.branch').textContent = s.branch;
    const li = document.createElement('li'); li.appendChild(a);
    if (status === 'archived') {
      const b = document.createElement('button'); b.className = 'restore'; b.textContent = 'Unarchive'; b.dataset.testid = 'unarchive';
      b.onclick = async () => { b.disabled = true; await fetch('/api/cathy/sessions/' + s.id + '/unarchive', { method: 'POST' }); load(); };
      li.appendChild(b);
    }
    return li;
  }
  function draw() {
    const term = q.value.trim().toLowerCase();
    const shown = sessions.filter((s) => !term || [s.title, s.last_message, s.branch].join(' ').toLowerCase().includes(term));
    list.replaceChildren(...shown.map(row));
    if (!shown.length) list.innerHTML = '<li class="empty">' + (term ? 'No chats match.' : status === 'archived' ? 'Nothing archived.' : 'No chats yet. Start one.') + '</li>';
  }
  async function load() {
    try {
      const r = await fetch('/api/cathy/sessions' + (status === 'archived' ? '?status=archived' : ''));
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      sessions = await r.json(); draw();
    } catch (e) { list.innerHTML = '<li class="error"></li>'; list.firstChild.textContent = 'Could not load chats: ' + e.message; }
  }
  q.addEventListener('input', draw);
  tabs.querySelectorAll('button').forEach((b) => b.onclick = () => { status = b.dataset.s; tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); });
  document.getElementById('new').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const r = await fetch('/api/cathy/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (r.ok) location.href = '/cathy/' + (await r.json()).id;
    else { e.currentTarget.disabled = false; alert('Could not start a chat'); }
  });
  load();
  addEventListener('pageshow', (e) => { if (e.persisted) load(); });
`;

export const explorerPage = () =>
  page({
    title: 'Cathy',
    css: EXPLORER_CSS,
    body: `<main>
  <a class="back" href="/">‹ Admin</a>
  <div class="top"><div><p class="eyebrow">Your tutor agents</p><h1>Cathy</h1></div><button class="new" id="new" data-testid="new-chat">New chat</button></div>
  <div class="tools"><input class="search" id="q" type="search" placeholder="Search chats" data-testid="chat-search">
    <div class="seg" id="tabs"><button data-s="active" aria-pressed="true">Active</button><button data-s="archived" aria-pressed="false" data-testid="archived-tab">Archived</button></div></div>
  <ul class="chats" id="chats"><li class="empty">Loading…</li></ul>
</main>`,
    script: EXPLORER_JS,
  });

const CHAT_CSS = `
  ${ARTIFACT_CSS}
  /* Laid out like a messaging app: header, scrolling messages, composer pinned above the keyboard. */
  html, body { height:var(--app-h, 100dvh); overflow:hidden; }
  body { padding:0; display:flex; flex-direction:column; min-height:0; }
  body::before { display:none; }
  header { flex:none; padding: calc(env(safe-area-inset-top) + 10px) max(12px, env(safe-area-inset-right)) 10px max(12px, env(safe-area-inset-left)); display:flex; align-items:center; gap:10px; border-bottom:1px solid var(--line); background:var(--paper); }
  header .back { margin:0; font-size:22px; line-height:1; padding:4px 8px 4px 2px; }
  header .who { flex:1; min-width:0; }
  header .name { font-family:var(--display); font-weight:600; font-size:17px; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border-radius:6px; outline:none; cursor:text; }
  header .name:focus { white-space:normal; box-shadow:0 0 0 2px var(--cobalt); padding:0 4px; }
  header .branch { font:12px ui-monospace, monospace; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .hbtn { flex:none; background:none; border:0; color:var(--muted); font-size:14px; cursor:pointer; padding:6px; text-decoration:none; }
  #log { flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
  .thread { max-width:760px; margin:0 auto; padding:20px max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left)); display:flex; flex-direction:column; gap:14px; }
  .m { overflow-wrap:anywhere; line-height:1.55; font-size:16px; min-width:0; }
  .user { align-self:flex-end; max-width:85%; display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
  .user .bubble { background:var(--panel); border:1px solid var(--line); border-radius:20px; padding:10px 15px; white-space:pre-wrap; }
  .user .files { display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end; }
  .file { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line); background:var(--bg); border-radius:12px; padding:6px 10px; font-size:13px; color:var(--ink); text-decoration:none; max-width:220px; }
  .file span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .file.img { padding:0; overflow:hidden; border-radius:14px; }
  .file.img img { display:block; width:120px; height:120px; object-fit:cover; }
  .assistant { align-self:stretch; }
  .assistant p { margin:0 0 10px; } .assistant p:last-child { margin-bottom:0; }
  .assistant code { font:14px ui-monospace, monospace; background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:1px 5px; }
  .assistant pre { margin:0 0 10px; overflow-x:auto; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .assistant pre code { border:0; padding:0; background:none; font-size:13px; }
  .assistant a { color:var(--cobalt); }
  .label { margin-top:6px; font-size:12px; color:var(--muted); }
  .label .stopped { color:var(--pen); font-weight:600; }
  details.thinking { align-self:stretch; font-size:14px; color:var(--muted); border-left:2px solid var(--line); padding-left:10px; }
  details.thinking summary { cursor:pointer; list-style:none; font-weight:600; }
  details.thinking summary::-webkit-details-marker { display:none; }
  details.thinking summary::before { content:'▸ '; } details.thinking[open] summary::before { content:'▾ '; }
  details.thinking div { white-space:pre-wrap; margin-top:6px; max-height:40vh; overflow:auto; }
  .cathy { align-self:flex-start; max-width:85%; background:var(--cobalt-soft); border-radius:16px; padding:10px 14px; white-space:pre-wrap; }
  .cathy::before { content:attr(data-from); display:block; font-size:12px; font-weight:600; color:var(--cobalt); margin-bottom:2px; }
  /* Progress updates (tell_chris): a plain note. Not the --hand font: admin doesn't load Kalam, and iOS's "cursive" fallback is calligraphy. */
  .update { align-self:flex-start; max-width:85%; color:var(--muted); font-size:15px; border-left:3px solid var(--cobalt); padding:2px 0 2px 10px; white-space:pre-wrap; }
  .tool { align-self:flex-start; max-width:100%; font:13px/1.4 ui-monospace, monospace; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:4px 11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tool::before { content:'› '; color:var(--cobalt); }
  .artifact { align-self:flex-start; width:100%; display:flex; }
  .notice { align-self:center; font-size:13px; color:var(--pen); text-align:center; }
  .hint { color:var(--muted); font-size:15px; text-align:center; margin-top:18vh; line-height:1.5; }
  .hint b { display:block; font-family:var(--display); color:var(--ink); font-size:22px; margin-bottom:6px; }
  .working { display:none; align-items:center; gap:8px; color:var(--muted); font-size:14px; }
  .working[data-status=thinking] { display:flex; }
  .working[data-status=offline] { display:flex; color:var(--pen); }
  .dots { display:inline-flex; gap:4px; }
  .dots i { width:6px; height:6px; border-radius:50%; background:var(--cobalt); opacity:.35; animation:blink 1.2s infinite; }
  .dots i:nth-child(2) { animation-delay:.2s; } .dots i:nth-child(3) { animation-delay:.4s; }
  @keyframes blink { 40% { opacity:1; } }
  @media (prefers-reduced-motion: reduce) { .dots i { animation:none; opacity:.8; } }
  .composer { flex:none; padding:8px max(10px, env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 8px) max(10px, env(safe-area-inset-left)); background:var(--paper); }
  .box { max-width:760px; margin:0 auto; background:var(--bg); border:1px solid var(--line); border-radius:24px; padding:10px 10px 8px 14px; box-shadow:var(--shadow); }
  .box:focus-within { border-color:color-mix(in srgb, var(--cobalt) 45%, var(--line)); }
  .box.drop { border-color:var(--cobalt); border-style:dashed; }
  .pending { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; }
  .pending:empty { display:none; }
  .pend { position:relative; display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line); background:var(--panel); border-radius:12px; padding:5px 26px 5px 8px; font-size:13px; max-width:200px; }
  .pend img { width:34px; height:34px; object-fit:cover; border-radius:7px; }
  .pend span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pend[data-state=uploading] { opacity:.6; } .pend[data-state=failed] { border-color:var(--pen); color:var(--pen); }
  .pend button { position:absolute; right:4px; top:50%; transform:translateY(-50%); border:0; background:none; color:var(--muted); font-size:16px; cursor:pointer; padding:2px 4px; }
  textarea { display:block; width:100%; min-width:0; resize:none; border:0; outline:none; background:transparent; color:var(--ink); font:16px/1.45 var(--ui); padding:2px 0; max-height:36vh; }
  textarea::placeholder { color:var(--muted); }
  .row { display:flex; align-items:center; gap:6px; margin-top:6px; }
  .row .grow { flex:1; }
  .icon { flex:none; width:36px; height:36px; border-radius:50%; border:0; background:none; color:var(--muted); display:grid; place-items:center; cursor:pointer; }
  .icon svg { width:20px; height:20px; }
  .pick { flex:none; max-width:42vw; appearance:none; -webkit-appearance:none; border:1px solid var(--line); background:var(--panel); color:var(--ink); border-radius:999px; padding:6px 12px; font:600 13px var(--ui); cursor:pointer; text-overflow:ellipsis; }
  .send { flex:none; width:38px; height:38px; border-radius:50%; border:0; display:grid; place-items:center; background:var(--fill); color:#fff; cursor:pointer; transition:opacity .15s, transform .1s; }
  .send:active { transform:scale(.94); }
  .send:disabled { opacity:.3; cursor:default; }
  .send svg { width:20px; height:20px; }
  .send .sq { display:none; width:12px; height:12px; border-radius:2px; background:#fff; }
  .send[data-mode=stop] { background:var(--ink); }
  .send[data-mode=stop] svg { display:none; } .send[data-mode=stop] .sq { display:block; }
  .send[data-mode=stop] .sq { background:var(--paper); }
  .busy { display:none; max-width:760px; margin:0 auto 6px; gap:8px; justify-content:flex-end; align-items:center; font-size:13px; color:var(--muted); }
  .busy[data-on] { display:flex; }
  .busy button { border:1px solid var(--line); background:var(--bg); color:var(--ink); border-radius:999px; padding:6px 12px; font:600 13px var(--ui); cursor:pointer; }
  .busy button[data-k=interrupt] { background:var(--fill); color:#fff; border-color:var(--fill); }
`;

const CHAT_JS = `
  ${ARTIFACT_JS}
  const id = location.pathname.split('/').pop();
  const API = '/api/cathy/sessions/' + id;
  const $ = (s) => document.getElementById(s);
  const log = $('log'), thread = $('thread'), t = $('t'), send = $('send'), working = $('working'), pending = $('pending'), fileIn = $('file'), box = $('box'), busy = $('busy'), nameEl = $('name'), modelSel = $('model'), effortSel = $('effort');
  let ws, live = null, liveThink = null, retry = 0, connected = false, status = 'connecting', attachments = [], session = null, names = {};

  // Fit the page to the visible area so the composer sits just above the keyboard (iOS doesn't resize for it).
  const fit = () => { document.documentElement.style.setProperty('--app-h', (visualViewport?.height || innerHeight) + 'px'); scrollTo(0, 0); };
  visualViewport?.addEventListener('resize', fit); visualViewport?.addEventListener('scroll', () => scrollTo(0, 0)); fit();

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // Just enough Markdown for Cathy's replies: code blocks, inline code, bold, links, paragraphs.
  function md(text) {
    return esc(text).split(/\`\`\`/).map((part, i) => {
      if (i % 2) return '<pre><code>' + part.replace(/^[a-z]*\\n/, '') + '</code></pre>';
      return part.split(/\\n{2,}/).filter((p) => p.trim()).map((p) => '<p>' + p
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>')
        .replace(/(https:\\/\\/[^\\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
        .replace(/\\n/g, '<br>') + '</p>').join('');
    }).join('');
  }
  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const toBottom = () => { log.scrollTop = log.scrollHeight; };
  const place = (d) => { const stick = atBottom(); thread.insertBefore(d, working); if (stick) toBottom(); return d; };

  function fileChip(f) {
    const a = document.createElement('a'); a.href = API + '/uploads/' + f.id; a.target = '_blank'; a.rel = 'noopener'; a.title = f.name;
    if (/^image\\//.test(f.mime)) { a.className = 'file img'; const i = document.createElement('img'); i.src = a.href; i.alt = f.name; i.loading = 'lazy'; a.appendChild(i); }
    else { a.className = 'file'; a.innerHTML = '📄 <span></span>'; a.querySelector('span').textContent = f.name; }
    a.dataset.testid = 'attachment'; return a;
  }
  function thinkingBlock(text, open) {
    const d = document.createElement('details'); d.className = 'm thinking'; d.dataset.testid = 'thinking'; if (open) d.open = true;
    d.innerHTML = '<summary>Thinking</summary><div></div>'; d.querySelector('div').textContent = text; return d;
  }
  function add(m) {
    thread.querySelector('.hint')?.remove();
    if (m.role === 'assistant' && m.thinking) place(thinkingBlock(m.thinking));
    const d = document.createElement('div');
    d.className = 'm ' + m.role; d.dataset.testid = 'msg-' + m.role;
    if (m.role === 'assistant') {
      d.innerHTML = md(m.content || '');
      if (m.model || m.stopped) {
        const l = document.createElement('div'); l.className = 'label'; l.dataset.testid = 'reply-label';
        l.innerHTML = (m.stopped ? '<span class="stopped">Stopped</span>' + (m.model ? ' · ' : '') : '') + esc(m.model ? (names[m.model] || m.model) + ' · ' + m.effort + ' effort' : '');
        d.appendChild(l);
      }
    } else if (m.role === 'user') {
      if (m.files?.length) { const f = document.createElement('div'); f.className = 'files'; m.files.forEach((x) => f.appendChild(fileChip(x))); d.appendChild(f); }
      if (m.content) { const b = document.createElement('div'); b.className = 'bubble'; b.textContent = m.content; d.appendChild(b); }
    } else if (m.role === 'artifact') {
      try { d.appendChild(artifactCard(JSON.parse(m.content))); } catch { d.textContent = m.content; }
    } else d.textContent = m.content;
    if (m.role === 'cathy') d.dataset.from = 'From Cathy ' + m.sender;
    return place(d);
  }
  function setStatus(s) {
    status = s;
    working.dataset.status = s;
    working.querySelector('span:last-child').textContent = s === 'offline' ? 'Reconnecting…' : 'Cathy is working…';
    if (s === 'thinking') toBottom();
    sync();
  }
  const ready = () => attachments.every((a) => a.state === 'done');
  const hasInput = () => t.value.trim() || attachments.length;
  // While she works: an empty box shows Stop (white square); typing offers Queue or Interrupt.
  function sync() {
    const working = status === 'thinking';
    const stopMode = working && !hasInput();
    send.dataset.mode = stopMode ? 'stop' : 'send';
    send.setAttribute('aria-label', stopMode ? 'Stop' : 'Send');
    send.dataset.testid = stopMode ? 'stop' : 'send';
    send.disabled = !connected || (!stopMode && (!hasInput() || !ready()));
    if (working && hasInput()) busy.setAttribute('data-on', ''); else busy.removeAttribute('data-on');
  }

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + API + '/ws');
    ws.onopen = () => { retry = 0; connected = true; sync(); };
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'history') {
        thread.querySelectorAll('.m, .hint').forEach((n) => n.remove()); live = liveThink = null;
        if (!ev.messages.length) thread.insertAdjacentHTML('afterbegin', '<div class="hint"><b>Hi Chris</b>Ask Cathy anything, give her a coding task, or attach a file.<br>She works on her own branch, opens PRs, and can make artifacts you can share.</div>');
        ev.messages.forEach(add); setStatus(ev.status); toBottom();
      }
      if (ev.type === 'status') { setStatus(ev.status); if (ev.status === 'idle') { thread.querySelectorAll('[data-streaming]').forEach((n) => n.remove()); live = liveThink = null; } }
      if (ev.type === 'title') showTitle(ev.title);
      if (ev.type === 'settings') { modelSel.value = ev.model; effortSel.value = ev.effort; }
      if (ev.type === 'thinking') {
        if (!liveThink) { liveThink = place(thinkingBlock('', true)); liveThink.dataset.streaming = '1'; }
        const stick = atBottom(); liveThink.querySelector('div').textContent += ev.text; if (stick) toBottom();
      }
      // Streamed text shows in a temporary block; the finished reply replaces it.
      if (ev.type === 'delta') {
        if (liveThink) liveThink.open = false;
        if (!live) { live = add({ role: 'assistant', content: '' }); live.dataset.testid = 'msg-streaming'; live.dataset.streaming = '1'; live.raw = ''; }
        const stick = atBottom(); live.raw += ev.text; live.innerHTML = md(live.raw); if (stick) toBottom();
      }
      if (ev.type === 'message') {
        if (ev.message.role === 'assistant' || ev.message.role === 'tool') { thread.querySelectorAll('[data-streaming]').forEach((n) => n.remove()); live = liveThink = null; }
        add(ev.message);
      }
    };
    ws.onclose = () => { connected = false; sync(); setStatus('offline'); setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000)); };
  }

  function submit(interrupt) {
    if (send.dataset.mode === 'stop') { ws.send(JSON.stringify({ type: 'stop' })); return; }
    const text = t.value.trim(); if (!hasInput() || !ready() || !connected) return;
    ws.send(JSON.stringify({ type: 'send', text, files: attachments.map((a) => ({ id: a.id })), interrupt: !!interrupt }));
    t.value = ''; attachments = []; pending.replaceChildren(); grow(); sync(); toBottom();
  }
  const grow = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  $('f').addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
  busy.querySelector('[data-k=queue]').onclick = () => submit(false);
  busy.querySelector('[data-k=interrupt]').onclick = () => submit(true);
  t.addEventListener('input', () => { grow(); sync(); });
  t.addEventListener('focus', () => setTimeout(() => { fit(); toBottom(); }, 300));
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); if (status === 'thinking' && hasInput()) submit(false); else if (send.dataset.mode !== 'stop') submit(false); } });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && status === 'thinking' && !document.querySelector('.viewer')) ws?.send(JSON.stringify({ type: 'stop' })); });

  // Attachments: paperclip, paste or drop. Each uploads at once; Send waits for them.
  const MAX = 25 * 1024 * 1024;
  function attach(files) {
    for (const file of files) {
      if (attachments.length >= 10) { toast('Up to 10 files per message'); break; }
      const a = { file, state: 'uploading' };
      const chip = document.createElement('div'); chip.className = 'pend'; chip.dataset.testid = 'pending-file';
      if (/^image\\//.test(file.type)) { const i = document.createElement('img'); i.src = URL.createObjectURL(file); chip.appendChild(i); }
      const n = document.createElement('span'); n.textContent = file.name || 'pasted image'; chip.appendChild(n);
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove');
      x.onclick = () => { attachments = attachments.filter((y) => y !== a); chip.remove(); sync(); };
      chip.appendChild(x); pending.appendChild(chip); attachments.push(a);
      const done = (state, msg) => { a.state = state; chip.dataset.state = state; if (msg) n.textContent = msg; sync(); };
      chip.dataset.state = 'uploading';
      if (file.size > MAX) { done('failed', (file.name || 'file') + ': over 25 MB'); continue; }
      const name = file.name || ('pasted-' + Date.now() + '.' + ((file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')));
      fetch(API + '/uploads', { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(name) }, body: file })
        .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); Object.assign(a, await r.json()); done('done'); })
        .catch((e) => done('failed', 'Failed: ' + e.message));
    }
    sync();
  }
  $('clip').onclick = () => fileIn.click();
  fileIn.onchange = () => { attach([...fileIn.files]); fileIn.value = ''; };
  t.addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); attach(fs); } });
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('drop'); attach([...e.dataTransfer.files]); });

  // Title: tap to rename. Chris's name sticks; Cathy can't change it after.
  function showTitle(title) { if (document.activeElement !== nameEl) nameEl.textContent = title || 'New chat'; document.title = (title || 'New chat') + ' · Cathy'; if (session) session.title = title; }
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } if (e.key === 'Escape') { nameEl.textContent = session?.title || 'New chat'; nameEl.blur(); } });
  nameEl.addEventListener('blur', async () => {
    const title = nameEl.textContent.trim();
    if (!title || title === session?.title) { showTitle(session?.title); return; }
    const r = await fetch(API, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
    if (r.ok) { session = await r.json(); showTitle(session.title); toast('Renamed'); } else showTitle(session?.title);
  });

  // Model and effort: saved on the chat, used from her next turn.
  async function saveSettings(change) {
    const r = await fetch(API, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) });
    if (r.ok) { session = await r.json(); toast((names[session.model] || session.model) + ' · ' + session.effort + ' effort'); }
    else { toast('Could not change: ' + ((await r.json().catch(() => ({}))).error || r.status)); modelSel.value = session.model; effortSel.value = session.effort; }
  }
  modelSel.onchange = () => saveSettings({ model: modelSel.value });
  effortSel.onchange = () => saveSettings({ effort: effortSel.value });

  $('archive').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to archive'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Archive'; }, 3000); return; }
    await fetch(API + '/archive', { method: 'POST' }); location.href = '/cathy';
  });

  Promise.all([fetch('/api/cathy/models').then((r) => r.ok ? r.json() : null), fetch(API).then((r) => r.ok ? r.json() : null)]).then(([m, s]) => {
    if (m) {
      m.models.forEach((x) => { names[x.id] = x.label; modelSel.add(new Option(x.label, x.id)); });
      m.efforts.forEach((x) => effortSel.add(new Option(x[0].toUpperCase() + x.slice(1) + ' effort', x)));
    }
    if (s) { session = s; $('branch').textContent = s.branch; showTitle(s.title); modelSel.value = s.model; effortSel.value = s.effort; }
  }).finally(connect); // after the model names are known, so reply labels read well
`;

export const chatPage = () =>
  page({
    title: 'Cathy',
    css: CHAT_CSS,
    body: `<header>
  <a class="back" href="/cathy" aria-label="Back to chats">‹</a>
  <div class="who"><div class="name" id="name" contenteditable="plaintext-only" spellcheck="false" data-testid="chat-title" title="Tap to rename">Cathy</div><div class="branch" id="branch"></div></div>
  <a class="hbtn" href="/artifacts">Artifacts</a>
  <button class="hbtn" id="archive" type="button">Archive</button>
</header>
<div id="log"><div class="thread" id="thread">
  <div class="working" id="working" data-testid="status" data-status="connecting"><span class="dots"><i></i><i></i><i></i></span><span>Cathy is working…</span></div>
</div></div>
<form class="composer" id="f">
  <div class="busy" id="busy"><span>Cathy is working.</span><button type="button" data-k="queue" data-testid="queue">Queue</button><button type="button" data-k="interrupt" data-testid="interrupt">Interrupt</button></div>
  <div class="box" id="box">
    <div class="pending" id="pending"></div>
    <textarea id="t" rows="1" placeholder="Message Cathy" data-testid="composer" enterkeyhint="send"></textarea>
    <div class="row">
      <button class="icon" id="clip" type="button" aria-label="Attach files" data-testid="attach"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9"/></svg></button>
      <input type="file" id="file" multiple hidden data-testid="file-input">
      <select class="pick" id="model" aria-label="Model" data-testid="model"></select>
      <select class="pick" id="effort" aria-label="Thinking effort" data-testid="effort"></select>
      <span class="grow"></span>
      <button class="send" id="send" type="submit" disabled aria-label="Send" data-testid="send" data-mode="send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg><i class="sq"></i></button>
    </div>
  </div>
</form>`,
    script: CHAT_JS,
  });
