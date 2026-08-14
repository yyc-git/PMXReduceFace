// diag-tda-hole-locate.mjs — 精确定位输出新增洞（对比输入输出三角形覆盖）
// 思路：输出边界边中「输入无对应」的边 → 围成洞；列出洞的顶点环 + 缺失三角形
// 用法: node scripts/diag-tda-hole-locate.mjs <in.pmx> <out.pmx> [x0 x1 y0 y1 z0 z1]
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath, ...box] = process.argv.slice(2);
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

const inB = boundaryEdges(inTri);
const outB = boundaryEdges(outTri);

// 输入边界边空间网格（中点 + 容差）
const TOL = 0.12;
const cell = 0.12;
const grid = new Map();
for (const [a, b] of inB) {
  const p = inPos[a], q = inPos[b];
  const c = [(p[0]+q[0])/2, (p[1]+q[1])/2, (p[2]+q[2])/2];
  const k = `${Math.floor(c[0]/cell)},${Math.floor(c[1]/cell)},${Math.floor(c[2]/cell)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(c);
}

// 输出新增边界边（输入无匹配）
const newEdges = [];
for (const [a, b] of outB) {
  const p = outPos[a], q = outPos[b];
  const c = [(p[0]+q[0])/2, (p[1]+q[1])/2, (p[2]+q[2])/2];
  if (box.length === 6) {
    const [x0,x1,y0,y1,z0,z1] = box.map(Number);
    if (c[0]<x0||c[0]>x1||c[1]<y0||c[1]>y1||c[2]<z0||c[2]>z1) continue;
  }
  const gx = Math.floor(c[0]/cell), gy = Math.floor(c[1]/cell), gz = Math.floor(c[2]/cell);
  let matched = false;
  outer: for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) {
    const cands = grid.get(`${gx+dx},${gy+dy},${gz+dz}`);
    if (!cands) continue;
    for (const ic of cands) {
      if (Math.hypot(ic[0]-c[0], ic[1]-c[1], ic[2]-c[2]) < TOL) { matched = true; break outer; }
    }
  }
  if (!matched) {
    const len = Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]);
    newEdges.push({ a, b, len, c });
  }
}
newEdges.sort((x, y) => y.len - x.len);
console.log(`新增边界边 ${newEdges.length} 条`);
for (const e of newEdges) {
  console.log(`  len=${e.len.toFixed(3)} @(${e.c.map(v=>v.toFixed(2)).join(', ')})  A(${outPos[e.a].map(v=>v.toFixed(2)).join(',')}) B(${outPos[e.b].map(v=>v.toFixed(2)).join(',')})`);
}

// 用新增边界边追踪环（连接相邻边）
if (newEdges.length >= 3) {
  const adj = new Map();
  for (const e of newEdges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }
  const visited = new Set();
  const loops = [];
  for (const e of newEdges) {
    const k = key(e.a, e.b);
    if (visited.has(k)) continue;
    const loop = [e.a, e.b];
    visited.add(k);
    let cur = e.b, prev = e.a;
    while (cur !== e.a && loop.length < 100) {
      const nbs = adj.get(cur) || [];
      let next = null;
      for (const n of nbs) {
        if (n !== prev && !visited.has(key(cur, n))) { next = n; break; }
      }
      if (next === null) break;
      visited.add(key(cur, next));
      loop.push(next);
      prev = cur; cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  console.log(`\n新增边界组成的环: ${loops.length} 个`);
  for (const l of loops) {
    const closed = l[0] === l[l.length-1] || adj.get(l[l.length-1]).includes(l[0]);
    const c = [0,0,0];
    l.forEach(v => { c[0]+=outPos[v][0]; c[1]+=outPos[v][1]; c[2]+=outPos[v][2]; });
    c[0]/=l.length; c[1]/=l.length; c[2]/=l.length;
    console.log(`  环长 ${l.length} ${closed?'闭合=洞':'开放链'} 质心@(${c.map(v=>v.toFixed(2)).join(', ')})`);
  }
}
