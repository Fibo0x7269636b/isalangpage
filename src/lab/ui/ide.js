// Lab IDE. Loaded with import() only after the compiler session is ready.
// Workspace state lives at module level so it survives client-side navigation.
//
// Programs are compiled with isac.wasm (--emit-obj) and executed by linking the
// object against the Isalang C runtime built for the browser (run.worker.js).
// Diagnostics caused by features the WebAssembly build lacks are labelled as
// "não funciona no laboratório".
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, highlightSpecialChars, rectangularSelection, dropCursor } from '@codemirror/view';
import { defaultKeymap, history as cmHistory, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, indentUnit } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { isalang, isalangHighlight, irLanguage, irHighlight } from './isalang-language.js';
import { compile, run, cancelRun, labStatus } from '../client.js';
import { UNSUPPORTED } from '../../data/example-meta.js';
import { parseDiagnostics } from '../engine/compiler.js';
import examplesData from '../../data/lab-examples.json';

const STORAGE_KEY = 'isalang-lab-workspace-v3';
const examples = examplesData.entries;
const byId = new Map(examples.map(e => [e.id, e]));

export const STAGES = [
  { id: 'tokens', label: 'tokens', flag: '--emit-tokens' },
  { id: 'ast', label: 'AST', flag: '--emit-ast' },
  { id: 'expanded', label: 'expandido', flag: '--emit-expanded' },
  { id: 'hir', label: 'HIR', flag: '--emit-hir' },
  { id: 'core', label: 'Core', flag: '--emit-core' },
  { id: 'erased', label: 'erased', flag: '--emit-erased' },
  { id: 'lir', label: 'LIR', flag: '--emit-lir' },
  { id: 'mlir', label: 'MLIR isac', flag: '--emit-mlir' },
  { id: 'std-mlir', label: 'MLIR std', flag: '--emit-std-mlir' },
  { id: 'llvm-dialect', label: 'MLIR llvm', flag: '--emit-llvm-dialect' },
  { id: 'llvm', label: 'LLVM IR', flag: '--emit-llvm' },
  { id: 'asm', label: 'assembly', flag: '--emit-asm', file: 'out.s' },
];
const TARGETS = { wasm32: 'wasm32-unknown-emscripten', x86_64: 'x86_64-unknown-linux-gnu' };
const OPT_STAGES = ['mlir', 'std-mlir', 'llvm-dialect', 'llvm', 'asm'];
const TARGET_STAGES = ['llvm-dialect', 'llvm', 'asm'];

// ---------------------------------------------------------------- state
const ws = loadWorkspace();
let view = null, irView = null, root = null;
const editorStates = new Map();
let busy = false;

function fromExample(ex) {
  return { files: { ...ex.files }, main: ex.main, active: ex.main, exampleId: ex.id,
    stdin: ex.stdin ?? '', args: (ex.args ?? []).join(' '), opt: '-O0', stage: 'core', target: 'wasm32', panel: 'terminal' };
}
function defaultWorkspace() {
  return fromExample(byId.get('connection.isa') ?? examples[0]);
}
function loadWorkspace() {
  const ex = byId.get(new URLSearchParams(location.search).get('example'));
  if (ex) return fromExample(ex);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.files && saved.main in saved.files) return { ...defaultWorkspace(), ...saved };
  } catch { /* storage unavailable */ }
  return defaultWorkspace();
}
function saveWorkspace() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ws)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- editor
const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'var(--bg-1)', color: 'var(--fg)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--own)', padding: '10px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--own)', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'var(--bg-1)', color: 'var(--fg-dim)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-2)', color: 'var(--fg-muted)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--bg-2) 70%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in srgb, var(--own) 22%, transparent) !important' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--shared) 18%, transparent)' },
  '.cm-matchingBracket': { outline: '1px solid var(--fg-dim)', backgroundColor: 'transparent' },
  '.cm-panels': { backgroundColor: 'var(--bg-2)', color: 'var(--fg)', borderColor: 'var(--line)' },
  '.cm-panel input, .cm-panel button': { fontFamily: 'var(--font-mono)', fontSize: '12px' },
  '.cm-textfield': { backgroundColor: 'var(--bg)', border: '1px solid var(--line-strong)', color: 'var(--fg)' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--bg-3)', border: '1px solid var(--line-strong)', color: 'var(--fg)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--own) 25%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-2)', border: '1px solid var(--line-strong)', color: 'var(--fg)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--err)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--err)', textUnderlineOffset: '3px' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-3)', border: 'none', color: 'var(--fg-muted)' },
}, { dark: true });

