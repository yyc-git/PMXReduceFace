// diag-finger-full.mjs — 指尖全区域（|x|>7, y>13）对比输入/输出/新旧 LOD70
// 找「verify 外带断言没覆盖」的残留尖刺
// 用法: node scripts/diag-finger-full.mjs <in.pmx> <out.pmx> [label]
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';
import { maxProtrudeOfVerts, buildEdgeTris } from '../src/tool/pmx-face-reduce/qem.mjs';

const [inPath, outPath, label = '输出'] = process.argv.slice(2);
const load = (p) => loadPmx(p, false);
const orig = load(inPath);
const out = load(outPath);

function analyze(m, tag) {
  const positions = m.vertices.map((v) => v.position);
  const tris = m.faces.map((f) => f.indices);
  const edgeMap = buildEdgeTris(tris);
  const rows = [];
  for (let ti = 0; ti < m.faces.length; ti++) {
    const t = m.faces[ti].indices;
    const p0 = positions[t[0]], p1 = positions[t[1]], p2 = positions[t[2]];
    const cx = (p0[0] + p1[0] + p2[0]) / 3, cy = (p0[1] + p1[1] + p2[1]) / 3, cz = (p0[2] + p1[2] + p2[2]) / 3;
    // 全指尖区域 |x|>7, 13<y<16
    if (Math.abs(cx) <= 7 || cy <= 13 || cy >= 16) continue;
    const p = maxProtrudeOfVerts(positions, tris, ti, edgeMap);
    if (p > 0.045) rows.push({ ti, p, cx, cy, cz });
  }
  rows.sort((a, b) => b.p - a.p);
  const outer = rows.filter((r) => Math.abs(r.cx) > 9);
  const inner = rows.filter((r) => Math.abs(r.cx) <= 9);
  console.log(`[${tag}] 指尖全区域 protrude>0.045: 共${rows.length} (外带|x|>9: ${outer.length}, 内带: ${inner.length})`);
  console.log(`  外带 max=${outer.length ? outer[0].p.toFixed(3) : '-'}  内带 max=${inner.length ? inner[0].p.toFixed(3) : '-'}`);
  // 聚类（0.5 网格）
  const clusters = new Map();
  for (const r of rows) {
    const key = `${Math.round(r.cx * 2) / 2},${Math.round(r.cy * 2) / 2}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(r);
  }
  const clist = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of clist.slice(0, 15)) {
    const maxP = Math.max(...v.map((r) => r.p));
    console.log(`  @(${k}) n=${v.length} maxP=${maxP.toFixed(3)}`);
  }
  return rows;
}

const inRows = analyze(orig, '输入');
const outRows = analyze(out, label);

// 新增突起候选：输出 p>0.05 且距输入任何 >0.045 突起质心 >0.25
console.log(`\n=== ${label} 新增突起候选（p>0.05, 距输入>0.25）===`);
let n = 0;
for (const r of outRows) {
  if (r.p <= 0.05) continue;
  let md = Infinity;
  for (const s of inRows) md = Math.min(md, Math.hypot(r.cx - s.cx, r.cy - s.cy, r.cz - s.cz));
  if (md > 0.25) {
    n++;
    if (n <= 25) console.log(`  tri#${r.ti} p=${r.p.toFixed(3)} @[${r.cx.toFixed(2)},${r.cy.toFixed(2)},${r.cz.toFixed(2)}] 距输入=${md.toFixed(2)} 外带=${Math.abs(r.cx) > 9}`);
  }
}
console.log(`新增突起总数: ${n}`);
