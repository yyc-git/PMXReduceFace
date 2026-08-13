// diag-holes.mjs — 减面质量诊断：洞（新增边界/非流形）+ 折叠翻转 + sliver 量化对比
// 用法：node scripts/diag-holes.mjs <input.pmx> [lod1.pmx [lod2.pmx ...]]
// 输出：每个模型的「边界边 / 非流形边 / 新增边界（洞） / 折叠翻转三角 / sliver」统计，
//       其中「新增边界（洞）」用空间匹配（输出边界边中点到输入边界边线段距离）量化。
import { loadPmx } from '../src/tool/lib/pmx-loader.mjs';
import { SLIVER_ASPECT_MAX, SLIVER_MAXL_MIN, FOLD_ANGLE_MAX_DEG } from '../src/tool/pmx-face-reduce/qem.mjs';

function edgeKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

function triStats(a, b, c) {
    const ab = Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
    const bc = Math.hypot(b[0]-c[0], b[1]-c[1], b[2]-c[2]);
    const ca = Math.hypot(c[0]-a[0], c[1]-a[1], c[2]-a[2]);
    const maxL = Math.max(ab, bc, ca);
    const minL = Math.min(ab, bc, ca);
    return { maxL, minL, aspect: minL > 1e-12 ? maxL / minL : Infinity };
}

function triNormal(p0, p1, p2) {
    const abx = p1[0]-p0[0], aby = p1[1]-p0[1], abz = p1[2]-p0[2];
    const acx = p2[0]-p0[0], acy = p2[1]-p0[1], acz = p2[2]-p0[2];
    return [aby*acz - abz*acy, abz*acx - abx*acz, abx*acy - aby*acx];
}

function dotNorm(a, b) {
    const la = Math.hypot(a[0], a[1], a[2]);
    const lb = Math.hypot(b[0], b[1], b[2]);
    if (la < 1e-12 || lb < 1e-12) return 1;
    return (a[0]*b[0] + a[1]*b[1] + a[2]*b[2]) / (la * lb);
}

function pointSegDist2(p, a, b) {
    const abx = b[0]-a[0], aby = b[1]-a[1], abz = b[2]-a[2];
    const apx = p[0]-a[0], apy = p[1]-a[1], apz = p[2]-a[2];
    const len2 = abx*abx + aby*aby + abz*abz;
    if (len2 < 1e-16) return apx*apx + apy*apy + apz*apz;
    let t = (apx*abx + apy*aby + apz*abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a[0] + abx*t - p[0], cy = a[1] + aby*t - p[1], cz = a[2] + abz*t - p[2];
    return cx*cx + cy*cy + cz*cz;
}

function analyze(path) {
    const m = loadPmx(path);
    const v = m.vertices;
    const faces = m.faces;

    const cnt = new Map();
    const mid = new Map();
    for (const f of faces) {
        const [a, b, c] = f.indices;
        for (const [x, y] of [[a, b], [b, c], [c, a]]) {
            const k = edgeKey(x, y);
            cnt.set(k, (cnt.get(k) || 0) + 1);
            if (!mid.has(k)) {
                const px = v[x].position, py = v[y].position;
                mid.set(k, [(px[0]+py[0])/2, (px[1]+py[1])/2, (px[2]+py[2])/2]);
            }
        }
    }
    let bnd = 0, nonManifold = 0;
    for (const [, c] of cnt) { if (c === 1) bnd++; else if (c > 2) nonManifold++; }

    let sliver = 0;
    for (const f of faces) {
        const [a, b, c] = f.indices;
        const s = triStats(v[a].position, v[b].position, v[c].position);
        if (s.aspect >= SLIVER_ASPECT_MAX && s.maxL >= SLIVER_MAXL_MIN) sliver++;
    }

    const edgeTris = new Map();
    for (let ti = 0; ti < faces.length; ti++) {
        const [a, b, c] = faces[ti].indices;
        for (const [x, y] of [[a, b], [b, c], [c, a]]) {
            const k = edgeKey(x, y);
            if (!edgeTris.has(k)) edgeTris.set(k, []);
            edgeTris.get(k).push(ti);
        }
    }
    const FOLD_DOT = Math.cos((FOLD_ANGLE_MAX_DEG * Math.PI) / 180);
    let foldOver = 0;
    for (let ti = 0; ti < faces.length; ti++) {
        const [a, b, c] = faces[ti].indices;
        const n = triNormal(v[a].position, v[b].position, v[c].position);
        let bad = false;
        for (const [x, y] of [[a, b], [b, c], [c, a]]) {
            const nbrs = edgeTris.get(edgeKey(x, y)) || [];
            for (const tj of nbrs) {
                if (tj === ti) continue;
                const [a2, b2, c2] = faces[tj].indices;
                const n2 = triNormal(v[a2].position, v[b2].position, v[c2].position);
                if (dotNorm(n, n2) < FOLD_DOT) { bad = true; break; }
            }
            if (bad) break;
        }
        if (bad) foldOver++;
    }

    return { verts: v.length, tris: faces.length, bnd, nonManifold, sliver, foldOver, cnt, mid, v, faces };
}

const [input, ...lods] = process.argv.slice(2);
if (!input) { console.error('usage: node scripts/diag-holes.mjs <input.pmx> [lod.pmx ...]'); process.exit(1); }

const orig = analyze(input);
console.log(`原始 ${input}: 顶点 ${orig.verts} 三角 ${orig.tris} | 边界边 ${orig.bnd} 非流形 ${orig.nonManifold} | sliver ${orig.sliver} | foldOver ${orig.foldOver}`);

// 原始边界边线段 + 空间哈希
const CELL = 0.5;
const bndGrid = new Map();
for (const [k, c] of orig.cnt) {
    if (c !== 1) continue;
    const [a, b] = k.split(':').map(Number);
    const seg = [orig.v[a].position, orig.v[b].position];
    const p = orig.mid.get(k);
    const key = `${Math.floor(p[0]/CELL)},${Math.floor(p[1]/CELL)},${Math.floor(p[2]/CELL)}`;
    if (!bndGrid.has(key)) bndGrid.set(key, []);
    bndGrid.get(key).push(seg);
}

for (const lod of lods) {
    const m = analyze(lod);
    console.log(`\n${lod}: 顶点 ${m.verts} 三角 ${m.tris} | 边界边 ${m.bnd} (原始 ${orig.bnd}) 非流形 ${m.nonManifold} | sliver ${m.sliver} | foldOver ${m.foldOver}`);
    for (const tol of [0.05, 0.1, 0.2]) {
        const tol2 = tol * tol;
        let matched = 0, unmatched = 0;
        for (const [k, c] of m.cnt) {
            if (c !== 1) continue;
            const p = m.mid.get(k);
            const gx = Math.floor(p[0]/CELL), gy = Math.floor(p[1]/CELL), gz = Math.floor(p[2]/CELL);
            let ok = false;
            outer: for (let dx = -1; dx <= 1 && !ok; dx++) for (let dy = -1; dy <= 1 && !ok; dy++) for (let dz = -1; dz <= 1 && !ok; dz++) {
                const segs = bndGrid.get(`${gx+dx},${gy+dy},${gz+dz}`);
                if (!segs) continue;
                for (const [sa, sb] of segs) if (pointSegDist2(p, sa, sb) < tol2) { ok = true; break outer; }
            }
            if (ok) matched++; else unmatched++;
        }
        console.log(`  容差 ${tol}: 边界边匹配 ${matched} / 新增边界(洞候选) ${unmatched}`);
    }
}
