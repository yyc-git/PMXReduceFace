// shot-tda-wire2.mjs — Tda LOD50 线框截图（看洞）：右臂后侧 + 左大腿内侧 + 默认视角
import { createRequire } from 'module';
const require = createRequire('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
const { chromium } = require('playwright');

const outDir = process.argv[2] || 'shots-wire2';
const { mkdirSync } = require('fs');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const shots = [
  ['default', ''],
  ['tb1', '&shot=tb1'],
  ['tb2', '&shot=tb2'],
  ['ta2', '&shot=ta2'],
];
for (const [name, extra] of shots) {
  await page.goto(`http://localhost:8096/?lod=LOD_50&wire=1${extra}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${name} saved`);
}
await browser.close();
