// Builds the model for a chat turn. Kept apart from session.ts (which needs the Workers
// runtime) so it can be tested under plain Node.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { isChatGPT, providerFor } from './models.ts';
import { BASE_URL, chatgptFetch, type TokenSource } from './chatgpt-fetch.ts';

export interface ProviderKeys {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  OPENAI_API_KEY?: string;
  /** Gives the ChatGPT plan sign-in's access token. Absent when ChatGPT isn't wired up. */
  CHATGPT?: TokenSource;
}

/** The AI SDK model for an id. A missing key is an error Chris can read in the chat. */
export function buildModel(keys: ProviderKeys, id: string, fetch?: typeof globalThis.fetch, opts: { cacheKey?: string } = {}) {
  if (isChatGPT(id)) {
    // Chris's ChatGPT plan, not the API: a different bill, so it never falls back to the API key (or the reverse).
    if (!keys.CHATGPT) throw new Error("The ChatGPT plan isn't set up here, so I can't use " + id);
    return createOpenAI({ apiKey: 'chatgpt-plan', baseURL: BASE_URL, fetch: chatgptFetch({ token: keys.CHATGPT, fetch, cacheKey: opts.cacheKey }) })(id.slice('chatgpt/'.length));
  }
  if (providerFor(id) === 'openai') {
    if (!keys.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY isn't set, so I can't use " + id);
    // Responses API (the default): it's the one that returns reasoning summaries.
    return createOpenAI({ apiKey: keys.OPENAI_API_KEY, fetch })(id.replace(/^openai\//, ''));
  }
  if (!keys.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY isn't set, so I can't use " + id);
  return createAnthropic({
    apiKey: keys.ANTHROPIC_API_KEY,
    headers: keys.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': keys.ANTHROPIC_WORKSPACE_ID } : undefined,
    fetch,
  })(id);
}
