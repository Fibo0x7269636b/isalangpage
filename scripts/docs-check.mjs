#!/usr/bin/env node
// Validates documentation pages:
//   * frontmatter (title required, types of order/draft)
//   * every ```isalang block compiles with isac.wasm (`fail` blocks must be rejected,
//     `nocheck` blocks are skipped, blocks without fn main use --library)
// Usage: npm run docs:check [-- path/to/page.md ...]
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { extractIsalangBlocks, parseFrontmatter, validateDoc } from '../src/lib/docs-shared.js';
import { loadIsac } from './isac-node.mjs';

const root = new URL('..', import.meta.url).pathname;
const docsDir = join(root, 'src/content/docs');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (/\.mdx?$/.test(e.name) && !e.name.startsWith('_')) out.push(p);
  }
  return out.sort();
}

const files = process.argv.slice(2).length ? process.argv.slice(2).map(f => join(process.cwd(), f)) : await walk(docsDir);
if (!files.length) { console.log('docs:check: nenhuma página em src/content/docs'); process.exit(0); }

const { isac, manifest } = await loadIsac();
let errors = 0, blocksChecked = 0;
for (const file of files) {
  const rel = relative(root, file);
  const text = await readFile(file, 'utf8');
  const { data, body } = parseFrontmatter(text);
  for (const e of validateDoc(data)) { console.log(`✗ ${rel}: ${e}`); errors++; }
  const offset = text.slice(0, text.length - body.length).split('\n').length - 1;
  for (const b of extractIsalangBlocks(body)) {
    const where = `${rel}:${b.line + offset}`;
    if (b.skip) continue;
    const name = b.file ?? 'block.isa';
    const r = await isac({ [name]: b.code }, [name, '--check', '--color=never', ...(b.hasMain ? [] : ['--library'])]);
    blocksChecked++;
    const ok = b.expectFail ? r.status !== 0 : r.status === 0;
    if (!ok) {
      errors++;
      console.log(`✗ ${where}: ${b.expectFail ? 'bloco marcado com fail foi aceito pelo compilador' : 'bloco não compila'}`);
      if (r.stderr) console.log(r.stderr.split('\n').map(l => '    ' + l).join('\n'));
    }
  }
}
console.log(`\ndocs:check: ${files.length} páginas, ${blocksChecked} blocos verificados com isac.wasm ${manifest.compiler.sha256.slice(0, 12)}, ${errors} erros`);
process.exit(errors ? 1 : 0);
