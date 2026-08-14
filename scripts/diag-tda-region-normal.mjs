// diag-tda-region-normal.mjs — 严格法线对比：LOD100 vs LOD50 指定区域
// 输出「同一位置（±0.02）顶点，最近配对法线角度差 > 阈值」的顶点 + 关联三角形
// 用法: node scripts/diag-tda-region-normal.mjs <in.pmx> <out.pmx> <regName: thigh|arm|all>
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath, regName = 'thigh'] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);
const inPos = IN.vertices.map(v => v.position);
const inN = IN.vertices.map(v => v.normal);
const outPos = OUT.vertices.map(v => v.position);
const outN = OUT.vertices.map(v => v.normal);
const inTri = (IN.faces || []).map(f => f.indices);
const outTri = (OUT.faces || []).map(f => f.indices);

const ang = (a, b) => {
  const c = Math.max(-1, Math.min(1, (a[0]*b[0]+a[1]*b[1]+a[2]*b[2]) / (Math.hypot(...a)*Math.hypot(...b) || 1)));
  return Math.acos(c) * 180 / Math.PI;
};
const cent = (pos, t) => {
  const p0 = pos[t[0]], p1 = pos[t[1]], p2 = pos[t[2]];
  return [(p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3];
};

const regions = {
  // 兄弟报告位置：左大腿内侧（两腿之间）+ 右臂后侧
  thigh: (c) => Math.abs(c[0]) < 3 && c[1] >= 5 && c[1] <= 10,
  arm: (c) => c[0] >= 3.5 && c[0] <= 9 && c[1] >= 12 && c[1] <= 16.5 && c[2] < 0.5,
  all: () => true,
};
const inRegion = regions[regName] || regions.thigh;

// 输入顶点桶（0.02）
const cell = 0.05;
const grid = new Map();
inPos.forEach((p, i) => {
  const k = `${Math.floor(p[0]/cell)},${Math.floor(p[1]/cell)},${Math.floor(p[2]/cell)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
});

// 对每个输出顶点：找 ±0.02 内最近的输入顶点（严格最近配对），算法线角度差
const drift = [];
for (let vi = 0; vi < outPos.length; vi++) {
  const p = outPos[vi];
  const gx = Math.floor(p[0]/cell), gy = Math.floor(p[1]/cell), gz = Math.floor(p[2]/cell);
  let best = 1e9, bi = -1;
  for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
    const list = grid.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!list) continue;
    for (const i of list) {
      const q = inPos[i];
      const d = (q[0]-p[0])**2 + (q[1]-p[1])**2 + (q[2]-p[2])**2;
      if (d < best) { best = d; bi = i; }
    }
  }
  if (bi < 0 || Math.sqrt(best) > 0.02) continue; // 位置无配对 → 折叠合并产生的新顶点，跳过
  const a = ang(outN[vi], inN[bi]);
  if (a > 30) drift.push({ vi, bi, a, pos: p.slice(), dist: Math.sqrt(best) });
}

// 只保留区域内的
const inRegionDrift = drift.filter(d => inRegion(d.pos));
console.log(`区域 ${regName}: 输出顶点法线漂移 >30°（严格最近配对）: ${inRegionDrift.length} 个 / 全部漂移 ${drift.length}`);
inRegionDrift.sort((a,b) => b.a - a.a);
for (const d of inRegionDrift.slice(0, 30)) {
  console.log(`  v#${d.vi}→in#${d.bi} drift=${d.a.toFixed(1)}° dist=${d.dist.toFixed(4)} @ (${d.pos.map(v=>v.toFixed(2)).join(', ')}) 输出N[${outN[d.vi].map(x=>x.toFixed(2))}] 输入N[${inN[d.bi].map(x=>x.toFixed(2))}]`);
}

// 这些漂移顶点关联的输出三角形数量（影响面数）
if (inRegionDrift.length) {
  const vset = new Set(inRegionDrift.map(d => d.vi));
  let triCount = 0; const tris = [];
  outTri.forEach((t, i) => { if (t.some(v => vset.has(v))) { triCount++; tris.push(i); } });
  console.log(`关联输出三角形: ${triCount} 个`);
  // 这些三角形的质心位置
  for (const ti of tris.slice(0, 10)) {
    const c = cent(outPos, outTri[ti]);
    console.log(`  tri#${ti} @ (${c.map(v=>v.toFixed(2)).join(', ')})`);
  }
}
