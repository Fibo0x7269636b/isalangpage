// Extracts protocol declarations from Isalang source for diagrams.
// Handles the surface syntax used in examples/:
//   protocol Name { initial A; final A; state A { op(self) -> B; read(shared self); } }
export function parseProtocols(source) {
  const text = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const result = [];
  for (const m of text.matchAll(/\bprotocol\s+([A-Z]\w*)\s*\{/g)) {
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++; }
    const body = text.slice(start, i - 1);
    const protocol = { name: m[1], initial: null, finals: [], states: [] };
    protocol.initial = /\binitial\s+(\w+)\s*;/.exec(body)?.[1] ?? null;
    protocol.finals = [...body.matchAll(/\bfinal\s+(\w+)\s*;/g)].map(f => f[1]);
    for (const s of body.matchAll(/\bstate\s+(\w+)\s*\{([^}]*)\}/g)) {
      const ops = [...s[2].matchAll(/(\w+)\s*\(\s*(shared\s+|unique\s+)?self\s*\)\s*(?:->\s*(\w+))?\s*;/g)].map(o => ({
        name: o[1], access: o[2]?.trim() ?? 'own', to: o[3] ?? s[1],
      }));
      protocol.states.push({ name: s[1], ops });
    }
    result.push(protocol);
  }
  return result;
}
