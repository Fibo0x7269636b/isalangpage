import { test, expect } from '@playwright/test';

const isCompilerRequest = url => /\/isac\/(isac\.mjs|isac\.wasm|isac-runtime)/.test(url);

test('home page loads without touching the compiler', async ({ page }) => {
  const requests = [];
  const errors = [];
  page.on('request', r => requests.push(r.url()));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: 'Isalang' })).toBeVisible();
  await expect(page.locator('.isac-status')).toContainText('não carregado');
  await expect(page.locator('.trace .diag')).toContainText('E0301');
  await page.getByRole('tab', { name: /LLVM IR/ }).click();
  await expect(page.locator('#stage-llvm')).toContainText('define i32');
  await page.waitForLoadState('networkidle');
  expect(requests.filter(isCompilerRequest)).toEqual([]);
  expect(errors).toEqual([]);
});

test('no horizontal overflow on a phone', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const path of ['./', 'lab/', 'docs/', 'docs/editor/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, path).toBeLessThanOrEqual(390);
  }
  await page.close();
});

test('docs show the empty state and the editor previews a page', async ({ page }) => {
  await page.goto('docs/');
  await expect(page.getByText('Ainda não há páginas publicadas')).toBeVisible();
  await page.getByRole('link', { name: 'Abrir o editor' }).click();
  await expect(page.getByRole('heading', { name: 'Editor de páginas' })).toBeVisible();
  await expect(page.locator('[data-path]')).toContainText('.md'); // editor module mounted
  await page.locator('[data-field="title"]').fill('Ownership e move');
  await expect(page.locator('[data-path]')).toContainText('src/content/docs/conceitos/ownership-e-move.md');
  await expect(page.locator('[data-panel="preview"] h1')).toHaveText('Ownership e move');
});

test('the editor checks isalang blocks with the WebAssembly compiler', async ({ page }) => {
  await page.goto('docs/editor/');
  await expect(page.locator('[data-path]')).toContainText('.md');
  await page.locator('[data-template]').selectOption('conceito');
  await page.getByRole('tab', { name: /Verificação/ }).click();
  await page.getByRole('button', { name: 'Verificar blocos' }).click();
  const results = page.locator('[data-block-results]');
  await expect(results).toContainText('bloco 1', { timeout: 90_000 });
  await expect(results).toContainText('compila');
  await expect(results).toContainText('rejeitado como esperado (E0301)');
  await expect(results.locator('li.bad')).toHaveCount(0);
});

test('unknown routes render the 404 page', async ({ page }) => {
  const res = await page.goto('nao-existe/');
  expect(res.status()).toBe(404);
  await expect(page.getByRole('heading', { name: /não encontrada/ })).toBeVisible();
});
