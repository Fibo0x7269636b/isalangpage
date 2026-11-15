// Shared by the docs editor (browser), scripts/docs-check.mjs and scripts/docs-new.mjs.

/** Fenced Isalang blocks. Meta flags: `fail` (must be rejected), `nocheck`, `file=name.isa`. */
export function extractIsalangBlocks(markdown) {
  const blocks = [];
  const re = /^(```+|~~~+)[ \t]*(isalang|isa)\b([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm;
  for (const m of markdown.matchAll(re)) {
    const meta = m[3].trim();
    const line = markdown.slice(0, m.index).split('\n').length;
    blocks.push({
      line, meta, code: m[4],
      expectFail: /\bfail\b/.test(meta),
      skip: /\bnocheck\b/.test(meta),
      file: /\bfile=([\w./-]+\.isa)\b/.exec(meta)?.[1] ?? null,
      // Blocks without fn main are checked as a library (--library).
      hasMain: /\bfn\s+main\s*\(/.test(m[4]),
    });
  }
  return blocks;
}

/** Splits `---\nyaml\n---\nbody`. Only flat `key: value` pairs are needed here. */
export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { data: {}, body: text, raw: '' };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    else if (v === 'true' || v === 'false') v = v === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    data[kv[1]] = v;
  }
  return { data, body: text.slice(m[0].length), raw: m[1] };
}

export function serializeFrontmatter(data) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => `${k}: ${typeof v === 'string' && /[:#'"\n]|^\s|\s$/.test(v) ? JSON.stringify(v) : v}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

export function slugify(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export function validateDoc(data) {
  const errors = [];
  if (!data.title || typeof data.title !== 'string') errors.push('title é obrigatório');
  if (data.order !== undefined && typeof data.order !== 'number') errors.push('order deve ser um número');
  if (data.draft !== undefined && typeof data.draft !== 'boolean') errors.push('draft deve ser true ou false');
  return errors;
}
