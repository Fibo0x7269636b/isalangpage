import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadIsac } from '../../scripts/isac-node.mjs';
import { parseObject, linkObject, LinkError, missingImports } from '../../src/lab/engine/wasm-object.js';
import { runObject } from '../../src/lab/engine/runner.js';

const pub = new URL('../../public/isac/', import.meta.url);
const { default: createRuntime } = await import(new URL('isac-runtime.mjs', pub));
const runtimeModule = await WebAssembly.compile(await readFile(new URL('isac-runtime.wasm', pub)));
const { isac } = await loadIsac();

async function object(source, opt = '-O0') {
  const r = await isac({ 'main.isa': source }, ['main.isa', '--emit-obj', '-o', 'main.o', opt, '--color=never'], ['main.o']);
  assert.equal(r.status, 0, r.stderr);
  return r.files['main.o'];
}
const exec = async (source, opts = {}) => runObject({ object: await object(source, opts.opt), createRuntime, module: runtimeModule, ...opts });

test('rejects bytes that are not a wasm object', () => {
  assert.throws(() => parseObject(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), LinkError);
});

test('links an isac object into a valid module', async () => {
  const obj = parseObject(await object('fn main() -> i32 { let s = String::from("dados"); print(s); return 0; }'));
  assert.ok(obj.symbols.some(s => s.kind === 0 && s.name === 'main'));
  assert.ok(obj.segments.length > 0 && obj.relocations.length > 0);
  const linked = linkObject(obj, 4096);
  assert.ok(WebAssembly.validate(linked.module));
  assert.equal(linked.image.length, obj.dataEnd);
});

test('runs a program with string data and heap allocation', async () => {
  const r = await exec('fn main() -> i32 { let s = String::from("Olá"); s.push_str(", Lab"); print(s); return 3; }');
  assert.equal(r.stdout, 'Olá, Lab');
  assert.equal(r.exitCode, 3);
  assert.equal(r.trap, null);
  assert.equal(r.allocations, r.frees);
});

test('passes stdin and argv to the program', async () => {
  const r = await exec('@import "std.env"\nfn main() -> i32 { let name = @input("? "); @println("{} {}", name.value(), argument(1)); return 0; }', { stdin: 'Ana\n', args: ['x'] });
  assert.equal(r.stdout, '? Ana x');
});

test('reports a panic as a trap', async () => {
  const r = await exec('@import "std.buffer"\nfn main() -> i32 { let b = Buffer::new(2); let i: usize = 5; print(b.read(i)); b.release(); return 0; }');
  assert.ok(r.trap);
  assert.match(r.stderr, /panic/);
});

test('runs optimized objects', async () => {
  const r = await exec('fn main() -> i32 { let t = 0; for i in 0..10 { t = t + i; } print(t); return 0; }', { opt: '-O2' });
  assert.equal(r.stdout, '45');
});

test('names imports the browser runtime cannot provide', async () => {
  const obj = parseObject(await object('fn main() -> i32 { return 0; }'));
  obj.imports.push({ module: 'env', field: 'isac_rt_thread_call', kind: 0 });
  assert.ok(missingImports(obj, {}).some(m => m.name === 'isac_rt_thread_call' && /laboratório/.test(m.reason)));
});
