// Documentation editor: frontmatter form, Markdown editor, live preview,
// compiler-backed checks of isalang blocks and a GitHub proposal flow.
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history as cmHistory, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { LanguageDescription, LanguageSupport, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { searchKeymap } from '@codemirror/search';
import { Marked } from 'marked';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import isalangGrammar from '../lib/isalang.tmLanguage.json';
import shikiTheme from '../lib/shiki-theme.json';
import { isalang, isalangHighlight } from '../lab/ui/isalang-language.js';
import { extractIsalangBlocks, parseFrontmatter, serializeFrontmatter, slugify, validateDoc } from '../lib/docs-shared.js';
import { compile, labStatus } from '../lab/client.js';

const DRAFT_PREFIX = 'isalang-doc-draft:';
const MAX_URL = 7000;

let highlighterPromise;
const highlighter = () => highlighterPromise ??= createHighlighterCore({
  themes: [shikiTheme], langs: [isalangGrammar], engine: createJavaScriptRegexEngine({ forgiving: true }),
});
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const markdownHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: t.heading, color: '#eef0d9', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600', color: '#eef0d9' },
  { tag: [t.link, t.url], color: '#5cc8d6' },
  { tag: t.monospace, color: '#f2c48d' },
  { tag: [t.processingInstruction, t.meta], color: '#7a857d' },
  { tag: t.quote, color: '#a3aca5' },
  { tag: t.list, color: '#e8b04b' },
]));

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'var(--bg-1)', color: 'var(--fg)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
  '.cm-content': { caretColor: 'var(--own)', padding: '12px 0' },
  '.cm-gutters': { backgroundColor: 'var(--bg-1)', color: 'var(--fg-dim)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--bg-2) 70%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--own)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--own) 22%, transparent) !important' },
  '.cm-line': { wordBreak: 'break-word' },
}, { dark: true });

