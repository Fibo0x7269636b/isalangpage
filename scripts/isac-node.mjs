// Loads the Lab's compiler artifacts (public/isac) in Node for scripts and CI.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { runIsac } from '../src/lab/engine/compiler.js';

const pub = new URL('../public/isac/', import.meta.url).pathname;
let cached;
export async function loadIsac() {
  if (cached) return cached;
  const manifest = JSON.parse(await readFile(join(pub, 'manifest.json'), 'utf8'));
  const { default: createIsac } = await import(join(pub, manifest.compiler.loader));
  const module = await WebAssembly.compile(gunzipSync(await readFile(join(pub, manifest.compiler.wasm))));
  const NOISE = /^Aborted\(Assertion failed: native function `\w+` called after runtime exit/;
  const isac = async (files, args, outputs) => {
    const r = await runIsac({ createIsac, module, files, args, outputs });
    r.stderr = r.stderr.split('\n').filter(l => !NOISE.test(l)).join('\n');
    return r;
  };
  cached = { isac, manifest };
  return cached;
}
