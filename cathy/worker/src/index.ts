// The Cathy Worker. Not on the public internet (workers_dev is off). Two Workers reach it
// through service bindings:
//  - admin (behind Cloudflare Access) forwards /api/cathy/* here as /api/*;
//  - share (public) forwards only /share/*, which serves artifacts Chris made link-only or public.
import { Registry, type Artifact, type Visibility } from './registry.ts';
import { fileHeaders, MAX_FILE, mimeFor, shareUrl } from './files.ts';
import { SCHEMA } from './schema.ts';
import type { Env } from './env.ts';

export { Session } from './session.ts';
export { Sandbox } from '../../sandbox/sandbox.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: 'Not found' }, 404);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const registry = new Registry(env.DB, SCHEMA);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (parts[0] === 'share') return await share(parts.slice(1), request, registry, env);
      if (parts[0] !== 'api') return notFound();
      if (parts[1] === 'sessions') return await sessions(parts.slice(2), request, url, registry, env);
      if (parts[1] === 'artifacts') return await artifacts(parts.slice(2), request, url, registry, env);
      return notFound();
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function sessions([id, action, sub]: string[], request: Request, url: URL, registry: Registry, env: Env) {
  const method = request.method;
  if (!id && method === 'GET') return json(await registry.list(url.searchParams.get('status') === 'archived' ? 'archived' : 'active'));
  if (!id && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    return json(await registry.create(body.title ?? ''), 201);
  }

  const session = id && (await registry.get(id));
  if (!session) return json({ error: 'No such session' }, 404);

  if (!action && method === 'GET') return json(session);
  if (!action && method === 'PATCH') {
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    if (!body.title?.trim()) return json({ error: 'Give the chat a title' }, 400);
    await registry.rename(session.id, body.title, 'chris');
    const updated = (await registry.get(session.id))!;
    await env.SESSION.getByName(session.id).renamed(session.id, updated.title);
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
    const name = request.headers.get('x-filename') ?? 'file';
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_FILE) return json({ error: `Files can be up to ${MAX_FILE / 1024 / 1024} MB` }, 413);
    const type = (request.headers.get('content-type') ?? '').split(';')[0].trim();
    const mime = type && type !== 'application/octet-stream' ? type : mimeFor(name);
    const u = await registry.addUpload(session.id, name, mime, bytes);
    return json({ id: u.id, name: u.name, mime: u.mime, size: u.size }, 201);
  }
  if (action === 'uploads' && sub && method === 'GET') {
    const u = await registry.upload(sub);
    const bytes = u && u.session_id === session.id ? await registry.getBlob(`upload:${u.id}`) : null;
    if (!u || !bytes) return notFound();
    return new Response(bytes, { headers: fileHeaders({ filename: u.name, mime: u.mime, size: bytes.length }, { download: url.searchParams.has('download'), cache: 'private, max-age=86400' }) });
  }
  if (action === 'ws') {
    const target = new URL(request.url);
    target.searchParams.set('id', session.id);
    return env.SESSION.getByName(session.id).fetch(new Request(target, request));
  }
  return notFound();
}

const view = (a: Artifact, env: Env) => ({ ...a, token: undefined, share_url: shareUrl(env, a.token), admin_url: `/artifacts/${a.id}` });

async function artifacts([id, action]: string[], request: Request, url: URL, registry: Registry, env: Env) {
  const method = request.method;
  if (!id && method === 'GET') {
    const v = url.searchParams.get('visibility') as Visibility | null;
    const list = await registry.artifacts({ session_id: url.searchParams.get('session') ?? undefined, visibility: v ?? undefined });
    return json(list.map((a) => view(a, env)));
  }
  const a = id && (await registry.artifact(id));
  if (!a) return json({ error: 'No such artifact' }, 404);

  if (!action && method === 'GET') return json(view(a, env));
  if (!action && method === 'PATCH') {
    const body = (await request.json().catch(() => ({}))) as { title?: string; visibility?: Visibility };
    return json(view(await registry.updateArtifact(a.id, body), env));
  }
  if (!action && method === 'DELETE') {
    await registry.deleteArtifact(a.id);
    return json({ ok: true });
  }
  if (action === 'new-link' && method === 'POST') return json(view((await registry.newLink(a.id))!, env));
  if (action === 'raw' && method === 'GET') return raw(a, registry, url.searchParams.has('download'), 'private, no-store');
  return notFound();
}

async function raw(a: Artifact, registry: Registry, download: boolean, cache: string) {
  const bytes = await registry.getBlob(`artifact:${a.id}`);
  if (!bytes) return notFound();
  return new Response(bytes, { headers: { ...fileHeaders({ filename: a.filename, mime: a.mime, size: bytes.length }, { download, cache }), etag: `"${a.id}-${a.updated_at}"` } });
}

/**
 * The public face, reached only through the share Worker. Never shows private artifacts,
 * never shows ids or chats, and only lists artifacts marked public.
 */
async function share([kind, token, action]: string[], request: Request, registry: Registry, env: Env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Read only' }, 405);
  if (kind === 'public' && !token) {
    const list = await registry.artifacts({ visibility: 'public' });
    return json(list.map((a) => ({ title: a.title, filename: a.filename, mime: a.mime, size: a.size, updated_at: a.updated_at, url: shareUrl(env, a.token) })));
  }
  if (kind === 'a' && token) {
    const a = await registry.shared(token);
    if (!a) return notFound();
    if (action === 'meta') return json({ title: a.title, filename: a.filename, mime: a.mime, size: a.size, updated_at: a.updated_at, visibility: a.visibility });
    // Short cache: making an artifact private again takes effect within a minute.
    return raw(a, registry, action === 'download', 'public, max-age=60');
  }
  return notFound();
}
