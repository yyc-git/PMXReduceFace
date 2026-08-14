// shot-tda-hole2.mjs — 洞位置 LOD100 vs LOD50 对比（h1=两腿之间 h2=右腋下）
import { createRequire } from 'module';
const require = createRequire('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
const { chromium } = require('playwright');

const outDir = 'shots-hole';
const { mkdirSync } = require('fs');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
for (const [name, extra] of [['h1', '&shot=h1'], ['h2', '&shot=h2']]) {
  for (const lod of ['LOD_100', 'LOD_50']) {
    await page.goto(`http://localhost:8096/?lod=${lod}${extra}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `${outDir}/${name}_${lod}.png` });
    console.log(`${name}_${lod} saved`);
  }
}
await browser.close();