let saveTimer, irTimer;
function editorExtensions() {
  return [
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), cmHistory(), foldGutter(),
    drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true), indentOnInput(),
    bracketMatching(), closeBrackets(), rectangularSelection(), highlightActiveLine(),
    highlightSelectionMatches(), search({ top: true }), lintGutter(),
    indentUnit.of('  '), EditorState.tabSize.of(2), isalang, isalangHighlight, editorTheme,
    keymap.of([
      { key: 'Mod-Enter', run: () => { runProgram(); return true; } },
      { key: 'Mod-Shift-Enter', run: () => { checkProgram(); return true; } },
      { key: 'Mod-s', run: () => { checkProgram(); return true; } },
      ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab,
    ]),
    EditorView.updateListener.of(u => {
      if (!u.docChanged) return;
      ws.files[ws.active] = u.state.doc.toString();
      if (ws.exampleId) $('[data-modified]').hidden = ws.files[ws.active] === byId.get(ws.exampleId)?.files[ws.active];
      clearTimeout(saveTimer); saveTimer = setTimeout(saveWorkspace, 400);
      if (ws.panel === 'ir') { clearTimeout(irTimer); irTimer = setTimeout(() => ensureIR(), 700); }
      updateInputHint();
    }),
    EditorView.contentAttributes.of({ 'aria-label': 'Editor de código Isalang' }),
  ];
}

function stateFor(name) {
  if (!editorStates.has(name)) editorStates.set(name, EditorState.create({ doc: ws.files[name] ?? '', extensions: editorExtensions() }));
  return editorStates.get(name);
}
function switchFile(name) {
  if (view) editorStates.set(ws.active, view.state);
  ws.active = name;
  view.setState(stateFor(name));
  renderTabs();
  applyDiagnostics(lastDiagnostics);
  saveWorkspace();
}

// ---------------------------------------------------------------- dom helpers
const $ = sel => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
};

// Example files are fixed: imports in examples/ need them, so they appear as tabs.
function renderTabs() {
  const names = Object.keys(ws.files).sort((a, b) => (a === ws.main ? -1 : b === ws.main ? 1 : a.localeCompare(b)));
  $('[data-tabs]').replaceChildren(...names.map(name =>
    el('button', { type: 'button', role: 'tab', class: 'tab' + (name === ws.active ? ' active' : ''), 'aria-selected': String(name === ws.active),
      onclick: () => switchFile(name), title: name === ws.main ? 'arquivo de entrada' : name },
      name === ws.main ? el('span', { class: 'entry', 'aria-hidden': 'true' }, '▸') : null, name)));
}

// ---------------------------------------------------------------- examples
const STATUS_LABEL = { rejected: ' — rejeitado de propósito' };
function renderExamples() {
  const select = $('[data-example]');
  const groups = new Map();
  for (const ex of examples) {
    const key = ex.featured ? 'Destaques' : ex.categoryLabel;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ex);
  }
  select.replaceChildren(...[...groups].map(([label, list]) =>
    el('optgroup', { label }, list.map(ex => el('option', { value: ex.id }, ex.title + (STATUS_LABEL[ex.status] ?? ''))))));
  select.value = ws.exampleId ?? '';
  select.onchange = () => {
    const ex = byId.get(select.value);
    if (!ex) return;
    Object.assign(ws, fromExample(ex), { opt: ws.opt, stage: ws.stage, target: ws.target, panel: ws.panel });
    $('[data-modified]').hidden = true;
    $('[data-stdin]').value = ws.stdin;
    $('[data-args]').value = ws.args;
    editorStates.clear();
    updateInputHint();
    view.setState(stateFor(ws.active));
    renderTabs();
    showExampleInfo(ex);
    clearOutputs();
    saveWorkspace();
    if (ws.panel === 'ir') ensureIR();
    history.replaceState(history.state, '', `${location.pathname}?example=${encodeURIComponent(ex.id)}`);
  };
  showExampleInfo(byId.get(ws.exampleId));
}
function showExampleInfo(ex) {
  const box = $('[data-example-info]');
  if (!ex) { box.hidden = true; return; }
  box.hidden = false;
  const note = ex.status === 'rejected' ? `Programa inválido de propósito: o checker o rejeita com ${ex.diagnosticCode}.` : null;
  box.replaceChildren(...[
    el('span', { class: 'path mono' }, `examples/${ex.id}`),
    ex.summary ? el('span', { class: 'summary' }, ex.summary) : null,
    note ? el('span', { class: 'note' }, note) : null].filter(Boolean));
}