export function mountDocEditor(root, data) {
  const $ = s => root.querySelector(s);
  const fields = Object.fromEntries([...root.querySelectorAll('[data-field]')].map(i => [i.dataset.field, i]));
  const pageSelect = $('[data-page]');
  const templateSelect = $('[data-template]');
  let pageId = null;
  let slugTouched = false;
  let loading = false;
  let view;

  // ------------------------------------------------------------ model
  function meta() {
    return {
      title: fields.title.value.trim(),
      description: fields.description.value.trim() || undefined,
      section: fields.section.value.trim() || 'Geral',
      order: fields.order.value === '' ? undefined : Number(fields.order.value),
      draft: fields.draft.checked || undefined,
      compiler: root.dataset.compilerChecked || undefined,
    };
  }
  function filePath() {
    if (pageId) return data.pages.find(p => p.id === pageId).path;
    const slug = fields.slug.value || slugify(fields.title.value) || 'nova-pagina';
    return `${data.docsDir}/${slugify(fields.section.value || 'geral')}/${slug}.md`;
  }
  function fileContent() { return serializeFrontmatter(meta()) + '\n' + view.state.doc.toString().replace(/^\n+/, ''); }

  function load(raw, { id = null } = {}) {
    pageId = id;
    const { data: fm, body } = parseFrontmatter(raw);
    fields.title.value = fm.title ?? '';
    fields.description.value = fm.description ?? '';
    fields.section.value = fm.section ?? '';
    fields.order.value = fm.order ?? '';
    fields.draft.checked = fm.draft === true;
    delete root.dataset.compilerChecked;
    fields.slug.value = id ? id.split('/').pop() : slugify(fm.title ?? '');
    fields.slug.disabled = !!id;
    slugTouched = !!id;
    templateSelect.disabled = !!id;
    setBody(body.replace(/^\n+/, ''));
    update();
  }
  function setBody(text) {
    loading = true;
    try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); } finally { loading = false; }
  }
  const draftKey = () => DRAFT_PREFIX + (pageId ?? 'new');
  function saveDraft() {
    try {
      localStorage.setItem(draftKey(), JSON.stringify({ raw: fileContent(), slug: fields.slug.value, savedAt: Date.now() }));
      $('[data-saved]').textContent = `rascunho salvo ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch { $('[data-saved]').textContent = 'rascunho não pôde ser salvo neste navegador'; }
  }
  function readDraft(id) {
    try { return JSON.parse(localStorage.getItem(DRAFT_PREFIX + (id ?? 'new'))); } catch { return null; }
  }
  function open(id) {
    const page = id ? data.pages.find(p => p.id === id) : null;
    const draft = readDraft(page?.id ?? null);
    if (page) load(draft?.raw ?? page.raw, { id: page.id });
    else {
      load(draft?.raw ?? data.templates[templateSelect.value]);
      if (draft?.slug) { fields.slug.value = draft.slug; slugTouched = true; }
    }
    $('[data-saved]').textContent = draft ? 'rascunho local restaurado' : '';
    pageSelect.value = page?.id ?? '';
    update();
  }

  // ------------------------------------------------------------ preview
  let previewTimer;
  async function renderPreview() {
    const hl = await highlighter();
    const marked = new Marked({
      gfm: true,
      renderer: {
        code({ text, lang }) {
          const name = (lang ?? '').split(/\s+/)[0];
          if (name === 'isalang' || name === 'isa') return hl.codeToHtml(text, { lang: 'isalang', theme: 'isalang-dark' });
          return `<pre class="astro-code"><code>${escapeHtml(text)}</code></pre>`;
        },
      },
    });
    const m = meta();
    const body = marked.parse(view.state.doc.toString().replace(/<!--[\s\S]*?-->/g, ''));
    $('[data-panel="preview"]').innerHTML =
      `<p class="crumb label">${escapeHtml(m.section)}</p><h1>${escapeHtml(m.title || 'Sem título')}</h1>` +
      (m.description ? `<p class="lede">${escapeHtml(m.description)}</p>` : '') + body;
  }

  // ------------------------------------------------------------ checks
  function renderChecks() {
    const m = meta();
    const fm = validateDoc(m);
    const path = filePath();
    if (!pageId && data.pages.some(p => p.path === path)) fm.push(`já existe uma página em ${path}`);
    $('[data-fm-results]').replaceChildren(...(fm.length ? fm.map(e => li('bad', e)) : [li('ok', 'campos válidos')]));
    const count = fm.length;
    const badge = $('[data-badge]');
    badge.hidden = !count; badge.textContent = String(count);
  }
  function li(cls, text, detail) {
    const node = document.createElement('li');
    node.className = cls; node.textContent = text;
    if (detail) { const pre = document.createElement('pre'); pre.textContent = detail; node.append(pre); }
    return node;
  }

  async function checkBlocks() {
    const out = $('[data-block-results]');
    const blocks = extractIsalangBlocks(view.state.doc.toString());
    if (!blocks.length) { out.replaceChildren(li('warn', 'nenhum bloco isalang na página')); return; }
    const button = $('[data-check-blocks]');
    button.disabled = true;
    const unsub = labStatus.subscribe(s => {
      if (s.state === 'loading') out.replaceChildren(li('warn', `carregando o compilador${s.percent != null ? ` (${s.percent}%)` : ''}…`));
    });
    const results = [];
    let failed = 0;
    try {
      for (const [i, b] of blocks.entries()) {
        const label = `bloco ${i + 1} (linha ${b.line})${b.meta ? ` [${b.meta}]` : ''}`;
        if (b.skip) { results.push(li('warn', `${label}: ignorado (nocheck)`)); continue; }
        const name = b.file ?? 'block.isa';
        const r = await compile({ files: { [name]: b.code }, args: [name, '--check', '--color=never', ...(b.hasMain ? [] : ['--library'])] });
        const ok = b.expectFail ? r.status !== 0 : r.status === 0;
        if (!ok) failed++;
        const code = /error\[(E\d+)\]/.exec(r.stderr)?.[1];
        results.push(li(ok ? 'ok' : 'bad',
          `${label}: ${b.expectFail ? (r.status !== 0 ? `rejeitado como esperado (${code ?? 'erro'})` : 'deveria ser rejeitado, mas compilou') : (r.status === 0 ? 'compila' : 'não compila')}`,
          !ok || b.expectFail ? r.stderr.split('\n').slice(0, 8).join('\n') : null));
        out.replaceChildren(...results);
      }
      if (!failed) root.dataset.compilerChecked = data.compiler; else delete root.dataset.compilerChecked;
    } catch (e) {
      results.push(li('bad', `falha ao usar o compilador: ${e.message}`));
    } finally {
      unsub(); button.disabled = false;
      out.replaceChildren(...results);
    }
  }

  // ------------------------------------------------------------ publish
  const note = text => { $('[data-pub-note]').textContent = text; };
  async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
  async function publish() {
    const m = meta();
    const errors = validateDoc(m);
    if (errors.length) { note(`Corrija antes de propor: ${errors.join('; ')}.`); return; }
    const path = filePath();
    const content = fileContent();
    const repo = `https://github.com/${data.repo}`;
    if (pageId) {
      const copied = await copy(content);
      window.open(`${repo}/edit/${data.branch}/${path}`, '_blank', 'noopener');
      note(copied
        ? `Conteúdo copiado. No GitHub, substitua o texto de ${path} pelo da área de transferência e escolha “Propose changes”.`
        : `Não foi possível copiar automaticamente. Use “Copiar conteúdo” e cole no editor do GitHub (${path}).`);
      return;
    }
    const base = `${repo}/new/${data.branch}?filename=${encodeURIComponent(path)}`;
    const full = `${base}&value=${encodeURIComponent(content)}`;
    if (full.length <= MAX_URL) {
      window.open(full, '_blank', 'noopener');
      note(`O GitHub abriu ${path} preenchido. Escolha “Propose new file”; sem permissão de escrita, o GitHub cria um fork e um pull request.`);
    } else {
      const copied = await copy(content);
      window.open(base, '_blank', 'noopener');
      note(`A página é longa demais para ir na URL. ${copied ? 'O conteúdo foi copiado; cole' : 'Use “Copiar conteúdo” e cole'} no arquivo aberto no GitHub.`);
    }
  }
  function download() {
    const blob = new Blob([fileContent()], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filePath().split('/').pop();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------ wiring
  function update() {
    if (!slugTouched && !pageId) fields.slug.value = slugify(fields.title.value);
    $('[data-path]').textContent = filePath();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { renderPreview(); renderChecks(); }, 180);
  }
  let saveTimer;
  const changed = () => { update(); clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 600); };

  view = new EditorView({
    parent: $('[data-editor]'),
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(), cmHistory(), drawSelection(), highlightActiveLine(), EditorView.lineWrapping,
        markdown({ codeLanguages: [LanguageDescription.of({ name: 'isalang', alias: ['isa'], support: new LanguageSupport(isalang) })] }),
        isalangHighlight, markdownHighlight, theme,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.updateListener.of(u => { if (u.docChanged) (loading ? update : changed)(); }),
        EditorView.contentAttributes.of({ 'aria-label': 'Conteúdo da página em Markdown' }),
      ],
    }),
  });

  Object.values(fields).forEach(input => input.addEventListener('input', () => {
    if (input === fields.slug) slugTouched = true;
    changed();
  }));
  pageSelect.addEventListener('change', () => {
    open(pageSelect.value || null);
    const url = new URL(location.href);
    if (pageSelect.value) url.searchParams.set('page', pageSelect.value); else url.searchParams.delete('page');
    history.replaceState(history.state, '', url);
  });
  templateSelect.addEventListener('change', () => {
    if (pageId) return;
    if (view.state.doc.length && !confirm('Substituir o conteúdo atual pelo modelo?')) return;
    try { localStorage.removeItem(DRAFT_PREFIX + 'new'); } catch { /* ignore */ }
    load(data.templates[templateSelect.value]);
  });
  root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    root.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  }));
  $('[data-check-blocks]').addEventListener('click', checkBlocks);
  $('[data-publish]').addEventListener('click', publish);
  $('[data-download]').addEventListener('click', download);
  $('[data-copy]').addEventListener('click', async () => note(await copy(fileContent()) ? 'Conteúdo copiado.' : 'O navegador bloqueou a área de transferência.'));
  $('[data-discard]').addEventListener('click', () => {
    if (!confirm('Descartar o rascunho local desta página?')) return;
    try { localStorage.removeItem(draftKey()); } catch { /* ignore */ }
    open(pageId);
    note('Rascunho descartado.');
  });

  const requested = new URLSearchParams(location.search).get('page');
  open(requested && data.pages.some(p => p.id === requested) ? requested : null);
}
