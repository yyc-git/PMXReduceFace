// diag-sock.mjs — 袜子/内裤(BurumaSet)区域质量量化：边界回缩 + 三角形变大
// 输出 JSON 落盘 diag-sock.json（避免控制台 GBK 乱码）；diag-sock.json 已 gitignore。
// 与 verify.mjs 的 quality 段同口径（面积/边长分位数、袜区新增洞）；供 fix6-plan §8 校准闭环人工复查。
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';
import { writeFileSync } from 'node:fs';

const [inPath, outPath] = process.argv.slice(2);
const load = (p) => loadPmx(p, false);

function edgeKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

function analyze(path) {
  const m = load(path);
  const v = m.vertices, faces = m.faces;
  // 材质索引：BurumaSet 材质
  const matIdx = [];
  m.materials.forEach((mat, i) => { if (String(mat.name).includes('BurumaSet')) matIdx.push(i); });
  // face -> material
  const matOfFace = [];
  let acc = 0;
  m.materials.forEach((mat, i) => {
    for (let j = 0; j < mat.faceCount; j++) matOfFace[acc + j] = i;
    acc += mat.faceCount;
  });
  // BurumaSet 三角形
  const triArea = (t) => {
    const [a, b, c] = t;
    const p0 = v[a].position, p1 = v[b].position, p2 = v[c].position;
    const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
    const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
    const nx = aby*acz-abz*acy, ny = abz*acx-abx*acz, nz = abx*acy-aby*acx;
    return 0.5 * Math.hypot(nx, ny, nz);
  };
  const triMaxL = (t) => {
    const [a, b, c] = t;
    const p0 = v[a].position, p1 = v[b].position, p2 = v[c].position;
    const d = (x, y) => Math.hypot(x[0]-y[0], x[1]-y[1], x[2]-y[2]);
    return Math.max(d(p0, p1), d(p1, p2), d(p2, p0));
  };
  const triCentroid = (t) => {
    const [a, b, c] = t;
    const p0 = v[a].position, p1 = v[b].position, p2 = v[c].position;
    return [(p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3];
  };
  const sockTris = [], sockAreas = [], sockMaxL = [];
  for (let i = 0; i < faces.length; i++) {
    if (!matIdx.includes(matOfFace[i])) continue;
    const t = faces[i].indices;
    const area = triArea(t), maxL = triMaxL(t);
    sockTris.push({ i, t, area, maxL, c: triCentroid(t) });
    sockAreas.push(area); sockMaxL.push(maxL);
  }
  // 面积分位数
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  // 边界边（全局，但只统计袜子材质区域内的）
  const cnt = new Map(), mid = new Map();
  for (const f of faces) {
    const [a, b, c] = f.indices;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(x, y);
      cnt.set(k, (cnt.get(k) || 0) + 1);
      if (!mid.has(k)) {
        const px = v[x].position, py = v[y].position;
        mid.set(k, [(px[0]+py[0])/2, (px[1]+py[1])/2, (px[2]+py[2])/2]);
      }
    }
  }
  const bndEdges = [];
  for (const [k, c] of cnt) {
    if (c !== 1) continue;
    const [a, b] = k.split(':').map(Number);
    const p = mid.get(k);
    // 边界边属于袜子材质区：取两个顶点的材质面（简化：中点在袜子三角形质心附近？用顶点所在三角形判定）
    bndEdges.push({ a, b, p });
  }
  // 判断边界边是否属于袜子区域：边界边中点落在哪个材质三角形内（近似：找最近袜子三角形质心）
  // 简化：中点 y 在 10~18（袜子/大腿区域）且材质面判据
  const sockBnd = bndEdges.filter((e) => {
    const [x, y, z] = e.p;
    if (y < 9 || y > 19) return false;
    // 最近袜子三角形质心距离 < 0.5
    let best = Infinity;
    for (const st of sockTris) {
      const d = Math.hypot(st.c[0]-x, st.c[1]-y, st.c[2]-z);
      if (d < best) best = d;
    }
    return best < 0.5;
  });
  return {
    matCount: sockTris.length,
    area: { p50: q(sockAreas, 0.5), p90: q(sockAreas, 0.9), p95: q(sockAreas, 0.95), p99: q(sockAreas, 0.99), max: Math.max(...sockAreas) },
    maxL: { p50: q(sockMaxL, 0.5), p90: q(sockMaxL, 0.9), p95: q(sockMaxL, 0.95), p99: q(sockMaxL, 0.99), max: Math.max(...sockMaxL) },
    sockBndCount: sockBnd.length,
    sockBnd: sockBnd,
    sockTris, v, faces, matOfFace, cnt, mid
  };
}

const orig = analyze(inPath);
const out = analyze(outPath);

// 空间匹配：输出边界边中点 vs 输入边界边线段
const CELL = 0.5;
const bndGrid = new Map();
for (const e of orig.sockBnd) {
  const seg = [orig.v[e.a].position, orig.v[e.b].position];
  const [x, y, z] = e.p;
  const key = `${Math.floor(x/CELL)},${Math.floor(y/CELL)},${Math.floor(z/CELL)}`;
  if (!bndGrid.has(key)) bndGrid.set(key, []);
  bndGrid.get(key).push(seg);
}
const pointSegDist2 = (p, a, b) => {
  const abx = b[0]-a[0], aby = b[1]-a[1], abz = b[2]-a[2];
  const apx = p[0]-a[0], apy = p[1]-a[1], apz = p[2]-a[2];
  const len2 = abx*abx + aby*aby + abz*abz;
  if (len2 < 1e-16) return apx*apx + apy*apy + apz*apz;
  let t = (apx*abx + apy*aby + apz*abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + abx*t - p[0], cy = a[1] + aby*t - p[1], cz = a[2] + abz*t - p[2];
  return cx*cx + cy*cy + cz*cz;
};
const unmatched = [];
for (const e of out.sockBnd) {
  const [x, y, z] = e.p;
  const gx = Math.floor(x/CELL), gy = Math.floor(y/CELL), gz = Math.floor(z/CELL);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const segs = bndGrid.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!segs) continue;
    for (const [sa, sb] of segs) {
      const d2 = pointSegDist2([x, y, z], sa, sb);
      if (d2 < best) best = d2;
    }
  }
  if (best > 0.05 * 0.05) unmatched.push({ p: [x, y, z], dist: Math.sqrt(best) });
}

const result = {
  input: { matCount: orig.matCount, area: orig.area, maxL: orig.maxL, sockBndCount: orig.sockBndCount },
  output: { matCount: out.matCount, area: out.area, maxL: out.maxL, sockBndCount: out.sockBndCount },
  unmatchedBndCount: unmatched.length,
  unmatchedDist: unmatched.map((u) => +u.dist.toFixed(4)),
  unmatchedSample: unmatched.slice(0, 15).map((u) => ({ p: u.p.map((x) => +x.toFixed(2)), dist: +u.dist.toFixed(3) })),
  // 大三角形（maxL > 0.4 在袜子区域，视觉跨曲面）
  outBigTris: out.sockTris.filter((t) => t.maxL > 0.4).sort((a, b) => b.area - a.area).slice(0, 10).map((t) => ({ i: t.i, area: +t.area.toFixed(4), maxL: +t.maxL.toFixed(3), c: t.c.map((x) => +x.toFixed(2)) })),
  inBigTris: orig.sockTris.filter((t) => t.maxL > 0.4).length,
};
writeFileSync('diag-sock.json', JSON.stringify(result, null, 2));
console.log('written diag-sock.json');