// Highlights the stdin box when any workspace file calls @input.
function updateInputHint() {
  if (!root) return;
  const reads = Object.values(ws.files).some(text => /@input\b/.test(text));
  $('[data-reads-input]').hidden = !reads;
  $('[data-stdin-dock]').dataset.active = String(reads);
}

// ---------------------------------------------------------------- terminal
let term;
function termWrite(text, cls = '') {
  const last = term.lastElementChild;
  if (last && last.tagName === 'SPAN' && last.dataset.cls === cls) { last.textContent += text; }
  else {
    const span = el('span', { class: cls || null, 'data-cls': cls });
    span.textContent = text;
    term.append(span);
  }
  const pane = term.parentElement;
  if (pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80) pane.scrollTop = pane.scrollHeight;
}
function clearOutputs() {
  term.replaceChildren();
  setProblems([]);
  lastDiagnostics = [];
  applyDiagnostics([]);
  setStatus({});
}

// ---------------------------------------------------------------- diagnostics
let lastDiagnostics = [];
function applyDiagnostics(list) {
  if (!view) return;
  const doc = view.state.doc;
  const items = list.filter(d => d.line && (d.file ?? ws.main) === ws.active && d.line <= doc.lines).map(d => {
    const line = doc.line(d.line);
    const from = Math.min(line.from + Math.max(0, d.column - 1), line.to);
    const word = /^[\w@$]+/.exec(line.text.slice(from - line.from))?.[0].length ?? 1;
    return { from, to: Math.min(line.to, from + Math.max(1, word)), severity: d.severity, message: [d.code ? `${d.code}: ${d.message}` : d.message, ...d.notes].join('\n') };
  });
  view.dispatch(setDiagnostics(view.state, items));
}
function setProblems(list) {
  const box = $('[data-problems]');
  const count = $('[data-problem-count]');
  count.textContent = list.length ? String(list.length) : '';
  count.hidden = !list.length;
  if (!list.length) { box.replaceChildren(el('p', { class: 'empty' }, 'Nenhum diagnóstico.')); return; }
  box.replaceChildren(...list.map(d => el('button', { type: 'button', class: `problem ${d.severity}`, onclick: () => gotoDiagnostic(d) },
    el('span', { class: 'sev mono' }, d.code ?? d.severity),
    el('span', { class: 'msg' }, d.message),
    d.line ? el('span', { class: 'loc mono' }, `${d.file ?? ws.main}:${d.line}:${d.column}`) : null,
    d.notes.length ? el('span', { class: 'notes' }, d.notes.join('\n')) : null)));
}
function gotoDiagnostic(d) {
  if (!d.line) return;
  const file = d.file && d.file in ws.files ? d.file : ws.main;
  if (file !== ws.active) switchFile(file);
  const line = view.state.doc.line(Math.min(d.line, view.state.doc.lines));
  view.dispatch({ selection: { anchor: Math.min(line.from + Math.max(0, d.column - 1), line.to) }, scrollIntoView: true });
  view.focus();
}

// ---------------------------------------------------------------- status
function setStatus({ compileMs, runMs, alloc, exit, message, tone }) {
  const parts = [];
  if (message) parts.push(el('span', { class: tone ?? '' }, message));
  if (compileMs != null) parts.push(el('span', {}, `compilação ${Math.round(compileMs)} ms`));
  if (runMs != null) parts.push(el('span', {}, `execução ${runMs < 10 ? runMs.toFixed(1) : Math.round(runMs)} ms`));
  if (alloc) parts.push(el('span', { class: alloc[0] === alloc[1] ? 'ok' : 'warn', title: 'contadores do runtime (ISAC_RT_TESTING)' }, `alocações ${alloc[0]} · liberações ${alloc[1]}`));
  if (exit != null) parts.push(el('span', { class: exit === 0 ? '' : 'warn' }, `exit ${exit}`));
  $('[data-status]').replaceChildren(...parts);
}
function setBusy(on, running = false) {
  busy = on;
  root.dataset.busy = String(on);
  $('[data-run]').disabled = on;
  $('[data-check]').disabled = on;
  $('[data-stop]').hidden = !running;
}
function showPanel(name) {
  ws.panel = name;
  root.querySelectorAll('[data-panel-tab]').forEach(b => {
    const active = b.dataset.panelTab === name;
    b.setAttribute('aria-selected', String(active));
    b.tabIndex = active ? 0 : -1;
  });
  root.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
  if (name === 'ir') ensureIR();
}

// ---------------------------------------------------------------- actions
const cliLine = args => 'isac ' + args.join(' ');

