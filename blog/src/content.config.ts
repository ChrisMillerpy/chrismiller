import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  // Every .md or .mdx file in src/content/blog is a post. The filename (or folder name) becomes the URL.
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      description: z.string(),
      /** Optional cover image, relative to the post file. Without one, a generated pattern is used. */
      cover: image().optional(),
      coverAlt: z.string().optional(),
      /** Pattern for the generated cover when there's no image. */
      motif: z.enum(['waves', 'sines', 'rings', 'dots', 'rays', 'grid']).optional(),
      /** Drafts show up in `npm run dev` but are left out of the built site. */
      draft: z.boolean().default(false),
    }),
});

export const collections = { blog };
