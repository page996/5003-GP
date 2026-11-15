/**
 * Visa Atlas · 浏览器验收（Playwright + 系统 Chrome，不下载浏览器）
 *
 * 前置：另开终端运行 `npm run dev`（API 3001 + Web 5173）。
 * 运行：npm run e2e
 * 环境变量：E2E_BASE_URL（默认 http://127.0.0.1:5173）、CHROME_PATH。
 *
 * 覆盖：首屏渲染、地图国家数、关键词检索、结果卡、国家档案、分面筛选、
 *       地图悬停浮层、列表模式、演示数据开关、控制台/页面错误。
 */
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const failures = [];
const consoleErrors = [];
const pageErrors = [];
const check = (condition, message) => {
  if (condition) { console.log(`  ✔ ${message}`); return true; }
  console.error(`  ✘ ${message}`);
  failures.push(message);
  return false;
};

async function main() {
  let reachable = false;
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
    reachable = response.ok;
  } catch { reachable = false; }
  if (!reachable) {
    console.error(`✘ 无法访问 ${BASE}。请先运行 npm run dev（API 3001 + Web 5173），如需自定义地址请设置 E2E_BASE_URL。`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    /* 1. 首屏 */
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.va-map-country', { timeout: 20000 });
    await page.waitForSelector('.va-result-card', { timeout: 20000 });
    const countryPaths = await page.locator('.va-map-country').count();
    check(countryPaths >= 200, `地图渲染国家多边形 ${countryPaths} 个（≥200）`);
    const resultCards = await page.locator('.va-result-card').count();
    check(resultCards > 0, `首屏结果卡 ${resultCards} 张`);
    const stageText = await page.locator('.va-stage').innerText();
    check(/249|250/.test(stageText), '舞台显示 249/250 目的地统计');

    /* 2. 关键词检索 */
    const searchInput = page.locator('[data-testid="search-input"], input[aria-label*="搜索"]').first();
    await searchInput.click();
    await searchInput.fill('日本');
    await page.waitForTimeout(900);
    const japanCard = page.locator('.va-result-card[data-iso2="JP"]').first();
    await japanCard.waitFor({ timeout: 8000 });
    check(await japanCard.isVisible(), '搜索「日本」命中结果卡 JP');
    check((await page.locator('.va-result-card').count()) < 30, '搜索结果数量已收窄');

    /* 3. 国家档案 */
    await japanCard.click();
    const dossier = page.locator('[data-testid="dossier"], .va-dossier').first();
    await dossier.waitFor({ timeout: 8000 });
    const dossierText = await dossier.innerText();
    check(dossierText.includes('日本'), '国家档案显示国家名');
    check(/待采集|摘要级|资料完整度/.test(dossierText), '档案显示资料成熟度/待采集字段');
    check(!/undefined|NaN/.test(dossierText), '档案无 undefined/NaN 文本');

    /* 4. 返回 + 清空搜索 */
    await page.getByRole('button', { name: /返回结果/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);
    const clearButton = page.locator('[data-testid="search-input"], input[aria-label*="搜索"]').first();
    await clearButton.fill('');
    await page.waitForTimeout(700);

    /* 5. 地图悬停浮层 */
    // 先重置地图视图，避免上一步日本聚焦导致目标国家跑出可视区
    await page.locator('.va-map-reset, [aria-label*="重置地图"]').first().click().catch(() => {});
    await page.waitForTimeout(600);
    let hovered = false;
    for (const iso2 of ['BR', 'CN', 'AU', 'CA']) {
      const target = page.locator(`.va-map-country[data-iso2="${iso2}"]`).first();
      if (!(await target.count())) continue;
      const box = await target.boundingBox();
      if (!box) continue;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(500);
      const tooltip = page.locator('.va-map-tooltip').first();
      if (await tooltip.isVisible().catch(() => false)) {
        const tooltipText = await tooltip.innerText().catch(() => '');
        if (tooltipText.trim().length > 0) {
          check(true, `地图悬停出现国家浮层（${iso2}）`);
          check(tooltipText.length > 3, `浮层显示国家信息：${tooltipText.split('\n')[0]}`);
          hovered = true;
          break;
        }
      }
    }
    if (!hovered) check(false, '地图悬停出现国家浮层');

    /* 6. 分面筛选：地区 */
    const asiaChip = page.locator('.va-rail button').filter({ hasText: '亚洲' }).first();
    if (await asiaChip.count()) {
      await asiaChip.click();
      await page.waitForTimeout(900);
      const totalText = await page.locator('[data-testid="result-total"], .va-results__total, .va-stage__count').first().innerText().catch(() => '');
      check(/\d+\s*(个目的地|条|目的地)/.test(totalText) || totalText.length > 0, `地区筛选后统计更新：${totalText.replace(/\s+/g, ' ').trim()}`);
      check((await page.locator('.va-result-card').count()) > 0, '地区筛选后仍有结果');
      await asiaChip.click().catch(() => {});
      await page.waitForTimeout(500);
    } else {
      check(false, '筛选栏找到「亚洲」chip');
    }

    /* 7. 列表模式 */
    const listButton = page.locator('[data-testid="stage-toggle"] button').filter({ hasText: '列表' }).first();
    await listButton.click();
    await page.waitForTimeout(600);
    check((await page.locator('.va-stage-grid .va-result-card').count()) > 0, '列表模式渲染结果网格');
    await page.locator('[data-testid="stage-toggle"] button').filter({ hasText: '地图' }).first().click();
    await page.waitForTimeout(400);

    /* 8. 演示明细开关 */
    const demoSwitch = page.locator('[data-testid="demo-toggle"]').first();
    if (await demoSwitch.count()) {
      await demoSwitch.click();
      await page.waitForTimeout(900);
      const demoBadge = await page.getByText('演示', { exact: false }).count();
      check(demoBadge > 0, '开启演示开关后出现演示标注');
    } else {
      check(false, '筛选栏存在演示开关');
    }

    /* 9. 数据说明弹层 */
    const notes = page.locator('[data-testid="data-notes"]').first();
    if (await notes.count()) {
      await notes.click();
      await page.waitForTimeout(400);
      check(await page.getByRole('dialog').first().isVisible().catch(() => false), '数据说明弹层可打开');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    /* 10. 控制台错误 */
    check(consoleErrors.length === 0, `控制台无 error（实际 ${consoleErrors.length}）`);
    check(pageErrors.length === 0, `页面无未捕获异常（实际 ${pageErrors.length}）`);
    if (consoleErrors.length) console.error(consoleErrors.slice(0, 5).join('\n'));
    if (pageErrors.length) console.error(pageErrors.slice(0, 5).join('\n'));
  } catch (error) {
    failures.push(`执行异常：${error instanceof Error ? error.message : String(error)}`);
    console.error('✘ 执行异常：', error);
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.error(`E2E 失败：${failures.length} 项`);
    process.exitCode = 1;
  } else {
    console.log('E2E 全部通过');
  }
}

main();
