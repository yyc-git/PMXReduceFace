// diag-tda-arm-shading.mjs — Tda LOD50 右手臂肩窝「破面」根因诊断
// 用法: node scripts/diag-tda-arm-shading.mjs <in.pmx> <out.pmx>
// 区域: 右上臂（x 4.2-8.7, y 10.5-16, z -2.9-2.2），疑似破面中心 ≈ [6.4,13.6,-0.4]
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);

const REGION = { x: [4.2, 8.7], y: [10.5, 16.0], z: [-2.9, 2.2] };
const CENTER = [6.4, 13.6, -0.4];

const inR = (p) => p[0] >= REGION.x[0] && p[0] <= REGION.x[1] && p[1] >= REGION.y[0] && p[1] <= REGION.y[1] && p[2] >= REGION.z[0] && p[2] <= REGION.z[1];

function faceNormals(m) {
  return m.faces.map((f) => {
    const [a, b, c] = f.indices;
    const p0 = m.vertices[a].position, p1 = m.vertices[b].position, p2 = m.vertices[c].position;
    const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
    const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
    const n = [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
    const l = Math.hypot(...n) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  });
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (a, b) => {
  const c = Math.max(-1, Math.min(1, dot(a, b) / (Math.hypot(...a) * Math.hypot(...b) || 1)));
  return Math.acos(c) * 180 / Math.PI;
};
const area = (p0, p1, p2) => {
  const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
  const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
  return 0.5 * Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
};
const maxEdgeLen = (p0, p1, p2) => Math.max(Math.hypot(p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]), Math.hypot(p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]), Math.hypot(p0[0]-p2[0], p0[1]-p2[1], p0[2]-p2[2]));
const p95 = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * 0.95))]; };

function analyze(m, label) {
  const pos = (i) => m.vertices[i].position;
  // 区域三角形
  const rTris = [];
  for (let ti = 0; ti < m.faces.length; ti++) {
    const [a, b, c] = m.faces[ti].indices;
    const pc = [(pos(a)[0] + pos(b)[0] + pos(c)[0]) / 3, (pos(a)[1] + pos(b)[1] + pos(c)[1]) / 3, (pos(a)[2] + pos(b)[2] + pos(c)[2]) / 3];
    if (inR(pc)) rTris.push(ti);
  }
  // 三角形内顶点法线展角（渲染 faceting 预测指标）+ dotNL
  const L = [50, 100, 80]; const Ll = Math.hypot(...L);
  const spread = [], dotNL = [], areas = [], maxLs = [];
  for (const ti of rTris) {
    const [a, b, c] = m.faces[ti].indices;
    const na = m.vertices[a].normal, nb = m.vertices[b].normal, nc = m.vertices[c].normal;
    spread.push(Math.max(ang(na, nb), ang(nb, nc), ang(nc, na)));
    const da = (na[0] * L[0] + na[1] * L[1] + na[2] * L[2]) / Ll;
    const db = (nb[0] * L[0] + nb[1] * L[1] + nb[2] * L[2]) / Ll;
    const dc = (nc[0] * L[0] + nc[1] * L[1] + nc[2] * L[2]) / Ll;
    dotNL.push(da, db, dc);
    areas.push(area(pos(a), pos(b), pos(c)));
    maxLs.push(maxEdgeLen(pos(a), pos(b), pos(c)));
  }
  // 每边二面角
  const dih = [];
  {
    const fN = faceNormals(m);
    const edgeMap = new Map();
    for (const ti of rTris) {
      const [a, b, c] = m.faces[ti].indices;
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        const k = x < y ? `${x}:${y}` : `${y}:${x}`;
        if (!edgeMap.has(k)) edgeMap.set(k, []);
        edgeMap.get(k).push(ti);
      }
    }
    for (const [, ts] of edgeMap) {
      if (ts.length === 2) dih.push(ang(fN[ts[0]], fN[ts[1]]));
    }
  }
  // 顶点法线偏离面积加权面法线平均（diag-normal-deviation 同口径，仅区域顶点）
  const vTris = m.vertices.map(() => []);
  for (const ti of rTris) for (const vi of m.faces[ti].indices) vTris[vi].push(ti);
  const vDev = [], hardVerts = [];
  for (let vi = 0; vi < m.vertices.length; vi++) {
    const list = vTris[vi];
    if (!list.length) continue;
    let ax = 0, ay = 0, az = 0;
    for (const ti of list) {
      const [a, b, c] = m.faces[ti].indices;
      const p0 = pos(a), p1 = pos(b), p2 = pos(c);
      const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
      const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
      ax += aby*acz-abz*acy; ay += abz*acx-abx*acz; az += abx*acy-aby*acx;
    }
    const l = Math.hypot(ax, ay, az);
    if (l < 1e-12) continue;
    const d = ang(m.vertices[vi].normal, [ax / l, ay / l, az / l]);
    vDev.push(d);
    if (d > 15) hardVerts.push({ vi, d, p: pos(vi) });
  }
  // 材质分布
  const matTris = new Map();
  for (const ti of rTris) {
    const mi = m.triMaterial ? m.triMaterial[ti] : -1;
    matTris.set(mi, (matTris.get(mi) || 0) + 1);
  }
  console.log(`=== ${label} 右上臂区域 ===`);
  console.log(`区域三角数: ${rTris.length} / 全局 ${m.faces.length}`);
  console.log(`三角形法线展角: p50=${p95(spread.slice().sort((a,b)=>a-b).filter((_,i)=>i%2===0))} p95=${p95(spread).toFixed(2)} max=${spread.length?Math.max(...spread).toFixed(2):0}`);
  console.log(`dotNL(主光): p05=${spread.length?p95(dotNL.filter(()=>true)):0} ... 分布: min=${dotNL.length?Math.min(...dotNL).toFixed(3):0} p50=${dotNL.length?p95(dotNL):0} max=${dotNL.length?Math.max(...dotNL).toFixed(3):0}`);
  console.log(`面积: p95=${p95(areas).toFixed(4)} max=${areas.length?Math.max(...areas).toFixed(4):0} | maxL: p95=${p95(maxLs).toFixed(3)} max=${maxLs.length?Math.max(...maxLs).toFixed(3):0}`);
  console.log(`二面角: p95=${p95(dih).toFixed(1)} max=${dih.length?Math.max(...dih).toFixed(1):0} | >30°: ${dih.filter(d=>d>30).length} >45°: ${dih.filter(d=>d>45).length}`);
  console.log(`顶点法线偏离面平均: >15° ${vDev.filter(d=>d>15).length} >30° ${vDev.filter(d=>d>30).length} max ${vDev.length?Math.max(...vDev).toFixed(1):0}`);
  console.log(`材质三角分布: ${[...matTris.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([mi,c])=>`m${mi}:${c}`).join(' ')}`);
  return { rTris, spread, dih, hardVerts, vDev, areas, maxLs, dotNL };
}

