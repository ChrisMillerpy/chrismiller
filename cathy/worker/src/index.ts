// The Cathy Worker. Not on the public internet (workers_dev is off). Two Workers reach it
// through service bindings:
//  - admin (behind Cloudflare Access) forwards /api/cathy/* here as /api/*;
//  - share (public) forwards only GET /a/<token>[/download] here as /share/a/…, which serves
//    artifacts Chris set to "anyone with the link". Nothing else is reachable from share.
//  - money (public) forwards only Monzo webhooks, after checking the secret URL, here as
//    POST /money/monzo (money.ts). Nothing else is reachable from money.
// Routing lives in api.ts.
import { handle } from './api.ts';
import { SCHEMA } from './schema.ts';
import type { Env } from './env.ts';

export { Session } from './session.ts';
export { ChatGPT } from './chatgpt-account.ts';
export { Sandbox } from '../../sandbox/sandbox.ts';

export default {
  fetch: (request: Request, env: Env) => handle(request, env as any, SCHEMA),
} satisfies ExportedHandler<Env>;
