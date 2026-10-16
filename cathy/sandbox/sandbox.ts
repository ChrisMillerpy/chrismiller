// One Sandbox Durable Object per chat. It owns that chat's Linux box (a container
// built from ./Dockerfile) and runs commands in it. The box sleeps after 10 quiet
// minutes; every command resets the clock.
import { DurableObject } from 'cloudflare:workers';
import type { RunResult } from '../agent/box.ts';
import { singleFlight } from './single-flight.ts';
import { gitAuthEnv } from './git-auth.ts';
import { PREPARE } from './prepare.ts';

const IDLE_MS = 10 * 60 * 1000;
const decode = (b: ArrayBuffer) => new TextDecoder().decode(b);

interface SandboxEnv {
  CATHY_GITHUB_TOKEN?: string;
}

export class Sandbox extends DurableObject<SandboxEnv> {
  private preparedFor: string | null = null;
  private timeoutSet = false;

  private async box() {
    const c = this.ctx.container;
    if (!c) throw new Error('This Worker has no container configured.');
    if (!c.running) {
      c.start({ image: c.images.workspace, instance: 'standard-1', enableInternet: true });
      this.preparedFor = null;
      this.timeoutSet = false;
      // start() returns before the box is ready; wait until it can run a command.
      for (let i = 0; ; i++) {
        try {
          await (await c.exec(['true'])).output();
          break;
        } catch (err) {
          if (i > 60) throw err;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
    if (!this.timeoutSet) {
      await c.setInactivityTimeout(IDLE_MS);
      this.timeoutSet = true;
    }
    return c;
  }

  /**
   * Wake the box and put it on the branch. Safe to call often and concurrently:
   * callers share one run, so two git fetches never fight over git's lock files
   * (opening a chat warms the box while Cathy's first command may arrive at once).
   */
  async prepare(branch: string): Promise<void> {
    if (this.preparedFor === branch && this.ctx.container?.running) return;
    this.wantBranch = branch;
    return this.prepareOnce();
  }
  private wantBranch = '';
  private prepareOnce = singleFlight(async () => {
    const branch = this.wantBranch;
    const r = await this.exec(['bash', '-c', PREPARE], { BRANCH: branch });
    if (r.exitCode !== 0) throw new Error(`Could not prepare the box: ${r.stderr || r.stdout}`);
    this.preparedFor = branch;
  });

  async run(command: string, env: Record<string, string> = {}, timeoutMs = 120_000): Promise<RunResult> {
    return this.exec(['bash', '-lc', command], env, timeoutMs);
  }

  async readFile(path: string): Promise<string> {
    const r = await this.exec(['cat', '--', path]);
    if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `Could not read ${path}`);
    return r.stdout;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const c = await this.box();
    const p = await c.exec(['bash', '-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', '_', path], { cwd: '/workspace', stdin: 'pipe' });
    const w = p.stdin!.getWriter();
    await w.write(new TextEncoder().encode(content));
    await w.close();
    const out = await p.output();
    if (out.exitCode !== 0) throw new Error(decode(out.stderr).trim() || `Could not write ${path}`);
  }

  private async exec(argv: string[], env: Record<string, string> = {}, timeoutMs = 120_000): Promise<RunResult> {
    const c = await this.box();
    // The token goes with every command: commands don't inherit env from when the box started.
    const p = await c.exec(argv, { cwd: '/workspace', env: { ...gitAuthEnv(this.env.CATHY_GITHUB_TOKEN), ...env }, signal: AbortSignal.timeout(timeoutMs) });
    const out = await p.output();
    return { exitCode: out.exitCode, stdout: decode(out.stdout), stderr: decode(out.stderr) };
  }
}
