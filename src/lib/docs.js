import { getCollection } from 'astro:content';

const showDrafts = import.meta.env.DEV;

export async function getDocs() {
  const entries = await getCollection('docs', e => showDrafts || !e.data.draft);
  return entries.sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title, 'pt'));
}

/** Sections ordered by the smallest `order` among their pages. */
export function groupBySection(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.data.section)) map.set(e.data.section, []);
    map.get(e.data.section).push(e);
  }
  return [...map].map(([name, pages]) => ({ name, pages, order: Math.min(...pages.map(p => p.data.order)) }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt'));
}

export const docPath = entry => `/docs/${entry.id}/`;
