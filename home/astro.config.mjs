// @ts-check
// Landing page. Build with: npm run build:home
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { URLS } from '../shared/site.ts';

export default defineConfig({
  site: URLS.home,
  integrations: [sitemap()],
  devToolbar: { enabled: false },
});
