// diag-tda-new-broken.mjs — 抓「减面新增/恶化的破面」（对比输入 vs 输出，修正双层布料口径）
// 输出两类新增：① 新增超尺寸三角形（maxL ≥ 2× 输入局部 p90，且 ≥0.5）② 新增法线漂移顶点
// （±0.05 内**找不到任何**法线夹角 ≤20° 的输入顶点 = 真正的新增漂移；多层布料同位置有匹配层不算）
// 用法: node scripts/diag-tda-new-broken.mjs <in.pmx> <out.pmx>
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
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
const triGeom = (pos, t) => {
  const p0 = pos[t[0]], p1 = pos[t[1]], p2 = pos[t[2]];
  return Math.max(Math.hypot(p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]), Math.hypot(p2[0]-p0[0],p2[1]-p0[1],p2[2]-p0[2]), Math.hypot(p2[0]-p1[0],p2[1]-p1[1],p2[2]-p1[2]));
};
const triCentroid = (pos, t) => {
  const p0 = pos[t[0]], p1 = pos[t[1]], p2 = pos[t[2]];
  return [(p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3];
};

// ============ 1. 新增超尺寸三角形（局部相对口径） ============
const cell = 0.25;
const inGridTri = new Map();
for (const t of inTri) {
  const c = triCentroid(inPos, t);
  const k = `${Math.floor(c[0]/cell)},${Math.floor(c[1]/cell)},${Math.floor(c[2]/cell)}`;
  if (!inGridTri.has(k)) inGridTri.set(k, []);
  inGridTri.get(k).push({ c, maxL: triGeom(inPos, t) });
}
const localP90 = (c) => {
  const gx = Math.floor(c[0]/cell), gy = Math.floor(c[1]/cell), gz = Math.floor(c[2]/cell);
  const ls = [];
  for (let dx=-2; dx<=2; dx++) for (let dy=-2; dy<=2; dy++) for (let dz=-2; dz<=2; dz++) {
    const list = inGridTri.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!list) continue;
    for (const e of list) if (Math.hypot(e.c[0]-c[0], e.c[1]-c[1], e.c[2]-c[2]) <= 0.5) ls.push(e.maxL);
  }
  if (!ls.length) return null;
  ls.sort((a,b)=>a-b);
  return ls[Math.min(ls.length-1, Math.floor(ls.length*0.9))];
};
const newBig = [];
for (let ti = 0; ti < outTri.length; ti++) {
  const maxL = triGeom(outPos, outTri[ti]);
  const c = triCentroid(outPos, outTri[ti]);
  const base = localP90(c);
  if (base === null || base < 0.05) continue;
  if (maxL / base >= 2.0 && maxL >= 0.5) newBig.push({ ti, maxL, base, ratio: maxL/base, c });
}
newBig.sort((a,b) => b.ratio - a.ratio);

// ============ 2. 新增法线漂移顶点（修正口径：找不到任何匹配层才算） ============
const vcell = 0.1;
const inGridV = new Map();
inPos.forEach((p, i) => {
  const k = `${Math.floor(p[0]/vcell)},${Math.floor(p[1]/vcell)},${Math.floor(p[2]/vcell)}`;
  if (!inGridV.has(k)) inGridV.set(k, []);
  inGridV.get(k).push(i);
});
const drift = [];
for (let vi = 0; vi < outPos.length; vi++) {
  const p = outPos[vi];
  const gx = Math.floor(p[0]/vcell), gy = Math.floor(p[1]/vcell), gz = Math.floor(p[2]/vcell);
  let best = 1e9, bestAng = 1e9;
  for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
    const list = inGridV.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!list) continue;
    for (const i of list) {
      const q = inPos[i];
      const d = Math.hypot(q[0]-p[0], q[1]-p[1], q[2]-p[2]);
      if (d > 0.05) continue;
      if (d < best) best = d;
      const a = ang(outN[vi], inN[i]);
      if (a < bestAng) bestAng = a;
    }
  }
  if (bestAng > 20 && best <= 0.05) drift.push({ vi, ang: bestAng, pos: p.slice() });
}
drift.sort((a,b) => b.ang - a.ang);

// ============ 3. 区域归类（右臂后侧 / 左大腿内侧 / 其它） ============
const regions = [
  { name: '右臂后侧 (x4-9,y12-16.5,z<0)', fn: p => p[0]>=4 && p[0]<=9 && p[1]>=12 && p[1]<=16.5 && p[2]<0 },
  { name: '左大腿内侧 (|x|<2.5,y5-10)', fn: p => Math.abs(p[0])<2.5 && p[1]>=5 && p[1]<=10 },
  { name: '胯部双层 (|x|<2.5,y10-12)', fn: p => Math.abs(p[0])<2.5 && p[1]>=10 && p[1]<=12 },
];
const classify = (p) => {
  for (const r of regions) if (r.fn(p)) return r.name;
  return '其它';
};

console.log(`输入 ${inTri.length} 三角 / ${inPos.length} 顶点 → 输出 ${outTri.length} 三角 / ${outPos.length} 顶点`);
console.log(`\n【1】新增超尺寸三角形（maxL ≥ 2×输入局部p90 且 ≥0.5）：${newBig.length} 个`);
for (const r of [...regions, { name: '其它', fn: () => true }]) {
  const list = newBig.filter(h => r.fn(h.c));
  if (list.length) {
    console.log(`  ${r.name}: ${list.length}`);
    for (const h of list.slice(0, 8)) console.log(`    #${h.ti} maxL=${h.maxL.toFixed(3)} (${h.ratio.toFixed(1)}×) @ (${h.c.map(v=>v.toFixed(2)).join(', ')})`);
  }
}
console.log(`\n【2】新增法线漂移顶点（±0.05 内无 ≤20° 匹配层）：${drift.length} 个`);
for (const r of [...regions, { name: '其它', fn: () => true }]) {
  const list = drift.filter(h => r.fn(h.pos));
  if (list.length) {
    console.log(`  ${r.name}: ${list.length}`);
    for (const h of list.slice(0, 8)) console.log(`    v#${h.vi} drift=${h.ang.toFixed(1)}° @ (${h.pos.map(v=>v.toFixed(2)).join(', ')})`);
  }
}
