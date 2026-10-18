// The `fetch` Cathy's OpenAI model uses when a chat runs on Chris's ChatGPT plan instead of the
// API. It points the normal Responses request at ChatGPT's Codex backend and swaps in his
// sign-in. Two rules it never breaks: the token goes to chatgpt.com and nowhere else, and
// nothing about a request (token, account id, messages) is written to a log.
export const BASE_URL = 'https://chatgpt.com/backend-api/codex';

/** The ChatGPT backend wants instructions on every request; Cathy's own soul goes in as a developer message. */
export const DEFAULT_INSTRUCTIONS =
  'You are the model behind Cathy, an AI tutor and engineer working in a custom agent harness. ' +
  'Follow the developer messages and use only the tools provided in this request.';

export interface TokenSource {
  /** `force` asks for a refreshed token (the last one was refused). */
  (force?: boolean): Promise<{ access: string; accountId: string }>;
}

interface Options {
  token: TokenSource;
  fetch?: typeof globalThis.fetch;
  instructions?: string;
  /** Keeps one chat's requests together so the backend can cache its prompt. */
  cacheKey?: string;
}

/** Make an API-style Responses body acceptable to the ChatGPT backend: stateless, streamed, no ids. */
export function toCodexBody(body: Record<string, any>, opts: { instructions?: string; cacheKey?: string } = {}) {
  const out: Record<string, any> = { ...body };
  out.store = false; // the backend refuses anything else
  out.stream = true;
  out.instructions = opts.instructions ?? DEFAULT_INSTRUCTIONS;
  delete out.max_output_tokens;
  delete out.previous_response_id;
  if (opts.cacheKey) out.prompt_cache_key = opts.cacheKey;
  // Nothing is stored server side, so item ids point at nothing; references are dropped, ids stripped.
  out.input = (Array.isArray(body.input) ? body.input : [])
    .filter((i: any) => i?.type !== 'item_reference')
    .map((i: any) => {
      const { id: _id, ...rest } = i ?? {};
      return rest.role === 'system' ? { ...rest, role: 'developer' } : rest;
    });
  out.include = [...new Set([...(Array.isArray(body.include) ? body.include : []), 'reasoning.encrypted_content'])];
  return out;
}

const allowed = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'chatgpt.com' && !u.port && !u.username && !u.password && u.pathname.startsWith('/backend-api/');
  } catch {
    return false;
  }
};

/** ChatGPT answers a spent plan with a 404 or 429 and a JSON body; say it in words. */
async function friendlyLimit(res: Response): Promise<Response> {
  if (res.status !== 404 && res.status !== 429) return res;
  const text = await res.clone().text().catch(() => '');
  let e: any;
  try {
    e = JSON.parse(text)?.error;
  } catch {}
  const kind = String(e?.type ?? e?.code ?? '');
  if (!/usage_limit|usage_not_included|rate_limit/.test(kind)) return res;
  const secs = Number(e?.resets_in_seconds);
  const mins = Math.max(1, Math.round(secs / 60));
  const when = !secs ? '' : mins < 60 ? ` It resets in about ${mins} minutes.` : ` It resets in about ${Math.floor(mins / 60)} hour${mins >= 120 ? 's' : ''}${mins % 60 ? ` ${mins % 60} minutes` : ''}.`;
  return Response.json({ error: { message: `Your ChatGPT plan's usage limit is used up.${when} Switch to another model, or wait.` } }, { status: 429 });
}

export function chatgptFetch(opts: Options): typeof globalThis.fetch {
  const base = opts.fetch ?? fetch;
  return (async (input: any, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    // Checked before the token is even fetched.
    if (!allowed(url)) throw new Error('The ChatGPT sign-in only talks to chatgpt.com, so I refused to send it to ' + (URL.canParse(url) ? new URL(url).hostname : 'that address') + '.');
    const body = init.body ? JSON.stringify(toCodexBody(JSON.parse(String(init.body)), opts)) : undefined;
    const send = async (force: boolean) => {
      const { access, accountId } = await opts.token(force);
      const headers = new Headers(init.headers);
      headers.delete('x-api-key');
      headers.set('authorization', `Bearer ${access}`);
      headers.set('chatgpt-account-id', accountId);
      headers.set('openai-beta', 'responses=experimental');
      headers.set('originator', 'codex_cli_rs'); // the OAuth client is Codex CLI's, so this is how it is identified
      headers.set('accept', 'text/event-stream');
      if (opts.cacheKey) headers.set('session_id', opts.cacheKey);
      // Never follow a redirect: it could carry the token somewhere else.
      return base(url, { ...init, headers, body, redirect: 'manual' });
    };
    let res = await send(false);
    if (res.status === 401) res = await send(true);
    return friendlyLimit(res);
  }) as typeof globalThis.fetch;
}
