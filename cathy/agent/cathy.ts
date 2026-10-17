// Cathy herself: a Mastra agent. No Cloudflare code here, so she can run in a Worker
// today and in a terminal later. The caller hands her a model, a box and any extra tools.
// Her soul, memory and skills are markdown in cathy/self/ (see self.ts), read from the box
// each time she answers, so edits she commits are in her context on her next turn.
import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { boxTools, type Box } from './box.ts';
import { instructions, loadSelf } from './self.ts';

export interface CathyOptions {
  model: MastraModelConfig;
  box: Box;
  sessionId: string;
  branch: string;
  tools?: Record<string, any>;
}

export function createCathy({ model, box, sessionId, branch, tools = {} }: CathyOptions) {
  return new Agent({
    id: 'cathy',
    name: 'Cathy',
    instructions: async () => instructions(sessionId, branch, await loadSelf(box)),
    model,
    tools: { ...boxTools(box, branch), ...tools },
  });
}
