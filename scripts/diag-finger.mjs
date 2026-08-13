// 手指多余面专项诊断：定位折叠后「突起/翻转」三角形（视觉多余面）
// 用法: node scripts/diag-finger.mjs <input.pmx> <output.pmx> [topN]
// 分析：对输出模型每个三角形，检查 ① 与邻接三角形法线夹角 ② 顶点到邻接平面的最大距离（突起度）
// 聚簇输出（按位置），帮助定位手指区域的漏网多余面。
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { loadPmx } = await import('../src/tool/lib/pmx-loader.mjs');

const [inPath, outPath, topN = 40] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('usage: node scripts/diag-finger.mjs <in.pmx> <out.pmx> [topN]'); process.exit(1); }

const bufToAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const load = (p) => loadPmx(p, false);

const orig = load(inPath);
const out = load(outPath);

// 顶点表
const vp = (m, i) => m.vertices[i].position;
const tri = (m, i) => m.faces[i].indices;

function triNormal(m, ti) {
  const [a, b, c] = tri(m, ti);
  const p0 = vp(m, a), p1 = vp(m, b), p2 = vp(m, c);
  const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
  const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
  const n = [aby*acz-abz*acy, abz*acx-abx*acz, abx*acy-aby*acx];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0]/l, n[1]/l, n[2]/l];
}

function buildEdgeTris(m) {
  const edgeMap = new Map();
  for (let ti = 0; ti < m.faces.length; ti++) {
    const [a, b, c] = tri(m, ti);
    for (const [x, y] of [[a,b],[b,c],[c,a]]) {
      const k = x < y ? `${x}:${y}` : `${y}:${x}`;
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k).push(ti);
    }
  }
  return edgeMap;
}

// 邻接三角形（共享边）
function neighbors(m, edgeMap, ti) {
  const [a, b, c] = tri(m, ti);
  const set = new Set();
  for (const [x, y] of [[a,b],[b,c],[c,a]]) {
    const k = x < y ? `${x}:${y}` : `${y}:${x}`;
    for (const tj of edgeMap.get(k) || []) if (tj !== ti) set.add(tj);
  }
  return [...set];
}

