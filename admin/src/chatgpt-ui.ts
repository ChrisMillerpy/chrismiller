// The ChatGPT plan screen (/chatgpt): connect Chris's ChatGPT sign-in so Cathy can use his plan's
// usage instead of the API. Pure strings, so the script can be tested without a browser.
// It talks to /api/cathy/chatgpt, which admin forwards to the Cathy Worker. Nothing it receives is
// ever put on the page as HTML, and no token ever reaches it: the API never returns one.

export const CHATGPT_CSS = `
  .card { background:var(--bg); border:1px solid var(--line); border-radius:16px; padding:16px 18px; box-shadow:var(--shadow); margin:0 0 14px; }
  .card h2 { font:600 19px var(--display); margin:0 0 8px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .card p { margin:0 0 10px; } .card p.muted { color:var(--muted); font-size:14.5px; }
  .pill { display:inline-block; font:600 13px var(--ui); border-radius:999px; padding:3px 11px; border:1px solid var(--line); background:var(--panel); color:var(--muted); }
  .pill.on { color:#1B7F4B; border-color:#1B7F4B; }
  @media (prefers-color-scheme: dark) { .pill.on { color:#5FD38D; border-color:#5FD38D; } }
  .btn { display:inline-block; text-decoration:none; text-align:center; border:0; border-radius:12px; padding:12px 18px; font-weight:600; cursor:pointer; background:var(--fill); color:#fff; box-shadow:0 2px 0 var(--fill-shadow); }
  .btn[disabled] { opacity:.6; }
  .btn.danger { background:none; color:var(--pen); border:1px solid var(--pen); box-shadow:none; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  textarea { width:100%; min-height:92px; font:16px ui-monospace, monospace; padding:10px 12px; border-radius:12px; border:1px solid var(--line); background:var(--bg); color:var(--ink); resize:vertical; }
  select { font:16px var(--ui); padding:10px 12px; border-radius:12px; border:1px solid var(--line); background:var(--bg); color:var(--ink); min-height:44px; }
  .result { margin-top:12px; padding:10px 12px; border-radius:12px; border:1px solid var(--line); background:var(--panel); overflow-wrap:anywhere; white-space:pre-wrap; }
  .result.bad { border-color:var(--pen); color:var(--pen); }
  ol { margin:0 0 12px; padding-left:22px; } li { margin:0 0 6px; }
  [hidden] { display:none !important; }
`;

export const CHATGPT_BODY = `<main>
  <a class="back" href="/">‹ Admin</a>
  <p class="eyebrow">Use your own plan</p>
  <h1>ChatGPT plan</h1>

  <section class="card">
    <h2>Status <span class="pill" id="pill" data-testid="chatgpt-status">Checking…</span></h2>
    <p id="who" class="muted"></p>
    <p class="muted">Connect your ChatGPT account and Cathy can run GPT models on your plan's usage instead of billing the API. In a chat, pick a model marked <b>(ChatGPT plan)</b>. Models without that mark still use the API key.</p>
  </section>

  <section class="card" id="connect" hidden>
    <h2>Connect</h2>
    <ol>
      <li>Tap <b>Start</b>, then <b>Open ChatGPT</b>, and sign in.</li>
      <li>When it finishes, the page will say it <b>can't be reached</b> (it points at <i>localhost</i>). That's expected, because nothing is listening there.</li>
      <li>Copy the whole web address from the <b>address bar</b>, come back here and paste it below.</li>
    </ol>
    <div class="row">
      <button class="btn" id="start" data-testid="chatgpt-start">Start</button>
      <a class="btn" id="open" target="_blank" rel="noopener noreferrer" hidden>Open ChatGPT</a>
    </div>
    <div id="paste" hidden style="margin-top:14px">
      <textarea id="pasted" placeholder="http://localhost:1455/auth/callback?code=…" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" data-testid="chatgpt-paste"></textarea>
      <div class="row" style="margin-top:10px"><button class="btn" id="finish" data-testid="chatgpt-finish">Finish connecting</button></div>
    </div>
    <div class="result bad" id="connect-error" hidden></div>
  </section>

  <section class="card" id="connected" hidden>
    <h2>Try it</h2>
    <p class="muted">Sends one tiny message on your plan and shows exactly what ChatGPT answers.</p>
    <div class="row">
      <select id="model" aria-label="Model" data-testid="chatgpt-model"></select>
      <button class="btn" id="test" data-testid="chatgpt-test">Send test</button>
    </div>
    <div class="result" id="test-result" hidden data-testid="chatgpt-test-result"></div>
  </section>

  <section class="card" id="manage" hidden>
    <h2>Disconnect</h2>
    <p class="muted">Deletes the sign-in from Cathy. Chats on a plan model will say it isn't connected until you connect again.</p>
    <button class="btn danger" id="disconnect" data-testid="chatgpt-disconnect">Disconnect ChatGPT</button>
  </section>

  <section class="card">
    <h2>Good to know</h2>
    <p class="muted">The sign-in is kept only inside Cathy's private storage. It never appears in a chat, a log, or her box, and this page never receives it.</p>
    <p class="muted">Your plan has its own usage limit, shared with ChatGPT itself. Long chats where Cathy uses lots of tools can use it up quickly; she'll say so when it happens.</p>
    <p class="muted">This is how OpenAI's Codex app signs in. It isn't an official option for other apps, so it could stop working without notice. In ChatGPT's settings, turn off <b>Improve the model for everyone</b> if you don't want chats used for training.</p>
  </section>
</main>`;

