// Prefixes a site-relative path with the configured base (GitHub Pages project sites).
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const url = (path = '/') => `${base}${path.startsWith('/') ? path : '/' + path}`;
