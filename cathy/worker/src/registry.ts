// The registry: which Cathy chats exist, files Chris attaches and artifacts Cathy publishes.
// Facts live in D1; file bytes live in R2. The D1 schema is in d1/migrations and is applied
// on first use, so there's no separate migration step to forget.

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
  /** Chosen model and effort; null = defaults. */
  model: string | null;
  effort: string | null;
  /** Sub-agents: the chat that started this one (null if Chris did), how, and with what task. */
  parent_id: string | null;
  mode: AgentMode | null;
  task: string | null;
  instructions: string | null;
  /** Whether Cathy is answering right now. */
  state: AgentState;
}

export type AgentMode = 'fresh' | 'fork' | 'custom';
export const MODES: AgentMode[] = ['fresh', 'fork', 'custom'];
export type AgentState = 'working' | 'idle';
const STATES: AgentState[] = ['working', 'idle'];

export type Visibility = 'private' | 'link';
export const VISIBILITIES: Visibility[] = ['private', 'link'];

export interface Artifact {
  id: string;
  session_id: string;
  title: string;
  visibility: Visibility;
  token: string;
  version: number;
  filename: string;
  mime: string;
  size: number;
  created_at: number;
  updated_at: number;
}

export interface ArtifactVersion {
  artifact_id: string;
  version: number;
  filename: string;
  mime: string;
  size: number;
  created_at: number;
}

export interface Upload {
  id: string;
  session_id: string;
  name: string;
  mime: string;
  size: number;
  created_at: number;
}

interface D1Like {
  prepare(sql: string): { bind(...args: unknown[]): any; all(): Promise<{ results: any[] }> };
  exec(sql: string): Promise<unknown>;
}

/** The bits of an R2 bucket the registry uses. */
export interface R2Like {
  put(key: string, value: Uint8Array | ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const randomId = (n = 6) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % 32]).join('');
const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** A file name that's safe in a path and a header: no folders, no quotes, no control characters. */
export const safeName = (name: string) =>
  name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f"<>|:*?]/g, '_').replace(/^\.+/, '').slice(0, 100) || 'file';

export const uploadKey = (id: string) => `uploads/${id}`;
export const versionKey = (id: string, v: number) => `artifacts/${id}/v${v}`;

