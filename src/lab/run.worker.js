// Execution worker: links an object from isac against the C runtime module and
// runs main(). Kept apart from the compiler so a runaway program can be stopped
// by terminating this worker alone.
import { runObject } from './engine/runner.js';

let createRuntime = null;
let module = null;
const OUTPUT_LIMIT = 1 << 20; // characters of stdout+stderr forwarded per run

async function init({ base }) {
  const manifest = await (await fetch(new URL('isac/manifest.json', base))).json();
  const wasmUrl = new URL(`isac/${manifest.runtime.wasm}`, base);
  const [loader, compiled] = await Promise.all([
    import(/* @vite-ignore */ new URL(`isac/${manifest.runtime.loader}`, base).href),
    WebAssembly.compileStreaming(fetch(wasmUrl)).catch(async () => WebAssembly.compile(await (await fetch(wasmUrl)).arrayBuffer())),
  ]);
  createRuntime = loader.default;
  module = compiled;
  return { bytes: manifest.runtime.bytes };
}

async function run(id, { object, stdin, args }) {
  if (!module) throw new Error('runtime não inicializado');
  let buffer = [], bufferedAt = performance.now(), forwarded = 0;
  const flush = () => {
    if (!buffer.length) return;
    postMessage({ id, type: 'stream', chunks: buffer });
    buffer = []; bufferedAt = performance.now();
  };
  const push = stream => text => {
    forwarded += text.length;
    if (forwarded > OUTPUT_LIMIT) throw new Error('limite de saída de 1 MiB excedido');
    buffer.push({ stream, text });
    if (performance.now() - bufferedAt > 32 || buffer.length > 200) flush();
  };
  const result = await runObject({ object, createRuntime, module, stdin, args, onStdout: push('stdout'), onStderr: push('stderr') });
  flush();
  return result;
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') postMessage({ id, type: 'result', result: await init(data) });
    else if (type === 'run') postMessage({ id, type: 'result', result: await run(id, data) });
    else throw new Error(`mensagem desconhecida: ${type}`);
  } catch (error) {
    postMessage({ id, type: 'error', message: error?.message ?? String(error) });
  }
};
