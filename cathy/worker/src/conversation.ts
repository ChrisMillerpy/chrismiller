// One Cathy chat: the message log, the agent's memory, turn-taking and the
// Cathy-to-Cathy loop guard. No Cloudflare code, so it's tested in plain Node;
// the Session Durable Object wires it to SQLite, WebSockets and the sandbox.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const MAX_HOPS = 3;

export type Role = 'user' | 'assistant' | 'tool' | 'update' | 'cathy' | 'notice' | 'artifact';
/** A file Chris attached to a message. Bytes are stored by the registry under its id. */
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
  files?: FileRef[];
  at: number;
}
/** An attachment ready for a turn: where it sits in the box, and its bytes. */
export interface Attachment extends FileRef {
  path: string;
  bytes: Uint8Array;
}
export interface PublishedArtifact {
  id: string;
  title: string;
  filename: string;
  mime: string;
  size: number;
  visibility: 'private' | 'link' | 'public';
  /** Where Chris sees it in admin. */
  admin_url: string;
  /** The share link (works only when visibility is link or public). */
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
  | { type: 'tool'; name: string; summary: string }
  | { type: 'status'; status: Status }
  | { type: 'title'; title: string };

export interface Store {
  addMessage(m: Omit<Message, 'seq' | 'at'>): Message;
  messages(): Message[];
  /** The agent's own memory: model messages, including tool calls and results. */
  history(): unknown[];
  appendHistory(msgs: unknown[]): void;
  getNumber(key: string): number;
  setNumber(key: string, value: number): void;
}

export interface Deps {
  store: Store;
  broadcast(e: Event): void;
  /** Builds Cathy with the chat tools added (tell_chris, list_cathys, message_cathy). */
  makeAgent(tools: Record<string, any>): { stream(messages: any, opts: any): Promise<any> };
  onActivity(preview: string): Promise<void>;
  sendToCathy(to: string, text: string, hops: number): Promise<void>;
  listCathys(): Promise<{ id: string; title: string }[]>;
  /** Put Chris's attachments in the box and return them with their bytes. */
  attach?(files: FileRef[]): Promise<Attachment[]>;
  /** Name the chat. False if Chris has named it (his name wins). */
  setTitle?(title: string): Promise<boolean>;
  publishArtifact?(a: { path: string; title: string; visibility?: PublishedArtifact['visibility']; id?: string }): Promise<PublishedArtifact>;
  listArtifacts?(): Promise<PublishedArtifact[]>;
}

type Pending = { content: string; files?: FileRef[] };

export class Conversation {
  private queue: Pending[] = [];
  private running: Promise<void> | null = null;
  private deps: Deps;
  constructor(deps: Deps) {
    this.deps = deps;
  }

  get status(): Status {
    return this.running ? 'thinking' : 'idle';
  }

  /** A message from Chris. Resolves when Cathy has answered it (and anything queued before it). */
  fromChris(text: string, files: FileRef[] = []) {
    this.deps.store.setNumber('hops', 0);
    this.add({ role: 'user', sender: 'chris', content: text, ...(files.length ? { files } : {}) });
    return this.enqueue({ content: text, files });
  }

  /** A message from another Cathy. `hops` counts Cathy-to-Cathy messages since Chris last spoke. */
  fromCathy(from: string, text: string, hops: number) {
    this.deps.store.setNumber('hops', hops);
    this.add({ role: 'cathy', sender: from, content: text });
    return this.enqueue({ content: `[Message from Cathy ${from}]\n${text}` });
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
        description: 'Name this chat (3 to 6 plain words, e.g. "Blog header fix"). Do it on your first reply in a new chat, and again if the task changes. Chris\'s own names are kept.',
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
          'Publish a file from your box as an artifact Chris can open from admin and share: a worksheet, page, image, PDF, anything. ' +
          'HTML is shown as a page (scripts run, sandboxed). Visibility: "private" (default; admin only), "link" (anyone with the link), "public" (also listed on the public gallery). ' +
          'Only use link or public when Chris asks, and never put student or parent details in a shared artifact. Pass id to update an existing artifact in place (same link).',
        inputSchema: z.object({
          path: z.string().describe('File in the box: relative to the repo root, or absolute (e.g. /uploads/x.png)'),
          title: z.string(),
          visibility: z.enum(['private', 'link', 'public']).optional(),
          id: z.string().optional().describe('An existing artifact to replace'),
        }),
        execute: async (input) => {
          const a = await publishArtifact(input);
          this.add({ role: 'artifact', content: JSON.stringify(a) });
          return `Published "${a.title}" (${a.visibility}). Admin: ${a.admin_url}${a.visibility === 'private' ? '' : `  Share link: ${a.share_url}`}`;
        },
      });
    if (listArtifacts)
      extra.list_artifacts = createTool({
        id: 'list_artifacts',
        description: 'List the artifacts this chat has published (id, title, visibility, links).',
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
    // What Cathy remembers: the text and where each file is. What she sees this turn: the files too.
    let userMessage: { role: string; content: any } = { role: 'user', content: p.content };
    let prompt = userMessage;
    try {
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
      const agent = this.deps.makeAgent(this.chatTools());
      const out = await agent.stream([...store.history(), prompt], { maxSteps: 40 });
      for await (const chunk of out.fullStream as AsyncIterable<any>) {
        if (chunk.type === 'text-delta') broadcast({ type: 'delta', text: chunk.payload.text });
        if (chunk.type === 'tool-call') {
          const summary = summarise(chunk.payload.args);
          broadcast({ type: 'tool', name: chunk.payload.toolName, summary });
          this.add({ role: 'tool', content: `${chunk.payload.toolName} ${summary}`.trim() });
        }
        if (chunk.type === 'tool-result' && /loop guard/i.test(String(chunk.payload.result))) {
          this.add({ role: 'tool', content: String(chunk.payload.result) });
        }
        if (chunk.type === 'error') throw chunk.payload?.error ?? new Error('Model error');
      }
      const text = (await out.text).trim();
      const response = await out.response;
      store.appendHistory([userMessage, ...(response?.messages ?? [{ role: 'assistant', content: text }])]);
      if (text) this.add({ role: 'assistant', content: text });
    } catch (err) {
      // Keep the question in memory so the next turn has context, and tell Chris what broke.
      store.appendHistory([userMessage, { role: 'assistant', content: '(I hit an error and could not answer.)' }]);
      this.add({ role: 'notice', content: `Error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
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
