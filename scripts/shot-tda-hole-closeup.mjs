// shot-tda-hole-closeup.mjs — 兄弟图1洞位置特写（两腿之间 y≈12）
// 相机从正面偏下看两腿之间: pos(0, 10.5, 5.5) → tgt(0.4, 12.0, 1.0)
import { createRequire } from 'module';
const require = createRequire('C:/Users/one/AppData/Roaming/npm/node_modules/playwright/index.mjs');
const { chromium } = require('playwright');

const outDir = process.argv[2] || 'shots-hole';
const { mkdirSync } = require('fs');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
// 需要 demo/main.ts 支持 h1 相机（两腿之间）。先试试已有 shot 或默认视角 + 放大
const shots = [
  ['default', ''],
  ['tb2', '&shot=tb2'],
];
for (const [name, extra] of shots) {
  for (const lod of ['LOD_100', 'LOD_50']) {
    await page.goto(`http://localhost:8096/?lod=${lod}${extra}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `${outDir}/${name}_${lod}.png` });
    console.log(`${name}_${lod} saved`);
  }
}
await browser.close();