export class Registry {
  private ready: Promise<unknown> | null = null;
  private db: D1Like;
  private files: R2Like | undefined;
  private schema: string[];
  constructor(db: D1Like, schema: string | string[], files?: R2Like) {
    this.db = db;
    this.files = files;
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

  private bucket(): R2Like {
    if (!this.files) throw new Error('File storage (R2) is not connected to this Worker.');
    return this.files;
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    const o = await this.bucket().get(key);
    return o ? new Uint8Array(await o.arrayBuffer()) : null;
  }

  // ── Sessions ──────────────────────────────────────────────

  async create(title: string, now = Date.now()): Promise<Session> {
    await this.init();
    const id = randomId();
    const named_by = title.trim() ? 'chris' : null;
    const s: Session = { id, title: oneLine(title, 60), branch: `cathy/${id}`, status: 'active', created_at: now, updated_at: now, last_message: null, named_by, model: null, effort: null, parent_id: null, mode: null, task: null, instructions: null, state: 'idle' };
    await this.db
      .prepare('INSERT INTO sessions (id, title, branch, status, created_at, updated_at, last_message, named_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(s.id, s.title, s.branch, s.status, s.created_at, s.updated_at, s.last_message, s.named_by)
      .run();
    return s;
  }

  /** A sub-agent's chat. It starts out working (its task is on the way), so it counts towards the parent's limit at once. */
  async createChild(
    parent_id: string,
    a: { title: string; task: string; mode: AgentMode; instructions?: string | null; model?: string | null; effort?: string | null },
    now = Date.now(),
  ): Promise<Session> {
    await this.init();
    if (!MODES.includes(a.mode)) throw new Error(`Mode must be one of ${MODES.join(', ')}`);
    const id = randomId();
    const s: Session = {
      id,
      title: oneLine(a.title || a.task, 60),
      branch: `cathy/${id}`,
      status: 'active',
      created_at: now,
      updated_at: now,
      last_message: null,
      named_by: 'cathy',
      model: a.model ?? null,
      effort: a.effort ?? null,
      parent_id,
      mode: a.mode,
      task: a.task,
      instructions: a.instructions?.trim() || null,
      state: 'working',
    };
    await this.db
      .prepare('INSERT INTO sessions (id, title, branch, status, created_at, updated_at, last_message, named_by, model, effort, parent_id, mode, task, instructions, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(s.id, s.title, s.branch, s.status, s.created_at, s.updated_at, s.last_message, s.named_by, s.model, s.effort, s.parent_id, s.mode, s.task, s.instructions, s.state)
      .run();
    return s;
  }

  /** A chat's active sub-agents, oldest first. */
  async children(parent_id: string): Promise<Session[]> {
    await this.init();
    const { results } = await this.db.prepare("SELECT * FROM sessions WHERE parent_id = ? AND status = 'active' ORDER BY created_at, rowid").bind(parent_id).all();
    return results.map((r: Session) => ({ ...r }));
  }

  async setState(id: string, state: AgentState) {
    await this.init();
    if (!STATES.includes(state)) throw new Error(`State must be one of ${STATES.join(', ')}`);
    await this.db.prepare('UPDATE sessions SET state = ? WHERE id = ?').bind(state, id).run();
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

  /** Save the chat's model and/or effort (validated by the caller). */
  async setModel(id: string, change: { model?: string; effort?: string }) {
    await this.init();
    const s = await this.get(id);
    if (!s) throw new Error(`No session ${id}`);
    await this.db.prepare('UPDATE sessions SET model = ?, effort = ? WHERE id = ?').bind(change.model ?? s.model, change.effort ?? s.effort, id).run();
    return (await this.get(id))!;
  }

  /** Archive a chat and its sub-agents. */
  async archive(id: string) {
    await this.init();
    await this.db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ? OR parent_id = ?").bind(id, id).run();
  }

  async unarchive(id: string, now = Date.now()) {
    await this.init();
    await this.db.prepare("UPDATE sessions SET status = 'active', updated_at = ? WHERE id = ? OR parent_id = ?").bind(now, id, id).run();
  }

  // ── Uploads: files Chris attaches to messages ───────────────

  async addUpload(session_id: string, name: string, mime: string, bytes: Uint8Array, now = Date.now()): Promise<Upload> {
    await this.init();
    const u: Upload = { id: randomId(10), session_id, name: safeName(name), mime: mime || 'application/octet-stream', size: bytes.length, created_at: now };
    await this.bucket().put(uploadKey(u.id), bytes, { httpMetadata: { contentType: u.mime } });
    await this.db.prepare('INSERT INTO uploads (id, session_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(u.id, u.session_id, u.name, u.mime, u.size, u.created_at).run();
    return u;
  }

  async upload(id: string): Promise<Upload | null> {
    await this.init();
    const { results } = await this.db.prepare('SELECT * FROM uploads WHERE id = ?').bind(id).all();
    return results[0] ? { ...results[0] } : null;
  }

  // ── Artifacts ──────────────────────────────────────────────

  /** Publish a file as a new artifact, or as the next version of an existing one (same id and link). */
  async publish(
    a: { session_id: string; title: string; filename: string; mime: string; visibility?: Visibility; id?: string },
    bytes: Uint8Array,
    now = Date.now(),
  ): Promise<Artifact> {
    await this.init();
    if (a.visibility && !VISIBILITIES.includes(a.visibility)) throw new Error(`Visibility must be one of ${VISIBILITIES.join(', ')}`);
    const filename = safeName(a.filename);
    const existing = a.id ? await this.artifact(a.id) : null;
    if (a.id && !existing) throw new Error(`No artifact ${a.id}`);
    const art: Artifact = existing
      ? { ...existing, title: oneLine(a.title, 80) || existing.title, filename, mime: a.mime, size: bytes.length, visibility: a.visibility ?? existing.visibility, version: existing.version + 1, updated_at: now }
      : { id: randomId(8), session_id: a.session_id, title: oneLine(a.title, 80) || filename, filename, mime: a.mime, size: bytes.length, visibility: a.visibility ?? 'private', token: randomId(20), version: 1, created_at: now, updated_at: now };
    // Bytes first: a row never points at a missing file.
    await this.bucket().put(versionKey(art.id, art.version), bytes, { httpMetadata: { contentType: art.mime } });
    await this.db
      .prepare('INSERT INTO artifact_versions (artifact_id, version, filename, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(art.id, art.version, art.filename, art.mime, art.size, now)
      .run();
    await this.db
      .prepare(
        `INSERT INTO artifacts (id, session_id, title, visibility, token, version, filename, mime, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, visibility = excluded.visibility, version = excluded.version, filename = excluded.filename, mime = excluded.mime, size = excluded.size, updated_at = excluded.updated_at`,
      )
      .bind(art.id, art.session_id, art.title, art.visibility, art.token, art.version, art.filename, art.mime, art.size, art.created_at, art.updated_at)
      .run();
    return art;
  }

  async artifact(id: string): Promise<Artifact | null> {
    await this.init();
    const { results } = await this.db.prepare('SELECT * FROM artifacts WHERE id = ?').bind(id).all();
    return results[0] ? { ...results[0] } : null;
  }

  async versions(id: string): Promise<ArtifactVersion[]> {
    await this.init();
    const { results } = await this.db.prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC').bind(id).all();
    return results.map((r: ArtifactVersion) => ({ ...r }));
  }

  /** What a share link may see: link artifacts, by token. Private ones are never found. */
  async shared(token: string): Promise<Artifact | null> {
    await this.init();
    if (!/^[a-z0-9]{20}$/.test(token)) return null;
    const { results } = await this.db.prepare("SELECT * FROM artifacts WHERE token = ? AND visibility = 'link'").bind(token).all();
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
    const vs = await this.versions(id);
    await this.db.prepare('DELETE FROM artifacts WHERE id = ?').bind(id).run();
    await this.db.prepare('DELETE FROM artifact_versions WHERE artifact_id = ?').bind(id).run();
    if (vs.length) await this.bucket().delete(vs.map((v) => versionKey(id, v.version)));
  }
}
