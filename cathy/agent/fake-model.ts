// A scripted language model for tests: each call plays the next step in the script.
// A step is either text to say, or a tool call to make.
export type Step = { text: string } | { tool: string; input: Record<string, unknown> };

export function fakeModel(script: Step[]) {
  let call = 0;
  const calls: unknown[] = [];
  const model = {
    specificationVersion: 'v2' as const,
    provider: 'fake',
    modelId: 'fake-model',
    supportedUrls: {},
    calls,
    async doGenerate(): Promise<never> {
      throw new Error('fakeModel only supports streaming');
    },
    async doStream(options: unknown) {
      calls.push(options);
      const step = script[call++] ?? { text: '(script finished)' };
      const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      const parts: unknown[] = [{ type: 'stream-start', warnings: [] }];
      if ('text' in step) {
        parts.push({ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: step.text }, { type: 'text-end', id: 't' });
        parts.push({ type: 'finish', finishReason: 'stop', usage });
      } else {
        parts.push({ type: 'tool-call', toolCallId: `call-${call}`, toolName: step.tool, input: JSON.stringify(step.input) });
        parts.push({ type: 'finish', finishReason: 'tool-calls', usage });
      }
      return {
        stream: new ReadableStream({
          start(c) {
            for (const p of parts) c.enqueue(p);
            c.close();
          },
        }),
      };
    },
  };
  return model;
}
