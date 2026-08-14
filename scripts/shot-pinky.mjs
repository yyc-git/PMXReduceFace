// shot-pinky.mjs — 小手指特写截图（放大 + 多角度旋转）
// 用法: node shot-pinky.mjs <outDir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || './shots/pinky';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:8096/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForFunction(() => {
  const hud = document.getElementById('hud-body');
  return hud && hud.textContent.includes('LOD');
}, { timeout: 60000 });
await page.waitForTimeout(2000);

// 切到 LOD_70
await page.locator('#lod-buttons button', { hasText: 'LOD_70' }).click();
await page.waitForTimeout(3500);

// 强烈放大（zoom in 8 次）
for (let i = 0; i < 8; i++) {
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -700);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, 'p0_zoom.png') });

// 向下旋转视角（拖拽向上移动 → 看模型下部/手部）
async function drag(dx, dy, steps = 25) {
  await page.mouse.move(700, 450);
  await page.mouse.down();
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(700 + (dx * i) / steps, 450 + (dy * i) / steps, { steps: 2 });
    await page.waitForTimeout(14);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
}

// 视角下移（拖拽向上 = 旋转向下看）
await drag(0, -260);
await page.screenshot({ path: path.join(outDir, 'p1_down.png') });

// 左转（拖拽向右 → 视角左转，看模型左侧）
await drag(260, 0);
await page.screenshot({ path: path.join(outDir, 'p2_left.png') });

// 继续左转更多
await drag(200, 0);
await page.screenshot({ path: path.join(outDir, 'p3_left2.png') });

// 再放大一点
for (let i = 0; i < 4; i++) {
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -700);
  await page.waitForTimeout(200);
}
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(outDir, 'p4_left_zoom.png') });

// 右转回中心再右转（看模型右侧）
await drag(-460, 0);
await page.screenshot({ path: path.join(outDir, 'p5_right.png') });

await drag(-200, 0);
await page.screenshot({ path: path.join(outDir, 'p6_right2.png') });

// 再放大
for (let i = 0; i < 4; i++) {
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -700);
  await page.waitForTimeout(200);
}
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(outDir, 'p7_right_zoom.png') });

await browser.close();
console.log('done ->', outDir);
