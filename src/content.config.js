import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Documentation pages: src/content/docs/<section>/<page>.mdx
// The schema is shared with the editor (/docs/editor/) and scripts/docs-new.mjs.
const docs = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    section: z.string().default('Geral'),
    order: z.number().default(100),
    draft: z.boolean().default(false),
    // Compiler revision the page was checked against (manifest sha256 prefix).
    compiler: z.string().optional(),
  }),
});

export const collections = { docs };
