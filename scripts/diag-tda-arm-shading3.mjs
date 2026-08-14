// diag-tda-arm-shading3.mjs — 全手臂法线变化分布 + 接缝裂缝 + toon 带翻转预测
// 用法: node scripts/diag-tda-arm-shading3.mjs <in.pmx> <out.pmx>
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (a, b) => {
  const c = Math.max(-1, Math.min(1, dot(a, b) / (Math.hypot(...a) * Math.hypot(...b) || 1)));
  return Math.acos(c) * 180 / Math.PI;
};
const L = [50, 100, 80], Ll = Math.hypot(...L);

// 输出顶点 → 最近输入顶点（全域桶）
function buildNearest(outVert, inGrid, cell = 0.2) {
  const p = outVert.position;
  const gx = Math.floor(p[0]/cell), gy = Math.floor(p[1]/cell), gz = Math.floor(p[2]/cell);
  let best = 1e9, bestI = -1;
  for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
    const list = inGrid.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!list) continue;
    for (const i of list) {
      const q = IN.vertices[i].position;
      const d = (q[0]-p[0])**2 + (q[1]-p[1])**2 + (q[2]-p[2])**2;
      if (d < best) { best = d; bestI = i; }
    }
  }
  return bestI;
}

const cell = 0.2;
const inGrid = new Map();
IN.vertices.forEach((v, i) => {
  const k = `${Math.floor(v.position[0]/cell)},${Math.floor(v.position[1]/cell)},${Math.floor(v.position[2]/cell)}`;
  if (!inGrid.has(k)) inGrid.set(k, []);
  inGrid.get(k).push(i);
});

// 手臂全域: 右臂（本坐标系 x 为负 = 角色右侧）x -9.3..-3.5, y 9-16.5
const ARM = { x: [-9.3, -3.5], y: [9.0, 16.5], z: [-2.8, 3.2] };
const inArm = (p) => p[0] >= ARM.x[0] && p[0] <= ARM.x[1] && p[1] >= ARM.y[0] && p[1] <= ARM.y[1] && p[2] >= ARM.z[0] && p[2] <= ARM.z[1];

// 法线变化（fix8 修正口径）：输出顶点法线只有「在 ±0.05 位置内找不到任何输入顶点法线与其夹角
// ≤ 阈值」才算被改写（Tda 手臂是分层拼块，同位置常有多层重合顶点，贪心最近邻会把输出法线
// 错配到另一层的输入顶点 → 误报）。各带「>30° 数」改为该口径下的真变化数。
const localMinAng = (p, ref, tol = 0.05) => {
  const gx = Math.floor(p[0]/cell), gy = Math.floor(p[1]/cell), gz = Math.floor(p[2]/cell);
  let best = 1e9;
  for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
    const list = inGrid.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!list) continue;
    for (const i of list) {
      const q = IN.vertices[i].position;
      if (Math.hypot(q[0]-p[0], q[1]-p[1], q[2]-p[2]) > tol) continue;
      const d = ang(IN.vertices[i].normal, ref);
      if (d < best) best = d;
    }
  }
  return best;
};

const bands = new Map(); // y 带 → {n, sum, max, big}
const rows = [];
for (let oi = 0; oi < OUT.vertices.length; oi++) {
  const p = OUT.vertices[oi].position;
  if (!inArm(p)) continue;
  const d = localMinAng(p, OUT.vertices[oi].normal);
  if (d >= 1e9) continue; // 位置容差内无输入顶点（不应发生）
  const band = Math.floor(p[1]);
  if (!bands.has(band)) bands.set(band, { n: 0, sum: 0, max: 0, big: 0 });
  const b = bands.get(band);
  b.n++; b.sum += d; b.max = Math.max(b.max, d); if (d > 30) b.big++;
  rows.push({ oi, p, d });
}
console.log('y 带 | 顶点数 | 法线变化均值 | 最大 | >30° 数');
[...bands.entries()].sort((a, b) => a[0] - b[0]).forEach(([y, b]) => {
  console.log(`y=${y} | ${b.n} | ${(b.sum/b.n).toFixed(1)}° | ${b.max.toFixed(0)}° | ${b.big}`);
});

// 找出法线变化 >50° 的输出顶点分布（破面候选区域）
const big = rows.filter((r) => r.d > 50);
console.log(`\n法线变化 >50° 的输出顶点: ${big.length} 个`);
// 聚类（粗粒度）
const clus = [];
for (const r of big) {
  let found = false;
  for (const c of clus) {
    if (Math.abs(c.p[0]-r.p[0]) < 1.5 && Math.abs(c.p[1]-r.p[1]) < 1.0 && Math.abs(c.p[2]-r.p[2]) < 1.5) { c.n++; found = true; break; }
  }
  if (!found) clus.push({ p: r.p, n: 1 });
}
clus.sort((a, b) => b.n - a.n).forEach((c) => {
  console.log(`  簇 n=${c.n} @[${c.p.map(x=>x.toFixed(1)).join(',')}]`);
});

// 输出接缝裂缝: 重合顶点对 两侧法线夹角 >60° 且跨材质(手套/身体) 的裂缝位置
{
  const g = new Map();
  OUT.vertices.forEach((v, i) => {
    if (!inArm(v.position)) return;
    const k = `${Math.floor(v.position[0]/0.1)},${Math.floor(v.position[1]/0.1)},${Math.floor(v.position[2]/0.1)}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(i);
  });
  const cracks = new Map();
  for (const [, list] of g) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const pa = OUT.vertices[list[a]].position, pb = OUT.vertices[list[b]].position;
      if (Math.hypot(pa[0]-pb[0], pa[1]-pb[1], pa[2]-pb[2]) > 0.02) continue;
      const n = ang(OUT.vertices[list[a]].normal, OUT.vertices[list[b]].normal);
      if (n > 60) {
        const key = `${pa[0].toFixed(1)},${pa[1].toFixed(1)},${pa[2].toFixed(1)}`;
        if (!cracks.has(key)) cracks.set(key, 0);
        cracks.set(key, cracks.get(key) + 1);
      }
    }
  }
  console.log(`\n输出重合对法线夹角 >60° 的裂缝位置: ${cracks.size} 处`);
  [...cracks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, c]) => {
    console.log(`  @[${k}] pairs=${c}`);
  });
}
