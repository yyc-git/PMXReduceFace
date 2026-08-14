// diag-seam-stats.mjs — 通用接缝法线一致性统计: 输入 vs 输出（任意模型/区域）
// 用法: node scripts/diag-seam-stats.mjs <in.pmx> <out.pmx> [x0,x1,y0,y1,z0,z1]
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath, regionStr] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);
const REGION = regionStr ? regionStr.split(',').map(Number) : null;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (a, b) => {
  const c = Math.max(-1, Math.min(1, dot(a, b) / (Math.hypot(...a) * Math.hypot(...b) || 1)));
  return Math.acos(c) * 180 / Math.PI;
};

function coincidentPairAngles(m, maxDist = 0.02) {
  const cell = 0.1;
  const grid = new Map();
  m.vertices.forEach((v, i) => {
    const p = v.position;
    if (REGION && !(p[0] >= REGION[0] && p[0] <= REGION[1] && p[1] >= REGION[2] && p[1] <= REGION[3] && p[2] >= REGION[4] && p[2] <= REGION[5])) return;
    const k = `${Math.floor(p[0]/cell)},${Math.floor(p[1]/cell)},${Math.floor(p[2]/cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const angs = [];
  const seenPairs = new Set();
  for (const [, list] of grid) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const key = `${Math.min(list[a],list[b])}:${Math.max(list[a],list[b])}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const pa = m.vertices[list[a]].position, pb = m.vertices[list[b]].position;
      if (Math.hypot(pa[0]-pb[0], pa[1]-pb[1], pa[2]-pb[2]) < maxDist) angs.push(ang(m.vertices[list[a]].normal, m.vertices[list[b]].normal));
    }
  }
  return angs;
}

const p95 = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * 0.95))]; };
const report = (angs, label) => {
  console.log(`${label}: pairs=${angs.length} p50=${angs.length ? p95(angs.filter(()=>true)) : 0} p95=${p95(angs).toFixed(1)}° max=${angs.length ? Math.max(...angs).toFixed(1) : 0}° >40°:${angs.filter(x=>x>40).length} >70°:${angs.filter(x=>x>70).length} >100°:${angs.filter(x=>x>100).length}`);
};

console.log(`== ${inPath} (${REGION ? 'region ' + REGION : '全域'}) ==`);
report(coincidentPairAngles(IN), '输入');
report(coincidentPairAngles(OUT), '输出');
