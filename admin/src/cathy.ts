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
  /* Laid out like a messaging app: header, scrolling messages, composer pinned above the keyboard. */
  html, body { height:var(--app-h, 100dvh); overflow:hidden; }
  body { padding:0; display:flex; flex-direction:column; min-height:0; }
  body::before { display:none; }
  header { flex:none; padding: calc(env(safe-area-inset-top) + 10px) max(12px, env(safe-area-inset-right)) 10px max(12px, env(safe-area-inset-left)); display:flex; align-items:center; gap:10px; border-bottom:1px solid var(--line); background:var(--paper); }
  header .back { margin:0; font-size:22px; line-height:1; padding:4px 8px 4px 2px; }
  header .who { flex:1; min-width:0; }
  header .name { font-family:var(--display); font-weight:600; font-size:17px; line-height:1.2; }
  header .branch { font:12px ui-monospace, monospace; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .archive { flex:none; background:none; border:0; color:var(--muted); font-size:14px; cursor:pointer; padding:6px; }
  #log { flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
  .thread { max-width:760px; margin:0 auto; padding:20px max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left)); display:flex; flex-direction:column; gap:14px; }
  .m { overflow-wrap:anywhere; line-height:1.55; font-size:16px; min-width:0; }
  .user { align-self:flex-end; max-width:85%; background:var(--panel); border:1px solid var(--line); border-radius:20px; padding:10px 15px; white-space:pre-wrap; }
  .assistant { align-self:stretch; }
  .assistant p { margin:0 0 10px; } .assistant p:last-child { margin-bottom:0; }
  .assistant code { font:14px ui-monospace, monospace; background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:1px 5px; }
  .assistant pre { margin:0 0 10px; overflow-x:auto; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .assistant pre code { border:0; padding:0; background:none; font-size:13px; }
  .assistant a { color:var(--cobalt); }
  .cathy { align-self:flex-start; max-width:85%; background:var(--cobalt-soft); border-radius:16px; padding:10px 14px; white-space:pre-wrap; }
  .cathy::before { content:attr(data-from); display:block; font-size:12px; font-weight:600; color:var(--cobalt); margin-bottom:2px; }
  /* Progress updates (tell_chris): a plain note. Not the --hand font: admin doesn't load Kalam, and iOS's "cursive" fallback is calligraphy. */
  .update { align-self:flex-start; max-width:85%; color:var(--muted); font-size:15px; border-left:3px solid var(--cobalt); padding:2px 0 2px 10px; white-space:pre-wrap; }
  .tool { align-self:flex-start; max-width:100%; font:13px/1.4 ui-monospace, monospace; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:4px 11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tool::before { content:'› '; color:var(--cobalt); }
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
  .box { max-width:760px; margin:0 auto; background:var(--bg); border:1px solid var(--line); border-radius:24px; padding:12px 12px 10px 16px; box-shadow:var(--shadow); }
  .box:focus-within { border-color:color-mix(in srgb, var(--cobalt) 45%, var(--line)); }
  textarea { display:block; width:100%; min-width:0; resize:none; border:0; outline:none; background:transparent; color:var(--ink); font:16px/1.45 var(--ui); padding:2px 0; max-height:36vh; }
  textarea::placeholder { color:var(--muted); }
  .row { display:flex; justify-content:flex-end; align-items:center; margin-top:6px; }
  .send { flex:none; width:38px; height:38px; border-radius:50%; border:0; display:grid; place-items:center; background:var(--fill); color:#fff; cursor:pointer; transition:opacity .15s, transform .1s; }
  .send:active { transform:scale(.94); }
  .send:disabled { opacity:.3; cursor:default; }
  .send svg { width:20px; height:20px; }
`;

const CHAT_JS = `
  const id = location.pathname.split('/').pop();
  const log = document.getElementById('log'), thread = document.getElementById('thread'), t = document.getElementById('t'), send = document.getElementById('send'), working = document.getElementById('working');
  let ws, live = null, retry = 0, connected = false;

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

  function add(m) {
    thread.querySelector('.hint')?.remove();
    const d = document.createElement('div');
    d.className = 'm ' + m.role; d.dataset.testid = 'msg-' + m.role;
    if (m.role === 'assistant') d.innerHTML = md(m.content); else d.textContent = m.content;
    if (m.role === 'cathy') d.dataset.from = 'From Cathy ' + m.sender;
    const stick = atBottom(); thread.insertBefore(d, working); if (stick) toBottom(); return d;
  }
  function status(s) {
    working.dataset.status = s;
    working.querySelector('span:last-child').textContent = s === 'offline' ? 'Reconnecting…' : 'Cathy is working…';
    if (s === 'thinking') toBottom();
  }
  const sync = () => { send.disabled = !connected || !t.value.trim(); };

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/cathy/sessions/' + id + '/ws');
    ws.onopen = () => { retry = 0; connected = true; sync(); };
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'history') {
        thread.querySelectorAll('.m, .hint').forEach((n) => n.remove()); live = null;
        if (!ev.messages.length) thread.insertAdjacentHTML('afterbegin', '<div class="hint"><b>Hi Chris</b>Ask Cathy anything, or give her a coding task.<br>She works on her own branch and opens PRs for you.</div>');
        ev.messages.forEach(add); status(ev.status); toBottom();
      }
      if (ev.type === 'status') { status(ev.status); if (ev.status === 'idle') { thread.querySelectorAll('[data-streaming]').forEach((n) => n.remove()); live = null; } }
      // Streamed text shows in a temporary block; the finished reply replaces it.
      if (ev.type === 'delta') {
        if (!live) { live = add({ role: 'assistant', content: '' }); live.dataset.testid = 'msg-streaming'; live.dataset.streaming = '1'; live.raw = ''; }
        const stick = atBottom(); live.raw += ev.text; live.innerHTML = md(live.raw); if (stick) toBottom();
      }
      if (ev.type === 'message') {
        if (ev.message.role === 'assistant') thread.querySelectorAll('[data-streaming]').forEach((n) => n.remove());
        live = null; add(ev.message);
      }
    };
    ws.onclose = () => { connected = false; sync(); status('offline'); setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000)); };
  }

  function submit() {
    const text = t.value.trim(); if (!text || !connected) return;
    ws.send(JSON.stringify({ type: 'send', text })); t.value = ''; grow(); sync(); toBottom();
  }
  const grow = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  t.addEventListener('input', () => { grow(); sync(); });
  t.addEventListener('focus', () => setTimeout(() => { fit(); toBottom(); }, 300));
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); submit(); } });
  document.getElementById('archive').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to archive'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Archive'; }, 3000); return; }
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
  <a class="back" href="/cathy" aria-label="Back to chats">‹</a>
  <div class="who"><div class="name">Cathy</div><div class="branch" id="branch"></div></div>
  <button class="archive" id="archive" type="button">Archive</button>
</header>
<div id="log"><div class="thread" id="thread">
  <div class="working" id="working" data-testid="status" data-status="connecting"><span class="dots"><i></i><i></i><i></i></span><span>Cathy is working…</span></div>
</div></div>
<form class="composer" id="f"><div class="box">
  <textarea id="t" rows="1" placeholder="Message Cathy" data-testid="composer" enterkeyhint="send"></textarea>
  <div class="row"><button class="send" id="send" type="submit" disabled aria-label="Send" data-testid="send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div>
</div></form>`,
    script: CHAT_JS,
  });
