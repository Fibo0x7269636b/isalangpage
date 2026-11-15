// Thin wrapper around the Emscripten build of isac (build-wasm/compiler/isac.mjs).
// isac is linked with EXIT_RUNTIME=1, so each invocation gets a fresh instance;
// the compiled WebAssembly.Module is reused and only instantiation is repeated.

export const WORKDIR = '/work';

/**
 * @param {object} opts
 * @param {Function} opts.createIsac        factory exported by isac.mjs
 * @param {WebAssembly.Module} opts.module  compiled isac.wasm
 * @param {Record<string,string>} opts.files  path (relative to /work) -> source
 * @param {string[]} opts.args              CLI arguments (paths relative to /work)
 * @param {string[]} [opts.outputs]         files to read back after the run
 */
export async function runIsac({ createIsac, module, files, args, outputs = [] }) {
  const stdout = [], stderr = [];
  const instance = await createIsac({
    noInitialRun: true,
    print: line => stdout.push(line),
    printErr: line => stderr.push(line),
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(module, imports).then(inst => done(inst, module));
      return {};
    },
  });
  const { FS } = instance;
  mkdirp(FS, WORKDIR);
  for (const [path, source] of Object.entries(files)) {
    const full = `${WORKDIR}/${path}`;
    const dir = full.slice(0, full.lastIndexOf('/'));
    if (dir !== WORKDIR) mkdirp(FS, dir);
    FS.writeFile(full, source);
  }
  FS.chdir(WORKDIR);
  let status;
  const started = performance.now();
  try {
    status = instance.callMain(args);
  } catch (error) {
    if (error?.name === 'ExitStatus') status = error.status;
    else {
      stderr.push(`isac: internal error: ${error?.message ?? error}`);
      status = 70;
    }
  }
  const elapsed = performance.now() - started;
  const read = {};
  for (const path of outputs) {
    try { read[path] = FS.readFile(`${WORKDIR}/${path}`); } catch { /* not produced */ }
  }
  return { status: status ?? 0, stdout: stdout.join('\n'), stderr: stderr.join('\n'), files: read, elapsed };
}

function mkdirp(FS, dir) {
  let current = '';
  for (const part of dir.split('/').filter(Boolean)) {
    current += '/' + part;
    try { FS.mkdir(current); } catch { /* exists */ }
  }
}

/**
 * Parses isac diagnostics. The compiler prints
 *   error[E0301]: use of moved value `a`
 *     --> /work/main.isa:4:11
 * followed by source excerpts, labels, notes and helps.
 */
export function parseDiagnostics(text) {
  const lines = text.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  const result = [];
  let current = null;
  const head = /^(error|warning|note|help)(?:\[([A-Z]\d+)\])?:\s*(.*)$/;
  const loc = /^\s*-->\s*(.+?):(\d+):(\d+)/;
  for (const line of lines) {
    const h = head.exec(line);
    if (h && !line.startsWith(' ')) {
      if (h[1] === 'note' || h[1] === 'help') {
        if (current) { current.notes.push(`${h[1]}: ${h[3]}`); continue; }
      }
      current = { severity: h[1] === 'warning' ? 'warning' : 'error', code: h[2] ?? null,
        message: h[3], file: null, line: null, column: null, notes: [], raw: [line] };
      result.push(current);
      continue;
    }
    if (!current) continue;
    current.raw.push(line);
    const l = loc.exec(line);
    if (l && current.line === null) {
      current.file = l[1].replace(`${WORKDIR}/`, '');
      current.line = Number(l[2]); current.column = Number(l[3]);
    }
    const n = /^\s*=\s*(note|help):\s*(.*)$/.exec(line);
    if (n) current.notes.push(`${n[1]}: ${n[2]}`);
  }
  return result;
}
