// Cathy's pages: the chat explorer (/cathy) and a chat (/cathy/:id).
// Both talk to the Cathy Worker through /api/cathy/*, which admin forwards.
import { page } from './layout.ts';

const EXPLORER_CSS = `
  .top { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:20px; }
  .top h1 { margin-bottom:0; }
  .new { background:var(--fill); color:#fff; border:0; border-radius:10px; padding:11px 16px; font-weight:600; cursor:pointer; box-shadow:0 2px 0 var(--fill-shadow); }
  .new:active { transform:translateY(1px); }
  .new[disabled] { opacity:.6; }
  .chats { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:minmax(0,1fr); gap:10px; }
  .chats li { min-width:0; }
  .chat { display:block; background:var(--bg); border:1px solid var(--line); border-radius:14px; padding:14px 16px; color:var(--ink); text-decoration:none; box-shadow:var(--shadow); }
  .chat:active { transform:scale(.99); }
  @media (hover:hover) { .chat:hover { border-color:var(--cobalt); } }
  .chat .row { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
  .chat .title { font-family:var(--display); font-weight:600; font-size:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chat .when { color:var(--muted); font-size:13px; flex:none; }
  .chat .preview { color:var(--muted); font-size:15px; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chat .branch { font:12px var(--mono, ui-monospace, monospace); color:var(--cobalt); margin-top:6px; }
  .empty, .error { color:var(--muted); padding:24px 4px; }
  .error { color:var(--pen); }
`;

const EXPLORER_JS = `
  const list = document.getElementById('chats');
  const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  function row(s) {
    const a = document.createElement('a');
    a.className = 'chat'; a.href = '/cathy/' + s.id; a.dataset.testid = 'chat-row';
    a.innerHTML = '<div class="row"><div class="title"></div><div class="when"></div></div><div class="preview"></div><div class="branch"></div>';
    a.querySelector('.title').textContent = s.title || 'New chat';
    a.querySelector('.when').textContent = ago(s.updated_at);
    a.querySelector('.preview').textContent = s.last_message || 'No messages yet';
    a.querySelector('.branch').textContent = s.branch;
    const li = document.createElement('li'); li.appendChild(a); return li;
  }
  async function load() {
    try {
      const r = await fetch('/api/cathy/sessions');
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const sessions = await r.json();
      list.replaceChildren(...sessions.map(row));
      if (!sessions.length) list.innerHTML = '<li class="empty">No chats yet. Start one.</li>';
    } catch (e) { list.innerHTML = '<li class="error"></li>'; list.firstChild.textContent = 'Could not load chats: ' + e.message; }
  }
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
  <ul class="chats" id="chats"><li class="empty">Loading…</li></ul>
</main>`,
    script: EXPLORER_JS,
  });

const CHAT_CSS = `
  body { padding:0; display:flex; flex-direction:column; height:100dvh; min-height:0; }
  body::before { height:300px; }
  header { padding: calc(env(safe-area-inset-top) + 12px) 16px 10px; display:flex; align-items:center; gap:10px; border-bottom:1px solid var(--line); background:color-mix(in srgb, var(--paper) 88%, transparent); backdrop-filter:blur(8px); }
  header .back { margin:0; }
  header .who { flex:1; min-width:0; }
  header .name { font-family:var(--display); font-weight:600; font-size:18px; line-height:1.2; }
  header .branch { font:12px ui-monospace, monospace; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pill { font-size:12px; font-weight:600; border-radius:999px; padding:3px 10px; background:var(--cobalt-soft); color:var(--cobalt); }
  .pill.offline { background:transparent; color:var(--pen); border:1px solid currentColor; }
  #log { flex:1; overflow-y:auto; padding:16px max(16px, env(safe-area-inset-left)); display:flex; flex-direction:column; gap:10px; max-width:820px; width:100%; margin:0 auto; }
  .m { max-width:86%; padding:10px 14px; border-radius:16px; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.45; }
  .user { align-self:flex-end; background:var(--fill); color:#fff; border-bottom-right-radius:5px; }
  .assistant { align-self:flex-start; background:var(--bg); border:1px solid var(--line); border-bottom-left-radius:5px; }
  .cathy { align-self:flex-start; background:var(--cobalt-soft); border-bottom-left-radius:5px; }
  .cathy::before { content:attr(data-from); display:block; font-size:12px; font-weight:600; color:var(--cobalt); margin-bottom:2px; }
  .update { align-self:flex-start; font-family:var(--hand, cursive); color:var(--pen); font-size:18px; padding:2px 6px; }
  .tool { align-self:flex-start; font:13px ui-monospace, monospace; color:var(--muted); padding:0 6px; }
  .tool::before { content:'› '; color:var(--cobalt); }
  .notice { align-self:center; font-size:13px; color:var(--pen); text-align:center; }
  .hint { align-self:center; color:var(--muted); font-size:15px; margin-top:20vh; text-align:center; }
  form { display:flex; gap:8px; padding:10px 12px calc(env(safe-area-inset-bottom) + 10px); border-top:1px solid var(--line); background:var(--paper); max-width:820px; width:100%; margin:0 auto; }
  textarea { flex:1; resize:none; font:inherit; padding:10px 14px; border-radius:20px; border:1px solid var(--line); background:var(--bg); color:var(--ink); max-height:160px; outline:none; }
  textarea:focus { border-color:var(--cobalt); }
  form button { border:0; border-radius:20px; padding:0 18px; background:var(--fill); color:#fff; font-weight:600; cursor:pointer; }
  form button:disabled { opacity:.4; }
  .archive { background:none; border:0; color:var(--muted); font-size:14px; cursor:pointer; padding:4px; }
`;

