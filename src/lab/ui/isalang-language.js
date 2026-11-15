// CodeMirror stream tokenizer for Isalang. Mirrors src/lib/isalang.tmLanguage.json,
// which Shiki uses for static highlighting on the site.
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t, Tag } from '@lezer/highlight';

const CONTROL = new Set(['if', 'else', 'while', 'loop', 'for', 'in', 'break', 'continue', 'return', 'match', 'await']);
const DECL = new Set(['fn', 'let', 'const', 'struct', 'enum', 'union', 'impl', 'protocol', 'state', 'initial', 'final', 'type', 'extern', 'async', 'borrow']);
const MODIFIER = new Set(['pub', 'unsafe', 'as']);
const PRIMITIVE = new Set(['i8', 'i16', 'i32', 'i64', 'isize', 'u8', 'u16', 'u32', 'u64', 'usize', 'f32', 'f64', 'bool', 'char', 'str']);

export const accessShared = Tag.define();
export const accessUnique = Tag.define();
export const stateName = Tag.define();

const parser = {
  name: 'isalang',
  startState: () => ({ inComment: false, afterArrow: false }),
  token(stream, state) {
    if (state.inComment) {
      if (stream.skipTo('*/')) { stream.next(); stream.next(); state.inComment = false; }
      else stream.skipToEnd();
      return 'blockComment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'lineComment'; }
    if (stream.match('/*')) { state.inComment = true; return 'blockComment'; }
    if (stream.peek() === '"') {
      stream.next();
      let escaped = false, ch;
      while ((ch = stream.next()) != null) {
        if (ch === '"' && !escaped) break;
        escaped = !escaped && ch === '\\';
      }
      return 'string';
    }
    if (stream.match(/^'(?:\\(?:[nrt0\\"']|x[0-9A-Fa-f]{2}|u\{[0-9A-Fa-f]+\})|[^'\\])'/)) return 'character';
    if (stream.match(/^@[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*/)) return 'macroName';
    if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)) return 'macroName';
    if (stream.match(/^0x[0-9A-Fa-f_]+(?:[iu](?:8|16|32|64|size))?/) || stream.match(/^0b[01_]+(?:[iu](?:8|16|32|64|size))?/) ||
        stream.match(/^[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9]+)?(?:[iu](?:8|16|32|64|size)|f32|f64)?/)) return 'number';
    if (stream.match('->') || stream.match('=>')) { state.afterArrow = true; return 'operator'; }
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      const w = word[0];
      const arrow = state.afterArrow; state.afterArrow = false;
      if (CONTROL.has(w)) return 'controlKeyword';
      if (DECL.has(w)) return 'definitionKeyword';
      if (MODIFIER.has(w)) return 'modifier';
      if (w === 'shared') return 'accessShared';
      if (w === 'unique' || w === 'mut') return 'accessUnique';
      if (w === 'self') return 'self';
      if (w === 'true' || w === 'false') return 'bool';
      if (PRIMITIVE.has(w)) return 'typeName';
      if (/^[A-Z][A-Z0-9_]+$/.test(w)) return 'constant';
      if (/^[A-Z]/.test(w)) return arrow && stream.match(/^\s*;/, false) ? 'stateName' : 'typeName';
      if (stream.match(/^\s*\(/, false)) return 'function';
      return 'variableName';
    }
    if (stream.match('::')) return 'punctuation';
    if (stream.match(/^(&&|\|\||<<|>>|[=!<>]=|\+\+|--|\.\.|[-+*/%&|^!<>=])/)) return 'operator';
    stream.next();
    return 'punctuation';
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } }, closeBrackets: { brackets: ['(', '[', '{', '"'] } },
  tokenTable: {
    accessShared, accessUnique, stateName,
    controlKeyword: t.controlKeyword, definitionKeyword: t.definitionKeyword, modifier: t.modifier,
    macroName: t.macroName, self: t.self, bool: t.bool, constant: t.constant(t.variableName),
    function: t.function(t.variableName), typeName: t.typeName,
  },
};

export const isalang = StreamLanguage.define(parser);

export const isalangHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: [t.lineComment, t.blockComment], color: '#7a857d', fontStyle: 'italic' },
  { tag: t.string, color: '#a9d08e' },
  { tag: t.character, color: '#a9d08e' },
  { tag: [t.number, t.bool], color: '#f2a477' },
  { tag: t.constant(t.variableName), color: '#f2c48d' },
  { tag: [t.controlKeyword, t.definitionKeyword], color: '#e8b04b' },
  { tag: t.modifier, color: '#c7a6ff' },
  { tag: t.self, color: '#c7a6ff', fontStyle: 'italic' },
  { tag: accessShared, color: '#5cc8d6' },
  { tag: accessUnique, color: '#ff8566' },
  { tag: t.macroName, color: '#ff8566' },
  { tag: t.function(t.variableName), color: '#eef0d9' },
  { tag: t.typeName, color: '#79d0d9' },
  { tag: stateName, color: '#9fe0b0' },
  { tag: [t.operator, t.punctuation], color: '#9aa39c' },
  { tag: t.variableName, color: '#dfe4de' },
]));

// Minimal tokenizer for IR dumps (Core, LIR, MLIR, LLVM IR, assembly).
export const irLanguage = StreamLanguage.define({
  name: 'isac-ir',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^(;|\/\/|#\s).*/)) return 'lineComment';
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/^[%@][\w.$-]+/)) return 'variableName';
    if (stream.match(/^#[A-Z]+\d+/)) return 'typeName';
    if (stream.match(/^\^?bb\d+(?::\d+)?/)) return 'labelName';
    if (stream.match(/^!?[a-z_]+\.[\w.]+/)) return 'keyword';
    if (stream.match(/^-?\d+(\.\d+)?/)) return 'number';
    if (stream.match(/^(define|declare|fn|func|call|ret|br|return|bind|move|drop|borrow|load|store|alloca|getelementptr|icmp|phi|i\d+|ptr|void)\b/)) return 'keyword';
    if (stream.match(/^\w+/)) return null;
    stream.next();
    return null;
  },
  tokenTable: { labelName: t.labelName },
});

export const irHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: t.lineComment, color: '#7a857d' },
  { tag: t.string, color: '#a9d08e' },
  { tag: t.variableName, color: '#79d0d9' },
  { tag: t.typeName, color: '#f2c48d' },
  { tag: t.labelName, color: '#c7a6ff' },
  { tag: t.keyword, color: '#e8b04b' },
  { tag: t.number, color: '#f2a477' },
]));
