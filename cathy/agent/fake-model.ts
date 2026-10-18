// A scripted language model for tests: each call plays the next step in the script.
// A step is text to say (optionally with thinking first), or a tool call to make.
// `slow` streams text word by word with a pause, so tests can stop a reply part-way.
// `usage` overrides the token counts the step reports.
type Usage = Record<string, unknown>;
export type Step = { text: string; thinking?: string; slow?: number; usage?: Usage } | { tool: string; input: Record<string, unknown>; usage?: Usage };

export function fakeModel(script: Step[]) {
  let call = 0;
  const calls: any[] = [];
  const model = {
    specificationVersion: 'v2' as const,
    provider: 'fake',
    modelId: 'fake-model',
    supportedUrls: {},
    calls,
    async doGenerate(): Promise<never> {
      throw new Error('fakeModel only supports streaming');
    },
    async doStream(options: any) {
      calls.push(options);
      const step = script[call++] ?? { text: '(script finished)' };
      const usage = step.usage ?? { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      const parts: unknown[] = [{ type: 'stream-start', warnings: [] }];
      let pause = 0;
      if ('text' in step) {
        if (step.thinking) parts.push({ type: 'reasoning-start', id: 'r' }, { type: 'reasoning-delta', id: 'r', delta: step.thinking }, { type: 'reasoning-end', id: 'r' });
        parts.push({ type: 'text-start', id: 't' });
        const words = step.slow ? step.text.split(/(?<= )/) : [step.text];
        for (const w of words) parts.push({ type: 'text-delta', id: 't', delta: w });
        parts.push({ type: 'text-end', id: 't' }, { type: 'finish', finishReason: 'stop', usage });
        pause = step.slow ?? 0;
      } else {
        parts.push({ type: 'tool-call', toolCallId: `call-${call}`, toolName: step.tool, input: JSON.stringify(step.input) });
        parts.push({ type: 'finish', finishReason: 'tool-calls', usage });
      }
      const signal: AbortSignal | undefined = options?.abortSignal;
      return {
        stream: new ReadableStream({
          async start(c) {
            for (const p of parts) {
              if (signal?.aborted) return c.error(new DOMException('Aborted', 'AbortError'));
              c.enqueue(p);
              if (pause) await new Promise((r) => setTimeout(r, pause));
            }
            c.close();
          },
        }),
      };
    },
  };
  return model;
}
