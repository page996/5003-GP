/**
 * Visa Atlas v2 · 浏览器验收（Playwright + 系统 Chrome，不下载浏览器）
 *
 * 前置：另开终端运行 `npm run dev`（API 3001 + Web 5173）。
 * 运行：npm run e2e
 * 环境变量：E2E_BASE_URL（默认 http://127.0.0.1:5173）、CHROME_PATH。
 *
 * 覆盖：地球渲染、悬停国家浮层、搜索预置词、模糊搜索、搜索结果选择、
 *       精简国家抽屉字段、点击地球选国、数据说明弹层、控制台零错误。
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
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(String(error)));

  const searchInput = page.locator('[data-testid="search-input"], .va-search input').first();
  const closeSheet = async () => {
    const button = page.locator('[data-testid="sheet-close"]').first();
    if (await button.count()) await button.click().catch(() => {});
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  };
  const openPreset = async label => {
    const preset = page.locator(`[data-testid="preset-${label}"], .va-presets button`).filter({ hasText: label }).first();
    await preset.click();
    await page.waitForTimeout(900);
  };
  const clearSearch = async () => {
    await searchInput.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(600);
  };

  try {
    /* 1. 首屏地球 */
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.va-globe canvas', { timeout: 25000 });
    await page.waitForFunction(() => window.__globeReady === true, undefined, { timeout: 25000 });
    await page.waitForTimeout(800);
    check(true, '地球 canvas 已渲染并完成加载');
    check(await searchInput.isVisible(), '顶部搜索框可见');
    const presetCount = await page.locator('.va-presets button, [data-testid^="preset-"]').count();
    check(presetCount >= 6, `预置词 ${presetCount} 个（≥6）`);
    check(
      await page.locator('[data-testid="policy-legend"]').isVisible().catch(() => false),
      '政策组语义色图例可见',
    );
    const bodyText = await page.locator('body').innerText();
    check(!/Filters|筛选栏|检索结果面板/.test(bodyText), '旧三栏 UI 已移除');

    /* 2. 预置词：免签 */
    await openPreset('免签');
    const rows = page.locator('[data-testid="result-row"], .va-search-row');
    const rowCount = await rows.count();
    check(rowCount > 0, `预置词「免签」返回 ${rowCount} 行结果`);
    const firstRowText = rowCount ? await rows.first().innerText() : '';
    check(/免签|签证|停留/.test(firstRowText), '结果行包含类别/停留信息');

    /* 3. hover 结果行 → 固定悬浮卡 */
    if (rowCount) {
      await rows.first().hover();
      await page.waitForTimeout(500);
      const hoverCard = page.locator('[data-testid="hover-card"], .va-hover-card').first();
      check(await hoverCard.isVisible().catch(() => false), 'hover 结果行出现固定悬浮卡');
      const hoverText = await hoverCard.innerText().catch(() => '');
      check(hoverText.includes('查看档案') || hoverText.includes('点击'), '悬浮卡提供查看档案入口');
    }

    /* 4. 点击结果行 → 国家抽屉 */
    if (rowCount) {
      await rows.first().click();
      await page.waitForSelector('[data-testid="country-sheet"], .va-sheet', { timeout: 8000 });
      await page.waitForTimeout(700);
      const sheet = page.locator('[data-testid="country-sheet"], .va-sheet').first();
      check(await sheet.isVisible(), '点击结果行打开国家抽屉');
      const sheetText = await sheet.innerText();
      check(/停留|入境/.test(sheetText), '抽屉包含停留/入境信息');
      check(/来源|路线/.test(sheetText), '抽屉包含来源/路线编号');
      check(!/待采集|费用|材料|审核时间/.test(sheetText), '抽屉已瘦身（不再预留费用/材料/审核时间空位）');
      await closeSheet();
    }

    /* 5. 图谱预置：美国只命中美国，不应出现无关国家 */
    await openPreset('美国');
    const usRows = page.locator('[data-testid="result-row"], .va-search-row');
    const usCount = await usRows.count();
    const usIso2 = usCount ? await usRows.first().getAttribute('data-iso2') : null;
    check(usCount === 1 && usIso2 === 'US', `预置词「美国」图谱精确命中 US（实际 ${usCount} 行 / ${usIso2}）`);
    check(
      await page.locator('[data-testid="graph-hint"]').first().isVisible().catch(() => false),
      '搜索结果显示知识图谱命中解释',
    );
    await openPreset('美国'); // 取消该预置

    /* 6. 搜索「日本」 */
    await clearSearch();
    await searchInput.fill('日本');
    await page.waitForTimeout(1000);
    const japanRow = page.locator('[data-testid="result-row"][data-iso2="JP"], .va-search-row[data-iso2="JP"]').first();
    check(await japanRow.count() > 0, '搜索「日本」命中 JP 行');
    if (await japanRow.count()) {
      await japanRow.click();
      await page.waitForTimeout(900);
      const sheet = page.locator('[data-testid="country-sheet"], .va-sheet').first();
      const text = await sheet.innerText().catch(() => '');
      check(text.includes('日本'), '日本抽屉显示国家名');
      check(!/undefined|NaN/.test(text), '抽屉无 undefined/NaN');
      await closeSheet();
    }

    /* 6. 模糊搜索（本地容错） */
    await clearSearch();
    await searchInput.fill('Japn');
    await page.waitForTimeout(700);
    const fuzzyRow = page.locator('[data-testid="suggestion-row"][data-iso2="JP"], [data-testid="result-row"][data-iso2="JP"]').first();
    check(await fuzzyRow.count() > 0, '模糊输入「Japn」建议命中 JP');
    await clearSearch();

    /* 7. 点击地球中心选国 */
    const canvasBox = await page.locator('.va-globe canvas').first().boundingBox();
    if (canvasBox) {
      await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
      await page.waitForTimeout(1100);
      const sheet = page.locator('[data-testid="country-sheet"], .va-sheet').first();
      check(await sheet.isVisible().catch(() => false), '点击地球国家打开国家抽屉');
      await closeSheet();
    } else {
      check(false, '拿到地球 canvas 尺寸');
    }

    /* 8. 地区预置：欧洲 */
    await openPreset('欧洲');
    const euRows = await page.locator('[data-testid="result-row"], .va-search-row').count();
    check(euRows > 0, `预置词「欧洲」返回 ${euRows} 行`);

    /* 9. 数据说明 */
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
