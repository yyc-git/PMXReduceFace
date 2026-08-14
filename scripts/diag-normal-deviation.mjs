// diag-normal-deviation.mjs — 输出顶点法线 vs 几何面法线的偏差检测
// 用法: node diag-normal-deviation.mjs <in.pmx> <out.pmx>
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';

const [inPath, outPath] = process.argv.slice(2);
const load = (p) => loadPmx(p, false);
const orig = load(inPath);
const out = load(outPath);

function triNormals(m) {
  const norms = m.faces.map((f) => {
    const [a, b, c] = f.indices;
    const p0 = m.vertices[a].position, p1 = m.vertices[b].position, p2 = m.vertices[c].position;
    const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
    const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
    const n = [aby*acz-abz*acy, abz*acx-abx*acz, abx*acy-aby*acx];
    const l = Math.hypot(...n) || 1;
    return [n[0]/l, n[1]/l, n[2]/l];
  });
  return norms;
}

function analyze(m, label) {
  const triN = triNormals(m);
  // 顶点相邻三角形索引
  const vTris = m.vertices.map(() => []);
  m.faces.forEach((f, ti) => {
    for (const vi of f.indices) vTris[vi].push(ti);
  });
  // 顶点法线 vs 相邻面法线平均的夹角
  let bad = 0, worse = 0, maxAng = 0;
  const rows = [];
  for (let vi = 0; vi < m.vertices.length; vi++) {
    const vn = m.vertices[vi].normal;
    const list = vTris[vi];
    if (!list.length) continue;
    // 面积加权平均面法线
    let ax = 0, ay = 0, az = 0;
    for (const ti of list) {
      const [a, b, c] = m.faces[ti].indices;
      const p0 = m.vertices[a].position, p1 = m.vertices[b].position, p2 = m.vertices[c].position;
      const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
      const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
      const n = [aby*acz-abz*acy, abz*acx-abx*acz, abx*acy-aby*acx];
      ax += n[0]; ay += n[1]; az += n[2];
    }
    const l = Math.hypot(ax, ay, az);
    if (l < 1e-12) continue;
    const gn = [ax/l, ay/l, az/l];
    const dot = Math.max(-1, Math.min(1, vn[0]*gn[0] + vn[1]*gn[1] + vn[2]*gn[2]));
    const ang = Math.acos(dot) * 180 / Math.PI;
    if (ang > maxAng) maxAng = ang;
    if (ang > 15) bad++;
    if (ang > 30) worse++;
    if (ang > 25) {
      const p = m.vertices[vi].position;
      rows.push({ vi, ang, p });
    }
  }
  console.log(`[${label}] 顶点 ${m.vertices.length} | 法线偏离面平均 >15°: ${bad} | >30°: ${worse} | max: ${maxAng.toFixed(1)}°`);
  rows.sort((a, b) => b.ang - a.ang).slice(0, 12).forEach((r) => {
    console.log(`  v${r.vi} dev=${r.ang.toFixed(1)}° @[${r.p.map((x) => x.toFixed(2))}]`);
  });
  return { bad, worse, maxAng };
}

const a = analyze(orig, '输入');
const b = analyze(out, '输出');
console.log(`\n结论: 输出法线偏离面平均 >15° ${a.bad}→${b.bad} | >30° ${a.worse}→${b.worse} | max ${a.maxAng.toFixed(1)}°→${b.maxAng.toFixed(1)}°`);
