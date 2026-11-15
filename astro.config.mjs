// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import isalang from './src/lib/isalang.tmLanguage.json' with { type: 'json' };
import theme from './src/lib/shiki-theme.json' with { type: 'json' };

// Production: https://isa-language.github.io/isalang/ (repository isa-language/isalang).
// The deploy workflow passes SITE_URL and BASE_PATH from actions/configure-pages;
// these defaults match it so local builds produce the same paths.
const base = process.env.BASE_PATH === undefined ? '/isalang' : (process.env.BASE_PATH || '/');

export default defineConfig({
  site: process.env.SITE_URL || 'https://isa-language.github.io',
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
