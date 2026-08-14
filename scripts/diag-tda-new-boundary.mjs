// diag-tda-new-boundary.mjs — 找输出「新增边界边」（输入同位置无边界 → 真新增洞/缺口）
// 用法: node scripts/diag-tda-new-boundary.mjs <in.pmx> <out.pmx>
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);
const inPos = IN.vertices.map(v => v.position);
const outPos = OUT.vertices.map(v => v.position);
const inTri = (IN.faces || []).map(f => f.indices);
const outTri = (OUT.faces || []).map(f => f.indices);

const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const boundaryEdges = (tris) => {
  const cnt = new Map();
  for (const t of tris) {
    for (const [x, y] of [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]]) {
      const k = key(x, y);
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
  }
  const o = [];
  for (const [k, c] of cnt) if (c === 1) o.push(k.split(':').map(Number));
  return o;
};

// 输入边界边空间网格（线段中点 + 半径容差）
const inB = boundaryEdges(inTri);
const cell = 0.2;
const grid = new Map();
for (const [a, b] of inB) {
  const p = inPos[a], q = inPos[b];
  const c = [(p[0]+q[0])/2, (p[1]+q[1])/2, (p[2]+q[2])/2];
  const k = `${Math.floor(c[0]/cell)},${Math.floor(c[1]/cell)},${Math.floor(c[2]/cell)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(c);
}

// 输出边界边：中点是否能在输入边界网格 ±cell 内找到匹配 → 是继承，否 = 新增
const outB = boundaryEdges(outTri);
const newEdges = [];
for (const [a, b] of outB) {
  const p = outPos[a], q = outPos[b];
  const c = [(p[0]+q[0])/2, (p[1]+q[1])/2, (p[2]+q[2])/2];
  const gx = Math.floor(c[0]/cell), gy = Math.floor(c[1]/cell), gz = Math.floor(c[2]/cell);
  let matched = false;
  outer: for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
    const cands = grid.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!cands) continue;
    for (const ic of cands) {
      if (Math.hypot(ic[0]-c[0], ic[1]-c[1], ic[2]-c[2]) < cell) { matched = true; break outer; }
    }
  }
  if (!matched) {
    const len = Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]);
    newEdges.push({ a, b, c, len });
  }
}
newEdges.sort((x, y) => y.len - x.len);
console.log(`输出边界边 ${outB.length}，新增（输入无匹配）${newEdges.length} 个`);
console.log('\n新增边界边 Top 40（按长度降序）：');
for (const e of newEdges.slice(0, 40)) {
  console.log(`  len=${e.len.toFixed(3)} 中点@(${e.c.map(v=>v.toFixed(2)).join(', ')})`);
}
console.log('\n区域统计：');
const regions = {
  '左大腿内侧 (|x|<3,y5-10)': p => Math.abs(p[0])<3 && p[1]>=5 && p[1]<=10,
  '右臂后侧 (x3.5-9,y12-16.5,z<0.5)': p => p[0]>=3.5 && p[0]<=9 && p[1]>=12 && p[1]<=16.5 && p[2]<0.5,
  '胯部 (|x|<3,y10-12)': p => Math.abs(p[0])<3 && p[1]>=10 && p[1]<=12,
};
for (const [name, fn] of Object.entries(regions)) {
  const list = newEdges.filter(e => fn(e.c));
  if (list.length) {
    console.log(`  ${name}: ${list.length} 个`);
    for (const e of list.slice(0, 10)) console.log(`    len=${e.len.toFixed(3)} @(${e.c.map(v=>v.toFixed(2)).join(', ')})`);
  }
}
