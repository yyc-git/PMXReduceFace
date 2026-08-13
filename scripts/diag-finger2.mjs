// 手指多余面专项诊断 v2：锁定手部区域（|x|>5, y 10-17），对比原始 vs 输出
// 找输出中「新增的异常三角形」：细长(aspect)、碎面(面积突变)、翻转(法线夹角)、孤立面
import fs from 'fs';
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('usage: node scripts/diag-finger2.mjs <in.pmx> <out.pmx>'); process.exit(1); }

const load = (p) => loadPmx(p, false);
const orig = load(inPath);
const out = load(outPath);

const vp = (m, i) => m.vertices[i].position;
const tri = (m, i) => m.faces[i].indices;

function triInfo(m, ti) {
  const [a, b, c] = tri(m, ti);
  const p0 = vp(m, a), p1 = vp(m, b), p2 = vp(m, c);
  const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
  const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
  const nx = aby*acz-abz*acy, ny = abz*acx-abx*acz, nz = abx*acy-aby*acx;
  const area = 0.5 * Math.hypot(nx, ny, nz);
  const e0 = Math.hypot(abx, aby, abz);
  const e1 = Math.hypot(p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]);
  const e2 = Math.hypot(p0[0]-p2[0], p0[1]-p2[1], p0[2]-p2[2]);
  const maxL = Math.max(e0, e1, e2), minL = Math.min(e0, e1, e2);
  const aspect = minL > 1e-12 ? maxL / minL : Infinity;
  const centroid = [(p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3];
  return { ti, area, aspect, maxL, centroid, n: [nx, ny, nz] };
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

function maxNeighborAngle(m, edgeMap, ti, info) {
  const [a, b, c] = tri(m, ti);
  let maxA = 0;
  for (const [x, y] of [[a,b],[b,c],[c,a]]) {
    const k = x < y ? `${x}:${y}` : `${y}:${x}`;
    for (const tj of edgeMap.get(k) || []) {
      if (tj === ti) continue;
      const nn = triInfo(m, tj).n;
      const la = Math.hypot(info.n[0], info.n[1], info.n[2]) || 1;
      const lb = Math.hypot(nn[0], nn[1], nn[2]) || 1;
      const dot = Math.max(-1, Math.min(1, (info.n[0]*nn[0]+info.n[1]*nn[1]+info.n[2]*nn[2])/(la*lb)));
      const ang = Math.acos(dot) * 180 / Math.PI;
      if (ang > maxA) maxA = ang;
    }
  }
  return maxA;
}

// 手部区域判定：x 绝对值大（手臂伸出身体两侧）、y 在中下部
const isHand = (c) => Math.abs(c[0]) > 4.5 && c[1] > 9 && c[1] < 18;

function analyze(m, label, edgeMap) {
  const rows = [];
  for (let ti = 0; ti < m.faces.length; ti++) {
    const info = triInfo(m, ti);
    if (!isHand(info.centroid)) continue;
    info.maxAngle = maxNeighborAngle(m, edgeMap, ti, info);
    rows.push(info);
  }
  console.log(`\n===== ${label}: 手部区域三角形 ${rows.length} 个 =====`);
  // 细长条 (aspect>10 && maxL>0.5)
  const slivers = rows.filter(r => r.aspect > 10 && r.maxL > 0.5);
  console.log(`细长条 aspect>10 && maxL>0.5: ${slivers.length}`);
  for (const r of slivers.slice(0, 15)) {
    console.log(`  tri#${r.ti} aspect=${r.aspect.toFixed(0)} maxL=${r.maxL.toFixed(2)} area=${r.area.toFixed(4)} angle=${r.maxAngle.toFixed(0)}° @[${r.centroid.map(v=>v.toFixed(2)).join(',')}]`);
  }
  // 大翻转 (>150°，接近 180)
  const flips = rows.filter(r => r.maxAngle > 150);
  console.log(`法线夹角>150°: ${flips.length}`);
  for (const r of flips.slice(0, 15)) {
    console.log(`  tri#${r.ti} angle=${r.maxAngle.toFixed(1)}° area=${r.area.toFixed(4)} aspect=${r.aspect.toFixed(0)} @[${r.centroid.map(v=>v.toFixed(2)).join(',')}]`);
  }
  // 中等翻转 120-150（foldOver 阈值 120 应该拦住，看看是否还有）
  const mid = rows.filter(r => r.maxAngle > 120 && r.maxAngle <= 150);
  console.log(`法线夹角 120-150°: ${mid.length}`);
  for (const r of mid.slice(0, 15)) {
    console.log(`  tri#${r.ti} angle=${r.maxAngle.toFixed(1)}° area=${r.area.toFixed(4)} aspect=${r.aspect.toFixed(0)} @[${r.centroid.map(v=>v.toFixed(2)).join(',')}]`);
  }
  // 极小碎面 (area < 1e-4)
  const frags = rows.filter(r => r.area < 1e-4);
  console.log(`碎面 area<1e-4: ${frags.length}`);
  // 面积分布
  const areas = rows.map(r => r.area).sort((a,b)=>a-b);
  const med = areas[Math.floor(areas.length/2)];
  console.log(`面积中位数=${med.toFixed(5)} 最大=${areas[areas.length-1].toFixed(4)}`);
  return rows;
}

const origEdgeMap = buildEdgeTris(orig);
const outEdgeMap = buildEdgeTris(out);
const origRows = analyze(orig, '原始模型', origEdgeMap);
const outRows = analyze(out, '输出 LOD', outEdgeMap);

// 对比：输出新增的 >120° 三角形数量（原始没有的）
const outHigh = outRows.filter(r => r.maxAngle > 120);
const origHigh = origRows.filter(r => r.maxAngle > 120);
console.log(`\n===== 对比：手部区域法线夹角>120° =====`);
console.log(`原始: ${origHigh.length} | 输出: ${outHigh.length}`);

// 细长条对比
const outSliver = outRows.filter(r => r.aspect > 10 && r.maxL > 0.5);
const origSliver = origRows.filter(r => r.aspect > 10 && r.maxL > 0.5);
console.log(`细长条 aspect>10&&maxL>0.5 — 原始: ${origSliver.length} | 输出: ${outSliver.length}`);
