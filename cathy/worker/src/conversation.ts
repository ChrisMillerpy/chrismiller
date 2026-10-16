// One Cathy chat: the message log, the agent's memory, turn-taking and the
// Cathy-to-Cathy loop guard. No Cloudflare code, so it's tested in plain Node;
// the Session Durable Object wires it to SQLite, WebSockets and the sandbox.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const MAX_HOPS = 3;

export type Role = 'user' | 'assistant' | 'tool' | 'update' | 'cathy' | 'notice';
export interface Message {
  seq: number;
  role: Role;
  sender?: string;
  content: string;
  at: number;
}
export type Status = 'thinking' | 'idle';
export type Event =
  | { type: 'history'; messages: Message[]; status: Status }
  | { type: 'message'; message: Message }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'status'; status: Status };

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
}

type Pending = { content: string };

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
  fromChris(text: string) {
    this.deps.store.setNumber('hops', 0);
    this.add({ role: 'user', sender: 'chris', content: text });
    return this.enqueue({ content: text });
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
    if (m.role === 'user' || m.role === 'assistant' || m.role === 'cathy') this.deps.onActivity(m.content).catch(() => {});
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
    const { store, sendToCathy, listCathys } = this.deps;
    return {
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
    const userMessage = { role: 'user', content: p.content };
    try {
      const agent = this.deps.makeAgent(this.chatTools());
      const out = await agent.stream([...store.history(), userMessage], { maxSteps: 40 });
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
