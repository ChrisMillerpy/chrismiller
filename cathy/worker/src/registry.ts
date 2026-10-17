// The registry (D1): which Cathy chats exist, the artifacts she publishes, and stored
// file bytes. Schema lives in d1/migrations and is applied on first use, so there's no
// separate migration step to forget.

export interface Session {
  id: string;
  title: string;
  branch: string;
  status: 'active' | 'archived';
  created_at: number;
  updated_at: number;
  last_message: string | null;
  /** Who named the chat: null (from the first message), 'cathy' or 'chris'. */
  named_by: 'cathy' | 'chris' | null;
}

export type Visibility = 'private' | 'link' | 'public';
export const VISIBILITIES: Visibility[] = ['private', 'link', 'public'];

export interface Artifact {
  id: string;
  session_id: string;
  title: string;
  filename: string;
  mime: string;
  size: number;
  visibility: Visibility;
  token: string;
  created_at: number;
  updated_at: number;
}

export interface Upload {
  id: string;
  session_id: string;
  name: string;
  mime: string;
  size: number;
  created_at: number;
}

/** A file name that's safe in a path and a header: no folders, no quotes, no control characters. */
export const safeName = (name: string) =>
  name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f"<>|:*?]/g, '_').replace(/^\.+/, '').slice(0, 100) || 'file';

interface D1Like {
  prepare(sql: string): { bind(...args: unknown[]): any; all(): Promise<{ results: any[] }> };
  exec(sql: string): Promise<unknown>;
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const randomId = (n = 6) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % 32]).join('');
const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
/** D1 caps a value at 2 MB, so bytes are stored in parts. */
export const PART = 1_000_000;

export class Registry {
  private ready: Promise<unknown> | null = null;
  private db: D1Like;
  private schema: string[];
  constructor(db: D1Like, schema: string | string[]) {
    this.db = db;
    this.schema = Array.isArray(schema) ? schema : [schema];
  }

  private init() {
    return (this.ready ??= (async () => {
      // One statement at a time, so an ALTER that already ran ("duplicate column") can be skipped.
      const statements = this.schema.join(';\n').replace(/--.*$/gm, '').split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
      for (const s of statements) {
        try {
          await this.db.exec(s + ';');
        } catch (err) {
          if (!/duplicate column/i.test(String(err))) throw err;
        }
      }
    })().catch((err) => {
      this.ready = null;
      throw err;
    }));
  }

  // ── Sessions ──────────────────────────────────────────────

  async create(title: string, now = Date.now()): Promise<Session> {
    await this.init();
    const id = randomId();
    const named_by = title.trim() ? 'chris' : null;
    const s: Session = { id, title: oneLine(title, 60), branch: `cathy/${id}`, status: 'active', created_at: now, updated_at: now, last_message: null, named_by };
    await this.db
      .prepare('INSERT INTO sessions (id, title, branch, status, created_at, updated_at, last_message, named_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(s.id, s.title, s.branch, s.status, s.created_at, s.updated_at, s.last_message, s.named_by)
      .run();
    return s;
  }

  async get(id: string): Promise<Session | null> {
    await this.init();
    const { results } = await this.db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).all();
    return results[0] ? { ...results[0] } : null;
  }

