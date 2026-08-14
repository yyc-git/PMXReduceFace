// diag-tda-arm-seam.mjs — 接缝顶点对的法线一致性: 输入(艺术家调校) vs 输出(recomputeNormals 后)
// 用法: node scripts/diag-tda-arm-seam.mjs <in.pmx> <out.pmx>
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (a, b) => {
  const c = Math.max(-1, Math.min(1, dot(a, b) / (Math.hypot(...a) * Math.hypot(...b) || 1)));
  return Math.acos(c) * 180 / Math.PI;
};

// 三角材质映射
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

// 空间重合顶点对（不同索引、距离 < 0.02）：输入与输出分别找
function coincidentPairs(m, maxDist = 0.02, region) {
  const cell = 0.1;
  const grid = new Map();
  m.vertices.forEach((v, i) => {
    const p = v.position;
    if (region && !(p[0] >= region[0] && p[0] <= region[1] && p[1] >= region[2] && p[1] <= region[3] && p[2] >= region[4] && p[2] <= region[5])) return;
    const k = `${Math.floor(p[0]/cell)},${Math.floor(p[1]/cell)},${Math.floor(p[2]/cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const pairs = new Set();
  for (const [, list] of grid) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const pa = m.vertices[list[a]].position, pb = m.vertices[list[b]].position;
      if (Math.hypot(pa[0]-pb[0], pa[1]-pb[1], pa[2]-pb[2]) < maxDist) pairs.add(`${Math.min(list[a],list[b])}:${Math.max(list[a],list[b])}`);
    }
  }
  return [...pairs].map((k) => k.split(':').map(Number));
}

const REGION = [4.0, 8.8, 10.5, 16.5, -3.0, 2.5]; // 右上臂
const inPairs = coincidentPairs(IN, 0.02, REGION);
const outPairs = coincidentPairs(OUT, 0.02, REGION);

function pairStats(m, pairs, tm) {
  const angs = [];
  for (const [a, b] of pairs) {
    const n = ang(m.vertices[a].normal, m.vertices[b].normal);
    const p = m.vertices[a].position;
    // 顶点材质归属（其邻接三角形的材质集合）
    const matsA = new Set(), matsB = new Set();
    m.faces.forEach((f, ti) => {
      if (f.indices.includes(a)) matsA.add(tm[ti]);
      if (f.indices.includes(b)) matsB.add(tm[ti]);
    });
    angs.push({ n, p, matsA: [...matsA], matsB: [...matsB] });
  }
  return angs;
}

const inA = pairStats(IN, inPairs, IN_TM);
const outA = pairStats(OUT, outPairs, OUT_TM);

const p95 = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * 0.95))]; };
console.log(`区域重合顶点对: 输入 ${inPairs.length} | 输出 ${outPairs.length}`);
console.log(`输入对法线夹角: p50=${p95(inA.map(x=>x.n))} p95=${p95(inA.map(x=>x.n)).toFixed(1)} max=${Math.max(...inA.map(x=>x.n)).toFixed(1)} | >40°: ${inA.filter(x=>x.n>40).length} >70°: ${inA.filter(x=>x.n>70).length}`);
console.log(`输出对法线夹角: p50=${p95(outA.map(x=>x.n))} p95=${p95(outA.map(x=>x.n)).toFixed(1)} max=${Math.max(...outA.map(x=>x.n)).toFixed(1)} | >40°: ${outA.filter(x=>x.n>40).length} >70°: ${outA.filter(x=>x.n>70).length}`);

console.log('\n输出中法线夹角最大的 20 个重合对（跨材质 = 破面候选）:');
outA.map((x, i) => ({ x, i })).sort((a, b) => b.x.n - a.x.n).slice(0, 20).forEach(({ x }) => {
  const cross = x.matsA.some((mi) => !x.matsB.includes(mi));
  console.log(`  @[${x.p.map(v=>v.toFixed(2)).join(',')}] pairAngle=${x.n.toFixed(0)}° crossMat=${cross} matsA=[${x.matsA.map(mi=>`m${mi}(${IN.materials[mi]?IN.materials[mi].name:mi})`)}] matsB=[${x.matsB.map(mi=>`m${mi}(${IN.materials[mi]?IN.materials[mi].name:mi})`)}]`);
});

// 同样位置在输入中的对角度（对比）
console.log('\n对应输入同位置的对法线夹角（验证艺术家原本的调校）:');
{
  const cell = 0.1;
  const grid = new Map();
  IN.vertices.forEach((v, i) => {
    const k = `${Math.floor(v.position[0]/cell)},${Math.floor(v.position[1]/cell)},${Math.floor(v.position[2]/cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const top = outA.map((x) => x).sort((a, b) => b.n - a.n).slice(0, 12);
  for (const x of top) {
    const p = x.p;
    const gx = Math.floor(p[0]/cell), gy = Math.floor(p[1]/cell), gz = Math.floor(p[2]/cell);
    const near = new Set();
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
      const list = grid.get(`${gx+dx},${gy+dy},${gz+dz}`);
      if (!list) continue;
      for (const i of list) if (Math.hypot(IN.vertices[i].position[0]-p[0], IN.vertices[i].position[1]-p[1], IN.vertices[i].position[2]-p[2]) < 0.02) near.add(i);
    }
    const arr = [...near];
    let maxPair = 0;
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) maxPair = Math.max(maxPair, ang(IN.vertices[arr[a]].normal, IN.vertices[arr[b]].normal));
    console.log(`  @[${p.map(v=>v.toFixed(2)).join(',')}] 输出对角=${x.n.toFixed(0)}° | 输入同位置最大对法线角=${maxPair.toFixed(0)}° (${arr.length} 个输入顶点)`);
  }
}
