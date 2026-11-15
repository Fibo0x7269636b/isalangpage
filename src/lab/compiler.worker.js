// Compiler worker: downloads isac.wasm.gz once, compiles it while it streams,
// and serves compile requests. Each request gets a fresh Emscripten instance
// (isac is linked with EXIT_RUNTIME=1) built from the same WebAssembly.Module.
import { runIsac } from './engine/compiler.js';

let createIsac = null;
let module = null;

const progress = (step, data) => postMessage({ type: 'progress', step, ...data });

async function fetchManifest(base) {
  const res = await fetch(new URL('isac/manifest.json', base), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
  return res.json();
}

async function loadModule(base, manifest) {
  const url = new URL(`isac/${manifest.compiler.wasm}`, base);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${manifest.compiler.wasm}: HTTP ${res.status}`);
  if (!res.body || typeof DecompressionStream === 'undefined')
    throw new Error('este navegador não oferece DecompressionStream; use uma versão recente de Chrome, Firefox ou Safari');
  // Some servers (Vite preview, nginx with gzip_static) send *.gz with
  // Content-Encoding: gzip, so the browser already inflated the body. Sniff
  // the magic number instead of trusting headers: 1f 8b = gzip, 00 61 73 6d = wasm.
  const reader = res.body.getReader();
  const first = await reader.read();
  if (first.done) throw new Error(`${manifest.compiler.wasm}: resposta vazia`);
  const head = first.value;
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  if (!gzipped && !(head[0] === 0 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d))
    throw new Error(`${manifest.compiler.wasm}: conteúdo inesperado (nem gzip nem WebAssembly)`);
  const total = gzipped ? manifest.compiler.gzipBytes : manifest.compiler.bytes;
  let loaded = 0, last = 0;
  const report = (state) => progress('download', { state, loaded, total, gzipped });
  const body = new ReadableStream({
    start(controller) { loaded += head.byteLength; controller.enqueue(head); },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { report('done'); controller.close(); return; }
      loaded += value.byteLength;
      const now = performance.now();
      if (now - last > 50) { last = now; report('active'); }
      controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  const inflated = gzipped ? body.pipeThrough(new DecompressionStream('gzip')) : body;
  progress('compile', { state: 'active' });
  const started = performance.now();
  let compiled;
  try {
    compiled = await WebAssembly.compileStreaming(new Response(inflated, { headers: { 'Content-Type': 'application/wasm' } }));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // Older engines reject synthetic Responses; buffer and compile instead.
    const again = await fetch(url);
    const bytes = await new Response(gzipped ? again.body.pipeThrough(new DecompressionStream('gzip')) : again.body).arrayBuffer();
    compiled = await WebAssembly.compile(bytes);
  }
  progress('compile', { state: 'done', ms: Math.round(performance.now() - started) });
  return compiled;
}

async function init({ base }) {
  progress('manifest', { state: 'active' });
  const manifest = await fetchManifest(base);
  progress('manifest', { state: 'done', manifest });
  const [mod, loader] = await Promise.all([
    loadModule(base, manifest),
    import(/* @vite-ignore */ new URL(`isac/${manifest.compiler.loader}`, base).href),
  ]);
  module = mod;
  createIsac = loader.default;
  progress('selftest', { state: 'active' });
  const probe = await runIsac({ createIsac, module, files: {}, args: ['--print-target'] });
  if (probe.status !== 0) throw new Error(`autoteste falhou: ${probe.stderr || 'isac --print-target retornou ' + probe.status}`);
  progress('selftest', { state: 'done', target: probe.stdout.trim(), ms: Math.round(probe.elapsed) });
  return { manifest, target: probe.stdout.trim() };
}

// The Emscripten build prints this after exit() when an assertion-enabled
// libc call races teardown. It is noise for the user.
const NOISE = /^Aborted\(Assertion failed: native function `\w+` called after runtime exit/;

async function compile({ files, args, outputs }) {
  if (!module) throw new Error('compilador não inicializado');
  const result = await runIsac({ createIsac, module, files, args, outputs });
  result.stderr = result.stderr.split('\n').filter(l => !NOISE.test(l)).join('\n');
  const transfer = Object.values(result.files).map(f => f.buffer);
  return { result, transfer };
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') postMessage({ id, type: 'result', result: await init(data) });
    else if (type === 'compile') {
      const { result, transfer } = await compile(data);
      postMessage({ id, type: 'result', result }, transfer);
    } else throw new Error(`mensagem desconhecida: ${type}`);
  } catch (error) {
    postMessage({ id, type: 'error', message: error?.message ?? String(error) });
  }
};
