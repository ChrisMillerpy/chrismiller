/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

declare namespace App {
  interface Locals {
    staff: import('./lib/db').StaffMember;
    email: string;
    /** Today's date in the UK, 'YYYY-MM-DD'. */
    today: string;
    /** Runs queries in one transaction under the signed-in staff member's claims. */
    db: <T>(fn: (tx: import('./lib/db').Tx) => Promise<T>) => Promise<T>;
  }
}
