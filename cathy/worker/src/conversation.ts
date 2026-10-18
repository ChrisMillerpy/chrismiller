// One Cathy chat: the message log, the agent's memory, turn-taking, stop and interrupt,
// and the Cathy-to-Cathy loop guard. No Cloudflare code, so it's tested in plain Node;
// the Session Durable Object wires it to SQLite, WebSockets, R2 and the sandbox.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const MAX_HOPS = 10;

export type Role = 'user' | 'assistant' | 'tool' | 'update' | 'cathy' | 'notice' | 'artifact';
/** A file Chris attached to a message. Bytes are in R2 under its id. */
export interface FileRef {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export interface Message {
  seq: number;
  role: Role;
  sender?: string;
  /** Text; for role 'artifact', the artifact as JSON. */
  content: string;
  at: number;
  /** Chris's attachments (user messages). */
  files?: FileRef[];
  /** Which model and effort wrote it (assistant messages). */
  model?: string;
  effort?: string;
  /** Cathy's summarised thinking for this reply. */
  thinking?: string;
  /** Chris stopped this reply part-way. */
  stopped?: boolean;
  /** Tokens for the whole turn (assistant messages). */
  usage?: Tokens;
}
/** A turn's tokens. `input` is all input; `cacheRead` and `cacheWrite` are the parts read from and saved to the prompt cache. */
export interface Tokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}
/** An attachment ready for a turn: where it sits in the box, and its bytes. */
export interface Attachment extends FileRef {
  path: string;
  bytes: Uint8Array;
}
export type Visibility = 'private' | 'link';
export interface PublishedArtifact {
  id: string;
  title: string;
  filename: string;
  mime: string;
  size: number;
  version: number;
  visibility: Visibility;
  /** Where Chris sees it in admin. */
  admin_url: string;
  /** The share link (works only when visibility is link). */
  share_url: string;
}
/** Images Claude can see, and PDFs it can read. Up to 5 MB each; bigger files are only put in the box. */
export const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
export const INLINE_MAX = 5 * 1024 * 1024;

export type Status = 'thinking' | 'idle';
export type Event =
  | { type: 'history'; messages: Message[]; status: Status }
  | { type: 'message'; message: Message }
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'status'; status: Status }
  | { type: 'title'; title: string }
  | { type: 'settings'; model: string; effort: string };

export interface Store {
  addMessage(m: Omit<Message, 'seq' | 'at'>): Message;
  messages(): Message[];
  /** The agent's own memory: model messages, including tool calls and results. */
  history(): unknown[];
  appendHistory(msgs: unknown[]): void;
  getNumber(key: string): number;
  setNumber(key: string, value: number): void;
}

/** What one turn runs with: the model and effort, and options for agent.stream. */
export interface TurnSettings {
  model: string;
  effort: string;
  streamOptions?: Record<string, unknown>;
}

export interface Deps {
  store: Store;
  broadcast(e: Event): void;
  /** Builds Cathy with the chat tools added, for the given settings. */
  makeAgent(tools: Record<string, any>, settings?: TurnSettings): { stream(messages: any, opts: any): Promise<any> };
  onActivity(preview: string): Promise<void>;
  sendToCathy(to: string, text: string, hops: number): Promise<void>;
  listCathys(): Promise<{ id: string; title: string }[]>;
  /** The chat's current model and effort; read at the start of every turn. */
  settings?(): Promise<TurnSettings>;
  /** Put Chris's attachments in the box and return them with their bytes. */
  attach?(files: FileRef[]): Promise<Attachment[]>;
  /** Name the chat. False if Chris has named it (his name wins). */
  setTitle?(title: string): Promise<boolean>;
  publishArtifact?(a: { path: string; title: string; visibility?: Visibility; id?: string }): Promise<PublishedArtifact>;
  listArtifacts?(): Promise<PublishedArtifact[]>;
}

type Pending = { content: string; files?: FileRef[] };

export class Conversation {
  private queue: Pending[] = [];
  private running: Promise<void> | null = null;
  private current: AbortController | null = null;
  private deps: Deps;
  constructor(deps: Deps) {
    this.deps = deps;
  }

  get status(): Status {
    return this.running ? 'thinking' : 'idle';
  }

