// Loader for relocatable WebAssembly objects emitted by `isac --emit-obj`.
//
// isac.wasm cannot run wasm-ld, so the Lab does the minimum a static linker
// would do for a single object:
//   * data segments are copied into the runtime's linear memory at `base`;
//   * absolute memory relocations are rebased (relative ones use __memory_base);
//   * linking/reloc/data sections are dropped and `main` is exported;
//   * undefined functions are resolved against the C runtime module exports.
// Function and global indices already hold their final values, because LLVM
// writes provisional values that are valid for a module linked on its own.
//
// Format reference: https://github.com/WebAssembly/tool-conventions/blob/main/Linking.md

const SECTION = { custom: 0, type: 1, import: 2, function: 3, table: 4, memory: 5, global: 6,
  export: 7, start: 8, element: 9, code: 10, data: 11, datacount: 12, tag: 13 };

// Relocation types (tool-conventions, Linking.md).
const R = {
  FUNCTION_INDEX_LEB: 0, TABLE_INDEX_SLEB: 1, TABLE_INDEX_I32: 2, MEMORY_ADDR_LEB: 3,
  MEMORY_ADDR_SLEB: 4, MEMORY_ADDR_I32: 5, TYPE_INDEX_LEB: 6, GLOBAL_INDEX_LEB: 7,
  FUNCTION_OFFSET_I32: 8, SECTION_OFFSET_I32: 9, TAG_INDEX_LEB: 10, MEMORY_ADDR_REL_SLEB: 11,
  TABLE_INDEX_REL_SLEB: 12, GLOBAL_INDEX_I32: 13, MEMORY_ADDR_LEB64: 14, MEMORY_ADDR_SLEB64: 15,
  MEMORY_ADDR_I64: 16, MEMORY_ADDR_REL_SLEB64: 17, TABLE_INDEX_SLEB64: 18, TABLE_INDEX_I64: 19,
  TABLE_NUMBER_LEB: 20, MEMORY_ADDR_TLS_SLEB: 21, FUNCTION_OFFSET_I64: 22,
  MEMORY_ADDR_LOCREL_I32: 23, TABLE_INDEX_REL_SLEB64: 24, MEMORY_ADDR_TLS_SLEB64: 25,
  FUNCTION_INDEX_I32: 26,
};
const HAS_ADDEND = new Set([R.MEMORY_ADDR_LEB, R.MEMORY_ADDR_SLEB, R.MEMORY_ADDR_I32,
  R.FUNCTION_OFFSET_I32, R.SECTION_OFFSET_I32, R.MEMORY_ADDR_REL_SLEB, R.MEMORY_ADDR_LEB64,
  R.MEMORY_ADDR_SLEB64, R.MEMORY_ADDR_I64, R.MEMORY_ADDR_REL_SLEB64, R.MEMORY_ADDR_TLS_SLEB,
  R.FUNCTION_OFFSET_I64, R.MEMORY_ADDR_LOCREL_I32, R.MEMORY_ADDR_TLS_SLEB64]);
// Relocations whose provisional value is already correct for a standalone module.
const KEEP = new Set([R.FUNCTION_INDEX_LEB, R.TYPE_INDEX_LEB, R.GLOBAL_INDEX_LEB,
  R.MEMORY_ADDR_REL_SLEB, R.TABLE_INDEX_SLEB, R.TABLE_INDEX_I32, R.TABLE_NUMBER_LEB,
  R.GLOBAL_INDEX_I32, R.TAG_INDEX_LEB, R.FUNCTION_INDEX_I32]);

export class LinkError extends Error {
  constructor(message) { super(message); this.name = 'LinkError'; }
}

