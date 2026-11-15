#!/usr/bin/env node
// Copies the WebAssembly build of isac into public/isac/ for the Lab.
//
//   isac.mjs        Emscripten loader (one patched line, see below)
//   isac.wasm.gz    compiler module, gzip -9; the Lab inflates it with DecompressionStream
//   manifest.json   sizes, hashes and toolchain versions shown in the Lab
//
// Source directory defaults to build-wasm/compiler; override with ISAC_WASM_DIR.
// The runtime module (isac-runtime.*) is produced by tools/runtime/build.sh.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, constants } from 'node:zlib';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const src = process.env.ISAC_WASM_DIR ?? join(root, 'build-wasm/compiler');
const out = join(root, 'public/isac');
await mkdir(out, { recursive: true });

const sha256 = b => createHash('sha256').update(b).digest('hex');

// The build was linked with -sENVIRONMENT=web,node. The loader already handles
// workers (fetch-based readAsync, no DOM access), but an assertion rejects them.
// The Lab runs the compiler in a module worker so compilation never blocks the
// page. Remove only that assertion; upstream fix: add `worker` to -sENVIRONMENT.
const WORKER_ASSERT = "assert(!ENVIRONMENT_IS_WORKER, 'worker environment detected but not enabled at build time (add `worker` to `-sENVIRONMENT` to enable)');";
let loader = await readFile(join(src, 'isac.mjs'), 'utf8');
if (loader.includes(WORKER_ASSERT)) {
  loader = loader.replace(WORKER_ASSERT, '/* isalang-site: worker assertion removed by scripts/sync-compiler.mjs */');
} else if (!loader.includes('isalang-site: worker assertion removed')) {
  console.warn('warning: worker assertion not found; check whether the loader now supports workers');
}
await writeFile(join(out, 'isac.mjs'), loader);

const wasm = await readFile(join(src, 'isac.wasm'));
const gz = gzipSync(wasm, { level: constants.Z_BEST_COMPRESSION });
await writeFile(join(out, 'isac.wasm.gz'), gz);

const runtimeWasm = await readFile(join(out, 'isac-runtime.wasm')).catch(() => null);
const validation = JSON.parse(await readFile(join(src, '../validation.json'), 'utf8').catch(() => '{}'));
const manifest = {
  generated: new Date().toISOString(),
  compiler: {
    wasm: 'isac.wasm.gz', loader: 'isac.mjs',
    bytes: wasm.length, gzipBytes: gz.length, sha256: sha256(wasm),
    built: (await stat(join(src, 'isac.wasm'))).mtime.toISOString(),
    validated: validation.compiler_wasm_sha256 === sha256(wasm),
  },
  runtime: runtimeWasm ? { wasm: 'isac-runtime.wasm', loader: 'isac-runtime.mjs', bytes: runtimeWasm.length, sha256: sha256(runtimeWasm) } : null,
  toolchain: validation.toolchain ?? null,
  target: 'wasm32-unknown-emscripten',
};
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`isac.wasm ${(wasm.length / 1048576).toFixed(1)} MiB -> gzip ${(gz.length / 1048576).toFixed(1)} MiB`);
console.log(`sha256 ${manifest.compiler.sha256} (matches validation.json: ${manifest.compiler.validated})`);
