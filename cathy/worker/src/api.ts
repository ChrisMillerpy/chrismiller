// Cathy's HTTP API: routing for admin (/api/*) and share (/share/a/*). No Cloudflare imports,
// so it's tested in plain Node; index.ts is the Worker entry that adds the Durable Objects.
import { Registry, uploadKey, versionKey, type Artifact, type Visibility } from './registry.ts';
import { MAX_FILE, mimeFor, serveFile, shareUrl } from './files.ts';
import { isChatGPT, modelList, resolve, validate, EFFORTS } from './models.ts';
import { BASE_URL, chatgptFetch } from './chatgpt-fetch.ts';
import type { Vault } from './chatgpt-vault.ts';
import { Money, receive } from './money.ts';
import type { Env } from './env.ts';

/** What the API needs from the Session Durable Object. */
export interface SessionStub {
  fetch(r: Request): Promise<Response>;
  changed(id: string, e: import('./conversation.ts').Event): Promise<void>;
  /** Post a Monzo transaction line to this chat (the Money chat). */
  receiveMoney?(id: string, text: string, reply: boolean): Promise<void>;
}
/** What the API needs from the ChatGPT sign-in Durable Object. */
export type VaultStub = Pick<Vault, 'status' | 'start' | 'finish' | 'accessToken' | 'disconnect'>;
export type ApiEnv = Omit<Env, 'SESSION' | 'SANDBOX' | 'DB' | 'FILES' | 'CHATGPT'> & {
  DB: any;
  FILES: any;
  SESSION: { getByName(id: string): SessionStub };
  CHATGPT: { getByName(name: string): VaultStub };
  /** Tests only: stands in for the network when the ChatGPT test request is sent. */
  fetchImpl?: typeof globalThis.fetch;
};

/** Schema is passed in: the Worker imports the .sql files, tests read them from disk. */

const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: 'Not found' }, 404);

export async function handle(request: Request, env: ApiEnv, schema: string[]): Promise<Response> {
  const url = new URL(request.url);
  const registry = new Registry(env.DB, schema, env.FILES);
  let parts: string[];
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return notFound();
  }
  try {
    if (parts[0] === 'share') return await share(parts.slice(1), request, registry);
    if (parts[0] === 'money') return await money(parts.slice(1), request, registry, env);
    if (parts[0] !== 'api') return notFound();
    if (parts[1] === 'sessions') return await sessions(parts.slice(2), request, url, registry, env);
    if (parts[1] === 'artifacts') return await artifacts(parts.slice(2), request, url, registry, env);
    if (parts[1] === 'chatgpt') return await chatgpt(parts.slice(2), request, env);
    if (parts[1] === 'models' && request.method === 'GET') return json({ models: modelList(env), efforts: EFFORTS, defaults: resolve(env, {}) });
    return notFound();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, /^(Unknown|Effort|Visibility|A title|Give)/.test(message) ? 400 : 500);
  }
}

/** A session as the pages see it: with its model and effort filled in. */
const sessionView = (s: Awaited<ReturnType<Registry['get']>> & {}, env: ApiEnv) => ({ ...s, ...resolve(env, s) });