const CHAT_JS = `
  const id = location.pathname.split('/').pop();
  const log = document.getElementById('log'), t = document.getElementById('t'), send = document.getElementById('send'), pill = document.getElementById('pill');
  let ws, live = null, retry = 0;

  function add(m) {
    log.querySelector('.hint')?.remove();
    const d = document.createElement('div');
    d.className = 'm ' + m.role; d.dataset.testid = 'msg-' + m.role; d.textContent = m.content;
    if (m.role === 'cathy') d.dataset.from = 'From Cathy ' + m.sender;
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  function status(s) { pill.textContent = s; pill.className = 'pill' + (s === 'offline' ? ' offline' : ''); pill.dataset.status = s; }

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/cathy/sessions/' + id + '/ws');
    ws.onopen = () => { retry = 0; send.disabled = false; };
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'history') {
        log.replaceChildren(); live = null;
        if (!ev.messages.length) log.innerHTML = '<div class="hint">Ask Cathy anything, or give her a coding task.<br>She works on her own branch and opens PRs for you.</div>';
        ev.messages.forEach(add); status(ev.status);
      }
      if (ev.type === 'status') { status(ev.status); if (ev.status === 'idle') { log.querySelectorAll('[data-streaming]').forEach((n) => n.remove()); live = null; } }
      // Streamed text shows in temporary bubbles; the finished reply replaces them all.
      if (ev.type === 'delta') { if (!live) { live = add({ role: 'assistant', content: '' }); live.dataset.testid = 'msg-streaming'; live.dataset.streaming = '1'; } live.textContent += ev.text; log.scrollTop = log.scrollHeight; }
      if (ev.type === 'message') {
        if (ev.message.role === 'assistant') log.querySelectorAll('[data-streaming]').forEach((n) => n.remove());
        live = null;
        add(ev.message);
      }
    };
    ws.onclose = () => { send.disabled = true; status('offline'); setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000)); };
  }

  document.getElementById('f').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = t.value.trim(); if (!text || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'send', text })); t.value = ''; t.style.height = 'auto';
  });
  t.addEventListener('input', () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; });
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); document.getElementById('f').requestSubmit(); } });
  document.getElementById('archive').addEventListener('click', async () => {
    if (!confirm('Archive this chat? It leaves the list; the branch stays on GitHub.')) return;
    await fetch('/api/cathy/sessions/' + id + '/archive', { method: 'POST' }); location.href = '/cathy';
  });
  fetch('/api/cathy/sessions/' + id).then((r) => r.ok ? r.json() : null).then((s) => { if (s) { document.getElementById('branch').textContent = s.branch; document.title = (s.title || 'New chat') + ' · Cathy'; } });
  connect();
`;

export const chatPage = () =>
  page({
    title: 'Cathy',
    css: CHAT_CSS,
    body: `<header>
  <a class="back" href="/cathy">‹ Chats</a>
  <div class="who"><div class="name">Cathy</div><div class="branch" id="branch"></div></div>
  <span class="pill" id="pill" data-testid="status">connecting</span>
  <button class="archive" id="archive" title="Archive this chat">Archive</button>
</header>
<div id="log"></div>
<form id="f"><textarea id="t" rows="1" placeholder="Message Cathy" data-testid="composer"></textarea><button id="send" disabled data-testid="send">Send</button></form>`,
    script: CHAT_JS,
  });
