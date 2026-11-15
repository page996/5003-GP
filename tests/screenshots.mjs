/**
 * Visa Atlas · 截图生成（Playwright + 系统 Chrome）
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

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const shot = async name => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  saved docs/screenshots/${name}.png`);
  };

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.va-map-country', { timeout: 20000 });
    await page.waitForSelector('.va-result-card', { timeout: 20000 });
    await page.waitForTimeout(1200);
    await shot('explore');

    // 悬停地图：先重置视图，选无海外领地的大国，保证浮层稳定
    await page.locator('.va-map-reset, [aria-label*="重置地图"]').first().click().catch(() => {});
    await page.waitForTimeout(700);
    for (const iso2 of ['BR', 'CN', 'AU', 'CA']) {
      const target = page.locator(`.va-map-country[data-iso2="${iso2}"]`).first();
      if (!(await target.count())) continue;
      const box = await target.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(600);
        if (await page.locator('.va-map-tooltip').first().isVisible().catch(() => false)) {
          await shot('map-hover');
          break;
        }
      }
    }

    // 搜索
    const searchInput = page.locator('[data-testid="search-input"], input[aria-label*="搜索"]').first();
    await searchInput.click();
    await searchInput.fill('日本');
    await page.waitForTimeout(1000);
    await shot('search');

    // 国家档案
    const japanCard = page.locator('.va-result-card[data-iso2="JP"]').first();
    if (await japanCard.count()) {
      await japanCard.click();
      await page.waitForSelector('[data-testid="dossier"], .va-dossier', { timeout: 8000 });
      await page.waitForTimeout(600);
      await shot('dossier');
      await page.getByRole('button', { name: /返回结果/ }).first().click().catch(() => {});
      await page.waitForTimeout(300);
      await searchInput.fill('');
      await page.waitForTimeout(800);
    }

    // 筛选
    const asiaChip = page.locator('.va-rail button').filter({ hasText: '亚洲' }).first();
    if (await asiaChip.count()) {
      await asiaChip.click();
      await page.waitForTimeout(900);
      await shot('filters-asia');
      await asiaChip.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // 列表模式
    const listButton = page.locator('[data-testid="stage-toggle"] button').filter({ hasText: '列表' }).first();
    if (await listButton.count()) {
      await listButton.click();
      await page.waitForTimeout(800);
      await shot('list-view');
      await page.locator('[data-testid="stage-toggle"] button').filter({ hasText: '地图' }).first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // 演示明细：开启 demo + 切换商务签
    const demoSwitch = page.locator('[data-testid="demo-toggle"]').first();
    if (await demoSwitch.count()) {
      await demoSwitch.click();
      await page.waitForTimeout(700);
      const typeSelect = page.locator('select[aria-label*="签证用途"]').first();
      if (await typeSelect.count()) {
        await typeSelect.selectOption('BUSINESS');
        await page.waitForTimeout(1000);
        await shot('demo-business');
      }
    }

    // 宽屏
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(800);
    await shot('explore-1920');
  } catch (error) {
    console.error('✘ 截图失败：', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