  /**
   * A message from Chris. Resolves when Cathy has answered it (and anything queued before it).
   * With `interrupt`, the reply in progress stops and Cathy answers this one next.
   */
  fromChris(text: string, files: FileRef[] = [], opts: { interrupt?: boolean } = {}) {
    this.deps.store.setNumber('hops', 0);
    this.add({ role: 'user', sender: 'chris', content: text, ...(files.length ? { files } : {}) });
    if (opts.interrupt && this.current) {
      this.queue.unshift({ content: text, files });
      this.current.abort();
      return this.running!;
    }
    return this.enqueue({ content: text, files });
  }

  /** A message from another Cathy. `hops` counts Cathy-to-Cathy messages since Chris last spoke. */
  fromCathy(from: string, text: string, hops: number) {
    this.deps.store.setNumber('hops', hops);
    this.add({ role: 'cathy', sender: from, content: text });
    return this.enqueue({ content: `[Message from Cathy ${from}]\n${text}` });
  }

  /** Chris pressed stop: end the reply in progress and drop anything queued behind it. */
  stop() {
    if (!this.current) return false;
    const dropped = this.queue.length;
    this.queue = [];
    this.current.abort();
    if (dropped) this.add({ role: 'notice', content: `Stopped. ${dropped} queued message${dropped === 1 ? ' was' : 's were'} not answered.` });
    return true;
  }

  private add(m: Omit<Message, 'seq' | 'at'>) {
    const message = this.deps.store.addMessage(m);
    this.deps.broadcast({ type: 'message', message });
    const preview = m.content || (m.files?.length ? `📎 ${m.files.map((f) => f.name).join(', ')}` : '');
    if ((m.role === 'user' || m.role === 'assistant' || m.role === 'cathy') && preview) this.deps.onActivity(preview).catch(() => {});
    return message;
  }

