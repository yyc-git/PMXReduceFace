// shot-tda-wire-compare.mjs — LOD100 vs LOD50 线框同视角对比
import { createRequire } from 'module';
const require = createRequire('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
const { chromium } = require('playwright');

const outDir = 'shots-wire-cmp';
const { mkdirSync } = require('fs');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const shots = [
  ['tb2', '&shot=tb2'],   // 左大腿内侧
  ['tb1', '&shot=tb1'],   // 右臂后侧
];
for (const [name, extra] of shots) {
  for (const lod of ['LOD_100', 'LOD_50']) {
    await page.goto(`http://localhost:8096/?lod=${lod}&wire=1${extra}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `${outDir}/${name}_${lod}.png` });
    console.log(`${name}_${lod} saved`);
  }
}
await browser.close();
