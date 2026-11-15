// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import isalang from './src/lib/isalang.tmLanguage.json' with { type: 'json' };
import theme from './src/lib/shiki-theme.json' with { type: 'json' };

// GitHub Pages: the deploy workflow sets SITE_URL and BASE_PATH from
// actions/configure-pages (e.g. https://user.github.io and /repo).
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  base,
  trailingSlash: 'always',
  build: { format: 'directory', assets: '_assets' },
  integrations: [mdx()],
  markdown: {
    shikiConfig: { theme, langs: [isalang], langAlias: { isa: 'isalang' } },
  },
  vite: {
    worker: { format: 'es' },
    build: { target: 'es2022' },
  },
});
