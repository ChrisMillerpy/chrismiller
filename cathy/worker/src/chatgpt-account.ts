// The ChatGPT sign-in's home: one Durable Object, "main". The tokens live in its storage (encrypted
// at rest by Cloudflare) and nowhere else: not in D1, R2, a secret, a log, the box or a chat.
// It has no fetch handler, so nothing on the network can reach it. Only the Cathy Worker's own code
// can call these methods, through the CHATGPT binding. The logic is in chatgpt-vault.ts.
import { DurableObject } from 'cloudflare:workers';
import { Vault } from './chatgpt-vault.ts';
import type { Env } from './env.ts';

export class ChatGPT extends DurableObject<Env> {
  private vault = new Vault(this.ctx.storage as any);

  status() {
    return this.vault.status();
  }
  start() {
    return this.vault.start();
  }
  finish(pasted: string) {
    return this.vault.finish(pasted);
  }
  accessToken(force = false) {
    return this.vault.accessToken(force);
  }
  disconnect() {
    return this.vault.disconnect();
  }
}
