// diag-tda-arm-full.mjs — 右侧手臂完整分析（native 坐标: 角色右侧 = x<0）
// 用法: node scripts/diag-tda-arm-full.mjs <in.pmx> <out.pmx>
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (a, b) => {
  const c = Math.max(-1, Math.min(1, dot(a, b) / (Math.hypot(...a) * Math.hypot(...b) || 1)));
  return Math.acos(c) * 180 / Math.PI;
};

function tmMap(m) {
  const map = new Uint16Array(m.faces.length);
  let off = 0;
  for (let mi = 0; mi < m.materials.length; mi++) {
    const cnt = m.materials[mi].faceCount || 0;
    for (let k = 0; k < cnt && off + k < m.faces.length; k++) map[off + k] = mi;
    off += cnt;
  }
  return map;
}
const IN_TM = tmMap(IN);
const OUT_TM = tmMap(OUT);

// 右臂区域: x -8.8..-0.5, y 10.5..16.5, z -3..3
const ARM = { x: [-8.8, -0.5], y: [10.5, 16.5], z: [-3.0, 3.0] };
const inArm = (p) => p[0] >= ARM.x[0] && p[0] <= ARM.x[1] && p[1] >= ARM.y[0] && p[1] <= ARM.y[1] && p[2] >= ARM.z[0] && p[2] <= ARM.z[1];

// 输入顶点 → 输出最近顶点（桶）
const cell = 0.2;
const outGrid = new Map();
OUT.vertices.forEach((v, i) => {
  const k = `${Math.floor(v.position[0]/cell)},${Math.floor(v.position[1]/cell)},${Math.floor(v.position[2]/cell)}`;
  if (!outGrid.has(k)) outGrid.set(k, []);
  outGrid.get(k).push(i);
});
const nearestOut = (p) => {
  const gx = Math.floor(p[0]/cell), gy = Math.floor(p[1]/cell), gz = Math.floor(p[2]/cell);
  let best = 1e9, bestI = -1;
  for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
    const list = outGrid.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!list) continue;
    for (const i of list) {
      const q = OUT.vertices[i].position;
      const d = (q[0]-p[0])**2 + (q[1]-p[1])**2 + (q[2]-p[2])**2;
      if (d < best) { best = d; bestI = i; }
    }
  }
  return bestI;
};

// 输入顶点 → 法线变化 (输出最近顶点法线 vs 输入法线)，按 y 带统计
const bands = new Map();
for (let vi = 0; vi < IN.vertices.length; vi++) {
  const p = IN.vertices[vi].position;
  if (!inArm(p)) continue;
  const oi = nearestOut(p);
  if (oi < 0) continue;
  const d = ang(IN.vertices[vi].normal, OUT.vertices[oi].normal);
  const yb = Math.floor(p[1] * 2) / 2; // 0.5 步长
  if (!bands.has(yb)) bands.set(yb, { n: 0, sum: 0, max: 0, big: 0 });
  const b = bands.get(yb);
  b.n++; b.sum += d; b.max = Math.max(b.max, d); if (d > 30) b.big++;
}
console.log('y 带 | n | 均值 | max | >30°');
[...bands.entries()].sort((a, b) => a[0] - b[0]).forEach(([y, b]) => {
  console.log(`${y.toFixed(1)} | ${b.n} | ${(b.sum/b.n).toFixed(1)}° | ${b.max.toFixed(0)}° | ${b.big}`);
});

