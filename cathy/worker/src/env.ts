import type { Session } from './session.ts';
import type { Sandbox } from '../../sandbox/sandbox.ts';
import type { ChatGPT } from './chatgpt-account.ts';

export interface Env {
  DB: D1Database;
  /** File bytes: Chris's attachments and Cathy's artifacts. */
  FILES: R2Bucket;
  SESSION: DurableObjectNamespace<Session>;
  SANDBOX: DurableObjectNamespace<Sandbox>;
  /** The ChatGPT plan sign-in (tokens live only in this object). */
  CHATGPT: DurableObjectNamespace<ChatGPT>;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  OPENAI_API_KEY?: string;
  /** Default model for new chats. */
  MODEL?: string;
  /** Models Chris can pick: "id=Label,id=Label". */
  MODELS?: string;
  CATHY_GITHUB_TOKEN?: string;
  /** "1" = scripted stand-in model, no Claude (local tests and demos). */
  FAKE_MODEL?: string;
  /** "1" = in-memory box, no container (local tests and demos). */
  FAKE_BOX?: string;
  /** Where share links point: the share Worker's address (share/). */
  SHARE_URL?: string;
}
