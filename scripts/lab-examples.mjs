#!/usr/bin/env node
// Compiles every program in examples/ with the same isac.wasm the Lab uses
// (public/isac/) and writes:
//   src/data/lab-examples.json  status of each example in the Lab
//   src/data/pipeline.json      dumps of examples/heap/box.isa at each stage
//   src/data/showcase.json      Core/erased excerpts shown on the home page
//
// Each program that compiles is also executed with the Lab's runtime
// (src/lab/engine/runner.js); stdout and allocation counters are recorded.
// Programs rejected because of features the WebAssembly build lacks (FFI bridge,
// cross-thread transfers) are left out of the Lab list and recorded in `excluded`.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, dirname, basename } from 'node:path';
import { loadIsac } from './isac-node.mjs';
import { runObject } from '../src/lab/engine/runner.js';
import { EXAMPLE_META, CATEGORY_LABELS, UNSUPPORTED } from '../src/data/example-meta.js';

const root = new URL('..', import.meta.url).pathname;
const exampleRoot = join(root, 'examples');
const { isac } = await loadIsac();
const pub = join(root, 'public/isac');
const { default: createRuntime } = await import(join(pub, 'isac-runtime.mjs'));
const runtimeModule = await WebAssembly.compile(await readFile(join(pub, 'isac-runtime.wasm')));
const STDIN = { 'input_demo.isa': 'Ana\n20\n' };
const ARGS = { 'env/arguments.isa': ['exemplo'], 'std/systems.isa': ['exemplo'] };

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out.sort();
}

// Local files reachable through @import "x.isa" (relative to the importing file).
async function collectFiles(entry) {
  const files = {};
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    const rel = relative(dirname(entry), file);
    if (files[rel] !== undefined) continue;
    const text = await readFile(file, 'utf8');
    files[rel] = text;
    for (const m of text.matchAll(/@import\s*\(?([^)\n]*)\)?/g))
      for (const s of m[1].matchAll(/"([^"]+\.isa)"/g)) queue.push(join(dirname(file), s[1]));
  }
  return files;
}

