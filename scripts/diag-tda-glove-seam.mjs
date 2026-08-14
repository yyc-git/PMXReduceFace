// diag-tda-glove-seam.mjs — 手套/身体跨界接缝: 输入(艺术家) vs 输出(recompute) 法线对角度
// 用法: node scripts/diag-tda-glove-seam.mjs <in.pmx> <out.pmx>
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (a, b) => {
  const c = Math.max(-1, Math.min(1, dot(a, b) / (Math.hypot(...a) * Math.hypot(...b) || 1)));
  return Math.acos(c) * 180 / Math.PI;
};

function triMaterialMap(m) {
  const map = new Uint16Array(m.faces.length);
  let off = 0;
  for (let mi = 0; mi < m.materials.length; mi++) {
    const cnt = m.materials[mi].faceCount || 0;
    for (let k = 0; k < cnt && off + k < m.faces.length; k++) map[off + k] = mi;
    off += cnt;
  }
  return map;
}

// 顶点 → 材质集合（其邻接三角形）
function vertMats(m, tm) {
  const vM = m.vertices.map(() => new Set());
  m.faces.forEach((f, ti) => { for (const vi of f.indices) vM[vi].add(tm[ti]); });
  return vM;
}

// 跨材质重合顶点对（手套 22 ↔ 身体 0），限制 y 12.0-12.8（手套上沿）
function crossMatPairs(m, tm, y0 = 12.0, y1 = 12.8) {
  const vM = vertMats(m, tm);
  const cell = 0.1;
  const grid = new Map();
  m.vertices.forEach((v, i) => {
    const p = v.position;
    if (p[1] < y0 || p[1] > y1) return;
    const k = `${Math.floor(p[0]/cell)},${Math.floor(p[1]/cell)},${Math.floor(p[2]/cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const out = [];
  const seen = new Set();
  for (const [, list] of grid) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const i = list[a], j = list[b];
      const key = `${Math.min(i,j)}:${Math.max(i,j)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pa = m.vertices[i].position, pb = m.vertices[j].position;
      if (Math.hypot(pa[0]-pb[0], pa[1]-pb[1], pa[2]-pb[2]) > 0.02) continue;
      const mA = vM[i], mB = vM[j];
      const cross = (mA.has(0) && mB.has(22)) || (mA.has(22) && mB.has(0));
      if (!cross) continue;
      out.push({ i, j, n: ang(m.vertices[i].normal, m.vertices[j].normal), p: pa });
    }
  }
  return out;
}

const IN_TM = triMaterialMap(IN);
const OUT_TM = triMaterialMap(OUT);
const inP = crossMatPairs(IN, IN_TM);
const outP = crossMatPairs(OUT, OUT_TM);

const p95 = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * 0.95))]; };
console.log(`手套↔身体跨界重合对 (y 12.0-12.8):`);
console.log(`输入: pairs=${inP.length} p50=${p95(inP.map(x=>x.n))} p95=${p95(inP.map(x=>x.n)).toFixed(1)}° max=${Math.max(...inP.map(x=>x.n)).toFixed(1)}° | >40°: ${inP.filter(x=>x.n>40).length} >70°: ${inP.filter(x=>x.n>70).length}`);
console.log(`输出: pairs=${outP.length} p50=${p95(outP.map(x=>x.n))} p95=${p95(outP.map(x=>x.n)).toFixed(1)}° max=${Math.max(...outP.map(x=>x.n)).toFixed(1)}° | >40°: ${outP.filter(x=>x.n>40).length} >70°: ${outP.filter(x=>x.n>70).length}`);

// 配对检查：同一位置输入对角度 vs 输出对角度（只对比能匹配上的位置）
console.log('\n位置级对比（输入小角度→输出大角度的「翻转点」）:');
{
  const cell = 0.1;
  const grid = new Map();
  inP.forEach((x, idx) => {
    const p = x.p;
    const k = `${Math.floor(p[0]/cell)},${Math.floor(p[1]/cell)},${Math.floor(p[2]/cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(idx);
  });
  let flipped = 0, matched = 0;
  for (const o of outP) {
    const p = o.p;
    const gx = Math.floor(p[0]/cell), gy = Math.floor(p[1]/cell), gz = Math.floor(p[2]/cell);
    let best = -1, bestD = 1e9;
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
      const list = grid.get(`${gx+dx},${gy+dy},${gz+dz}`);
      if (!list) continue;
      for (const idx of list) {
        const q = inP[idx].p;
        const d = (q[0]-p[0])**2 + (q[1]-p[1])**2 + (q[2]-p[2])**2;
        if (d < bestD) { bestD = d; best = idx; }
      }
    }
    if (best >= 0) {
      matched++;
      const nIn = inP[best].n, nOut = o.n;
      if (nOut - nIn > 40) flipped++;
    }
  }
  console.log(`输出跨界对 ${outP.length} 个中 ${matched} 个能在输入找到同位置对`);
  console.log(`其中输出对角比输入对角大 >40° 的（接缝翻转点）: ${flipped}`);
}
