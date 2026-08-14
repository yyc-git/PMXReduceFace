// shot-tda-arm-closeup.mjs — 右手臂上臂背面特写（LOD50 vs LOD100 对比）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || './shots-arm';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

async function grab(lod, shot, name) {
  const url = `http://localhost:8096/?lod=${lod}&shot=${shot}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForFunction(() => {
    const hud = document.getElementById('hud-body');
    return hud && hud.textContent.includes('LOD');
  }, { timeout: 60000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(outDir, name) });
}

for (const s of ['ta1', 'ta2', 'ta3']) {
  await grab('LOD_50', s, `50_${s}.png`);
  await grab('LOD_100', s, `100_${s}.png`);
}
await browser.close();
console.log('done ->', outDir);