  async list(status: Session['status'] = 'active'): Promise<Session[]> {
    await this.init();
    const { results } = await this.db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC LIMIT 200').bind(status).all();
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

  /**
   * Name a chat. Chris's names always win; Cathy can only name chats Chris hasn't.
   * Returns false if Cathy tried to rename a chat Chris named.
   */
  async rename(id: string, title: string, by: 'chris' | 'cathy'): Promise<boolean> {
    await this.init();
    const t = oneLine(title, 60);
    if (!t) throw new Error('A title cannot be empty');
    const sql = by === 'chris' ? 'UPDATE sessions SET title = ?, named_by = ? WHERE id = ?' : "UPDATE sessions SET title = ?, named_by = ? WHERE id = ? AND (named_by IS NULL OR named_by = 'cathy')";
    await this.db.prepare(sql).bind(t, by, id).run();
    return (await this.get(id))?.title === t;
  }

  async archive(id: string) {
    await this.init();
    await this.db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ?").bind(id).run();
  }

  async unarchive(id: string, now = Date.now()) {
    await this.init();
    await this.db.prepare("UPDATE sessions SET status = 'active', updated_at = ? WHERE id = ?").bind(now, id).run();
  }

  // ── Blobs: file bytes, in parts ──────────────────────────────

  async putBlob(id: string, bytes: Uint8Array) {
    await this.init();
    await this.db.prepare('DELETE FROM blobs WHERE id = ?').bind(id).run();
    for (let i = 0, part = 0; i < bytes.length || part === 0; i += PART, part++) {
      await this.db.prepare('INSERT INTO blobs (id, part, data) VALUES (?, ?, ?)').bind(id, part, bytes.slice(i, i + PART)).run();
    }
  }

  async getBlob(id: string): Promise<Uint8Array | null> {
    await this.init();
    const { results } = await this.db.prepare('SELECT data FROM blobs WHERE id = ? ORDER BY part').bind(id).all();
    if (!results.length) return null;
    const parts = results.map((r: { data: ArrayBuffer | Uint8Array | number[] }) => (r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data as ArrayBuffer)));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) out.set(p, (at += p.length) - p.length);
    return out;
  }

  async deleteBlob(id: string) {
    await this.init();
    await this.db.prepare('DELETE FROM blobs WHERE id = ?').bind(id).run();
  }

  // ── Uploads: files Chris attaches to messages ───────────────

  async addUpload(session_id: string, name: string, mime: string, bytes: Uint8Array, now = Date.now()): Promise<Upload> {
    await this.init();
    const u: Upload = { id: randomId(10), session_id, name: safeName(name), mime: mime || 'application/octet-stream', size: bytes.length, created_at: now };
    await this.putBlob(`upload:${u.id}`, bytes);
    await this.db.prepare('INSERT INTO uploads (id, session_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(u.id, u.session_id, u.name, u.mime, u.size, u.created_at).run();
    return u;
  }

  async upload(id: string): Promise<Upload | null> {
    await this.init();
    const { results } = await this.db.prepare('SELECT * FROM uploads WHERE id = ?').bind(id).all();
    return results[0] ? { ...results[0] } : null;
  }

  // ── Artifacts ──────────────────────────────────────────────

  /** Publish a file, or replace an existing artifact's content (same id and link). */
  async publish(
    a: { session_id: string; title: string; filename: string; mime: string; visibility?: Visibility; id?: string },
    bytes: Uint8Array,
    now = Date.now(),
  ): Promise<Artifact> {
    await this.init();
    a = { ...a, filename: safeName(a.filename) };
    const existing = a.id ? await this.artifact(a.id) : null;
    if (a.id && !existing) throw new Error(`No artifact ${a.id}`);
    const art: Artifact = existing
      ? { ...existing, title: oneLine(a.title, 80) || existing.title, filename: a.filename, mime: a.mime, size: bytes.length, visibility: a.visibility ?? existing.visibility, updated_at: now }
      : { id: randomId(8), session_id: a.session_id, title: oneLine(a.title, 80) || a.filename, filename: a.filename, mime: a.mime, size: bytes.length, visibility: a.visibility ?? 'private', token: randomId(20), created_at: now, updated_at: now };
    await this.putBlob(`artifact:${art.id}`, bytes);
    await this.db
      .prepare(
        `INSERT INTO artifacts (id, session_id, title, filename, mime, size, visibility, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, filename = excluded.filename, mime = excluded.mime, size = excluded.size, visibility = excluded.visibility, updated_at = excluded.updated_at`,
      )
      .bind(art.id, art.session_id, art.title, art.filename, art.mime, art.size, art.visibility, art.token, art.created_at, art.updated_at)
      .run();
    return art;
  }

  async artifact(id: string): Promise<Artifact | null> {
    await this.init();
    const { results } = await this.db.prepare('SELECT * FROM artifacts WHERE id = ?').bind(id).all();
    return results[0] ? { ...results[0] } : null;
  }

  /** What a share link may see: link or public artifacts, by token. Private ones are never found. */
  async shared(token: string): Promise<Artifact | null> {
    await this.init();
    const { results } = await this.db.prepare("SELECT * FROM artifacts WHERE token = ? AND visibility IN ('link', 'public')").bind(token).all();
    return results[0] ? { ...results[0] } : null;
  }

  async artifacts(filter: { session_id?: string; visibility?: Visibility } = {}): Promise<Artifact[]> {
    await this.init();
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.session_id) where.push('session_id = ?'), args.push(filter.session_id);
    if (filter.visibility) where.push('visibility = ?'), args.push(filter.visibility);
    const sql = `SELECT * FROM artifacts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 500`;
    const { results } = await this.db.prepare(sql).bind(...args).all();
    return results.map((r: Artifact) => ({ ...r }));
  }

  async updateArtifact(id: string, change: { title?: string; visibility?: Visibility }, now = Date.now()) {
    await this.init();
    if (change.visibility && !VISIBILITIES.includes(change.visibility)) throw new Error(`Visibility must be one of ${VISIBILITIES.join(', ')}`);
    const a = await this.artifact(id);
    if (!a) throw new Error(`No artifact ${id}`);
    await this.db
      .prepare('UPDATE artifacts SET title = ?, visibility = ?, updated_at = ? WHERE id = ?')
      .bind(change.title?.trim() ? oneLine(change.title, 80) : a.title, change.visibility ?? a.visibility, now, id)
      .run();
    return (await this.artifact(id))!;
  }

  /** A fresh link: the old one stops working. */
  async newLink(id: string) {
    await this.init();
    await this.db.prepare('UPDATE artifacts SET token = ? WHERE id = ?').bind(randomId(20), id).run();
    return this.artifact(id);
  }

  async deleteArtifact(id: string) {
    await this.init();
    await this.db.prepare('DELETE FROM artifacts WHERE id = ?').bind(id).run();
    await this.deleteBlob(`artifact:${id}`);
  }
}