const A = analyze(IN, '输入 LOD100');
const B = analyze(OUT, '输出 LOD50');

// 输入硬边顶点列表（>15°，区域）
console.log(`\n输入区域硬边顶点数: ${A.hardVerts.length}`);
A.hardVerts.sort((a, b) => b.d - a.d).slice(0, 20).forEach(h => {
  console.log(`  v${h.vi} dev=${h.d.toFixed(1)}° @[${h.p.map(x=>x.toFixed(2))}]`);
});
console.log(`输出区域硬边顶点数: ${B.hardVerts.length}`);

// 输出顶点位置漂移: 输出区域顶点 → 最近输入顶点距离
{
  const inVerts = IN.vertices.map((v, i) => ({ i, p: v.position }));
  const outRegionVerts = [];
  const outSeen = new Set();
  for (const ti of B.rTris) for (const vi of OUT.faces[ti].indices) if (!outSeen.has(vi)) { outSeen.add(vi); outRegionVerts.push(vi); }
  // 简化: 全模型暴力最近邻（20k×23k=4.6e8 太多）→ 用粗网格桶
  const cell = 0.5;
  const grid = new Map();
  for (const v of inVerts) {
    const k = `${Math.floor(v.p[0]/cell)},${Math.floor(v.p[1]/cell)},${Math.floor(v.p[2]/cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(v);
  }
  const drift = [];
  for (const vi of outRegionVerts) {
    const p = OUT.vertices[vi].position;
    const gx = Math.floor(p[0]/cell), gy = Math.floor(p[1]/cell), gz = Math.floor(p[2]/cell);
    let best = 1e9, bestV = null;
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
      const list = grid.get(`${gx+dx},${gy+dy},${gz+dz}`);
      if (!list) continue;
      for (const v of list) {
        const d = Math.hypot(v.p[0]-p[0], v.p[1]-p[1], v.p[2]-p[2]);
        if (d < best) { best = d; bestV = v; }
      }
    }
    if (bestV) drift.push({ d: best, inN: IN.vertices[bestV.i].normal, outN: OUT.vertices[vi].normal, p });
  }
  const sorted = drift.sort((a, b) => b.d - a.d);
  console.log(`\n输出区域顶点位置漂移(到最近输入顶点): p95=${p95(drift.map(x=>x.d)).toFixed(4)} max=${sorted.length?sorted[0].d.toFixed(4):0}`);
  const nDev = drift.map(x => ang(x.inN, x.outN));
  console.log(`输出顶点法线 vs 输入最近顶点法线: p95=${p95(nDev).toFixed(1)}° max=${nDev.length?Math.max(...nDev).toFixed(1):0}° >15°: ${nDev.filter(d=>d>15).length} >30°: ${nDev.filter(d=>d>30).length}`);
  console.log('法线偏离最大的输出顶点:');
  drift.map((x, i) => ({ x, i })).sort((a, b) => ang(b.x.inN, b.x.outN) - ang(a.x.inN, a.x.outN)).slice(0, 15).forEach(({ x }) => {
    console.log(`  @[${x.p.map(v=>v.toFixed(2))}] d_pos=${x.d.toFixed(4)} d_norm=${ang(x.inN, x.outN).toFixed(1)}°`);
  });
}
