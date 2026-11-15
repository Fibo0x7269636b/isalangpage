// Runs a program object produced by isac against the browser build of the
// Isalang C runtime (tools/runtime/build.sh). A fresh runtime instance is
// created per run, so allocator state and counters never leak between runs.
import { parseObject, instantiateObject, LinkError } from './wasm-object.js';

/**
 * @param {object} opts
 * @param {Uint8Array} opts.object            relocatable object from `isac --emit-obj`
 * @param {Function} opts.createRuntime       factory exported by isac-runtime.mjs
 * @param {WebAssembly.Module} [opts.module]  precompiled isac-runtime.wasm
 * @param {string} [opts.stdin]
 * @param {string[]} [opts.args]              argv[1..]; argv[0] is "program"
 */
export async function runObject({ object, createRuntime, module, stdin = '', args = [], onStdout, onStderr }) {
  const out = [], err = [];
  const input = new TextEncoder().encode(stdin);
  let inputPos = 0;
  const runtime = await createRuntime({
    print: line => { out.push(line); onStdout?.(line + '\n'); },
    printErr: line => { err.push(line); onStderr?.(line + '\n'); },
    stdin: () => (inputPos < input.length ? input[inputPos++] : null),
    ...(module ? { instantiateWasm(imports, done) {
      WebAssembly.instantiate(module, imports).then(inst => done(inst, module));
      return {};
    } } : {}),
  });
  const { instance } = await instantiateObject(parseObject(object), runtime);

  const argv = ['program', ...args];
  const argvPtr = runtime._malloc(4 * (argv.length + 1));
  const view = () => new DataView(runtime.wasmMemory.buffer);
  argv.forEach((arg, i) => {
    const size = runtime.lengthBytesUTF8(arg) + 1;
    const ptr = runtime._malloc(size);
    runtime.stringToUTF8(arg, ptr, size);
    view().setUint32(argvPtr + 4 * i, ptr, true);
  });
  view().setUint32(argvPtr + 4 * argv.length, 0, true);

  let exitCode = null, trap = null;
  const started = performance.now();
  try {
    exitCode = instance.exports.main(argv.length, argvPtr);
  } catch (error) {
    if (error?.name === 'ExitStatus') exitCode = error.status;
    else trap = describeTrap(error);
  }
  const elapsed = performance.now() - started;
  try { runtime._fflush(0); } catch { /* runtime aborted */ }
  let allocations = null, frees = null;
  try { allocations = runtime._isac_rt_test_allocations(); frees = runtime._isac_rt_test_frees(); } catch { /* aborted */ }
  return { exitCode, trap, stdout: out.join('\n'), stderr: err.join('\n'), elapsed, allocations, frees };
}

function describeTrap(error) {
  const message = String(error?.message ?? error);
  if (/^Aborted/.test(message)) return { kind: 'abort', message: 'programa abortado (panic)' };
  if (error instanceof WebAssembly.RuntimeError) return { kind: 'trap', message };
  if (error instanceof LinkError) return { kind: 'link', message };
  return { kind: 'error', message };
}
