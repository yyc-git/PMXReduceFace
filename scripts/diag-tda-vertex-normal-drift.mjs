// diag-tda-vertex-normal-drift.mjs — 逐顶点法线漂移检测：输出 vs 输入（±0.05 内最近顶点）
// 定位 fix8 后仍被改写的法线（破面根因候选：touched 重算坏 / 未触碰误标 / 输入就有）
// 用法: node scripts/diag-tda-vertex-normal-drift.mjs <in.pmx> <out.pmx> [regName]
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);
const inPos = IN.vertices.map(v => v.position);
const inN = IN.vertices.map(v => v.normal);
const outPos = OUT.vertices.map(v => v.position);
const outN = OUT.vertices.map(v => v.normal);

const ang = (a, b) => {
  const c = Math.max(-1, Math.min(1, (a[0]*b[0]+a[1]*b[1]+a[2]*b[2]) / (Math.hypot(...a)*Math.hypot(...b) || 1)));
  return Math.acos(c) * 180 / Math.PI;
};

// 输入顶点桶
const cell = 0.1;
const grid = new Map();
inPos.forEach((p, i) => {
  const k = `${Math.floor(p[0]/cell)},${Math.floor(p[1]/cell)},${Math.floor(p[2]/cell)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
});

// 输出顶点 → 输入 ±0.05 内最近顶点法线
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
  if (bi < 0 || Math.sqrt(best) > 0.05) continue; // 无配对顶点（可能被合并）跳过
  const a = ang(outN[vi], inN[bi]);
  if (a > 20) drift.push({ vi, a, pos: p.slice(), dist: Math.sqrt(best) });
}

drift.sort((x, y) => y.a - x.a);
console.log(`输出顶点 ${outPos.length}，法线漂移 >20° 的配对顶点：${drift.length} 个`);
console.log('Top 30（角度降序）：');
for (const d of drift.slice(0, 30)) {
  console.log(`  v#${d.vi} drift=${d.a.toFixed(1)}° dist=${d.dist.toFixed(4)} @ (${d.pos.map(v=>v.toFixed(2)).join(', ')})`);
}

// 区域统计
const regions = {
  '右臂后侧 (x4-8.5,y12-16.5,z<0)': p => p[0] >= 4 && p[0] <= 8.5 && p[1] >= 12 && p[1] <= 16.5 && p[2] < 0,
  '右臂全 (x4-8.5,y12-16.5)': p => p[0] >= 4 && p[0] <= 8.5 && p[1] >= 12 && p[1] <= 16.5,
  '左大腿内侧 (|x|<2.5,y5-10)': p => Math.abs(p[0]) < 2.5 && p[1] >= 5 && p[1] <= 10,
  '其它': () => true,
};
console.log('\n区域分布：');
for (const [name, fn] of Object.entries(regions)) {
  const list = drift.filter(d => fn(d.pos));
  if (name !== '其它') console.log(`  ${name}: ${list.length} 个（其中 >60°: ${list.filter(d=>d.a>60).length}）`);
}
const named = drift.filter(d => regions['右臂后侧 (x4-8.5,y12-16.5,z<0)'](d.pos) || regions['左大腿内侧 (|x|<2.5,y5-10)'](d.pos));
const others = drift.filter(d => !named.includes(d));
console.log(`  其它: ${others.length} 个`);
