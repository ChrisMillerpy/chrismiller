// @ts-check
// Tutoring page. Build with: npm run build:learn
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { URLS } from '../shared/site.ts';

export default defineConfig({
  site: URLS.learn,
  integrations: [sitemap()],
  devToolbar: { enabled: false },
});
