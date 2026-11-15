// Session-wide Lab controller. Imported by the header on every page, so it must
// stay small: workers and the compiler are created only by startLab().
// Astro's ClientRouter keeps this module alive across navigations, so the
// compiler is loaded at most once per tab session.

const BASE = new URL(import.meta.env.BASE_URL.replace(/\/?$/, '/'), globalThis.location?.href ?? 'http://localhost/').href;

function store(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set(patch) { value = { ...value, ...patch }; subs.forEach(fn => fn(value)); },
    subscribe(fn) { subs.add(fn); fn(value); return () => subs.delete(fn); },
  };
}

/** state: idle | loading | ready | error */
export const labStatus = store({ state: 'idle', percent: null, steps: {}, error: null, info: null });

let compilerWorker = null;
let runWorker = null;
let readyPromise = null;
let seq = 0;
const pending = new Map();

function setStep(name, patch) {
  const steps = { ...labStatus.get().steps };
  steps[name] = { ...(steps[name] ?? {}), ...patch };
  labStatus.set({ steps });
}

function handle(event) {
  const msg = event.data;
  if (msg.type === 'progress') {
    setStep(msg.step, msg);
    if (msg.step === 'download' && msg.total) labStatus.set({ percent: Math.min(99, Math.floor((msg.loaded / msg.total) * 100)) });
    return;
  }
  const entry = pending.get(msg.id);
  if (!entry) return;
  if (msg.type === 'stream') { entry.onStream?.(msg); return; }
  pending.delete(msg.id);
  if (msg.type === 'error') entry.reject(new Error(msg.message));
  else entry.resolve(msg.result);
}

function call(worker, type, payload = {}, { onStream } = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onStream, worker });
    worker.postMessage({ id, type, ...payload });
  });
}

function failPending(worker, message) {
  for (const [id, entry] of pending) if (entry.worker === worker) { pending.delete(id); entry.reject(new Error(message)); }
}

function createWorker(file, name) {
  const w = file === 'compiler'
    ? new Worker(new URL('./compiler.worker.js', import.meta.url), { type: 'module', name })
    : new Worker(new URL('./run.worker.js', import.meta.url), { type: 'module', name });
  w.onmessage = handle;
  w.onerror = e => { e.preventDefault?.(); failPending(w, e.message || `falha no worker ${name}`); };
  return w;
}

/** Starts (or returns) the compiler session. Safe to call repeatedly. */
export function startLab() {
  if (readyPromise) return readyPromise;
  labStatus.set({ state: 'loading', percent: 0, steps: {}, error: null });
  compilerWorker = createWorker('compiler', 'isalang-compiler');
  runWorker = createWorker('run', 'isalang-run');
  const started = performance.now();
  readyPromise = Promise.all([call(compilerWorker, 'init', { base: BASE }), call(runWorker, 'init', { base: BASE })])
    .then(([info]) => {
      const result = { ...info, totalMs: Math.round(performance.now() - started) };
      labStatus.set({ state: 'ready', percent: 100, info: result });
      return result;
    }).catch(error => {
      compilerWorker?.terminate(); runWorker?.terminate();
      compilerWorker = runWorker = null;
      readyPromise = null;
      labStatus.set({ state: 'error', error: error.message, percent: null });
      throw error;
    });
  return readyPromise;
}

/** Runs isac with the given files. Returns {status, stdout, stderr, files, elapsed}. */
export async function compile({ files, args, outputs }) {
  await startLab();
  return call(compilerWorker, 'compile', { files, args, outputs });
}

/**
 * Executes an object file in the run worker. onStream receives {chunks}.
 * Cancel or timeout replaces the run worker; the compiler is unaffected.
 */
export async function run({ object, stdin, args, timeoutMs = 10000, onStream }) {
  await startLab();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      cancelRun();
      reject(Object.assign(new Error(`tempo limite de ${timeoutMs / 1000} s excedido; execução interrompida`), { kind: 'timeout' }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([call(runWorker, 'run', { object, stdin, args }, { onStream }), timeout]);
  } finally { clearTimeout(timer); }
}

export function cancelRun() {
  if (!runWorker) return;
  const old = runWorker;
  old.terminate();
  failPending(old, 'execução interrompida');
  runWorker = createWorker('run', 'isalang-run');
  call(runWorker, 'init', { base: BASE }).catch(() => {});
}
