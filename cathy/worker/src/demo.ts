// Stand-ins for local testing and demos (FAKE_MODEL / FAKE_BOX = "1"): no Claude, no container.
import type { Box } from '../../agent/box.ts';

/** A box with a tiny in-memory "repo". Commands are echoed, not run. */
export function demoBox(branch: string): Box {
  const files = new Map<string, string>([['README.md', '# withchris.uk\n\nChris Miller\'s sites, in one repo.\n']]);
  return {
    async run(command) {
      if (/git status/.test(command)) return { exitCode: 0, stdout: `## ${branch}\nnothing to commit, working tree clean`, stderr: '' };
      return { exitCode: 0, stdout: `(demo box) ran: ${command}`, stderr: '' };
    },
    async readFile(path) {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path)!;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
  };
}

/**
 * A model that always checks git status first, then answers in a few streamed chunks,
 * quoting the tool result. Enough to exercise tools, streaming and history end to end.
 */
export function demoModel() {
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
  const textOf = (content: any): string =>
    typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: any) => p.text ?? (typeof p.output?.value === 'string' ? p.output.value : JSON.stringify(p.output ?? p.result ?? ''))).join(' ') : '';
  return {
    specificationVersion: 'v2' as const,
    provider: 'demo',
    modelId: 'demo',
    supportedUrls: {},
    async doGenerate(): Promise<never> {
      throw new Error('demo model only streams');
    },
    async doStream({ prompt }: { prompt: any[] }) {
      const last = prompt[prompt.length - 1];
      const lastUser = [...prompt].reverse().find((m) => m.role === 'user');
      const parts: any[] = [{ type: 'stream-start', warnings: [] }];
      if (last.role === 'tool') {
        const status = textOf(last.content).split('\\n')[0].replace(/^"|"$/g, '');
        const reply = `Demo Cathy here. You said: "${textOf(lastUser?.content).trim()}". I checked my box: ${status}.`;
        parts.push({ type: 'text-start', id: 't' });
        for (const word of reply.split(/(?<= )/)) parts.push({ type: 'text-delta', id: 't', delta: word });
        parts.push({ type: 'text-end', id: 't' }, { type: 'finish', finishReason: 'stop', usage });
      } else {
        parts.push({ type: 'tool-call', toolCallId: `c${prompt.length}`, toolName: 'run_command', input: JSON.stringify({ command: 'git status --short --branch' }) });
        parts.push({ type: 'finish', finishReason: 'tool-calls', usage });
      }
      return {
        stream: new ReadableStream({
          async start(c) {
            for (const p of parts) {
              c.enqueue(p);
              await new Promise((r) => setTimeout(r, 25)); // so streaming is visible
            }
            c.close();
          },
        }),
      };
    },
  };
}
