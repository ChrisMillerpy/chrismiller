// Models and thinking effort Chris can pick per chat. The list is the MODELS var in
// wrangler.jsonc (one source of truth); MODEL is the default.
import type { TurnSettings } from './conversation.ts';

export const EFFORTS = ['low', 'medium', 'high', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = 'medium';

export interface ModelChoice {
  id: string;
  label: string;
}

/** Parses "id=Label,id=Label" (label optional). The default model is always included. */
export function modelList(env: { MODELS?: string; MODEL?: string }): ModelChoice[] {
  const fallback = env.MODEL || 'claude-opus-5-5';
  const list = (env.MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, label] = s.split('=').map((x) => x.trim());
      return { id, label: label || id };
    });
  return list.some((m) => m.id === fallback) ? list : [{ id: fallback, label: fallback }, ...list];
}

export function defaults(env: { MODELS?: string; MODEL?: string }) {
  return { model: env.MODEL || 'claude-opus-5-5', effort: DEFAULT_EFFORT };
}

/** Check a change Chris asked for. Unknown models or efforts are refused. */
export function validate(env: { MODELS?: string; MODEL?: string }, change: { model?: unknown; effort?: unknown }) {
  const out: { model?: string; effort?: Effort } = {};
  if (change.model !== undefined) {
    if (!modelList(env).some((m) => m.id === change.model)) throw new Error(`Unknown model: ${String(change.model)}`);
    out.model = change.model as string;
  }
  if (change.effort !== undefined) {
    if (!EFFORTS.includes(change.effort as Effort)) throw new Error(`Effort must be one of ${EFFORTS.join(', ')}`);
    out.effort = change.effort as Effort;
  }
  return out;
}

/** The chat's saved choice, falling back to defaults (and to the default if a model was removed from the list). */
export function resolve(env: { MODELS?: string; MODEL?: string }, saved: { model?: string | null; effort?: string | null }) {
  const d = defaults(env);
  const model = saved.model && modelList(env).some((m) => m.id === saved.model) ? saved.model : d.model;
  const effort = saved.effort && EFFORTS.includes(saved.effort as Effort) ? (saved.effort as Effort) : d.effort;
  return { model, effort };
}

export type Provider = 'anthropic' | 'openai';

/** Which company serves a model, from its id: gpt-*, o1/o3/o4-style and openai/* are OpenAI; the rest are Anthropic. */
export function providerFor(model: string): Provider {
  return /^(gpt-|o\d|openai\/)/.test(model) ? 'openai' : 'anthropic';
}

/**
 * What a turn sends to the model: the effort, and thinking with summaries shown, so Chris
 * can read her reasoning. Anthropic gets adaptive thinking and a 1-hour prompt cache: each step
 * re-reads the tools, system prompt and history it has already sent at about a tenth of the input
 * price, and 1 hour (not 5 minutes) so it survives Chris stepping away. OpenAI gets reasoning
 * effort and summaries, and store: false so the chat stays with us (history is replayed each turn,
 * which is also what lets Chris switch between Claude and GPT mid-chat; OpenAI caches prompts
 * by itself). Models that don't support these ignore or reject them; keep MODELS to ones that do.
 */
export function turnSettings(model: string, effort: Effort): TurnSettings {
  const providerOptions =
    providerFor(model) === 'openai'
      ? { openai: { reasoningEffort: effort, reasoningSummary: 'auto', store: false } }
      : { anthropic: { effort, thinking: { type: 'adaptive', display: 'summarized' }, cacheControl: { type: 'ephemeral', ttl: '1h' } } };
  return { model, effort, streamOptions: { providerOptions } };
}
