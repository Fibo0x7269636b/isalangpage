import { test, expect } from '@playwright/test';

const editor = page => page.locator('.ide [data-editor] .cm-editor');

async function startLab(page) {
  await page.goto('lab/');
  await page.getByRole('button', { name: 'Carregar o compilador' }).click();
  await expect(editor(page)).toBeVisible({ timeout: 90_000 });
}
async function setSource(page, text) {
  await page.locator('.ide [data-editor] .cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
}

test('the compiler is fetched only after the user asks for it', async ({ page }) => {
  const wasm = [];
  page.on('request', r => { if (r.url().includes('isac.wasm')) wasm.push(r.url()); });
  await page.goto('lab/');
  await expect(page.getByRole('button', { name: 'Carregar o compilador' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(wasm).toEqual([]);
  await page.getByRole('button', { name: 'Carregar o compilador' }).click();
  await expect(page.locator('[data-step="download"]')).toBeVisible();
  await expect(editor(page)).toBeVisible({ timeout: 90_000 });
  expect(wasm.length).toBe(1);
  await expect(page.locator('.isac-status')).toContainText('pronto');
});

test('compiles, runs, reports diagnostics and shows IR', async ({ page }) => {
  await startLab(page);
  await page.locator('[data-example]').selectOption('connection.isa');
  await page.getByRole('button', { name: 'Executar' }).click();
  await expect(page.locator('[data-terminal]')).toContainText('[exit 0]');
  await expect(page.locator('[data-terminal]')).toContainText('11\n22\n24');

  await page.locator('[data-example]').selectOption('heap/buffer.isa');
  await page.getByRole('button', { name: 'Executar' }).click();
  await expect(page.locator('[data-status]')).toContainText('alocações 1 · liberações 1');

  await page.locator('[data-example]').selectOption('string_move_invalid.isa');
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.locator('[data-problems]')).toContainText('E0301');
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(1);

  await page.locator('[data-example]').selectOption('heap/box.isa');
  await page.getByRole('tab', { name: 'IR' }).click();
  await page.getByRole('button', { name: 'LLVM IR' }).click();
  await expect(page.locator('[data-ir-cmd]')).toContainText('--emit-llvm');
  await expect(page.locator('[data-ir] .cm-content')).toContainText('target');
});

test('stdin from the Entrada panel reaches the program', async ({ page }) => {
  await startLab(page);
  await page.locator('[data-example]').selectOption('input_demo.isa');
  await expect(page.locator('[data-reads-input]')).toBeVisible();
  await expect(page.getByLabel('Entrada do programa')).toBeVisible();
  await page.getByLabel('Entrada do programa').fill('Bia\n31\n');
  await page.getByRole('button', { name: 'Executar' }).click();
  await expect(page.locator('[data-terminal]')).toContainText('Hello Bia, you are 31 years old.');
});

test('new examples run', async ({ page }) => {
  await startLab(page);
  await page.locator('[data-example]').selectOption('protocols/work_token.isa');
  await page.getByRole('button', { name: 'Executar' }).click();
  await expect(page.locator('[data-terminal]')).toContainText('42\n43');
});

test('a runaway program can be stopped and the Lab keeps working', async ({ page }) => {
  await startLab(page);
  await setSource(page, 'fn main() -> i32 {\n  let i = 0;\n  while i >= 0 {\n    i = i + 1;\n    if i == 1000000000 { i = 0; }\n  }\n  return 0;\n}\n');
  await page.getByRole('button', { name: 'Executar' }).click();
  await expect(page.getByRole('button', { name: 'Parar' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Parar' }).click();
  await expect(page.locator('[data-terminal]')).toContainText('interrompida');
  await page.locator('[data-example]').selectOption('heap/box.isa');
  await page.getByRole('button', { name: 'Executar' }).click();
  await expect(page.locator('[data-terminal]')).toContainText('42');
});

test('examples that need unported features are not listed; such code is labelled', async ({ page }) => {
  await startLab(page);
  const ids = await page.locator('[data-example] option').evaluateAll(o => o.map(x => x.value));
  for (const id of ['ffi/record.isa', 'ffi/advanced.isa', 'ffi/sequences.isa', 'protocol_execution.isa', 'thread_owned.isa', 'thread_carriers.isa', 'async_threaded.isa'])
    expect(ids).not.toContain(id);
  await setSource(page, 'extern "C" fn twice(value: i32) -> i32;\nfn main() -> i32 {\n  unsafe { print(twice(2)); }\n  return 0;\n}\n');
  await page.getByRole('button', { name: 'Executar' }).click();
  await expect(page.locator('[data-terminal]')).toContainText('Não funciona no laboratório');
  await page.getByRole('tab', { name: 'Não funciona' }).click();
  await expect(page.locator('[data-panel="limits"]')).toContainText('FFI com ponte ABI C');
});

test('the compiler stays loaded across client-side navigation', async ({ page }) => {
  const wasm = [];
  page.on('request', r => { if (r.url().includes('isac.wasm')) wasm.push(r.url()); });
  await startLab(page);
  await page.locator('a[data-nav="home"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Isalang' })).toBeVisible();
  await expect(page.locator('.isac-status')).toContainText('pronto');
  await page.locator('a[data-nav="lab"]').click();
  await expect(editor(page)).toBeVisible({ timeout: 5_000 });
  expect(wasm.length).toBe(1);
});

test('a failed download shows an error and can be retried', async ({ page }) => {
  await page.route('**/isac/isac.wasm.gz', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('lab/');
  await page.getByRole('button', { name: 'Carregar o compilador' }).click();
  await expect(page.getByRole('alert')).toContainText('HTTP 503');
  await page.unroute('**/isac/isac.wasm.gz');
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(editor(page)).toBeVisible({ timeout: 90_000 });
});

test('example links open the Lab with that program and start loading', async ({ page }) => {
  await page.goto('./');
  await page.locator('.card').first().click();
  await expect(editor(page)).toBeVisible({ timeout: 90_000 });
  const id = new URL(page.url()).searchParams.get('example');
  await expect(page.locator('[data-example]')).toHaveValue(id);
});
