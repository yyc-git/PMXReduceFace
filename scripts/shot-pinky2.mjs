// shot-pinky2.mjs — 真正的指尖特写：pan（右键拖拽）把手指移到画面中心 + 缩放
// 用法: node shot-pinky2.mjs <outDir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || './shots/pinky2';
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
await page.locator('#lod-buttons button', { hasText: 'LOD_70' }).click();
await page.waitForTimeout(3500);

// 旋转：先向下看（拖拽 up），再转左侧
async function drag(btn, dx, dy, steps = 30) {
  await page.mouse.move(700, 450);
  await page.mouse.down({ button: btn });
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(700 + (dx * i) / steps, 450 + (dy * i) / steps, { steps: 2 });
    await page.waitForTimeout(14);
  }
  await page.mouse.up({ button: btn });
  await page.waitForTimeout(500);
}
async function zoom(times) {
  for (let i = 0; i < times; i++) {
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, -800);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(600);
}
const shot = (name) => page.screenshot({ path: path.join(outDir, name) });

// 视角：下移 + 左转（看向模型左侧 = 左手区域）
await drag('left', 0, -300);   // 视角下移
await drag('left', 350, 0);    // 左转
await shot('a_left_view.png');
await zoom(5);
await shot('b_left_zoom.png');

// pan：右键拖拽把左手（x<0）移到画面中心（画面右移 → 相机看向左）
await drag('right', 300, 0);
await shot('c_left_pan1.png');
await drag('right', 200, 0);
await zoom(4);
await shot('d_left_pan_zoom.png');
await drag('right', 150, -80);
await zoom(3);
await shot('e_left_pinky.png');

// 转右侧（右手）：先转回来
await drag('left', -900, 0);   // 右转回
await drag('left', 0, -150);
await shot('f_right_view.png');
await zoom(4);
await drag('right', -350, 0);  // pan 向左 → 看向右手
await shot('g_right_pan.png');
await drag('right', -200, -60);
await zoom(4);
await shot('h_right_pinky.png');

await browser.close();
console.log('done ->', outDir);