// On narrow screens the output sits below the editor; bring it into view.
const stacked = () => matchMedia('(max-width: 900px)').matches;
function revealOutput() {
  if (!stacked()) return;
  const pane = root.querySelector('.output-pane');
  if (pane.getBoundingClientRect().top > innerHeight * 0.6) pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function runCompiler(args, outputs = [], { keepBusy = false } = {}) {
  clearOutputs();
  showPanel('terminal');
  revealOutput();
  termWrite(`$ ${cliLine(args)}\n`, 'cmd');
  setBusy(true);
  let ok = false;
  try {
    const r = await compile({ files: { ...ws.files }, args, outputs });
    const diags = parseDiagnostics(r.stderr);
    lastDiagnostics = diags;
    setProblems(diags);
    applyDiagnostics(diags);
    if (r.stderr) termWrite(r.stderr + '\n', 'err');
    if (r.status !== 0) {
      const reason = UNSUPPORTED[diags[0]?.code];
      const unsupported = !!reason;
      if (unsupported) termWrite(`\n${reason}\n`, 'warn');
      setStatus({ compileMs: r.elapsed, message: unsupported ? 'não funciona no laboratório' : `rejeitado (${diags.length || 1} erro${diags.length > 1 ? 's' : ''})`, tone: unsupported ? 'warn' : 'err' });
      if (diags.length && !unsupported) showPanel('problems');
    }
    ok = r.status === 0;
    return r;
  } catch (e) {
    termWrite(`erro do Lab: ${e.message}\n`, 'err');
    return null;
  } finally { if (!(keepBusy && ok)) setBusy(false); }
}

async function checkProgram() {
  if (busy) return;
  const r = await runCompiler([ws.main, '--check', '--color=never']);
  if (r?.status === 0) { termWrite('verificação concluída sem erros\n', 'ok'); setStatus({ compileMs: r.elapsed, message: 'verificado', tone: 'ok' }); }
}

async function runProgram() {
  if (busy) return;
  const compiled = await runCompiler([ws.main, '--emit-obj', '-o', 'program.o', ws.opt, '--color=never'], ['program.o'], { keepBusy: true });
  const object = compiled?.files?.['program.o'];
  if (compiled?.status !== 0 || !object) return;
  const argv = ws.args.trim() ? ws.args.trim().split(/\s+/) : [];
  if (!ws.stdin && Object.values(ws.files).some(text => /@input\b/.test(text)))
    termWrite('aviso: o programa usa @input e a caixa “Entrada do programa” está vazia; a leitura vai receber fim de arquivo\n', 'warn');
  termWrite(`$ ${['./program', ...argv].join(' ')}${ws.stdin ? ' < stdin' : ''}\n`, 'cmd');
  setBusy(true, true);
  try {
    const r = await run({ object, stdin: ws.stdin, args: argv,
      onStream: msg => msg.chunks.forEach(c => termWrite(c.text, c.stream === 'stderr' ? 'err' : '')) });
    if (r.trap) termWrite(`\n${r.trap.kind === 'abort' ? 'abortado' : r.trap.kind === 'link' ? 'erro de ligação' : 'trap'}: ${r.trap.message}\n`, 'err');
    termWrite(`\n[exit ${r.exitCode ?? '—'}]\n`, 'meta');
    setStatus({ compileMs: compiled.elapsed, runMs: r.elapsed, alloc: r.allocations != null ? [r.allocations, r.frees] : null,
      exit: r.exitCode, message: r.trap ? 'falhou na execução' : null, tone: 'err' });
  } catch (e) {
    termWrite(`\n${e.message}\n`, 'err');
    setStatus({ compileMs: compiled.elapsed, message: e.kind === 'timeout' ? 'tempo limite' : 'interrompido', tone: 'warn' });
  } finally { setBusy(false); }
}

// ---------------------------------------------------------------- IR view
let irToken = 0, irShownKey = null;
const irCache = new Map();
const irKey = () => JSON.stringify([ws.files, ws.main, ws.stage, ws.opt, ws.target]);

function renderStages() {
  $('[data-stages]').replaceChildren(...STAGES.map(s => el('button', { type: 'button', class: 'chip mono', 'aria-pressed': String(s.id === ws.stage),
    onclick: () => { ws.stage = s.id; renderStages(); ensureIR(true); saveWorkspace(); } }, s.label)));
  const target = $('[data-target]');
  target.value = ws.target;
  target.disabled = !TARGET_STAGES.includes(ws.stage);
}

async function ensureIR(force = false) {
  const key = irKey();
  if (!force && irShownKey === key) return;
  const stage = STAGES.find(s => s.id === ws.stage);
  const args = [ws.main, stage.flag, '--color=never'];
  if (OPT_STAGES.includes(stage.id)) args.push(ws.opt);
  if (TARGET_STAGES.includes(stage.id) && ws.target !== 'wasm32') args.push(`--target=${TARGETS[ws.target]}`);
  if (stage.file) args.push('-o', stage.file);
  $('[data-ir-cmd]').textContent = cliLine(args);
  const token = ++irToken;
  let text = irCache.get(key);
  if (text === undefined) {
    setIR('// compilando…');
    $('[data-ir-size]').textContent = '';
    try {
      const r = await compile({ files: { ...ws.files }, args, outputs: stage.file ? [stage.file] : [] });
      if (token !== irToken) return;
      if (r.status !== 0) text = `// isac terminou com status ${r.status}\n\n${r.stderr}`;
      else {
        text = stage.file ? new TextDecoder().decode(r.files[stage.file]) : r.stdout;
        irCache.set(key, text);
        if (irCache.size > 24) irCache.delete(irCache.keys().next().value);
      }
    } catch (e) { text = `// erro: ${e.message}`; }
  }
  if (token !== irToken) return;
  setIR(text);
  $('[data-ir-size]').textContent = `${text.split('\n').length} linhas`;
  irShownKey = key;
}
function setIR(text) { irView.dispatch({ changes: { from: 0, to: irView.state.doc.length, insert: text } }); }

// ---------------------------------------------------------------- mount
export function mountIDE(container) {
  root = container;
  view?.destroy(); irView?.destroy();
  editorStates.clear();
  term = $('[data-terminal]');
  view = new EditorView({ state: stateFor(ws.active), parent: $('[data-editor]') });
  irView = new EditorView({
    parent: $('[data-ir]'),
    state: EditorState.create({ doc: '', extensions: [lineNumbers(), foldGutter(), highlightActiveLine(), search({ top: true }),
      keymap.of([...searchKeymap, ...foldKeymap, ...defaultKeymap]), EditorState.readOnly.of(true), EditorView.editable.of(false),
      irLanguage, irHighlight, editorTheme, EditorView.contentAttributes.of({ 'aria-label': 'Representação intermediária' })] }),
  });
  irShownKey = null;

  renderTabs();
  renderExamples();
  renderStages();
  $('[data-modified]').hidden = !ws.exampleId || ws.files[ws.main] === byId.get(ws.exampleId)?.files[ws.main];
  $('[data-opt]').value = ws.opt;
  $('[data-opt]').onchange = e => { ws.opt = e.target.value; saveWorkspace(); if (ws.panel === 'ir') ensureIR(); };
  $('[data-target]').onchange = e => { ws.target = e.target.value; saveWorkspace(); ensureIR(); };
  $('[data-run]').onclick = runProgram;
  $('[data-stop]').onclick = () => cancelRun();
  $('[data-check]').onclick = checkProgram;
  $('[data-stdin]').value = ws.stdin ?? '';
  $('[data-stdin]').oninput = e => { ws.stdin = e.target.value; saveWorkspace(); };
  $('[data-args]').value = ws.args ?? '';
  $('[data-args]').oninput = e => { ws.args = e.target.value; saveWorkspace(); };
  updateInputHint();
  $('[data-clear]').onclick = clearOutputs;
  $('[data-ir-copy]').onclick = async () => { try { await navigator.clipboard.writeText(irView.state.doc.toString()); } catch { /* ignore */ } };
  root.querySelectorAll('[data-panel-tab]').forEach(b => { b.onclick = () => showPanel(b.dataset.panelTab); });
  root.querySelector('[data-panel-tabs]').onkeydown = e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = [...root.querySelectorAll('[data-panel-tab]')];
    const i = tabs.findIndex(t => t.dataset.panelTab === ws.panel);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    showPanel(next.dataset.panelTab); next.focus();
  };
  const info = labStatus.get().info;
  if (info) $('[data-target-info]').textContent = `isac · ${info.target}`;
  showPanel(ws.panel ?? 'terminal');
  setBusy(false);
  setStatus({ message: matchMedia('(pointer: coarse)').matches ? 'pronto' : 'pronto · Ctrl+Enter executa, Ctrl+Shift+Enter verifica' });
  // Fonts load after the first measure; re-measure so gutters line up.
  document.fonts?.ready.then(() => { view.requestMeasure(); irView.requestMeasure(); });
  // Focusing on a phone would open the keyboard over the page.
  if (matchMedia('(pointer: fine)').matches) view.focus();
}

export function unmountIDE() {
  if (view) { ws.files[ws.active] = view.state.doc.toString(); saveWorkspace(); view.destroy(); view = null; }
  irView?.destroy(); irView = null;
}