const entries = [];
const excluded = [];
for (const file of (await walk(exampleRoot)).filter(f => f.endsWith('.isa'))) {
  const id = relative(exampleRoot, file);
  const text = await readFile(file, 'utf8');
  if (!/\bfn\s+main\s*\(/.test(text)) continue; // modules imported by other examples
  const files = await collectFiles(file);
  const main = basename(file);
  const r = await isac(files, [main, '--emit-obj', '-o', 'program.o', '--color=never'], ['program.o']);
  const meta = EXAMPLE_META[id] ?? {};
  const category = id.includes('/') ? id.split('/')[0] : 'language';
  const entry = { id, main, files, category, categoryLabel: CATEGORY_LABELS[category] ?? category,
    title: meta.title ?? basename(id, '.isa').replace(/[_-]/g, ' '),
    summary: meta.summary ?? null, featured: meta.featured ?? false,
    stdin: STDIN[id] ?? '', args: ARGS[id] ?? [] };
  if (r.status === 0) {
    const run = await runObject({ object: r.files['program.o'], createRuntime, module: runtimeModule, stdin: entry.stdin, args: entry.args });
    if (run.trap) throw new Error(`${id}: ${run.trap.message}\n${run.stderr}`);
    Object.assign(entry, { status: 'runs', stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode,
      allocations: run.allocations, frees: run.frees });
  } else {
    const code = /error\[(E\d+)\]/.exec(r.stderr)?.[1] ?? null;
    if (UNSUPPORTED[code]) {
      excluded.push({ id, code, reason: UNSUPPORTED[code] });
      console.log(`excluded    ${id} (${code})`);
      continue;
    }
    Object.assign(entry, { status: 'rejected', diagnosticCode: code, diagnostics: r.stderr });
  }
  entries.push(entry);
  console.log(`${entry.status.padEnd(11)} ${id}`);
}
const order = { runs: 0, rejected: 1 };
entries.sort((a, b) => (b.featured - a.featured) || (order[a.status] - order[b.status]) || a.id.localeCompare(b.id));
await mkdir(join(root, 'src/data'), { recursive: true });
await writeFile(join(root, 'src/data/lab-examples.json'), JSON.stringify({ generated: new Date().toISOString(), entries, excluded }, null, 1) + '\n');

// ---------------------------------------------------------------- dumps
async function dump(rel, stage) {
  const source = await readFile(join(exampleRoot, rel), 'utf8');
  const name = basename(rel);
  const r = await isac({ [name]: source }, [name, `--emit-${stage}`, '--color=never']);
  if (r.status !== 0) throw new Error(`${rel} --emit-${stage}: ${r.stderr}`);
  return { source, lines: r.stdout.split('\n') };
}
// Last block starting with `start`, up to the next unindented line.
function block(lines, start, { max = 40 } = {}) {
  let i = -1;
  for (let k = lines.length - 1; k >= 0; k--) if (start.test(lines[k])) { i = k; break; }
  if (i < 0) throw new Error(`no block matching ${start}`);
  const out = [lines[i]];
  for (let k = i + 1; k < lines.length && out.length < max && /^\s/.test(lines[k]); k++) out.push(lines[k]);
  return out.join('\n');
}

const stages = ['tokens', 'ast', 'hir', 'core', 'erased', 'lir', 'mlir', 'std-mlir', 'llvm-dialect', 'llvm'];
const excerpt = {
  tokens: lines => { const i = lines.findIndex(l => /^3:/.test(l)); return lines.slice(i, i + 14).join('\n'); },
  ast: lines => block(lines, /^fn ::main\b/),
  hir: lines => block(lines, /^fn #F\d+ main\b/),
  core: lines => block(lines, /^fn #F\d+ main kind=/, { max: 14 }),
  erased: lines => block(lines, /^fn isa_\d+_main$/),
  lir: lines => block(lines, /^fn isa_\d+_main$/),
  mlir: lines => block(lines, /func\.func @isa_\d+_main\(/, { max: 12 }),
  'std-mlir': lines => block(lines, /func\.func @isa_\d+_main\(/, { max: 12 }),
  'llvm-dialect': lines => block(lines, /llvm\.func @isa_\d+_main\(/, { max: 11 }),
  llvm: lines => { const i = lines.findIndex(l => /^define .*@isa_\d+_main/.test(l)); return lines.slice(i, lines.indexOf('}', i) + 1).join('\n'); },
};
const pipeline = [];
let boxSource;
for (const stage of stages) {
  const { source, lines } = await dump('heap/box.isa', stage);
  boxSource = source;
  pipeline.push({ stage, lines: lines.length, excerpt: excerpt[stage](lines) });
}
await writeFile(join(root, 'src/data/pipeline.json'), JSON.stringify({ source: boxSource, file: 'examples/heap/box.isa', pipeline }, null, 1) + '\n');

const connectionCore = block((await dump('connection.isa', 'core')).lines, /^fn #F\d+ main kind=/)
  .split('\n').filter(l => !/^\s+end_views$/.test(l)).join('\n');
const bufferErased = (await dump('heap/buffer.isa', 'erased')).lines;
await writeFile(join(root, 'src/data/showcase.json'), JSON.stringify({
  connectionCore,
  bufferRelease: block(bufferErased, /^fn isa_\d+_Buffer__release$/),
  bufferMain: block(bufferErased, /^fn isa_\d+_main$/),
}, null, 1) + '\n');

const count = s => entries.filter(e => e.status === s).length;
console.log(`\n${entries.length} programas no Lab: ${count('runs')} executam, ${count('rejected')} rejeitados de propósito; ${excluded.length} fora da lista (não funcionam no laboratório)`);
