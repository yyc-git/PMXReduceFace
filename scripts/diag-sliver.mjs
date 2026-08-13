// 诊断：列出模型材质名 + LOD 三角形形状分析（aspect ratio / 细长 sliver）
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';
import { SLIVER_ASPECT_MAX, SLIVER_MAXL_MIN } from '../src/tool/pmx-face-reduce/qem.mjs';

function triStats(a, b, c) {
  const ab = Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
  const bc = Math.hypot(b[0]-c[0], b[1]-c[1], b[2]-c[2]);
  const ca = Math.hypot(c[0]-a[0], c[1]-a[1], c[2]-a[2]);
  const maxL = Math.max(ab, bc, ca);
  const minL = Math.min(ab, bc, ca);
  const area = 0.5 * Math.abs(
    (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])
  );
  return { maxL, minL, aspect: minL > 1e-9 ? maxL/minL : Infinity, area };
}

// 「长条 sliver」判定（与 src/tool/pmx-face-reduce/qem.mjs 的 SLIVER_ASPECT_MAX / SLIVER_MAXL_MIN 对齐，
// 直接从 qem.mjs import 保证单一来源）：
// 细且长（aspect 高 + maxL 大）才是视觉致命的长条/多余三角；原始模型发丝级 sliver 细但短（maxL<2），不算。

function analyze(path, label) {
  const m = loadPmx(path);
  const v = m.vertices;
  const faces = m.faces; // [{indices:[i0,i1,i2]}]
  const hist = {};
  let sliver = 0;
  let longSliver = 0;        // aspect>=SLIVER_ASPECT_MAX 且 maxL>=SLIVER_MAXL_MIN（视觉致命）
  let longSliver100 = 0;     // 更严：aspect>=100 且 maxL>=2
  let worst = { aspect: 0 };
  const slivers = [];
  const longSlivers = [];
  for (let f = 0; f < faces.length; f++) {
    const [i0, i1, i2] = faces[f].indices;
    const s = triStats(v[i0].position, v[i1].position, v[i2].position);
    const bucket = s.aspect >= 100 ? '>=100' : s.aspect >= 50 ? '50-100' : s.aspect >= 20 ? '20-50' : s.aspect >= 10 ? '10-20' : '<10';
    hist[bucket] = (hist[bucket] || 0) + 1;
    if (s.aspect > worst.aspect) worst = { aspect: s.aspect, f, maxL: s.maxL, area: s.area };
    if (s.aspect >= 20) {
      sliver++;
      if (slivers.length < 10) slivers.push({ f, aspect: +s.aspect.toFixed(1), maxL: +s.maxL.toFixed(4) });
    }
    if (s.aspect >= SLIVER_ASPECT_MAX && s.maxL >= SLIVER_MAXL_MIN) {
      longSliver++;
      if (s.aspect >= 100) longSliver100++;
      if (longSlivers.length < 10) longSlivers.push({ f, aspect: +s.aspect.toFixed(1), maxL: +s.maxL.toFixed(4) });
    }
  }
  console.log(`\n=== ${label} ===`);
  console.log('顶点:', v.length, '三角形:', faces.length);
  console.log('aspect 分布:', JSON.stringify(hist));
  console.log('sliver(aspect>=20):', sliver, '| 最差:', JSON.stringify(worst));
  console.log(`长条 sliver(aspect>=${SLIVER_ASPECT_MAX} && maxL>=${SLIVER_MAXL_MIN}):`, longSliver, '| 其中 aspect>=100:', longSliver100);
  if (longSlivers.length) console.log('长条样例:', JSON.stringify(longSlivers));
  console.log('样例:', JSON.stringify(slivers));
  // 每个材质的 sliver 分布
  console.log('材质 sliver 分布:');
  m.materials.forEach((mat, mi) => {
    let cnt = 0, total = 0;
    for (let f = mat.faceStart ?? 0; f < (mat.faceStart ?? 0) + mat.faceCount; f++) {
      const [i0, i1, i2] = faces[f].indices;
      const s = triStats(v[i0].position, v[i1].position, v[i2].position);
      total++;
      if (s.aspect >= 20) cnt++;
    }
    if (cnt > 0) console.log(`  [${mi}] ${mat.name}: ${cnt}/${total} sliver`);
  });
}

analyze('./demo/assets/XiaoMeiOriginFix_02_elrein.pmx', '原始模型');
analyze('./demo/assets/XiaoMeiOriginFix_02_elrein.LOD50.pmx', 'LOD50');
analyze('./demo/assets/XiaoMeiOriginFix_02_elrein.LOD25.pmx', 'LOD25');