class Reader {
  constructor(bytes, pos = 0, end = bytes.length) { this.b = bytes; this.pos = pos; this.end = end; }
  u8() { if (this.pos >= this.end) throw new LinkError('truncated object'); return this.b[this.pos++]; }
  u32() {
    let result = 0, shift = 0, byte;
    do { byte = this.u8(); result |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    return result >>> 0;
  }
  s32() {
    let result = 0, shift = 0, byte;
    do { byte = this.u8(); result |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    if (shift < 32 && (byte & 0x40)) result |= -1 << shift;
    return result | 0;
  }
  bytes(n) { const v = this.b.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  name() { return new TextDecoder().decode(this.bytes(this.u32())); }
  limits() { const flags = this.u8(); const min = this.u32(); const max = flags & 1 ? this.u32() : undefined; return { flags, min, max }; }
  initExpr() { // const expressions used in object files: i32.const / global.get
    const op = this.u8(); let value;
    if (op === 0x41) value = this.s32();
    else if (op === 0x23) value = { global: this.u32() };
    else throw new LinkError(`unsupported init expression opcode 0x${op.toString(16)}`);
    if (this.u8() !== 0x0b) throw new LinkError('unterminated init expression');
    return value;
  }
}

function encodeU32(value) {
  const out = [];
  do { let byte = value & 0x7f; value >>>= 7; if (value) byte |= 0x80; out.push(byte); } while (value);
  return out;
}
function writePaddedU32(bytes, pos, value) {
  for (let i = 0; i < 5; i++) { bytes[pos + i] = (value & 0x7f) | (i < 4 ? 0x80 : 0); value >>>= 7; }
}
function writePaddedS32(bytes, pos, value) {
  for (let i = 0; i < 5; i++) { bytes[pos + i] = (value & 0x7f) | (i < 4 ? 0x80 : 0); value >>= 7; }
}

/** Parses a relocatable object. Returns a description used by `linkObject`. */
export function parseObject(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d)
    throw new LinkError('not a WebAssembly object');
  const r = new Reader(bytes, 8);
  const sections = [];
  while (r.pos < r.end) {
    const id = r.u8(); const size = r.u32(); const start = r.pos;
    const section = { id, start, end: start + size, index: sections.length };
    if (id === SECTION.custom) section.name = new Reader(bytes, start).name();
    sections.push(section); r.pos = start + size;
  }
  const byId = id => sections.find(s => s.id === id);
  const obj = { bytes, sections, imports: [], symbols: [], segments: [], initFuncs: [] };

  const imports = byId(SECTION.import);
  if (imports) {
    const ir = new Reader(bytes, imports.start, imports.end);
    for (let n = ir.u32(); n--;) {
      const module = ir.name(), field = ir.name(), kind = ir.u8();
      const entry = { module, field, kind };
      if (kind === 0) entry.type = ir.u32();
      else if (kind === 1) { entry.elemType = ir.u8(); entry.limits = ir.limits(); }
      else if (kind === 2) entry.limits = ir.limits();
      else if (kind === 3) { entry.valueType = ir.u8(); entry.mutable = ir.u8() === 1; }
      else if (kind === 4) { ir.u8(); entry.type = ir.u32(); }
      else throw new LinkError(`unsupported import kind ${kind}`);
      obj.imports.push(entry);
    }
  }

  const data = byId(SECTION.data);
  if (data) {
    const dr = new Reader(bytes, data.start, data.end);
    for (let n = dr.u32(); n--;) {
      const flags = dr.u32();
      if (flags !== 0) throw new LinkError(`unsupported data segment flags ${flags}`);
      const offset = dr.initExpr();
      if (typeof offset !== 'number') throw new LinkError('data segment offset is not constant');
      const size = dr.u32();
      obj.segments.push({ offset, size, pos: dr.pos - data.start });
      dr.pos += size;
    }
  }
  obj.dataEnd = obj.segments.reduce((m, s) => Math.max(m, s.offset + s.size), 0);

  const linking = sections.find(s => s.name === 'linking');
  if (!linking) throw new LinkError('object has no linking section');
  const lr = new Reader(bytes, linking.start, linking.end); lr.name();
  if (lr.u32() !== 2) throw new LinkError('unsupported linking metadata version');
  while (lr.pos < lr.end) {
    const type = lr.u8(); const size = lr.u32(); const end = lr.pos + size;
    if (type === 8) { // WASM_SYMBOL_TABLE
      for (let n = lr.u32(); n--;) {
        const kind = lr.u8(), flags = lr.u32(), sym = { kind, flags };
        const undefinedSym = (flags & 0x10) !== 0, explicitName = (flags & 0x40) !== 0;
        if (kind === 0 || kind === 2 || kind === 4 || kind === 5) {
          sym.index = lr.u32();
          if (!undefinedSym || explicitName) sym.name = lr.name();
        } else if (kind === 1) {
          sym.name = lr.name();
          if (!undefinedSym) { sym.segment = lr.u32(); sym.offset = lr.u32(); sym.size = lr.u32(); }
        } else if (kind === 3) sym.section = lr.u32();
        else throw new LinkError(`unsupported symbol kind ${kind}`);
        sym.undefined = undefinedSym;
        obj.symbols.push(sym);
      }
    } else if (type === 6) { // WASM_INIT_FUNCS
      for (let n = lr.u32(); n--;) obj.initFuncs.push({ priority: lr.u32(), symbol: lr.u32() });
    }
    lr.pos = end;
  }

  obj.relocations = [];
  for (const s of sections) {
    if (!s.name?.startsWith('reloc.')) continue;
    const rr = new Reader(bytes, s.start, s.end); rr.name();
    const target = sections[rr.u32()];
    for (let n = rr.u32(); n--;) {
      const type = rr.u8(), offset = rr.u32(), index = rr.u32();
      const addend = HAS_ADDEND.has(type) ? rr.s32() : 0;
      obj.relocations.push({ type, offset, index, addend, target });
    }
  }
  const undefinedData = obj.symbols.filter(s => s.kind === 1 && s.undefined).map(s => s.name);
  if (undefinedData.length) throw new LinkError(`undefined data symbols: ${undefinedData.join(', ')}`);
  return obj;
}

function dataSymbolAddress(obj, sym, base) {
  if (sym.kind !== 1 || sym.undefined) throw new LinkError(`relocation against unsupported symbol ${sym.name}`);
  return base + obj.segments[sym.segment].offset + sym.offset;
}

/** Produces a self-contained module plus the data image that belongs at `base`. */
export function linkObject(obj, base) {
  const { bytes } = obj;
  const code = obj.sections.find(s => s.id === SECTION.code);
  const data = obj.sections.find(s => s.id === SECTION.data);
  const patched = { code: code ? bytes.slice(code.start, code.end) : null, data: data ? bytes.slice(data.start, data.end) : null };
  for (const rel of obj.relocations) {
    if (KEEP.has(rel.type)) continue;
    const buf = rel.target === code ? patched.code : rel.target === data ? patched.data : null;
    if (!buf) throw new LinkError(`relocation in unexpected section ${rel.target?.name ?? rel.target?.id}`);
    const value = dataSymbolAddress(obj, obj.symbols[rel.index], base) + rel.addend;
    if (rel.type === R.MEMORY_ADDR_LEB) writePaddedU32(buf, rel.offset, value >>> 0);
    else if (rel.type === R.MEMORY_ADDR_SLEB) writePaddedS32(buf, rel.offset, value | 0);
    else if (rel.type === R.MEMORY_ADDR_I32) new DataView(buf.buffer, buf.byteOffset).setUint32(rel.offset, value >>> 0, true);
    else throw new LinkError(`unsupported relocation type ${rel.type}`);
  }
  // Relative relocations must already hold the segment-relative address.
  for (const rel of obj.relocations) {
    if (rel.type !== R.MEMORY_ADDR_REL_SLEB || rel.target !== code) continue;
    const expected = dataSymbolAddress(obj, obj.symbols[rel.index], 0) + rel.addend;
    if (new Reader(patched.code, rel.offset).s32() !== expected)
      throw new LinkError('relative memory relocation does not match its provisional value');
  }

  const image = new Uint8Array(obj.dataEnd);
  for (const seg of obj.segments) image.set(patched.data.subarray(seg.pos, seg.pos + seg.size), seg.offset);

  const named = new Map();
  for (const sym of obj.symbols)
    if (sym.kind === 0 && !sym.undefined && sym.name && !(sym.flags & 0x02 /* LOCAL */)) named.set(sym.name, sym.index);
  if (!named.has('main')) throw new LinkError('object does not define main');
  const exports = [['main', 0, named.get('main')]];
  const initFuncs = obj.initFuncs.sort((a, b) => a.priority - b.priority).map(f => obj.symbols[f.symbol].index);
  initFuncs.forEach((index, i) => exports.push([`__init_${i}`, 0, index]));

  const out = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const emit = (id, payload) => { out.push(id, ...encodeU32(payload.length)); for (const b of payload) out.push(b); };
  let exported = false;
  const emitExports = () => {
    if (exported) return; exported = true;
    const payload = [...encodeU32(exports.length)];
    const enc = new TextEncoder();
    for (const [name, kind, index] of exports) { const n = enc.encode(name); payload.push(...encodeU32(n.length), ...n, kind, ...encodeU32(index)); }
    emit(SECTION.export, payload);
  };
  // Section order: export (7) comes before start, element, datacount and code.
  const order = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 13: 5.5, 6: 6, 7: 7, 8: 8, 9: 9, 12: 10, 10: 11, 11: 12 };
  for (const s of obj.sections) {
    if (s.id === SECTION.custom || s.id === SECTION.data || s.id === SECTION.datacount) continue;
    if (s.id === SECTION.export) throw new LinkError('object already has an export section');
    if (order[s.id] > 7) emitExports();
    emit(s.id, s.id === SECTION.code ? patched.code : bytes.subarray(s.start, s.end));
  }
  emitExports();
  return { module: new Uint8Array(out), image, initFuncs: initFuncs.length };
}

/** Imports the browser runtime cannot provide, with a reason. */
export const UNSUPPORTED_IMPORTS = {
  isac_rt_thread_run_u64: 'threads não funcionam no laboratório',
  isac_rt_thread_call: 'threads não funcionam no laboratório',
};

export function missingImports(obj, runtimeExports) {
  return obj.imports.filter(imp => imp.kind === 0 && typeof runtimeExports['_' + imp.field] !== 'function')
    .map(imp => ({ name: imp.field, reason: UNSUPPORTED_IMPORTS[imp.field] ?? 'não exportado pelo runtime do navegador' }));
}

/** Instantiates the object against an initialised Emscripten runtime instance. */
export async function instantiateObject(obj, runtime, { stackSize = 1 << 20 } = {}) {
  const missing = missingImports(obj, runtime);
  if (missing.length) throw new LinkError(missing.map(m => `símbolo indefinido ${m.name}: ${m.reason}`).join('\n'));
  const dataSize = (obj.dataEnd + 15) & ~15;
  const base = dataSize ? runtime._malloc(dataSize) : 0;
  const stackBase = runtime._malloc(stackSize);
  if ((dataSize && !base) || !stackBase) throw new LinkError('runtime could not reserve program memory');
  const linked = linkObject(obj, base);
  runtime.HEAPU8.set(linked.image, base);

  const env = {};
  for (const imp of obj.imports) {
    if (imp.module !== 'env') throw new LinkError(`unsupported import module ${imp.module}`);
    if (imp.kind === 0) env[imp.field] = runtime['_' + imp.field];
    else if (imp.kind === 2) env[imp.field] = runtime.wasmMemory;
    else if (imp.kind === 1) env[imp.field] = new WebAssembly.Table({ element: 'anyfunc', initial: Math.max(imp.limits.min, 1) });
    else if (imp.kind === 3) {
      if (imp.field === '__stack_pointer') env[imp.field] = new WebAssembly.Global({ value: 'i32', mutable: true }, (stackBase + stackSize) & ~15);
      else if (imp.field === '__memory_base') env[imp.field] = new WebAssembly.Global({ value: 'i32', mutable: imp.mutable }, base);
      else if (imp.field === '__table_base') env[imp.field] = new WebAssembly.Global({ value: 'i32', mutable: imp.mutable }, 0);
      else throw new LinkError(`unsupported global import ${imp.field}`);
    } else throw new LinkError(`unsupported import ${imp.field}`);
  }
  const { instance } = await WebAssembly.instantiate(linked.module, { env });
  for (let i = 0; i < linked.initFuncs; i++) instance.exports[`__init_${i}`]();
  return { instance, base };
}
