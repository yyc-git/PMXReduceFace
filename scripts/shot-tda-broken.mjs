// shot-tda-broken.mjs — Tda 大破面定位截图（tb1=右臂后侧 tb2=左大腿内侧）
import { createRequire } from 'module';
const require = createRequire('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
const { chromium } = require('playwright');

const outDir = process.argv[2] || 'shots-broken';
const { mkdirSync } = require('fs');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
for (const [shot, label] of [['tb1', '右臂后侧'], ['tb2', '左大腿内侧']]) {
  await page.goto(`http://localhost:8096/?shot=${shot}&lod=LOD_50`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${outDir}/${shot}_lod50.png` });
  console.log(`${shot} (${label}) lod50 saved`);
}
await browser.close();