  private enqueue(p: Pending) {
    this.queue.push(p);
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
        this.deps.broadcast({ type: 'status', status: 'idle' });
      });
    }
    return this.running;
  }

  private async drain() {
    this.deps.broadcast({ type: 'status', status: 'thinking' });
    while (this.queue.length) await this.turn(this.queue.shift()!);
  }

  private chatTools() {
    const { store, sendToCathy, listCathys, setTitle, publishArtifact, listArtifacts } = this.deps;
    const extra: Record<string, any> = {};
    if (setTitle)
      extra.set_title = createTool({
        id: 'set_title',
        description: 'Name this chat (3 to 6 plain words, e.g. "Blog header fix"). Do it on your first reply in a new chat, and again if the task changes a lot. Chris\'s own names are kept.',
        inputSchema: z.object({ title: z.string() }),
        execute: async ({ title }) => {
          if (!(await setTitle(title))) return 'Kept: Chris has named this chat himself.';
          this.deps.broadcast({ type: 'title', title });
          return `Chat named "${title}".`;
        },
      });
    if (publishArtifact)
      extra.publish_artifact = createTool({
        id: 'publish_artifact',
        description:
          'Publish a file from your box as an artifact: Chris sees it as a card in this chat and on the Artifacts page in admin. ' +
          'Use it for anything you make for him: worksheets, notes, pages, images, PDFs. HTML runs as a page (sandboxed); Markdown is rendered with maths. ' +
          'Visibility: "private" (default; only Chris, behind his login) or "link" (anyone with the link). Only use "link" when Chris asks, and never put student or parent details in a linked artifact. ' +
          'Pass id to publish a new version of an existing artifact (same link).',
        inputSchema: z.object({
          path: z.string().describe('File in the box: relative to the repo root, or absolute (e.g. /tmp/sheet.html)'),
          title: z.string(),
          visibility: z.enum(['private', 'link']).optional(),
          id: z.string().optional().describe('An existing artifact to update'),
        }),
        execute: async (input) => {
          const a = await publishArtifact(input);
          this.add({ role: 'artifact', content: JSON.stringify(a) });
          return `Published "${a.title}" v${a.version} (${a.visibility}), id ${a.id}. Chris sees it as a card in this chat.${a.visibility === 'link' ? ` Share link: ${a.share_url}` : ''}`;
        },
      });
    if (listArtifacts)
      extra.list_artifacts = createTool({
        id: 'list_artifacts',
        description: 'List the artifacts this chat has published (id, title, version, visibility, links).',
        inputSchema: z.object({}),
        execute: async () => JSON.stringify(await listArtifacts()),
      });
    return {
      ...extra,
      tell_chris: createTool({
        id: 'tell_chris',
        description: 'Send Chris a short progress update while you keep working.',
        inputSchema: z.object({ text: z.string() }),
        execute: async ({ text }) => {
          this.add({ role: 'update', content: text });
          return 'Sent.';
        },
      }),
      list_cathys: createTool({
        id: 'list_cathys',
        description: 'List the other active Cathy sessions (id and title).',
        inputSchema: z.object({}),
        execute: async () => JSON.stringify(await listCathys()),
      }),
      message_cathy: createTool({
        id: 'message_cathy',
        description: 'Send a message to another Cathy session by id. She will reply in her own chat.',
        inputSchema: z.object({ to: z.string(), text: z.string() }),
        execute: async ({ to, text }) => {
          const hops = store.getNumber('hops') + 1;
          if (hops > MAX_HOPS) return `Not sent (loop guard): ${MAX_HOPS} Cathy-to-Cathy messages in a row without Chris. Wait for Chris.`;
          await sendToCathy(to, text, hops);
          return `Sent to ${to}.`;
        },
      }),
    };
  }

  private async turn(p: Pending) {
    const { store, broadcast } = this.deps;
    const abort = (this.current = new AbortController());
    // What Cathy remembers: the text and where each file is. What she sees this turn: the files too.
    let userMessage: { role: string; content: any } = { role: 'user', content: p.content };
    let prompt = userMessage;
    let streamed = '';
    let thinking = '';
    let settings: TurnSettings = { model: '', effort: '' };
    try {
      settings = (await this.deps.settings?.()) ?? settings;
      if (p.files?.length) {
        const files = this.deps.attach ? await this.deps.attach(p.files) : [];
        const list = files.map((f) => `- ${f.path} (${f.mime}, ${kb(f.size)})`).join('\n');
        const note = `${p.content}\n\n[Chris attached ${files.length} file${files.length === 1 ? '' : 's'}, saved in your box:\n${list}]`.trim();
        userMessage = { role: 'user', content: note };
        const parts: any[] = [{ type: 'text', text: note }];
        for (const f of files) {
          if (f.size > INLINE_MAX) continue;
          if (INLINE_IMAGE.test(f.mime)) parts.push({ type: 'image', image: f.bytes, mediaType: f.mime });
          else if (f.mime === 'application/pdf') parts.push({ type: 'file', data: f.bytes, mediaType: f.mime, filename: f.name });
        }
        prompt = { role: 'user', content: parts };
      }
      const agent = this.deps.makeAgent(this.chatTools(), settings);
      const out = await agent.stream([...store.history(), prompt], { maxSteps: 40, ...settings.streamOptions, abortSignal: abort.signal });
      for await (const chunk of out.fullStream as AsyncIterable<any>) {
        if (chunk.type === 'text-delta') {
          streamed += chunk.payload.text;
          broadcast({ type: 'delta', text: chunk.payload.text });
        }
        if (chunk.type === 'reasoning-delta' && chunk.payload.text) {
          thinking += chunk.payload.text;
          broadcast({ type: 'thinking', text: chunk.payload.text });
        }
        if (chunk.type === 'tool-call') {
          const summary = summarise(chunk.payload.args);
          broadcast({ type: 'tool', name: chunk.payload.toolName, summary });
          this.add({ role: 'tool', content: `${chunk.payload.toolName} ${summary}`.trim() });
          streamed = ''; // text before a tool call was shown live; the reply is what follows
        }
        if (chunk.type === 'tool-result' && /loop guard/i.test(String(chunk.payload.result))) {
          this.add({ role: 'tool', content: String(chunk.payload.result) });
        }
        if (chunk.type === 'error') throw chunk.payload?.error ?? new Error('Model error');
      }
      const label = { ...(settings.model ? { model: settings.model, effort: settings.effort } : {}), ...(thinking.trim() ? { thinking: thinking.trim() } : {}) };
      if (abort.signal.aborted) {
        // Keep only finished steps, so memory never holds a tool call without its result.
        const response = await out.response.catch(() => null);
        store.appendHistory([userMessage, ...completeSteps(response?.messages ?? []), { role: 'assistant', content: `${streamed.trim()}\n\n(Chris stopped me here.)`.trim() }]);
        this.add({ role: 'assistant', content: streamed.trim(), stopped: true, ...label });
        return;
      }
      const text = (await out.text).trim();
      const response = await out.response;
      const usage = tokens(await Promise.resolve(out.totalUsage).catch(() => undefined));
      store.appendHistory([userMessage, ...forMemory(response?.messages ?? [{ role: 'assistant', content: text }])]);
      if (text) this.add({ role: 'assistant', content: text, ...label, ...(usage ? { usage } : {}) });
    } catch (err) {
      if (abort.signal.aborted) {
        store.appendHistory([userMessage, { role: 'assistant', content: `${streamed.trim()}\n\n(Chris stopped me here.)`.trim() }]);
        this.add({ role: 'assistant', content: streamed.trim(), stopped: true, ...(settings.model ? { model: settings.model, effort: settings.effort } : {}) });
        return;
      }
      // Keep the question in memory so the next turn has context, and tell Chris what broke.
      store.appendHistory([userMessage, { role: 'assistant', content: '(I hit an error and could not answer.)' }]);
      this.add({ role: 'notice', content: `Error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      if (this.current === abort) this.current = null;
    }
  }
}

/**
 * Model messages to remember. Thinking is dropped: it's signed by the model that wrote it,
 * so keeping it would break the chat if Chris switches model; and it isn't needed later.
 */
export function forMemory(messages: any[]): any[] {
  return messages
    .map((m) => (m.role === 'assistant' && Array.isArray(m.content) ? { ...m, content: m.content.filter((p: any) => p.type !== 'reasoning' && p.type !== 'redacted-reasoning') } : m))
    .filter((m) => !(m.role === 'assistant' && Array.isArray(m.content) && m.content.length === 0));
}

/** After a stop: drop tool calls that never got a result (and empty messages left behind). */
export function completeSteps(messages: any[]): any[] {
  const answered = new Set(messages.filter((m) => m.role === 'tool').flatMap((m) => (Array.isArray(m.content) ? m.content.map((p: any) => p.toolCallId) : [])));
  return forMemory(messages.map((m) => (m.role === 'assistant' && Array.isArray(m.content) ? { ...m, content: m.content.filter((p: any) => p.type !== 'tool-call' || answered.has(p.toolCallId)) } : m)));
}

/**
 * A turn's token counts from the model's usage report, or undefined if there isn't one.
 * Reads both shapes in use: flat numbers (inputTokens, cachedInputTokens, cacheCreationInputTokens)
 * and per-kind objects (inputTokens: { total, cacheRead, cacheWrite }).
 */
export function tokens(u: any): Tokens | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const inObj = u.inputTokens && typeof u.inputTokens === 'object' ? u.inputTokens : null;
  const outObj = u.outputTokens && typeof u.outputTokens === 'object' ? u.outputTokens : null;
  const t: Tokens = {
    input: n(inObj ? inObj.total : u.inputTokens),
    cacheRead: n(inObj ? inObj.cacheRead : u.cachedInputTokens),
    cacheWrite: n(inObj ? inObj.cacheWrite : u.cacheCreationInputTokens),
    output: n(outObj ? outObj.total : u.outputTokens),
  };
  return t.input || t.output ? t : undefined;
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** A one-line view of a tool call's arguments for the chat. */
function summarise(args: unknown) {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  const main = a.command ?? a.path ?? a.pattern ?? a.title ?? a.to ?? a.text;
  const s = typeof main === 'string' ? main : JSON.stringify(args);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/** In-memory Store, for tests and the terminal. */
export function memoryStore(): Store {
  const msgs: Message[] = [];
  const hist: unknown[] = [];
  const nums = new Map<string, number>();
  let seq = 0;
  return {
    addMessage(m) {
      const message = { ...m, seq: ++seq, at: Date.now() };
      msgs.push(message);
      return message;
    },
    messages: () => [...msgs],
    history: () => [...hist],
    appendHistory: (m) => {
      hist.push(...m);
    },
    getNumber: (k) => nums.get(k) ?? 0,
    setNumber: (k, v) => {
      nums.set(k, v);
    },
  };
}
