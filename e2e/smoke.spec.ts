import { expect, test } from '@playwright/test';

const errors = new WeakMap<object, string[]>();

test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (error) => list.push(error.message));
  page.on('console', (message) => message.type() === 'error' && list.push(message.text()));
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test('hero renders in a worker and follows scroll', async ({ page }) => {
  const mode = await page.evaluate(async () => {
    const el = document.querySelector('#hero-ribbon')!;
    await el.ribbon!.ready;
    return el.ribbon!.mode;
  });
  expect(mode).toBe('worker');

  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.8));
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#hero-ribbon')!.progress))
    .toBeGreaterThan(0.4);
  await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector('.copy')!).opacity))).toBeLessThan(0.05);
});

test('falls back to the main thread and draws glyphs', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:10';
    const el = document.createElement('glyph-ribbon');
    el.setAttribute('worker', 'false');
    el.setAttribute('intro', 'false');
    el.style.cssText = 'width:600px;height:400px;color:#fff';
    host.append(el);
    document.body.append(host);
    await el.ribbon!.ready;
    await new Promise((r) => setTimeout(r, 200));
    const canvas = el.shadowRoot!.querySelector('canvas')!;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return { mode: el.ribbon!.mode, painted };
  });
  expect(result.mode).toBe('main');
  expect(result.painted).toBeGreaterThan(1000);
});

test('playground preview rebuilds from options', async ({ page }) => {
  await page.locator('#preview').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('#preview')!.ribbon!.ready);
  await page.locator('input[name="image"]').check();
  await page.locator('input[name="glyphs"]').fill('ab');
  await expect(page.locator('#config')).toContainText('"b"');
  await expect(page.locator('#config')).toContainText('mark.svg');
});
