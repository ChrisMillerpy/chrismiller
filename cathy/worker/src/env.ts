import type { Session } from './session.ts';
import type { Sandbox } from '../../sandbox/sandbox.ts';

export interface Env {
  DB: D1Database;
  SESSION: DurableObjectNamespace<Session>;
  SANDBOX: DurableObjectNamespace<Sandbox>;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  MODEL?: string;
  CATHY_GITHUB_TOKEN?: string;
  /** "1" = scripted stand-in model, no Claude (local tests and demos). */
  FAKE_MODEL?: string;
  /** "1" = in-memory box, no container (local tests and demos). */
  FAKE_BOX?: string;
}
