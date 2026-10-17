// Cathy's self: her soul, memory index and skills live as markdown in cathy/self/, in the repo.
// They're read from the box's checkout at the start of every turn, so an edit she commits
// shows up in her own context straight away, and Chris reviews it in a PR like any other change.
// No Cloudflare code here.
import type { Box } from './box.ts';

export const SELF_DIR = 'cathy/self';
const MAX_SOUL = 12_000;
const MAX_INDEX = 8_000;

export interface Skill {
  name: string;
  description: string;
  path: string;
}

export interface Self {
  soul: string;
  memoryIndex: string;
  skills: Skill[];
}

async function tryRead(box: Box, path: string): Promise<string | null> {
  try {
    return await box.readFile(path);
  } catch {
    return null;
  }
}

const cap = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}\n… (cut: this file is too long, trim it)` : s);

/** Reads `name` and `description` from a `---` frontmatter block. Values may be quoted. */
export function parseFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

export async function loadSelf(box: Box): Promise<Self> {
  const [soul, memoryIndex] = await Promise.all([tryRead(box, `${SELF_DIR}/SOUL.md`), tryRead(box, `${SELF_DIR}/memory/INDEX.md`)]);

  const skills: Skill[] = [];
  const ls = await box.run(`ls -1 ${SELF_DIR}/skills 2>/dev/null`).catch(() => null);
  const folders = ls && ls.exitCode === 0 ? ls.stdout.split('\n').map((s) => s.trim()).filter((s) => /^[\w.-]+$/.test(s)) : [];
  for (const folder of folders) {
    const path = `${SELF_DIR}/skills/${folder}/SKILL.md`;
    const text = await tryRead(box, path);
    if (text === null) continue;
    const fm = parseFrontmatter(text);
    skills.push({ name: fm.name || folder, description: fm.description || '(no description)', path });
  }

  return { soul: cap(soul ?? '', MAX_SOUL), memoryIndex: cap(memoryIndex ?? '', MAX_INDEX), skills };
}

/** The full system prompt: her soul, the session facts, then memory and skills. */
export function instructions(sessionId: string, branch: string, self: Self) {
  const soul = self.soul.trim() || `You are Cathy, an AI tutor and engineer working with Chris Miller. (${SELF_DIR}/SOUL.md is missing from this checkout; tell Chris.)`;
  const parts = [
    soul,
    `## This session\nYour session id is ${sessionId}. Your branch is ${branch}; your box (a Linux machine with git, node, npm and gh) has the repo checked out on it.`,
    `## Your memory\nThis is the index of ${SELF_DIR}/memory/. Read a note with read_file when it's relevant.\n\n${self.memoryIndex.trim() || '(empty)'}`,
    `## Your skills\n${
      self.skills.length
        ? `Before starting a task, check whether a skill matches. If so, read its file first.\n\n${self.skills.map((s) => `- **${s.name}**: ${s.description} (${s.path})`).join('\n')}`
        : '(none yet)'
    }`,
  ];
  return parts.join('\n\n');
}
