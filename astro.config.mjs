// @ts-check
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { SITE } from './src/site.ts';

export default defineConfig({
  site: SITE.url,
  // The homepage points at the tutoring page for now.
  redirects: { '/': '/learn' },
  markdown: {
    // $inline$ and $$display$$ maths in .md and .mdx posts, rendered to HTML at build time.
    processor: unified({ remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] }),
  },
  integrations: [mdx(), sitemap()],
  devToolbar: { enabled: false },
});
