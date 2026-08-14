// shot-pinky3.mjs — URL 参数精准特写：相机直对小手指
// 用法: node shot-pinky3.mjs <outDir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || './shots/pinky3';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const shots = ['r1', 'r2', 'r3', 'r4', 'l1', 'l2', 'l3', 'l4'];

async function grab(lod, shot) {
  const url = `http://localhost:8096/?lod=${lod}&shot=${shot}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction((s) => {
    const hud = document.getElementById('hud-body');
    return hud && hud.textContent.includes('LOD');
  }, shot, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, `${lod}_${shot}.png`) });
}

for (const s of shots) {
  await grab('LOD_70', s);
}
// 同角度 LOD100 对比（r1/l1/r2/l2 即可）
for (const s of ['r1', 'r2', 'l1', 'l2']) {
  await grab('LOD_100', s);
}

await browser.close();
console.log('done ->', outDir);