// 输出重合对裂缝（>60°），按 y 带统计
{
  const g = new Map();
  OUT.vertices.forEach((v, i) => {
    if (!inArm(v.position)) return;
    const k = `${Math.floor(v.position[0]/0.1)},${Math.floor(v.position[1]/0.1)},${Math.floor(v.position[2]/0.1)}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(i);
  });
  const cracks = [];
  for (const [, list] of g) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const pa = OUT.vertices[list[a]].position, pb = OUT.vertices[list[b]].position;
      if (Math.hypot(pa[0]-pb[0], pa[1]-pb[1], pa[2]-pb[2]) > 0.02) continue;
      const n = ang(OUT.vertices[list[a]].normal, OUT.vertices[list[b]].normal);
      if (n > 60) cracks.push({ p: pa, n });
    }
  }
  console.log(`\n输出裂缝对(>60°): ${cracks.length} 个`);
  const yb = new Map();
  for (const c of cracks) { const y = Math.floor(c.p[1]); yb.set(y, (yb.get(y) || 0) + 1); }
  console.log('按 y 分布:', [...yb.entries()].sort((a, b) => a[0] - b[0]).map(([y, c]) => `y${y}:${c}`).join(' '));
  // 裂缝聚类
  const clus = [];
  for (const c of cracks) {
    let found = false;
    for (const cl of clus) {
      if (Math.abs(cl.p[0]-c.p[0]) < 1.2 && Math.abs(cl.p[1]-c.p[1]) < 1.0 && Math.abs(cl.p[2]-c.p[2]) < 1.2) { cl.n++; found = true; break; }
    }
    if (!found) clus.push({ p: c.p, n: 1 });
  }
  clus.sort((a, b) => b.n - a.n).slice(0, 12).forEach((c) => console.log(`  裂缝簇 n=${c.n} @[${c.p.map(x=>x.toFixed(1)).join(',')}]`));
}

// 输入硬边顶点（dev>30°）聚类（区域）
{
  const fN = IN.faces.map((f) => {
    const [a, b, c] = f.indices;
    const p0 = IN.vertices[a].position, p1 = IN.vertices[b].position, p2 = IN.vertices[c].position;
    const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
    const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
    const n = [aby*acz-abz*acy, abz*acx-abx*acz, abx*acy-aby*acx];
    const l = Math.hypot(...n) || 1;
    return [n[0]/l, n[1]/l, n[2]/l];
  });
  const vTris = IN.vertices.map(() => []);
  IN.faces.forEach((f, ti) => { const [a, b, c] = f.indices; const pc = [(IN.vertices[a].position[0]+IN.vertices[b].position[0]+IN.vertices[c].position[0])/3,(IN.vertices[a].position[1]+IN.vertices[b].position[1]+IN.vertices[c].position[1])/3,(IN.vertices[a].position[2]+IN.vertices[b].position[2]+IN.vertices[c].position[2])/3]; if (inArm(pc)) { vTris[a].push(ti); vTris[b].push(ti); vTris[c].push(ti); } });
  const hard = [];
  for (let vi = 0; vi < IN.vertices.length; vi++) {
    const list = vTris[vi];
    if (!list.length) continue;
    let ax = 0, ay = 0, az = 0;
    for (const ti of list) { ax += fN[ti][0]; ay += fN[ti][1]; az += fN[ti][2]; }
    const l = Math.hypot(ax, ay, az);
    if (l < 1e-12) continue;
    const d = ang(IN.vertices[vi].normal, [ax / l, ay / l, az / l]);
    if (d > 30) hard.push({ p: IN.vertices[vi].position, d });
  }
  console.log(`\n输入硬边顶点(dev>30°): ${hard.length} 个`);
  const clus = [];
  for (const h of hard) {
    let found = false;
    for (const cl of clus) {
      if (Math.abs(cl.p[0]-h.p[0]) < 1.2 && Math.abs(cl.p[1]-h.p[1]) < 1.0 && Math.abs(cl.p[2]-h.p[2]) < 1.2) { cl.n++; found = true; break; }
    }
    if (!found) clus.push({ p: h.p, n: 1 });
  }
  clus.sort((a, b) => b.n - a.n).slice(0, 12).forEach((c) => console.log(`  硬边簇 n=${c.n} @[${c.p.map(x=>x.toFixed(1)).join(',')}]`));
}
