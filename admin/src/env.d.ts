/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

declare namespace App {
  interface Locals {
    email: string;
    /** Today's date in the UK, 'YYYY-MM-DD'. */
    today: string;
    db: D1Database;
  }
}
