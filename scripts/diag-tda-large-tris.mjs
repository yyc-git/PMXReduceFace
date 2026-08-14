// diag-tda-large-tris.mjs — 抓新增超尺寸三角形 + 定位（右臂后侧/左大腿内侧）
// 用法: node scripts/diag-tda-large-tris.mjs <in.pmx> <out.pmx> [--all]
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);
const inPos = IN.vertices.map(v => v.position);
const outPos = OUT.vertices.map(v => v.position);
const inTri = (IN.faces || []).map(f => f.indices);
const outTri = (OUT.faces || []).map(f => f.indices);

const triGeom = (pos, t) => {
  const p0 = pos[t[0]], p1 = pos[t[1]], p2 = pos[t[2]];
  const a = Math.hypot(p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]);
  const b = Math.hypot(p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]);
  const c = Math.hypot(p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]);
  const s = (a+b+c)/2;
  const area = Math.sqrt(Math.max(0, s*(s-a)*(s-b)*(s-c)));
  return { maxL: Math.max(a,b,c), area };
};
const triCentroid = (pos, t) => {
  const p0 = pos[t[0]], p1 = pos[t[1]], p2 = pos[t[2]];
  return [(p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3];
};

// 输入三角形 maxL 分布（p99 阈值 = verify 同款口径）
const inMaxL = inTri.map(t => triGeom(inPos, t).maxL).sort((a,b)=>a-b);
const p99 = inMaxL[Math.floor(inMaxL.length*0.99)];
const p50 = inMaxL[Math.floor(inMaxL.length*0.5)];
console.log(`输入三角形 ${inTri.length}，maxL p50=${p50.toFixed(3)} p99=${p99.toFixed(3)}`);
console.log(`输出三角形 ${outTri.length}`);

// 局部相对超尺寸检测：输出三角形 maxL vs 输入同位置邻域（半径 R）三角形 maxL p90
// 全局 p99 被裙摆大平面拉高 → 手臂/大腿高曲率区相对超尺寸漏网。
const R = 0.5; // 邻域半径
const cell = 0.25;
const inGridAll = new Map();
for (const t of inTri) {
  const c = triCentroid(inPos, t);
  const k = `${Math.floor(c[0]/cell)},${Math.floor(c[1]/cell)},${Math.floor(c[2]/cell)}`;
  if (!inGridAll.has(k)) inGridAll.set(k, []);
  inGridAll.get(k).push({ c, maxL: triGeom(inPos, t).maxL });
}
const localP90 = (c) => {
  const gx = Math.floor(c[0]/cell), gy = Math.floor(c[1]/cell), gz = Math.floor(c[2]/cell);
  const ls = [];
  for (let dx=-2; dx<=2; dx++) for (let dy=-2; dy<=2; dy++) for (let dz=-2; dz<=2; dz++) {
    const list = inGridAll.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!list) continue;
    for (const e of list) {
      if (Math.hypot(e.c[0]-c[0], e.c[1]-c[1], e.c[2]-c[2]) <= R) ls.push(e.maxL);
    }
  }
  if (!ls.length) return null;
  ls.sort((a,b)=>a-b);
  return ls[Math.min(ls.length-1, Math.floor(ls.length*0.9))];
};

const localHits = [];
for (let ti = 0; ti < outTri.length; ti++) {
  const g = triGeom(outPos, outTri[ti]);
  const c = triCentroid(outPos, outTri[ti]);
  const base = localP90(c);
  if (base === null || base < 0.05) continue;
  const ratio = g.maxL / base;
  if (ratio >= 2.0 && g.maxL >= 0.5) localHits.push({ ti, maxL: g.maxL, base, ratio, area: g.area, c });
}
localHits.sort((a,b) => b.ratio - a.ratio);
console.log(`\n局部相对超尺寸（maxL >= 2× 输入局部 p90，且 >=0.5）：${localHits.length} 个`);
for (const h of localHits.slice(0, 40)) {
  console.log(`  #${h.ti} maxL=${h.maxL.toFixed(3)} (局部基准 ${h.base.toFixed(3)}, ${h.ratio.toFixed(1)}×) area=${h.area.toFixed(4)} @ (${h.c.map(v=>v.toFixed(2)).join(', ')})`);
}

// 区域分布：右臂后侧（x 负 = 角色右侧，shading3 口径 x -9.3..-3.5, y 9-16.5, z<0）、左大腿内侧（两腿之间 |x|<2, y 5-10）
const hitRegions = {
  '右臂后侧 (x<-3,y9-16.5,z<0)': p => p[0] < -3 && p[1] >= 9 && p[1] <= 16.5 && p[2] < 0,
  '左大腿内侧 (|x|<2,y5-10)': p => Math.abs(p[0]) < 2 && p[1] >= 5 && p[1] <= 10,
  '右大腿内侧 (|x|<2,y2-5)': p => Math.abs(p[0]) < 2 && p[1] >= 2 && p[1] < 5,
};
console.log('\n区域分布：');
for (const [name, fn] of Object.entries(hitRegions)) {
  const list = localHits.filter(h => fn(h.c));
  if (list.length) { console.log(`  ${name}: ${list.length} 个`); for (const h of list) console.log(`    #${h.ti} maxL=${h.maxL.toFixed(3)} (${h.ratio.toFixed(1)}×) @ (${h.c.map(v=>v.toFixed(2)).join(', ')})`); }
}
const others2 = localHits.filter(h => !hitRegions['右臂后侧 (x<-3,y9-16.5,z<0)'](h.c) && !hitRegions['左大腿内侧 (|x|<2,y5-10)'](h.c) && !hitRegions['右大腿内侧 (|x|<2,y2-5)'](h.c));
console.log(`  其它: ${others2.length} 个`);
for (const h of others2.slice(0, 20)) console.log(`    #${h.ti} maxL=${h.maxL.toFixed(3)} (${h.ratio.toFixed(1)}×) @ (${h.c.map(v=>v.toFixed(2)).join(', ')})`);
