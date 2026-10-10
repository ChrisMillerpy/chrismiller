// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://admin.withchris.uk',
  output: 'server',
  adapter: cloudflare({
    // The admin has no images; without this the adapter adds a Cloudflare Images binding.
    imageService: 'passthrough',
  }),
  // Access handles login, so no Astro sessions (and no KV namespace provisioned for them).
  session: false,
  // Forms post back to their own page; Astro's own origin check would duplicate ours.
  security: { checkOrigin: false },
  devToolbar: { enabled: false },
  vite: {
    // Shares src/styles/global.css with the public site, one level up.
    server: { fs: { allow: ['..'] } },
  },
});
