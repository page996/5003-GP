/**
 * Visa Atlas v2 · 截图生成（Playwright + 系统 Chrome）
 *
 * 前置：另开终端运行 `npm run dev`。
 * 运行：npm run screenshots
 * 输出：docs/screenshots/*.png
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.resolve('docs/screenshots');

async function main() {
  await mkdir(OUT, { recursive: true });
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    console.error(`✘ 无法访问 ${BASE}。请先运行 npm run dev。`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const shot = async name => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  saved docs/screenshots/${name}.png`);
  };
  const searchInput = page.locator('[data-testid="search-input"], .va-search input').first();
  const openPreset = async label => {
    const preset = page.locator(`[data-testid="preset-${label}"], .va-presets button`).filter({ hasText: label }).first();
    await preset.click();
    await page.waitForTimeout(900);
  };

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.va-globe canvas', { timeout: 25000 });
    await page.waitForFunction(() => window.__globeReady === true, undefined, { timeout: 25000 });
    await page.waitForTimeout(1200);
    await shot('globe');

    // hover：通过搜索结果行 hover 触发地图高亮 + 固定悬浮卡
    await openPreset('免签');
    await shot('search-preset');
    const rows = page.locator('[data-testid="result-row"], .va-search-row');
    if (await rows.count()) {
      await rows.first().hover();
      await page.waitForTimeout(500);
      await shot('hover-card');
      await rows.first().click();
      await page.waitForTimeout(900);
      await shot('country-sheet');
      const expand = page.locator('[data-testid="sheet-expand"]').first();
      if (await expand.count()) {
        await expand.click();
        await page.waitForTimeout(600);
        await shot('country-sheet-expanded');
      }
      const close = page.locator('[data-testid="sheet-close"]').first();
      if (await close.count()) await close.click().catch(() => {});
      await page.waitForTimeout(400);
    }

    // 搜索「日本」
    await searchInput.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await searchInput.fill('日本');
    await page.waitForTimeout(1000);
    await shot('search-japan');

    // 模糊搜索
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await searchInput.fill('Japn');
    await page.waitForTimeout(800);
    await shot('search-fuzzy');

    // 宽屏初始状态
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.va-globe canvas', { timeout: 25000 });
    await page.waitForFunction(() => window.__globeReady === true, undefined, { timeout: 25000 });
    await page.waitForTimeout(1500);
    await shot('globe-1920');
  } catch (error) {
    console.error('✘ 截图失败：', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
