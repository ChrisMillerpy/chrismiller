// Cathy's hands: file and shell tools over a "box" (a Linux machine holding the repo).
// The box is handed in, so the same tools work on a cloud sandbox or, later, your own machine.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Box {
  /** Run a bash command in the repo root. `env` is how tools pass values safely (no quoting). */
  run(command: string, opts?: { env?: Record<string, string>; timeoutMs?: number }): Promise<RunResult>;
  /** Paths are relative to the repo root. */
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

const MAX_OUTPUT = 20_000;
const clip = (s: string) => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n… (${s.length - MAX_OUTPUT} more characters cut)` : s);
const show = (r: RunResult) => clip([r.stdout, r.stderr && `[stderr]\n${r.stderr}`, `[exit ${r.exitCode}]`].filter(Boolean).join('\n'));

export function boxTools(box: Box, branch: string) {
  return {
    read_file: createTool({
      id: 'read_file',
      description: 'Read a text file from the repo. Returns numbered lines. Use offset/limit for long files.',
      inputSchema: z.object({
        path: z.string().describe('Path relative to the repo root'),
        offset: z.number().int().min(1).optional().describe('First line to show (1-based)'),
        limit: z.number().int().min(1).max(2000).optional().describe('How many lines (default 500)'),
      }),
      execute: async ({ path, offset = 1, limit = 500 }) => {
        const lines = (await box.readFile(path)).split('\n');
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const body = slice.map((l, i) => `${String(offset + i).padStart(5)}  ${l}`).join('\n');
        const more = lines.length > offset - 1 + limit ? `\n… ${lines.length - (offset - 1 + limit)} more lines` : '';
        return clip(body + more);
      },
    }),

    write_file: createTool({
      id: 'write_file',
      description: 'Create or overwrite a file with the given content. Creates folders as needed.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        await box.writeFile(path, content);
        return `Wrote ${path} (${content.length} characters)`;
      },
    }),

    edit_file: createTool({
      id: 'edit_file',
      description: 'Replace exact text in a file. old_string must match exactly once unless replace_all is true.',
      inputSchema: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
      }),
      execute: async ({ path, old_string, new_string, replace_all }) => {
        const text = await box.readFile(path);
        const count = text.split(old_string).length - 1;
        if (count === 0) return `No match for old_string in ${path}. Read the file and copy the text exactly.`;
        if (count > 1 && !replace_all) return `old_string matches ${count} times in ${path}. Add more context, or set replace_all.`;
        await box.writeFile(path, replace_all ? text.split(old_string).join(new_string) : text.replace(old_string, () => new_string));
        return `Edited ${path} (${replace_all ? count : 1} replacement${count > 1 && replace_all ? 's' : ''})`;
      },
    }),

    list_files: createTool({
      id: 'list_files',
      description: 'List tracked files in the repo, optionally under a folder.',
      inputSchema: z.object({ path: z.string().optional().describe('Folder, relative to the repo root') }),
      execute: async ({ path }) => show(await box.run('git ls-files -- "${DIR:-.}" | head -500', { env: { DIR: path ?? '' } })),
    }),

    grep: createTool({
      id: 'grep',
      description: 'Search file contents with a regular expression (ripgrep). Returns matching lines with line numbers.',
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional().describe('File or folder to search, relative to the repo root'),
      }),
      execute: async ({ pattern, path }) =>
        show(await box.run('rg -n --max-count 50 -- "$PATTERN" "${DIR:-.}" | head -300', { env: { PATTERN: pattern, DIR: path ?? '' } })),
    }),

    run_command: createTool({
      id: 'run_command',
      description: 'Run a bash command in the repo root (git, node, npm, gh are available). Returns output and exit code.',
      inputSchema: z.object({
        command: z.string(),
        timeout_seconds: z.number().int().min(1).max(600).optional().describe('Default 120'),
      }),
      execute: async ({ command, timeout_seconds = 120 }) => show(await box.run(command, { timeoutMs: timeout_seconds * 1000 })),
    }),

    open_pr: createTool({
      id: 'open_pr',
      description: `Commit everything, push branch ${branch} and open a pull request to main (or return the existing one). Returns the PR link.`,
      inputSchema: z.object({
        title: z.string().describe('Short PR title; also the commit message if there are uncommitted changes'),
        body: z.string().describe('What changed and why, in a few lines'),
      }),
      execute: async ({ title, body }) => {
        const r = await box.run(
          [
            'set -e',
            '[ -n "$GH_TOKEN" ] || { echo "No GitHub token in the sandbox: Chris needs to add the CATHY_GITHUB_TOKEN secret."; exit 1; }',
            'git add -A',
            'git diff --cached --quiet || git commit -q -m "$TITLE"',
            'git push -q -u origin "HEAD:$BRANCH"',
            'url=$(gh pr view "$BRANCH" --json url -q .url 2>/dev/null || true)',
            '[ -n "$url" ] || url=$(gh pr create --base main --head "$BRANCH" --title "$TITLE" --body "$BODY")',
            'echo "$url"',
          ].join('\n'),
          { env: { TITLE: title, BODY: body, BRANCH: branch }, timeoutMs: 120_000 },
        );
        return r.exitCode === 0 ? `PR: ${r.stdout.trim().split('\n').pop()}` : show(r);
      },
    }),
  };
}
