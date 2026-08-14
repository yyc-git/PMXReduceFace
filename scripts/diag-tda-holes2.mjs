// diag-tda-holes2.mjs — 全模型空洞检测：找输出模型边界边环（洞）
// 用法: node scripts/diag-tda-holes2.mjs <in.pmx> <out.pmx>
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const IN = loadPmx(inPath, false);
const OUT = loadPmx(outPath, false);
const inPos = IN.vertices.map(v => v.position);
const outPos = OUT.vertices.map(v => v.position);
const inTri = (IN.faces || []).map(f => f.indices);
const outTri = (OUT.faces || []).map(f => f.indices);

const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// 边界边（只被 1 个三角形共享）
function boundaryEdges(tris) {
  const cnt = new Map();
  for (const t of tris) {
    for (const [x, y] of [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]]) {
      const k = key(x, y);
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
  }
  const out = [];
  for (const [k, c] of cnt) if (c === 1) out.push(k.split(':').map(Number));
  return out;
}

// 边界边 → 环（沿顶点连接追踪）
function edgeLoops(edges) {
  const adj = new Map();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const visited = new Set();
  const loops = [];
  for (const [a, b] of edges) {
    const k = key(a, b);
    if (visited.has(k)) continue;
    // BFS 追踪环
    const loop = [a, b];
    visited.add(k);
    let cur = b, prev = a;
    while (cur !== a && loop.length < 100000) {
      const nbs = adj.get(cur) || [];
      let next = null;
      for (const n of nbs) {
        if (n !== prev && !visited.has(key(cur, n))) { next = n; break; }
      }
      if (next === null) break; // 开放链（模型边缘，不是闭环洞）
      visited.add(key(cur, next));
      loop.push(next);
      prev = cur; cur = next;
    }
    if (loop.length >= 3 && cur === a) loops.push(loop); // 闭环 = 洞
  }
  return loops;
}

// 环长度分布 + 位置（质心）+ 面积
function loopInfo(loop, pos) {
  let area = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < loop.length; i++) {
    const p0 = pos[loop[i]], p1 = pos[loop[(i+1) % loop.length]];
    area += p0[0]*p1[1] - p1[0]*p0[1]; // 投影面积（xy）
    cx += p0[0]; cy += p0[1]; cz += p0[2];
  }
  return { len: loop.length, area: Math.abs(area)/2, c: [cx/loop.length, cy/loop.length, cz/loop.length] };
}

const inB = boundaryEdges(inTri);
const outB = boundaryEdges(outTri);
console.log(`输入边界边: ${inB.length}，输出边界边: ${outB.length}`);

const inLoops = edgeLoops(inB);
const outLoops = edgeLoops(outB);
console.log(`输入洞环: ${inLoops.length}，输出洞环: ${outLoops.length}`);

// 输出环按长度排序，展示所有环（前 40）
const outInfos = outLoops.map(l => loopInfo(l, outPos)).sort((a,b) => b.len - a.len);
console.log('\n输出洞环（按边长降序 Top 30）：');
for (const info of outInfos.slice(0, 30)) {
  console.log(`  环长 ${info.len} 面积≈${info.area.toFixed(4)} @ (${info.c.map(v=>v.toFixed(2)).join(', ')})`);
}

// 环长 ≥ 5 的（真正的洞，不是边界退化）
const big = outInfos.filter(i => i.len >= 5);
console.log(`\n环长 ≥5 的洞: ${big.length} 个`);
for (const info of big.slice(0, 20)) {
  console.log(`  环长 ${info.len} 面积≈${info.area.toFixed(4)} @ (${info.c.map(v=>v.toFixed(2)).join(', ')})`);
}
