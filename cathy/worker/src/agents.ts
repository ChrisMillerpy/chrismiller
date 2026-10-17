// Sub-agents: a Cathy starts child chats that work in parallel. Each child is a normal chat
// (its own Session, box and branch) with a parent, so Chris can open, steer or stop any of them
// in admin. No Cloudflare code here: session.ts hands in the registry, the parent's box and a
// way to reach a child's Session, so this is tested in plain Node.
import type { Box } from '../../agent/box.ts';
import { resolve, validate } from './models.ts';
import { MODES, type AgentMode, type Registry, type Session } from './registry.ts';

/** How many sub-agents one chat may have working at once. Each has its own container. */
export const MAX_WORKING = 5;

export interface SpawnInput {
  task: string;
  title?: string;
  mode?: AgentMode;
  instructions?: string;
  model?: string;
  effort?: string;
}

/** A sub-agent as its parent (and the spawn_agent tool) sees it. */
export interface AgentView {
  id: string;
  title: string;
  mode: AgentMode | null;
  state: string;
  model: string;
  effort: string;
  branch: string;
  task: string | null;
  last_message: string | null;
  /** Where Chris opens it in admin. */
  url: string;
}

/** What a parent can ask of a child's Session. */
export interface ChildStub {
  start(childId: string, parentId: string, history: unknown[], task: string): Promise<void>;
  message(childId: string, parentId: string, text: string): Promise<void>;
  stop(childId: string): Promise<void>;
}

export interface AgentDeps {
  id: string;
  registry: Registry;
  env: { MODEL?: string; MODELS?: string };
  child(id: string): ChildStub;
  /** The parent's conversation so far, for fork mode. */
  forkHistory(): unknown[];
  /** Push the parent's current work (uncommitted too) to the child's branch. Left out when there's no real box. */
  snapshot?(branch: string): Promise<void>;
}

export interface Agents {
  spawn(input: SpawnInput): Promise<AgentView>;
  list(): Promise<AgentView[]>;
  message(id: string, text: string): Promise<void>;
  stop(id: string): Promise<void>;
  stopAll(): Promise<void>;
}

export const agentView = (s: Session, env: AgentDeps['env']): AgentView => ({
  id: s.id,
  title: s.title,
  mode: s.mode,
  state: s.state,
  ...resolve(env, s),
  branch: s.branch,
  task: s.task,
  last_message: s.last_message,
  url: `/cathy/${s.id}`,
});

export function agents(d: AgentDeps): Agents {
  // One spawn at a time, so parallel tool calls can't slip past the limit.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const mine = async (id: string) => {
    const s = await d.registry.get(id);
    if (!s || s.parent_id !== d.id) throw new Error(`${id} is not one of your sub-agents. Use list_agents.`);
    return s;
  };

  return {
    spawn: (input) =>
      serial(async () => {
        const task = input.task?.trim();
        if (!task) throw new Error('Give the sub-agent a task.');
        const mode = input.mode ?? 'fresh';
        if (!MODES.includes(mode)) throw new Error(`Mode must be one of ${MODES.join(', ')}`);
        if (mode === 'custom' && !input.instructions?.trim()) throw new Error('Custom mode needs instructions (the sub-agent\'s role).');
        const settings = validate(d.env, { model: input.model, effort: input.effort });

        const me = await d.registry.get(d.id);
        if (me?.parent_id) throw new Error("Sub-agents can't start their own sub-agents. Ask your parent, or do it yourself.");
        const working = (await d.registry.children(d.id)).filter((c) => c.state === 'working').length;
        if (working >= MAX_WORKING) throw new Error(`${MAX_WORKING} sub-agents are already working. Wait for a report, or stop one with stop_agent.`);

        const child = await d.registry.createChild(d.id, { title: input.title?.trim() || task, task, mode, instructions: mode === 'custom' ? input.instructions : null, ...settings });
        try {
          await d.snapshot?.(child.branch);
        } catch (err) {
          await d.registry.archive(child.id);
          throw err;
        }
        await d.child(child.id).start(child.id, d.id, mode === 'fork' ? d.forkHistory() : [], task);
        return agentView(child, d.env);
      }),

    list: async () => (await d.registry.children(d.id)).map((s) => agentView(s, d.env)),

    message: async (id, text) => {
      await mine(id);
      await d.child(id).message(id, d.id, text);
    },

    stop: async (id) => {
      await mine(id);
      await d.child(id).stop(id);
    },

    stopAll: async () => {
      const working = (await d.registry.children(d.id)).filter((c) => c.state === 'working');
      await Promise.all(working.map((c) => d.child(c.id).stop(c.id).catch(() => {})));
    },
  };
}

/** What a sub-agent is told on top of her usual self. */
export function childInstructions(parentId: string, branch: string, instructions?: string | null) {
  const lines = [
    '## You are a sub-agent',
    `Cathy ${parentId} started you to do one part of a bigger job, possibly alongside other sub-agents. Her messages arrive as "[Message from Cathy ${parentId}, who started you]".`,
    `- Your branch ${branch} starts from her work at the moment she started you. Work only there. Commit and push it (git push origin HEAD) before you finish; she merges it. You can't open PRs, and never merge.`,
    '- Stay on your task. Other agents may be editing other files; if you need something outside your task, say so instead of doing it.',
    '- When you finish or get stuck, your final reply is sent to her automatically as your report. Keep it short: what you did, what is left, the files you touched, and whether you pushed.',
    '- Chris can open your chat and talk to you; answer him as usual.',
  ];
  if (instructions?.trim()) lines.push('', `## Your role (from Cathy ${parentId})`, instructions.trim());
  return lines.join('\n');
}

// Commits everything in the working tree (not ignored files) onto HEAD in a throwaway index,
// so the parent's own HEAD, index and files are untouched, then pushes that commit as the
// child's branch. With nothing uncommitted, the child's branch is just HEAD.
const SNAPSHOT = `set -e
idx=$(mktemp -u)
trap 'rm -f "$idx"' EXIT
cp "$(git rev-parse --git-path index)" "$idx"
export GIT_INDEX_FILE="$idx"
git add -A
tree=$(git write-tree)
head=$(git rev-parse HEAD)
if [ "$tree" = "$(git rev-parse "HEAD^{tree}")" ]; then c=$head; else c=$(git commit-tree "$tree" -p "$head" -m "Snapshot of cathy/$FROM for $TO"); fi
git push -q origin "$c:refs/heads/$TO"`;

export async function snapshot(box: Box, from: string, to: string, env: Record<string, string> = {}) {
  const r = await box.run(SNAPSHOT, { env: { GIT_AUTHOR_NAME: 'Cathy', GIT_AUTHOR_EMAIL: 'cathy@withchris.uk', GIT_COMMITTER_NAME: 'Cathy', GIT_COMMITTER_EMAIL: 'cathy@withchris.uk', ...env, FROM: from, TO: to }, timeoutMs: 120_000 });
  if (r.exitCode !== 0) throw new Error(`Could not snapshot your work to ${to}: ${(r.stderr || r.stdout).trim()}`);
}
