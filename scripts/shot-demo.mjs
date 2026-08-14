// shot-demo.mjs — PMXReduceFace demo 截图（LOD 对比 + 小手指特写）
// 用法: node shot-demo.mjs <outDir> [lod]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || './shots';
const lod = process.argv[3] || 'LOD_70';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto('http://localhost:8096/', { waitUntil: 'domcontentloaded', timeout: 30000 });
// 等模型加载（canvas 出现 + HUD 有 LOD 文本）
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForFunction(() => {
  const hud = document.getElementById('hud-body');
  return hud && hud.textContent.includes('LOD');
}, { timeout: 60000 });
await page.waitForTimeout(2000);

// 切到目标 LOD
const btn = page.locator('#lod-buttons button', { hasText: lod });
await btn.click();
await page.waitForTimeout(3500);

// 截图 1：fit 整体视角
await page.screenshot({ path: path.join(outDir, `${lod}_fit.png`) });

// 放大：滚轮向下（zoom in）3 次
for (let i = 0; i < 3; i++) {
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(400);
}
await page.waitForTimeout(800);

// 截图 2：放大后（手部区域）
await page.screenshot({ path: path.join(outDir, `${lod}_zoom.png`) });

// 拖拽旋转：把视角向左侧（x 负方向）转，让左手/右手可见
await page.mouse.move(700, 450);
await page.mouse.down();
for (let i = 0; i < 30; i++) {
  await page.mouse.move(700 + i * 8, 450 - i * 2, { steps: 2 });
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, `${lod}_rot.png`) });

// 再向下旋转一点（手部更居中）
await page.mouse.move(700, 450);
await page.mouse.down();
for (let i = 0; i < 20; i++) {
  await page.mouse.move(700, 450 + i * 5, { steps: 2 });
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, `${lod}_rot2.png`) });

await browser.close();
console.log('done ->', outDir);
