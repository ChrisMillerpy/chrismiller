// How each step of Cathy's work is described in the chat: a plain description for Chris,
// what went in (the command, the path), what came out, and whether it worked.
// No Cloudflare code, so it's tested in plain Node.

/** Most characters of a step's output kept for the chat (start and end; the middle is cut). */
export const MAX_OUTPUT = 4000;
const MAX_INPUT = 1500;

/** Keep the start and end of long text, marking what was cut. */
export function clip(s: string, max = MAX_OUTPUT) {
  if (s.length <= max) return s;
  const keep = Math.floor((max - 40) / 2);
  return `${s.slice(0, keep)}\n… ${s.length - 2 * keep} characters cut …\n${s.slice(-keep)}`;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
const oneLine = (s: string, n = 80) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The description and input for a tool call. */
export function describeCall(tool: string, a: Record<string, any> = {}): { desc: string; input: string } {
  const path = str(a.path);
  switch (tool) {
    case 'run_command':
      return { desc: oneLine(str(a.description).trim() || str(a.command)), input: clip(str(a.command), MAX_INPUT) };
    case 'read_file':
      return { desc: `Read ${path}`, input: path + (a.offset || a.limit ? ` (lines ${a.offset ?? 1}–${(a.offset ?? 1) + (a.limit ?? 500) - 1})` : '') };
    case 'write_file':
      return { desc: `Wrote ${path}`, input: `${path} (${str(a.content).length} characters)` };
    case 'edit_file':
      return { desc: `Edited ${path}`, input: clip(`${path}\n− ${str(a.old_string)}\n+ ${str(a.new_string)}`, MAX_INPUT) };
    case 'grep':
      return { desc: `Searched ${path || 'the repo'} for "${oneLine(str(a.pattern), 40)}"`, input: `${str(a.pattern)}${path ? `  in ${path}` : ''}` };
    case 'list_files':
      return { desc: path ? `Listed files in ${path}` : 'Listed files', input: path || '.' };
    case 'open_pr':
      return { desc: `Opened a PR: ${oneLine(str(a.title), 60)}`, input: clip(`${str(a.title)}\n\n${str(a.body)}`, MAX_INPUT) };
    case 'publish_artifact':
      return { desc: `Published "${oneLine(str(a.title), 60)}"`, input: `${path}${a.visibility ? ` (${a.visibility})` : ''}${a.id ? `, new version of ${a.id}` : ''}` };
    case 'set_title':
      return { desc: `Named the chat "${oneLine(str(a.title), 60)}"`, input: str(a.title) };
    case 'message_cathy':
      return { desc: `Messaged Cathy ${str(a.to)}`, input: clip(str(a.text), MAX_INPUT) };
    case 'list_cathys':
      return { desc: 'Listed the other Cathys', input: '' };
    case 'list_artifacts':
      return { desc: "Listed this chat's artifacts", input: '' };
    default:
      return { desc: tool, input: clip(JSON.stringify(a, null, 2), MAX_INPUT) };
  }
}

/** What a tool call returned, and whether it failed. */
export function outcome(tool: string, result: unknown, error?: unknown): { output: string; failed: boolean } {
  if (error !== undefined) return { output: clip(`Error: ${error instanceof Error ? error.message : str(error)}`), failed: true };
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? '';
  const exit = text.match(/\[exit (-?\d+)\]\s*$/);
  const refused = /^(No match for old_string|old_string matches \d+ times|Not sent \(loop guard\))/.test(text);
  return { output: clip(text), failed: (tool === 'run_command' && !!exit && exit[1] !== '0') || refused };
}
