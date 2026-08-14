// diag-tda-shoulder-seam.mjs — 肩窝接缝（y 14.8-16.2）输入 vs 输出 跨界对法线角度
// 用法: node scripts/diag-tda-shoulder-seam.mjs <in.pmx> <out.pmx>
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
const REGION = { x: [-2.6, -0.4], y: [14.6, 16.3], z: [-2.2, 1.6] };
const inR = (p) => p[0] >= REGION.x[0] && p[0] <= REGION.x[1] && p[1] >= REGION.y[0] && p[1] <= REGION.y[1] && p[2] >= REGION.z[0] && p[2] <= REGION.z[1];

function analyze(m, tm) {
  const vM = m.vertices.map(() => new Set());
  m.faces.forEach((f, ti) => { for (const vi of f.indices) vM[vi].add(tm[ti]); });
  const g = new Map();
  m.vertices.forEach((v, i) => {
    if (!inR(v.position)) return;
    const k = `${Math.floor(v.position[0]/0.1)},${Math.floor(v.position[1]/0.1)},${Math.floor(v.position[2]/0.1)}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(i);
  });
  const pairs = [];
  const seen = new Set();
  for (const [, list] of g) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const i = list[a], j = list[b];
      const key = `${Math.min(i,j)}:${Math.max(i,j)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pa = m.vertices[i].position, pb = m.vertices[j].position;
      if (Math.hypot(pa[0]-pb[0], pa[1]-pb[1], pa[2]-pb[2]) > 0.02) continue;
      const mA = [...vM[i]], mB = [...vM[j]];
      const cross = mA.some((x) => !mB.includes(x));
      pairs.push({ p: pa, n: ang(m.vertices[i].normal, m.vertices[j].normal), mA, mB, cross });
    }
  }
  return pairs;
}

const IN_TM = tmMap(IN);
const OUT_TM = tmMap(OUT);
const inP = analyze(IN, IN_TM);
const outP = analyze(OUT, OUT_TM);
const p95 = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * 0.95))]; };
console.log(`肩窝区重合对: 输入 ${inP.length} | 输出 ${outP.length}`);
console.log(`输入对角度: p50=${p95(inP.map(x=>x.n))} p95=${p95(inP.map(x=>x.n)).toFixed(1)}° max=${Math.max(...inP.map(x=>x.n)).toFixed(1)}° | >40°:${inP.filter(x=>x.n>40).length} >70°:${inP.filter(x=>x.n>70).length}`);
console.log(`输出对角度: p50=${p95(outP.map(x=>x.n))} p95=${p95(outP.map(x=>x.n)).toFixed(1)}° max=${Math.max(...outP.map(x=>x.n)).toFixed(1)}° | >40°:${outP.filter(x=>x.n>40).length} >70°:${outP.filter(x=>x.n>70).length}`);

// 位置级: 输入小 → 输出大 的翻转点
const cell = 0.1;
const grid = new Map();
inP.forEach((x, idx) => {
  const p = x.p;
  const k = `${Math.floor(p[0]/cell)},${Math.floor(p[1]/cell)},${Math.floor(p[2]/cell)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(idx);
});
console.log('\n翻转点（输出对角 - 输入对角 > 40°）:');
// 匹配口径（fix8 修正）：同位置常有多个重合对（肩窝分层拼块 3~15 个），贪心「首个最近输入对」
// 会把输出对错配到另一个重合对 → 误报（fix8 后全部输出法线 === 输入，实测 24 处全是此类误报）。
// 改为「角度最近匹配」：输出对在 ±0.02 位置的输入对中取角度差最小者，差仍 >40° 才算翻转点。
let cnt = 0;
const flips = [];
for (const o of outP) {
  const p = o.p;
  const gx = Math.floor(p[0]/cell), gy = Math.floor(p[1]/cell), gz = Math.floor(p[2]/cell);
  let best = -1, bestAngDiff = 1e9;
  for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
    const list = grid.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!list) continue;
    for (const idx of list) {
      const q = inP[idx].p;
      if (Math.hypot(q[0]-p[0], q[1]-p[1], q[2]-p[2]) > 0.02) continue;
      const d = Math.abs(inP[idx].n - o.n);
      if (d < bestAngDiff) { bestAngDiff = d; best = idx; }
    }
  }
  if (best >= 0) {
    const dIn = inP[best].n, dOut = o.n;
    if (bestAngDiff > 40) { cnt++; flips.push({ p, dIn, dOut, mA: o.mA, mB: o.mB }); }
  }
}
console.log(`翻转点总数: ${cnt}`);
// 翻转点材质组合
const combos = new Map();
for (const f of flips) {
  const names = [...new Set([...f.mA, ...f.mB])].map((mi) => IN.materials[mi] ? IN.materials[mi].name.slice(0, 10) : mi).sort().join('↔');
  combos.set(names, (combos.get(names) || 0) + 1);
}
console.log('翻转点材质组合:', [...combos.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}:${c}`).join(' | '));
flips.slice(0, 10).forEach((f) => console.log(`  @[${f.p.map(x=>x.toFixed(2)).join(',')}] in=${f.dIn.toFixed(0)}°→out=${f.dOut.toFixed(0)}°`));
