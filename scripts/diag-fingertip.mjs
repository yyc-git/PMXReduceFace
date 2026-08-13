// 指尖突起面专项检测：对比原始 vs 输出，找「突出/翘起」的三角形
// 突起定义：三角形顶点到邻接三角形平面的最大距离（相对手指局部尺度）
// 手指区域：|x|>8.0, 13.8<y<15.0（指尖/小指无名指头）
// 度量单一来源：qem.mjs 的 maxProtrudeOfVerts（「顶点到 1-ring 邻接面最大距离」，第五轮统一口径）
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';
import { maxProtrudeOfVerts, buildEdgeTris } from '../src/tool/pmx-face-reduce/qem.mjs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('usage: node scripts/diag-fingertip.mjs <in.pmx> <out.pmx>'); process.exit(1); }

const load = (p) => loadPmx(p, false);
const orig = load(inPath);
const out = load(outPath);

const vp = (m, i) => m.vertices[i].position;
const tri = (m, i) => m.faces[i].indices;
const isFingertip = (c) => Math.abs(c[0]) > 8.0 && c[1] > 13.8 && c[1] < 15.0;

const toPos = (m) => m.vertices.map((v) => v.position);
const toTris = (m) => m.faces.map((f) => f.indices);

function triInfo(m, ti) {
  const [a, b, c] = tri(m, ti);
  const p0 = vp(m, a), p1 = vp(m, b), p2 = vp(m, c);
  const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
  const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
  const nx = aby*acz-abz*acy, ny = abz*acx-abx*acz, nz = abx*acy-aby*acx;
  const area = 0.5 * Math.hypot(nx, ny, nz);
  const nl = Math.hypot(nx, ny, nz) || 1;
  const e0 = Math.hypot(abx, aby, abz);
  const e1 = Math.hypot(p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]);
  const e2 = Math.hypot(p0[0]-p2[0], p0[1]-p2[1], p0[2]-p2[2]);
  const maxL = Math.max(e0, e1, e2), minL = Math.min(e0, e1, e2);
  const centroid = [(p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3];
  return { ti, area, aspect: minL > 1e-12 ? maxL/minL : Infinity, maxL, centroid, n: [nx/nl, ny/nl, nz/nl], verts: [p0, p1, p2] };
}

function analyze(m, label) {
  const positions = toPos(m);
  const tris = toTris(m);
  const edgeMap = buildEdgeTris(tris);
  const rows = [];
  for (let ti = 0; ti < m.faces.length; ti++) {
    const info = triInfo(m, ti);
    if (!isFingertip(info.centroid)) continue;
    info.maxProtrude = maxProtrudeOfVerts(positions, tris, ti, edgeMap);
    // 最大邻接法线夹角
    const [a, b, c] = tri(m, ti);
    const nbs = new Set();
    for (const [x, y] of [[a,b],[b,c],[c,a]]) {
      const k = x < y ? `${x}:${y}` : `${y}:${x}`;
      for (const tj of edgeMap.get(k) || []) if (tj !== ti) nbs.add(tj);
    }
    let maxAngle = 0;
    for (const tj of nbs) {
      const nn = triInfo(m, tj).n;
      const dot = Math.max(-1, Math.min(1, info.n[0]*nn[0]+info.n[1]*nn[1]+info.n[2]*nn[2]));
      const ang = Math.acos(dot) * 180 / Math.PI;
      if (ang > maxAngle) maxAngle = ang;
    }
    info.maxAngle = maxAngle;
    info.nbs = nbs.size;
    rows.push(info);
  }
  console.log(`\n===== ${label}: 指尖区域 ${rows.length} 个三角形 =====`);
  const prot = rows.map(r => r.maxProtrude).sort((a,b)=>a-b);
  const p90 = prot[Math.floor(prot.length*0.9)];
  console.log(`突起度: p50=${prot[Math.floor(prot.length*0.5)].toFixed(4)} p90=${p90.toFixed(4)} max=${prot[prot.length-1].toFixed(4)}`);
  const big = rows.filter(r => r.maxProtrude > 0.08);
  console.log(`突起>0.08: ${big.length} 个`);
  for (const r of big.sort((a,b)=>b.maxProtrude-a.maxProtrude).slice(0, 25)) {
    console.log(`  tri#${r.ti} protrude=${r.maxProtrude.toFixed(3)} angle=${r.maxAngle.toFixed(0)}° area=${r.area.toFixed(4)} aspect=${r.aspect.toFixed(1)} maxL=${r.maxL.toFixed(3)} @[${r.centroid.map(v=>v.toFixed(2)).join(',')}]`);
  }
  const flip = rows.filter(r => r.maxAngle > 120);
  console.log(`法线夹角>120°: ${flip.length} 个`);
  for (const r of flip.sort((a,b)=>b.maxAngle-a.maxAngle).slice(0, 25)) {
    console.log(`  tri#${r.ti} angle=${r.maxAngle.toFixed(0)}° protrude=${r.maxProtrude.toFixed(3)} area=${r.area.toFixed(4)} aspect=${r.aspect.toFixed(1)} maxL=${r.maxL.toFixed(3)} @[${r.centroid.map(v=>v.toFixed(2)).join(',')}]`);
  }
  return rows;
}

const origRows = analyze(orig, '原始模型');
const outRows = analyze(out, '输出 LOD');

const bigO = origRows.filter(r => r.maxProtrude > 0.08).length;
const bigX = outRows.filter(r => r.maxProtrude > 0.08).length;
const flipO = origRows.filter(r => r.maxAngle > 120).length;
const flipX = outRows.filter(r => r.maxAngle > 120).length;
console.log(`\n===== 对比汇总 =====`);
console.log(`突起>0.08: 原始 ${bigO} | 输出 ${bigX}`);
console.log(`法线夹角>120°: 原始 ${flipO} | 输出 ${flipX}`);