function triArea(m, ti) {
  const [a, b, c] = tri(m, ti);
  const p0 = vp(m, a), p1 = vp(m, b), p2 = vp(m, c);
  const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
  const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
  const cx = aby*acz-abz*acy, cy = abz*acx-abx*acz, cz = abx*acy-aby*acx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

// 顶点到平面距离
function pointPlaneDist(p, n, q) {
  return Math.abs((p[0]-q[0])*n[0] + (p[1]-q[1])*n[1] + (p[2]-q[2])*n[2]);
}

const edgeMap = buildEdgeTris(out);
const N = out.faces.length;
const results = [];

for (let ti = 0; ti < N; ti++) {
  const n = triNormal(out, ti);
  const nbs = neighbors(out, edgeMap, ti);
  if (nbs.length === 0) continue;
  // 最大邻接法线夹角
  let maxAngle = 0;
  for (const tj of nbs) {
    const nn = triNormal(out, tj);
    const dot = Math.max(-1, Math.min(1, n[0]*nn[0]+n[1]*nn[1]+n[2]*nn[2]));
    const ang = Math.acos(dot) * 180 / Math.PI;
    if (ang > maxAngle) maxAngle = ang;
  }
  // 突起度：顶点到邻接平面平均距离（相对面积）
  const [a, b, c] = tri(out, ti);
  const area = triArea(out, ti);
  const centroid = [(vp(out,a)[0]+vp(out,b)[0]+vp(out,c)[0])/3,
                    (vp(out,a)[1]+vp(out,b)[1]+vp(out,c)[1])/3,
                    (vp(out,a)[2]+vp(out,b)[2]+vp(out,c)[2])/3];
  let maxDist = 0;
  for (const tj of nbs) {
    const nn = triNormal(out, tj);
    const q = vp(out, tri(out, tj)[0]);
    for (const vi of [a, b, c]) {
      const d = pointPlaneDist(vp(out, vi), nn, q);
      if (d > maxDist) maxDist = d;
    }
  }
  results.push({ ti, maxAngle, maxDist, area, centroid, nbs: nbs.length });
}

// 筛选：法线夹角 > 90°（视觉翻转/折痕）或 突起度显著（> 1.5 且非边界）
const flagged = results.filter(r => r.maxAngle > 90 || (r.maxDist > 1.5 && r.nbs >= 2));
flagged.sort((x, y) => Math.max(y.maxAngle, y.maxDist * 10) - Math.max(x.maxAngle, x.maxDist * 10));

console.log(`输出模型: 顶点 ${out.vertices.length} 三角形 ${out.faces.length}`);
console.log(`法线夹角>90° 或 突起>1.5 的三角形: ${flagged.length}`);
console.log('\nTop 异常（含位置聚簇）:');
for (const r of flagged.slice(0, topN)) {
  console.log(`tri#${r.ti} angle=${r.maxAngle.toFixed(1)}° dist=${r.maxDist.toFixed(2)} area=${r.area.toFixed(3)} nbr=${r.nbs} @[${r.centroid.map(v=>v.toFixed(2)).join(',')}]`);
}

// 聚簇：按位置粗聚类（0.5 格）
const clusters = new Map();
for (const r of flagged) {
  const k = `${Math.round(r.centroid[0]*2)/2},${Math.round(r.centroid[1]*2)/2},${Math.round(r.centroid[2]*2)/2}`;
  if (!clusters.has(k)) clusters.set(k, []);
  clusters.get(k).push(r);
}
console.log('\n聚簇（位置 → 数量）:');
[...clusters.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0, 20).forEach(([k, arr]) => {
  const maxAng = Math.max(...arr.map(r=>r.maxAngle));
  console.log(`@(${k}) 数量=${arr.length} maxAngle=${maxAng.toFixed(1)}°`);
});

// 对比原始模型同位置：这些区域原始是否就有大夹角（区分「原有折痕」vs「折叠引入」）
console.log('\n同位置原始模型对照（前 10 聚簇）:');
const origEdgeMap = buildEdgeTris(orig);
const origN = orig.faces.length;
const origAngles = [];
for (let ti = 0; ti < origN; ti++) {
  const n = triNormal(orig, ti);
  const nbs = neighbors(orig, origEdgeMap, ti);
  let maxAngle = 0;
  for (const tj of nbs) {
    const nn = triNormal(orig, tj);
    const dot = Math.max(-1, Math.min(1, n[0]*nn[0]+n[1]*nn[1]+n[2]*nn[2]));
    const ang = Math.acos(dot) * 180 / Math.PI;
    if (ang > maxAngle) maxAngle = ang;
  }
  origAngles.push({ ti, maxAngle, centroid: (() => { const [a,b,c] = tri(orig, ti); const p0=vp(orig,a),p1=vp(orig,b),p2=vp(orig,c); return [(p0[0]+p1[0]+p2[0])/3,(p0[1]+p1[1]+p2[1])/3,(p0[2]+p1[2]+p2[2])/3]; })() });
}
const origClusters = new Map();
for (const r of origAngles.filter(r=>r.maxAngle>90)) {
  const k = `${Math.round(r.centroid[0]*2)/2},${Math.round(r.centroid[1]*2)/2},${Math.round(r.centroid[2]*2)/2}`;
  if (!origClusters.has(k)) origClusters.set(k, []);
  origClusters.get(k).push(r);
}
[...clusters.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0, 10).forEach(([k, arr]) => {
  const oc = origClusters.get(k) || [];
  const origMax = oc.length ? Math.max(...oc.map(r=>r.maxAngle)) : 0;
  console.log(`@(${k}) 输出${arr.length}个(>90°) | 原始同格${oc.length}个(>90°) maxAngle=${origMax.toFixed(1)}°`);
});
