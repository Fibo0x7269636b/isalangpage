#!/usr/bin/env node
// Creates a documentation page from a template.
// Usage: npm run docs:new -- "Título da página" [--section Conceitos] [--template conceito] [--order 10]
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseFrontmatter, serializeFrontmatter, slugify } from '../src/lib/docs-shared.js';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const template = opt('template') ?? 'conceito';
const sectionArg = opt('section');
const order = opt('order');
const title = args.join(' ').trim();
if (!title) {
  console.error('uso: npm run docs:new -- "Título" [--section Seção] [--template conceito|guia|referencia] [--order N]');
  process.exit(1);
}
const source = await readFile(join(root, 'src/docs-templates', `${template}.md`), 'utf8').catch(() => {
  console.error(`modelo inexistente: ${template}`); process.exit(1);
});
const { data, body } = parseFrontmatter(source);
const section = sectionArg ?? data.section ?? 'Geral';
const file = join(root, 'src/content/docs', slugify(section), `${slugify(title)}.md`);
if (await access(file).then(() => true, () => false)) { console.error(`já existe: ${relative(root, file)}`); process.exit(1); }
await mkdir(join(file, '..'), { recursive: true });
await writeFile(file, serializeFrontmatter({ ...data, title, section, order: order ? Number(order) : data.order, draft: true }) + '\n' + body.replace(/^\n+/, ''));
console.log(`criado ${relative(root, file)} (draft: true; remova para publicar)`);
console.log('pré-visualização: npm run dev → http://localhost:4321/docs/');
