// One Session Durable Object per chat: stores the conversation in its SQLite, talks to
// open chat pages over WebSockets, runs Cathy, and reaches her sandbox for commands.
import { DurableObject } from 'cloudflare:workers';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createCathy } from '../../agent/cathy.ts';
import type { Box } from '../../agent/box.ts';
import { Conversation, type Event, type Message, type Store } from './conversation.ts';
import { Registry } from './registry.ts';
import { demoBox, demoModel } from './demo.ts';
import type { Env } from './env.ts';
import SCHEMA from '../../../d1/migrations/0001_sessions.sql';

export class Session extends DurableObject<Env> {
  private convo: Conversation | null = null;
  private sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, sender TEXT, content TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS history (seq INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }

  private get id(): string {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM kv WHERE key = 'id'").toArray()[0];
    if (!row) throw new Error('Session used before it was given an id');
    return row.value;
  }
  private setId(id: string) {
    this.sql.exec("INSERT OR IGNORE INTO kv (key, value) VALUES ('id', ?)", id);
  }
  private get branch() {
    return `cathy/${this.id}`;
  }

  private store(): Store {
    const sql = this.sql;
    return {
      addMessage(m) {
        const at = Date.now();
        const seq = sql.exec<{ seq: number }>('INSERT INTO messages (role, sender, content, at) VALUES (?, ?, ?, ?) RETURNING seq', m.role, m.sender ?? null, m.content, at).one().seq;
        return { ...m, seq, at };
      },
      messages: () => sql.exec<any>('SELECT seq, role, sender, content, at FROM messages ORDER BY seq').toArray().map((r) => ({ ...r, sender: r.sender ?? undefined })) as Message[],
      history: () => sql.exec<{ json: string }>('SELECT json FROM history ORDER BY seq').toArray().map((r) => JSON.parse(r.json)),
      appendHistory: (msgs) => {
        for (const m of msgs) sql.exec('INSERT INTO history (json) VALUES (?)', JSON.stringify(m));
      },
      getNumber: (k) => Number(sql.exec<{ value: string }>('SELECT value FROM kv WHERE key = ?', k).toArray()[0]?.value ?? 0),
      setNumber: (k, v) => {
        sql.exec('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));
      },
    };
  }

  private box(): Box {
    if (this.env.FAKE_BOX === '1') return demoBox(this.branch);
    const sandbox = this.env.SANDBOX.getByName(this.id);
    const branch = this.branch;
    return {
      async run(command, opts) {
        await sandbox.prepare(branch);
        return sandbox.run(command, opts?.env, opts?.timeoutMs);
      },
      async readFile(path) {
        await sandbox.prepare(branch);
        return sandbox.readFile(path);
      },
      async writeFile(path, content) {
        await sandbox.prepare(branch);
        return sandbox.writeFile(path, content);
      },
    };
  }

  private model() {
    if (this.env.FAKE_MODEL === '1') return demoModel() as any;
    const anthropic = createAnthropic({
      apiKey: this.env.ANTHROPIC_API_KEY,
      headers: this.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': this.env.ANTHROPIC_WORKSPACE_ID } : undefined,
    });
    return anthropic(this.env.MODEL || 'claude-opus-5-5');
  }

  private conversation() {
    if (this.convo) return this.convo;
    const registry = new Registry(this.env.DB, SCHEMA);
    const id = this.id;
    this.convo = new Conversation({
      store: this.store(),
      broadcast: (e) => this.broadcast(e),
      makeAgent: (tools) => createCathy({ model: this.model(), box: this.box(), sessionId: id, branch: this.branch, tools }),
      onActivity: (preview) => registry.touch(id, preview),
      sendToCathy: async (to, text, hops) => {
        if (!(await registry.get(to))) throw new Error(`No Cathy session ${to}`);
        await this.env.SESSION.getByName(to).receiveFromCathy(to, id, text, hops);
      },
      listCathys: async () => (await registry.list()).filter((s) => s.id !== id).map((s) => ({ id: s.id, title: s.title })),
    });
    return this.convo;
  }

  private broadcast(e: Event) {
    const data = JSON.stringify(e);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {}
    }
  }

  /** Wake the sandbox in the background so it's warm by the time Cathy needs it. */
  private warmUp() {
    if (this.env.FAKE_BOX === '1') return;
    this.ctx.waitUntil(this.env.SANDBOX.getByName(this.id).prepare(this.branch).catch(() => {}));
  }

  // A chat page connects: send the history, then live events.
  async fetch(request: Request) {
    const id = new URL(request.url).searchParams.get('id');
    if (id) this.setId(id);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'history', messages: this.store().messages(), status: this.convo?.status ?? 'idle' } satisfies Event));
    this.warmUp();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: { type?: string; text?: string };
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (msg.type === 'send' && msg.text?.trim()) await this.conversation().fromChris(msg.text.trim());
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code, 'bye');
    } catch {}
  }

  /** Another Cathy messages this one. Returns at once; she answers in the background. */
  async receiveFromCathy(myId: string, from: string, text: string, hops: number) {
    this.setId(myId);
    this.ctx.waitUntil(this.conversation().fromCathy(from, text, hops));
  }
}
