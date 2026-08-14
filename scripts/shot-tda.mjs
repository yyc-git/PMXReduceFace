// shot-tda.mjs — Tda 光辉模型测试截图（原版 vs LOD50 + 手部特写）
// 用法: node shot-tda.mjs <outDir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || './shots-tda';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });

await page.goto('http://localhost:8096/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForFunction(() => {
  const hud = document.getElementById('hud-body');
  return hud && hud.textContent.includes('LOD');
}, { timeout: 60000 });
await page.waitForTimeout(4000);

const shot = (n) => page.screenshot({ path: path.join(outDir, n) });
const drag = async (btn, dx, dy, steps = 25) => {
  await page.mouse.move(700, 450);
  await page.mouse.down({ button: btn });
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(700 + (dx * i) / steps, 450 + (dy * i) / steps, { steps: 2 });
    await page.waitForTimeout(14);
  }
  await page.mouse.up({ button: btn });
  await page.waitForTimeout(500);
};
const zoom = async (t) => {
  for (let i = 0; i < t; i++) {
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, -700);
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(600);
};

// LOD_100 原版
await shot('100_fit.png');
await zoom(5);
await shot('100_zoom.png');
// 手部：向下旋转视角（手在 y 9-13，模型中部偏下）
await drag('left', 0, -260);
await shot('100_down.png');
await drag('left', 300, 0);
await shot('100_left_hand.png');
await zoom(3);
await shot('100_left_hand_zoom.png');

// 切 LOD_50
await page.locator('#lod-buttons button', { hasText: 'LOD_50' }).click();
await page.waitForTimeout(4000);
await shot('50_fit.png');
await zoom(5);
await shot('50_zoom.png');
await drag('left', 0, -260);
await shot('50_down.png');
await drag('left', 300, 0);
await shot('50_left_hand.png');
await zoom(3);
await shot('50_left_hand_zoom.png');

await browser.close();
console.log('done ->', outDir);
