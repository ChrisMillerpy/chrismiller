// Admin Worker: a chat with Cathy, Chris's AI tutor assistant.
// Deliberately simple: password-protected (basic auth), no database,
// conversation lives in the browser tab. Harden when there's real data.

const MODEL = 'claude-sonnet-5-5';

const CATHY = `You are Cathy, an AI maths tutor working with Chris Miller, who runs a one-to-one maths tutoring business (withchris.uk) in London.
Chris is your colleague and the only person talking to you right now. Help him plan lessons, write worksheets and explanations, think through how to help particular students, and run the business.
Talk like a sharp, friendly colleague: short, plain, direct. No filler. Answer first, then detail only if needed.
Use LaTeX between $...$ for maths when it helps.`;

export default {
  async fetch(request, env) {
    if (!authorised(request, env)) {
      return new Response('Password needed', {
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="Cathy", charset="UTF-8"' },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/chat' && request.method === 'POST') return chat(request, env);
    return new Response(PAGE, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
    });
  },
};

// Any username; the password must match ADMIN_PASSWORD. Locked if it isn't set.
function authorised(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6));
    return decoded.slice(decoded.indexOf(':') + 1) === env.ADMIN_PASSWORD;
  } catch {
    return false;
  }
}

async function chat(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY is not set' }, 500);

  let messages;
  try {
    ({ messages } = await request.json());
  } catch {
    return json({ error: 'Bad request' }, 400);
  }
  if (!Array.isArray(messages) || !messages.length) return json({ error: 'No messages' }, 400);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: CATHY, cache_control: { type: 'ephemeral' } }],
      messages: messages.slice(-40),
    }),
  });

  const data = await res.json();
  if (!res.ok) return json({ error: data.error?.message || `Anthropic error ${res.status}` }, 502);
  const reply = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return json({ reply });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">
<meta name="robots" content="noindex">
<title>Cathy</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<style>
  :root { --bg:#fafaf7; --fg:#1a1a1a; --muted:#6b6b6b; --me:#1a1a1a; --me-fg:#fff; --her:#ececE6; --line:#ddd; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141414; --fg:#eee; --muted:#999; --me:#eee; --me-fg:#111; --her:#242424; --line:#333; } }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, sans-serif; }
  body { display:flex; flex-direction:column; height:100dvh; }
  header { padding:12px 16px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; }
  header b { font-size:18px; }
  header button { background:none; border:0; color:var(--muted); font:inherit; }
  #log { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px; }
  .msg { max-width:85%; padding:10px 14px; border-radius:16px; white-space:pre-wrap; overflow-wrap:anywhere; }
  .me { align-self:flex-end; background:var(--me); color:var(--me-fg); border-bottom-right-radius:4px; }
  .her { align-self:flex-start; background:var(--her); border-bottom-left-radius:4px; }
  .note { align-self:center; color:var(--muted); font-size:14px; }
  form { display:flex; gap:8px; padding:10px 12px calc(10px + env(safe-area-inset-bottom)); border-top:1px solid var(--line); }
  textarea { flex:1; resize:none; font:inherit; padding:10px 12px; border-radius:20px; border:1px solid var(--line); background:var(--bg); color:var(--fg); max-height:140px; }
  form button { border:0; border-radius:20px; padding:0 16px; background:var(--me); color:var(--me-fg); font:inherit; font-weight:600; }
  form button:disabled { opacity:.4; }
</style>
</head>
<body>
<header><b>Cathy</b><button id="clear" type="button">New chat</button></header>
<div id="log"><div class="note">Hi Chris. What are we working on?</div></div>
<form id="f"><textarea id="t" rows="1" placeholder="Message Cathy"></textarea><button id="send">Send</button></form>
<script>
  const log = document.getElementById('log'), t = document.getElementById('t'), send = document.getElementById('send');
  let messages = [];
  try { messages = JSON.parse(sessionStorage.getItem('cathy') || '[]'); } catch {}
  const save = () => { try { sessionStorage.setItem('cathy', JSON.stringify(messages)); } catch {} };

  function add(cls, text) {
    const d = document.createElement('div');
    d.className = 'msg ' + cls; d.textContent = text; log.appendChild(d);
    if (window.renderMathInElement) renderMathInElement(d, { delimiters: [{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}], throwOnError:false });
    log.scrollTop = log.scrollHeight; return d;
  }
  window.addEventListener('load', () => messages.forEach(m => add(m.role === 'user' ? 'me' : 'her', m.content)));

  t.addEventListener('input', () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; });
  document.getElementById('clear').onclick = () => { messages = []; save(); log.innerHTML = '<div class="note">New chat.</div>'; };

  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = t.value.trim(); if (!text) return;
    t.value = ''; t.style.height = 'auto';
    messages.push({ role: 'user', content: text }); save(); add('me', text);
    const wait = add('note', 'Cathy is typing…'); send.disabled = true;
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }) });
      const data = await r.json(); wait.remove();
      if (!r.ok) throw new Error(data.error || 'Something went wrong');
      messages.push({ role: 'assistant', content: data.reply }); save(); add('her', data.reply);
    } catch (err) {
      wait.remove(); messages.pop(); save(); add('note', 'Error: ' + err.message);
    } finally { send.disabled = false; }
  });
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); document.getElementById('f').requestSubmit(); } });
</script>
</body>
</html>`;
