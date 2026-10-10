// Local-only variable, never set in wrangler.jsonc. See middleware.ts.
declare namespace Cloudflare {
  interface Env {
    DEV_EMAIL?: string;
  }
}
