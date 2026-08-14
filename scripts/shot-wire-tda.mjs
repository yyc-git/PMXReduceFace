// shot-wire-tda.mjs — Tda LOD50 线框模式截图（右手臂背面破面拓扑）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || './shots-wire';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:8096/?wire=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
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

await shot('wire_fit.png');
await zoom(4);
await shot('wire_zoom.png');
// 转到背面
await drag(420, 0);
await shot('wire_back.png');
await zoom(2);
await shot('wire_back_zoom.png');
// 右侧（右手臂侧）
await drag(-200, 0);
await shot('wire_right.png');
await zoom(2);
await shot('wire_right_zoom.png');

await browser.close();
console.log('done ->', outDir);