async function sessions([id, action, sub]: string[], request: Request, url: URL, registry: Registry, env: ApiEnv) {
  const method = request.method;
  if (!id && method === 'GET') return json((await registry.list(url.searchParams.get('status') === 'archived' ? 'archived' : 'active')).map((s) => sessionView(s, env)));
  if (!id && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { title?: string; model?: string; effort?: string };
    const s = await registry.create(body.title ?? '');
    const change = validate(env, { model: body.model, effort: body.effort });
    return json(sessionView(Object.keys(change).length ? await registry.setModel(s.id, change) : s, env), 201);
  }

  const session = id && (await registry.get(id));
  if (!session) return json({ error: 'No such session' }, 404);
  const stub = () => env.SESSION.getByName(session.id);

  if (!action && method === 'GET') return json(sessionView(session, env));
  // Rename, or change model / effort. Open chat pages hear about it at once.
  if (!action && method === 'PATCH') {
    const body = (await request.json().catch(() => ({}))) as { title?: string; model?: string; effort?: string };
    if (body.title !== undefined) {
      if (!body.title.trim()) return json({ error: 'Give the chat a title' }, 400);
      await registry.rename(session.id, body.title, 'chris');
    }
    const change = validate(env, { model: body.model, effort: body.effort });
    if (Object.keys(change).length) await registry.setModel(session.id, change);
    const updated = sessionView((await registry.get(session.id))!, env);
    if (body.title !== undefined) await stub().changed(session.id, { type: 'title', title: updated.title });
    if (Object.keys(change).length) await stub().changed(session.id, { type: 'settings', model: updated.model, effort: updated.effort });
    return json(updated);
  }
  if (action === 'archive' && method === 'POST') {
    await registry.archive(session.id);
    return json({ ok: true });
  }
  if (action === 'unarchive' && method === 'POST') {
    await registry.unarchive(session.id);
    return json({ ok: true });
  }
  // Attachments: the page uploads each file first, then sends the message with their ids.
  if (action === 'uploads' && !sub && method === 'POST') {
    const name = decodeURIComponent(request.headers.get('x-filename') ?? 'file');
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_FILE) return json({ error: `Files can be up to ${MAX_FILE / 1024 / 1024} MB` }, 413);
    const type = (request.headers.get('content-type') ?? '').split(';')[0].trim();
    const mime = type && type !== 'application/octet-stream' ? type : mimeFor(name);
    const u = await registry.addUpload(session.id, name, mime, bytes);
    return json({ id: u.id, name: u.name, mime: u.mime, size: u.size }, 201);
  }
  if (action === 'uploads' && sub && method === 'GET') {
    const u = await registry.upload(sub);
    const bytes = u && u.session_id === session.id ? await registry.getBytes(uploadKey(u.id)) : null;
    if (!u || !bytes) return notFound();
    return serveFile({ filename: u.name, mime: u.mime }, bytes, { download: url.searchParams.has('download'), cache: 'private, max-age=86400' });
  }
  if (action === 'ws') {
    const target = new URL(request.url);
    target.searchParams.set('id', session.id);
    return stub().fetch(new Request(target, request));
  }
  return notFound();
}

/** An artifact as admin sees it. The token only appears inside share_url. */
const artifactView = (a: Artifact, env: ApiEnv) => {
  const { token, ...rest } = a;
  return { ...rest, share_url: shareUrl(env, token), admin_url: `/artifacts/${a.id}` };
};

async function artifacts([id, action, sub]: string[], request: Request, url: URL, registry: Registry, env: ApiEnv) {
  const method = request.method;
  if (!id && method === 'GET') {
    const v = url.searchParams.get('visibility') as Visibility | null;
    const list = await registry.artifacts({ session_id: url.searchParams.get('session') ?? undefined, visibility: v ?? undefined });
    const titles = new Map((await Promise.all([...new Set(list.map((a) => a.session_id))].map((s) => registry.get(s)))).filter(Boolean).map((s) => [s!.id, s!.title]));
    return json(list.map((a) => ({ ...artifactView(a, env), session_title: titles.get(a.session_id) ?? '' })));
  }
  const a = id && (await registry.artifact(id));
  if (!a) return json({ error: 'No such artifact' }, 404);

  if (!action && method === 'GET') return json({ ...artifactView(a, env), versions: await registry.versions(a.id), session_title: (await registry.get(a.session_id))?.title ?? '' });
  if (!action && method === 'PATCH') {
    const body = (await request.json().catch(() => ({}))) as { title?: string; visibility?: Visibility };
    return json(artifactView(await registry.updateArtifact(a.id, body), env));
  }
  if (!action && method === 'DELETE') {
    await registry.deleteArtifact(a.id);
    return json({ ok: true });
  }
  if (action === 'new-link' && method === 'POST') return json(artifactView((await registry.newLink(a.id))!, env));
  // The file itself, for admin (behind Access). ?v=<n> for an older version.
  if (action === 'raw' && method === 'GET') {
    const v = Number(url.searchParams.get('v') || a.version);
    const version = (await registry.versions(a.id)).find((x) => x.version === v);
    const bytes = version && (await registry.getBytes(versionKey(a.id, v)));
    if (!version || !bytes) return notFound();
    return serveFile({ filename: version.filename, mime: version.mime, title: a.title }, bytes, { download: url.searchParams.has('download') });
  }
  return notFound();
}

