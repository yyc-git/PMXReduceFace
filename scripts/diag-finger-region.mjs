// diag-finger-region.mjs — 手指区域新增突起诊断（兄弟反馈 LOD70 小手指突出的面还在）
// 用法: node scripts/diag-finger-region.mjs <in.pmx> <out.pmx>
// 聚焦手指区域 |x|>6, y>11，对比输入/输出 protrude>阈值 的三角形数量与位置聚类，
// 并列出输出「新增」（protrude 超阈值且输入同位置无）的三角形。
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';
import { maxProtrudeOfVerts, buildEdgeTris } from '../src/tool/pmx-face-reduce/qem.mjs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('usage: node scripts/diag-finger-region.mjs <in.pmx> <out.pmx>'); process.exit(1); }

const load = (p) => loadPmx(p, false);
const orig = load(inPath);
const out = load(outPath);

const vp = (m, i) => m.vertices[i].position;
const tri = (m, i) => m.faces[i].indices;
// 手指区域：|x|>6（手两侧），y>11（手上部）——比 verify 的指尖窄带 (|x|>8, 13.8<y<15) 更宽，抓手指根/中段
const inRegion = (c) => Math.abs(c[0]) > 6.0 && c[1] > 11.0 && Math.abs(c[2]) < 2.0;

function analyze(m, label) {
  const positions = m.vertices.map((v) => v.position);
  const tris = m.faces.map((f) => f.indices);
  const edgeMap = buildEdgeTris(tris);
  const rows = [];
  for (let ti = 0; ti < m.faces.length; ti++) {
    const [a, b, c] = tri(m, ti);
    const p0 = vp(m, a), p1 = vp(m, b), p2 = vp(m, c);
    const cx = (p0[0] + p1[0] + p2[0]) / 3, cy = (p0[1] + p1[1] + p2[1]) / 3, cz = (p0[2] + p1[2] + p2[2]) / 3;
    if (!inRegion([cx, cy, cz])) continue;
    const protrude = maxProtrudeOfVerts(positions, tris, ti, edgeMap);
    if (protrude > 0.04) {
      rows.push({ ti, protrude, cx, cy, cz });
    }
  }
  rows.sort((a, b) => b.protrude - a.protrude);
  console.log(`[${label}] 手指区域 protrude>0.04 三角形: ${rows.length}`);
  // 位置聚类（0.5 网格）
  const clusters = new Map();
  for (const r of rows) {
    const key = `${Math.round(r.cx * 2) / 2},${Math.round(r.cy * 2) / 2}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(r);
  }
  const clist = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of clist.slice(0, 25)) {
    const maxP = Math.max(...v.map((r) => r.protrude));
    console.log(`  @(${k}) 数量=${v.length} maxProtrude=${maxP.toFixed(3)}`);
  }
  return rows;
}

const inRows = analyze(orig, '输入');
const outRows = analyze(out, '输出');

// 新增突起：输出 protrude>0.06 且距离任何输入突起三角形质心 >0.2（粗略判断「新增」）
console.log('\n=== 输出新增突起候选（protrude>0.06, 距输入突起质心>0.2）===');
let newCount = 0;
for (const r of outRows) {
  if (r.protrude <= 0.06) continue;
  let minDist = Infinity;
  for (const s of inRows) {
    const d = Math.hypot(r.cx - s.cx, r.cy - s.cy, r.cz - s.cz);
    if (d < minDist) minDist = d;
  }
  if (minDist > 0.2) {
    newCount++;
    if (newCount <= 30) console.log(`  tri#${r.ti} protrude=${r.protrude.toFixed(3)} @[${r.cx.toFixed(2)},${r.cy.toFixed(2)},${r.cz.toFixed(2)}] 距最近输入突起=${minDist.toFixed(2)}`);
  }
}
console.log(`新增突起总数: ${newCount}`);
