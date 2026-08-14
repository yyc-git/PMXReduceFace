// shot-tda-back.mjs — Tda LOD50 右手臂背面特写
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || './shots-tda-back';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:8096/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForFunction(() => {
  const hud = document.getElementById('hud-body');
  return hud && hud.textContent.includes('LOD');
}, { timeout: 60000 });
await page.waitForTimeout(3500);
await page.locator('#lod-buttons button', { hasText: 'LOD_50' }).click();
await page.waitForTimeout(4000);

const shot = (n) => page.screenshot({ path: path.join(outDir, n) });
const drag = async (dx, dy, steps = 25) => {
  await page.mouse.move(700, 450);
  await page.mouse.down();
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(700 + (dx * i) / steps, 450 + (dy * i) / steps, { steps: 2 });
    await page.waitForTimeout(14);
  }
  await page.mouse.up();
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

// 旋转到背面（水平拖拽 ~400px 转 180°）
await drag(420, 0);
await shot('back_full.png');
await zoom(4);
await shot('back_zoom.png');
// 向下看 + 放大右手臂（模型右侧 = viewer 左侧？先拍两侧）
await drag(0, -200);
await shot('back_down.png');
await zoom(3);
await shot('back_down_zoom.png');
// 转向右侧看右手臂
await drag(-200, 0);
await shot('side_right.png');
await zoom(2);
await shot('side_right_zoom.png');
// 再转左侧
await drag(400, 0);
await shot('side_left.png');
await zoom(2);
await shot('side_left_zoom.png');

await browser.close();
console.log('done ->', outDir);