/**
 * The public face, reached only through the share Worker. Only "link" artifacts, only by
 * token, only the latest version. No ids, chats or lists.
 */
async function share([kind, token, action, extra]: string[], request: Request, registry: Registry) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Read only' }, 405);
  if (kind !== 'a' || !token || extra || (action && action !== 'download')) return notFound();
  const a = await registry.shared(token);
  const bytes = a && (await registry.getBytes(versionKey(a.id, a.version)));
  if (!a || !bytes) return notFound();
  // Short cache: switching an artifact back to private takes effect within a minute.
  return serveFile({ filename: a.filename, mime: a.mime, title: a.title }, bytes, { download: action === 'download', cache: 'public, max-age=60', etag: `"${a.id}-${a.version}"` });
}

/**
 * Monzo webhooks, reached only through the money Worker (money/), which has already checked the
 * secret URL. Always 200 for a well-formed body, so Monzo doesn't retry what we've already stored.
 */
async function money([source, extra]: string[], request: Request, registry: Registry, env: ApiEnv) {
  if (source !== 'monzo' || extra || request.method !== 'POST') return notFound();
  const body = await request.json().catch(() => null);
  const result = await receive(body, {
    money: new Money(env.DB, registry),
    post: async (chat, text, reply) => {
      await env.SESSION.getByName(chat).receiveMoney?.(chat, text, reply);
    },
  });
  return json(result, result.ok ? 200 : 400);
}

/**
 * Chris's ChatGPT plan sign-in. Reached only through admin (behind Access). Nothing here returns
 * a token or the account id: status is who is connected, and the test returns the words the model said.
 */
async function chatgpt([action]: string[], request: Request, env: ApiEnv) {
  const vault = env.CHATGPT.getByName('main');
  const method = request.method;
  const planModels = modelList(env).map((m) => m.id).filter(isChatGPT);
  if (!action && method === 'GET') return json({ ...(await vault.status()), models: planModels });
  if (!action && method === 'DELETE') {
    await vault.disconnect();
    return json({ ok: true });
  }
  if (method !== 'POST' || !['start', 'finish', 'test'].includes(action)) return notFound();
  // JSON only: a form posted from another site can't set this, so it can't start, finish or test a sign-in.
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'Send JSON' }, 415);
  const body = (await request.json().catch(() => ({}))) as { input?: string; model?: string };

  if (action === 'start') return json(await vault.start());
  if (action === 'finish') {
    try {
      return json(await vault.finish(String(body.input ?? '')));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }
  // test: one small request on the plan, so Chris sees what ChatGPT really answers.
  const model = body.model ?? planModels[0];
  if (!model || !planModels.includes(model)) return json({ error: 'Pick one of the ChatGPT plan models' }, 400);
  try {
    const send = chatgptFetch({ token: (force) => vault.accessToken(force), fetch: env.fetchImpl });
    const res = await send(`${BASE_URL}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: model.slice('chatgpt/'.length), reasoning: { effort: 'low' }, input: [{ role: 'user', content: [{ type: 'input_text', text: 'Reply with the single word: ready' }] }] }),
    });
    const text = await res.text();
    if (!res.ok) {
      let said = text;
      try {
        const j = JSON.parse(text);
        said = j?.error?.message ?? j?.detail ?? text;
      } catch {}
      return json({ ok: false, model, error: `ChatGPT answered ${res.status}: ${String(said).slice(0, 400)}` });
    }
    const reply = [...text.matchAll(/^data: (.*)$/gm)]
      .map((m) => {
        try {
          return JSON.parse(m[1]);
        } catch {
          return {};
        }
      })
      .filter((e) => e.type === 'response.output_text.delta')
      .map((e) => e.delta)
      .join('');
    return json({ ok: true, model, reply: reply.trim() });
  } catch (e) {
    return json({ ok: false, model, error: e instanceof Error ? e.message : String(e) });
  }
}
