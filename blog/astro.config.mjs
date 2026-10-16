// @ts-check
// Blog. Build with: npm run build:blog
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import sitemap from '@astrojs/sitemap';
import { URLS } from '../shared/site.ts';

export default defineConfig({
  site: URLS.blog,
  markdown: {
    // $inline$ and $$display$$ maths in .md and .mdx posts, rendered to HTML at build time.
    processor: unified({ remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] }),
  },
  integrations: [mdx(), sitemap()],
  devToolbar: { enabled: false },
});
