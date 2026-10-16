// The registry: which Cathy chats exist (D1). Schema lives in d1/migrations and is
// applied on first use, so there's no separate migration step to forget.

export interface Session {
  id: string;
  title: string;
  branch: string;
  status: 'active' | 'archived';
  created_at: number;
  updated_at: number;
  last_message: string | null;
}

interface D1Like {
  prepare(sql: string): { bind(...args: unknown[]): any; all(): Promise<{ results: any[] }> };
  exec(sql: string): Promise<unknown>;
}

const newId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
};
const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export class Registry {
  private ready: Promise<unknown> | null = null;
  private db: D1Like;
  private schema: string;
  constructor(db: D1Like, schema: string) {
    this.db = db;
    this.schema = schema;
  }

  private init() {
    // D1's exec wants one statement per line, so flatten each statement onto its own line.
    const sql = this.schema.replace(/--.*$/gm, '').split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join(';\n') + ';';
    return (this.ready ??= this.db.exec(sql));
  }

  async create(title: string, now = Date.now()): Promise<Session> {
    await this.init();
    const id = newId();
    const s: Session = { id, title: oneLine(title, 60), branch: `cathy/${id}`, status: 'active', created_at: now, updated_at: now, last_message: null };
    await this.db
      .prepare('INSERT INTO sessions (id, title, branch, status, created_at, updated_at, last_message) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(s.id, s.title, s.branch, s.status, s.created_at, s.updated_at, s.last_message)
      .run();
    return s;
  }

  async get(id: string): Promise<Session | null> {
    await this.init();
    const { results } = await this.db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).all();
    return results[0] ? { ...results[0] } : null;
  }

  async list(): Promise<Session[]> {
    await this.init();
    const { results } = await this.db.prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 200").bind().all();
    return results.map((r: Session) => ({ ...r }));
  }

  /** Record activity: newest message preview, and a title if the chat has none yet. */
  async touch(id: string, preview: string, now = Date.now()) {
    await this.init();
    await this.db
      .prepare("UPDATE sessions SET updated_at = ?, last_message = ?, title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ?")
      .bind(now, oneLine(preview, 140), oneLine(preview, 60), id)
      .run();
  }

  async archive(id: string) {
    await this.init();
    await this.db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ?").bind(id).run();
  }
}
