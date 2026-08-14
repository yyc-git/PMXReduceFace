// diag-tda-arm-shading2.mjs — 聚焦: 输入硬边顶点在输出中的命运 + 材质归属 + 1-ring 法线分布
// 用法: node scripts/diag-tda-arm-shading2.mjs <in.pmx> <out.pmx>
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (a, b) => {
  const c = Math.max(-1, Math.min(1, dot(a, b) / (Math.hypot(...a) * Math.hypot(...b) || 1)));
  return Math.acos(c) * 180 / Math.PI;
};

// 材质→三角形映射 (mmdparser materials.faceCount 累计)
function triMaterialMap(m) {
  const map = new Uint16Array(m.faces.length);
  let off = 0;
  for (let mi = 0; mi < m.materials.length; mi++) {
    const cnt = m.materials[mi].faceCount || 0;
    for (let k = 0; k < cnt && off + k < m.faces.length; k++) map[off + k] = mi;
    off += cnt;
  }
  return map;
}
const IN_TM = triMaterialMap(IN);
const OUT_TM = triMaterialMap(OUT);

function faceNormals(m) {
  return m.faces.map((f) => {
    const [a, b, c] = f.indices;
    const p0 = m.vertices[a].position, p1 = m.vertices[b].position, p2 = m.vertices[c].position;
    const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
    const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
    const n = [aby*acz-abz*acy, abz*acx-abx*acz, abx*acy-aby*acx];
    const l = Math.hypot(...n) || 1;
    return [n[0]/l, n[1]/l, n[2]/l];
  });
}
const IN_FN = faceNormals(IN);
const OUT_FN = faceNormals(OUT);

// 顶点 1-ring 面法线分布特征
function ringStats(m, vi, fn) {
  const list = [];
  for (let ti = 0; ti < m.faces.length; ti++) {
    if (m.faces[ti].indices.includes(vi)) list.push(fn[ti]);
  }
  const n = list.length;
  if (!n) return null;
  // 任意两邻接面法线最大夹角（顶点局部曲率上界）
  let maxPair = 0;
  let opp = 0; // 法线夹角 >120° 的对数（对立法线 = 双面薄片）
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = ang(list[i], list[j]);
    if (a > maxPair) maxPair = a;
    if (a > 120) opp++;
  }
  return { n, maxPair, opp };
}

// 区域: 右上臂肩窝（宽一点）
const REGION = { x: [4.0, 8.8], y: [11.0, 16.5], z: [-3.0, 2.5] };
const inR = (p) => p[0] >= REGION.x[0] && p[0] <= REGION.x[1] && p[1] >= REGION.y[0] && p[1] <= REGION.y[1] && p[2] >= REGION.z[0] && p[2] <= REGION.z[1];

// 输入区域硬边顶点 (dev>30°)
const inputHard = [];
{
  const vTris = IN.vertices.map(() => []);
  IN.faces.forEach((f, ti) => { const [a, b, c] = f.indices; if (inR((() => { const p0 = IN.vertices[a].position, p1 = IN.vertices[b].position, p2 = IN.vertices[c].position; return [(p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3]; })())) { vTris[a].push(ti); vTris[b].push(ti); vTris[c].push(ti); } });
  for (let vi = 0; vi < IN.vertices.length; vi++) {
    const list = vTris[vi];
    if (!list.length) continue;
    let ax = 0, ay = 0, az = 0;
    for (const ti of list) { ax += IN_FN[ti][0]; ay += IN_FN[ti][1]; az += IN_FN[ti][2]; }
    const l = Math.hypot(ax, ay, az);
    if (l < 1e-12) continue;
    const d = ang(IN.vertices[vi].normal, [ax / l, ay / l, az / l]);
    if (d > 30) {
      const rs = ringStats(IN, vi, IN_FN);
      const mats = new Map();
      for (const ti of list) mats.set(IN_TM[ti], (mats.get(IN_TM[ti]) || 0) + 1);
      inputHard.push({ vi, d, p: IN.vertices[vi].position, ring: rs.n, maxPair: rs.maxPair, opp: rs.opp, mats: [...mats.entries()] });
    }
  }
}
console.log(`输入区域 dev>30° 硬边顶点: ${inputHard.length}`);
const strapLike = inputHard.filter((h) => h.opp > 0);
console.log(`  其中 1-ring 存在 >120° 对立法线(双面薄片/带边缘): ${strapLike.length}`);
console.log(`  材质归属分布: ${JSON.stringify(inputHard.reduce((acc, h) => { for (const [mi] of h.mats) acc[mi] = (acc[mi] || 0) + 1; return acc; }, {}))}`);
inputHard.sort((a, b) => b.d - a.d).slice(0, 15).forEach((h) => {
  console.log(`  v${h.vi} dev=${h.d.toFixed(0)}° ring=${h.ring} maxPair=${h.maxPair.toFixed(0)}° oppPairs=${h.opp} mats=[${h.mats.map(([mi, c]) => `m${mi}(${IN.materials[mi].name}):${c}`).join(',')}] @[${h.p.map(x => x.toFixed(2))}]`);
});

// 输出中同位置顶点的法线（最近邻匹配）
{
  const cell = 0.1;
  const grid = new Map();
  OUT.vertices.forEach((v, i) => {
    const k = `${Math.floor(v.position[0]/cell)},${Math.floor(v.position[1]/cell)},${Math.floor(v.position[2]/cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  console.log('\n输出中同位置的顶点(硬边顶点的命运):');
  for (const h of inputHard.filter((x) => x.d > 50).slice(0, 12)) {
    const p = h.p;
    const gx = Math.floor(p[0]/cell), gy = Math.floor(p[1]/cell), gz = Math.floor(p[2]/cell);
    let found = [];
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
      const list = grid.get(`${gx+dx},${gy+dy},${gz+dz}`);
      if (!list) continue;
      for (const oi of list) {
        const op = OUT.vertices[oi].position;
        if (Math.hypot(op[0]-p[0], op[1]-p[1], op[2]-p[2]) < 0.02) found.push(oi);
      }
    }
    const desc = found.map((oi) => `o${oi}(n_dev=${ang(h.p.length ? IN.vertices[h.vi].normal : [0,0,1], OUT.vertices[oi].normal).toFixed(0)}°)`);
    console.log(`  v${h.vi} @[${p.map(x=>x.toFixed(2)).join(',')}] → ${desc.join(' ') || '无'}`);
  }
}

// 材质明细（区域）
{
  console.log('\n区域材质明细(输入):');
  const cnt = new Map();
  IN.faces.forEach((f, ti) => {
    const [a, b, c] = f.indices;
    const p0 = IN.vertices[a].position, p1 = IN.vertices[b].position, p2 = IN.vertices[c].position;
    const pc = [(p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3];
    if (inR(pc)) cnt.set(IN_TM[ti], (cnt.get(IN_TM[ti]) || 0) + 1);
  });
  [...cnt.entries()].sort((a, b) => b[1] - a[1]).forEach(([mi, c]) => {
    const m = IN.materials[mi];
    console.log(`  m${mi} "${m.name}" tri=${c} toonIdx=${m.toonIndex} envFlag=${m.envFlag} texIdx=${m.textureIndex}`);
  });
}
