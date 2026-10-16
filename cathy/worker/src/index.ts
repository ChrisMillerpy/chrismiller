// The Cathy Worker. Not on the public internet (workers_dev is off): the admin Worker
// reaches it through a service binding and forwards /api/cathy/* here.
import { Registry } from './registry.ts';
import type { Env } from './env.ts';
import SCHEMA from '../../../d1/migrations/0001_sessions.sql';

export { Session } from './session.ts';
export { Sandbox } from '../../sandbox/sandbox.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const registry = new Registry(env.DB, SCHEMA);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'sessions', id?, action?]
    if (parts[0] !== 'api' || parts[1] !== 'sessions') return json({ error: 'Not found' }, 404);
    const [, , id, action] = parts;

    try {
      if (!id && request.method === 'GET') return json(await registry.list());
      if (!id && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { title?: string };
        return json(await registry.create(body.title ?? ''), 201);
      }

      const session = id && (await registry.get(id));
      if (!session) return json({ error: 'No such session' }, 404);

      if (!action && request.method === 'GET') return json(session);
      if (action === 'archive' && request.method === 'POST') {
        await registry.archive(session.id);
        return json({ ok: true });
      }
      if (action === 'ws') {
        const target = new URL(request.url);
        target.searchParams.set('id', session.id);
        return env.SESSION.getByName(session.id).fetch(new Request(target, request));
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
