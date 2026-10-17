// Stand-ins for local testing and demos (FAKE_MODEL / FAKE_BOX = "1"): no Claude, no container.
import type { Box } from '../../agent/box.ts';

/** A box with a tiny in-memory "repo". Commands are echoed, not run. */
export function demoBox(branch: string): Box {
  const enc = new TextEncoder();
  const files = new Map<string, Uint8Array>([['README.md', enc.encode("# withchris.uk\n\nChris Miller's sites, in one repo.\n")]]);
  const get = (path: string) => {
    if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
    return files.get(path)!;
  };
  return {
    async run(command) {
      if (/git status/.test(command)) return { exitCode: 0, stdout: `## ${branch}\nnothing to commit, working tree clean`, stderr: '' };
      return { exitCode: 0, stdout: `(demo box) ran: ${command}`, stderr: '' };
    },
    async readFile(path) {
      return new TextDecoder().decode(get(path));
    },
    async writeFile(path, content) {
      files.set(path, enc.encode(content));
    },
    async readBytes(path) {
      return get(path);
    },
    async writeBytes(path, bytes) {
      files.set(path, bytes);
    },
  };
}

/**
 * A model that always checks git status first, then answers in a few streamed chunks,
 * quoting the tool result. Enough to exercise tools, streaming and history end to end.
 * Say "publish" and it publishes README.md as an artifact; it also names new chats.
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
    async doStream({ prompt, tools = [] }: { prompt: any[]; tools?: { name: string }[] }) {
      const last = prompt[prompt.length - 1];
      const lastUserIndex = prompt.map((m) => m.role).lastIndexOf('user');
      const lastUser = prompt[lastUserIndex];
      const said = textOf(lastUser?.content).split('\n\n[Chris attached')[0].trim();
      const calledThisTurn = prompt.slice(lastUserIndex).flatMap((m) => (m.role === 'assistant' && Array.isArray(m.content) ? m.content.filter((p: any) => p.type === 'tool-call').map((p: any) => p.toolName) : []));
      const has = (name: string) => tools.some((t) => t.name === name);
      const firstTurn = prompt.filter((m) => m.role === 'user').length === 1;
      const parts: any[] = [{ type: 'stream-start', warnings: [] }];
      const call = (toolName: string, input: unknown) => {
        parts.push({ type: 'tool-call', toolCallId: `c${prompt.length}`, toolName, input: JSON.stringify(input) });
        parts.push({ type: 'finish', finishReason: 'tool-calls', usage });
      };
      const images = Array.isArray(lastUser?.content) ? lastUser.content.filter((p: any) => p.type === 'file' && /^image\//.test(p.mediaType)).length : 0;

      if (!calledThisTurn.includes('run_command')) call('run_command', { command: 'git status --short --branch' });
      else if (firstTurn && has('set_title') && !calledThisTurn.includes('set_title')) call('set_title', { title: `Demo: ${said.split(/\s+/).slice(0, 4).join(' ') || 'files'}` });
      else if (/publish/i.test(said) && has('publish_artifact') && !calledThisTurn.includes('publish_artifact'))
        call('publish_artifact', { path: 'README.md', title: 'Demo artifact', visibility: /public/i.test(said) ? 'public' : /link/i.test(said) ? 'link' : 'private' });
      else {
        const status = textOf(prompt.find((m) => m.role === 'tool' && JSON.stringify(m.content).includes('##'))?.content ?? last.content).split('\\n')[0].replace(/^"|"$/g, '');
        const seen = images ? ` I can see ${images} image${images === 1 ? '' : 's'}.` : '';
        const reply = `Demo Cathy here. You said: "${said}". I checked my box: ${status}.${seen}`;
        parts.push({ type: 'text-start', id: 't' });
        for (const word of reply.split(/(?<= )/)) parts.push({ type: 'text-delta', id: 't', delta: word });
        parts.push({ type: 'text-end', id: 't' }, { type: 'finish', finishReason: 'stop', usage });
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