export const CHATGPT_JS = `
  const $ = (id) => document.getElementById(id);
  const API = '/api/cathy/chatgpt';
  const JSON_HEADERS = { 'content-type': 'application/json' };
  const show = (el, on) => { el.hidden = !on; };
  async function call(path, init) {
    const r = await fetch(API + path, init);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong (' + r.status + ')');
    return data;
  }
  function render(s) {
    $('pill').textContent = s.connected ? 'Connected' : 'Not connected';
    $('pill').className = 'pill' + (s.connected ? ' on' : '');
    $('who').textContent = s.connected ? [s.email, s.plan && s.plan[0].toUpperCase() + s.plan.slice(1) + ' plan'].filter(Boolean).join(' · ') : '';
    show($('connect'), !s.connected);
    show($('connected'), s.connected);
    show($('manage'), s.connected);
    const sel = $('model');
    if (s.models && !sel.options.length) s.models.forEach((m) => sel.add(new Option(m.replace(/^chatgpt\\//, ''), m)));
  }
  async function load() {
    try { render(await call('')); }
    catch (e) { $('pill').textContent = 'Could not check'; $('who').textContent = e.message; }
  }
  $('start').onclick = async () => {
    $('start').disabled = true; show($('connect-error'), false);
    try {
      const { url } = await call('/start', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
      $('open').href = url; show($('open'), true); show($('paste'), true);
    } catch (e) { $('connect-error').textContent = e.message; show($('connect-error'), true); }
    $('start').disabled = false;
  };
  $('finish').onclick = async () => {
    $('finish').disabled = true; show($('connect-error'), false);
    try {
      render(await call('/finish', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ input: $('pasted').value }) }));
      $('pasted').value = ''; show($('paste'), false); show($('open'), false);
    } catch (e) { $('connect-error').textContent = e.message; show($('connect-error'), true); }
    $('finish').disabled = false;
  };
  $('test').onclick = async () => {
    const out = $('test-result');
    $('test').disabled = true; out.hidden = false; out.className = 'result'; out.textContent = 'Asking…';
    try {
      const r = await call('/test', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ model: $('model').value }) });
      out.className = 'result' + (r.ok ? '' : ' bad');
      out.textContent = r.ok ? 'It works. The model said: ' + (r.reply || '(nothing)') : r.error;
    } catch (e) { out.className = 'result bad'; out.textContent = e.message; }
    $('test').disabled = false;
  };
  $('disconnect').onclick = async () => {
    if (!confirm('Disconnect ChatGPT? Chats on a plan model will stop working until you connect again.')) return;
    try { await call('', { method: 'DELETE' }); $('test-result').hidden = true; load(); }
    catch (e) { alert(e.message); }
  };
  load();
  addEventListener('pageshow', (e) => { if (e.persisted) load(); });
`;
