// qem.mjs — QEM 约束边折叠（Garland & Heckbert 1997）
// 纯函数模块，无 mmdparser 依赖，可被 jest 直接 import。
//
// 顶点结构（mmdparser 风格）：{ position:[3], normal:[3], uv:[2], auvs:[[4]...], type, skinIndices:[], skinWeights:[], edgeRatio }
// 三角形：[a, b, c]

import { computeQuadrics, solveQuadric, addQuadric } from './quadric.mjs';

// 保持导出接口稳定（quadric 数学已拆至 quadric.mjs）
export { computeQuadrics, solveQuadric };

const DEGENERATE_AREA = 1e-9;
const BOUNDARY_PENALTY = 5.0;
// 近退化边阈值：三角形存在边长 < 该值的「共点边」时视为网格缺陷（叠放/共点几何），
// 折叠清理此类三角形不算「造洞」（见 collapseStep 的洞守卫豁免）。
const NEAR_DEGENERATE_EDGE = 1e-4;
// sliver（细长条）三角形约束：折叠后三角形 aspect（最长边/最短边）过高且最长边过长时，
// 该折叠会制造视觉致命的「长条/多余三角形」（跨区域长条 → 破面感）。
// 阈值选择依据（scripts/diag-sliver.mjs / diag-finger2.mjs 实测）：
// - 第一轮（aspect≥20 且 maxL≥2）已消灭「长条」（maxL≥2）——原始模型此形态为 0；
// - 但头部仍残留「短长条」：LOD25 里 aspect≥20 的三角形 maxL 集中在 1.1~1.9（比第一轮前短），
//   即减面把长条从 maxL≈19 压到 1~2 但仍可见；
// - 更严档位量化：原始模型 aspect≥10 且 maxL≥1 的三角形仅 154/54228（0.28%，集中在
//   2000_Body all 近退化 110 + BurumaSet 布料边 38 + Hair 6，均非头部透明片），属「极少」；
//   减面引入的短长条（LOD25 209 个）远多于原始固有（154），收紧可显著减少。
// - 第三轮（兄弟反馈：小指/无名指仍有多余面）：收紧到 maxL≥1.0 后，手部区域
//   （|x|>4.5, y 9-18）原始模型 aspect>10 三角形为 0（8510 个手部三角形全 aspect≤10），
//   但 LOD50 输出新增 8 个 aspect=11 窄长条（maxL=0.51~0.56 < 1.0）→ 门槛太松，放行了它们。
//   手指直径约 0.3-0.5，maxL≈0.5 的窄长条在手指上视觉非常明显。原始模型全局 maxL≥0.5 的
//   aspect≥10 三角形仅 392/54228（0.72%，集中在袜子位/胸口的固有 sliver），收紧到 0.5 影响小。
// 故收紧到「aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN」，在消灭减面引入窄长条的同时
// 对原始固有细片影响极小（原始固有 sliver 是「存在」不是「折叠产生」，守卫不删它们）。
export const SLIVER_ASPECT_MAX = 10;
export const SLIVER_MAXL_MIN = 0.5;
// 折叠翻转（fold-over）阈值：折叠后受影响三角形与其相邻三角形法线夹角超过该角度（且原始夹角正常）
// 视为「折叠回自身/翻转」，产生视觉上冒出的多余面片（手指细长圆柱高曲率区典型）。
export const FOLD_ANGLE_MAX_DEG = 120;
// 突起（protrude）守卫阈值：折叠后受影响三角形顶点到邻接三角形平面的距离超过该值 → 拒绝。
// 根因：指尖/指甲区的近共面微三角团（面积 ~1e-4）被 QEM「免费」合并成跨曲面大平面 → 顶点从邻面戳出
// （diag-fingertip 实测突起面 8→98、最大突起 0.098→0.184）。
// PROTRUDE_MAX = 突起守卫阈值参考值（0.066，实测校准）；collapseMesh 实际使用尺度归一化阈值
// = PROTRUDE_RATIO × 原始边长中位数（本模型 medE≈0.13 → 0.066）。与每顶点原始突起预算（局部许可）配合：
// 实际许可 = max(尺度归一化阈值, 受影响三角形顶点的原始突起预算)。
// 选择依据：指尖近共面微三角团原始突起 ≤0.03 << 0.066，故能拦下「免费合并成跨曲面大平面」
// （突起 0.08~0.184）；对高曲率区（手/耳/袜口）由局部预算放大许可，不误杀正常简化。
// 尺度归一化必要：合成 fixture（网格 cell≈1.0）若用绝对 0.066 会误杀（实测 1951 目标只到 2761）。
// 校准数据（本模型）：0.08 档指尖突起面 4 但 LOD50 达不到目标（27770 > 27114）；0.066 档 LOD50 达标
// （27114 ≤ 27114）且指尖突起面 6 ≤ 输入基线 8、翻转面仍 34。BDD 计数/单元测试从本常量 import 单一来源。
export const PROTRUDE_MAX = 0.066;
export const PROTRUDE_RATIO = 0.4;
// 预算 cap（第五轮）：每顶点原始突起预算的上限 = PROTRUDE_RATIO × 原始边长中位数 × 1.5
// （本模型 medE≈0.13 → ≈0.078）。指尖输入几何的原始突起预算 ≈0.098（双面微片/指甲缝微特征）
// 被「当局部曲率许可」传播后放行 0.088 的新跨曲面大平面；cap 把预算限制在曲面尺度内，
// 杜绝「微特征突起被误当成曲率许可」。coarser 网格（合成 fixture cell≈1.0）自动放大，不误杀。
export function protrudeCap(medE) {
    return PROTRUDE_RATIO * medE * 1.5;
}
// 减面后洞校验容差（第五轮）：输出边界边中点距输入边界边线段距离超过该值 → 视为「新增洞」。
// 让洞保护与折叠顺序解耦的兜底：折叠顺序再变，最终输出也保证无洞。
export const HOLE_TOL = 0.2;

// 曲率感知三角形尺寸守卫（第六轮 P0）常量。全部基于 fix5 产物实测校准（docs/fix6-plan.md §1/§2.4）：
// - 屁股球面（BurumaSet 袜子/内裤，球半径≈1）局部输入 maxL p95≈0.49 / 面积 p95≈0.043，QEM 把 4-8 个
//   小三角免费合并成跨曲面大平面 → 视觉破面（实测 fix6 输出零跨曲面新超尺寸 = 已消除）；
// - 指尖穹面（半径≈0.3）局部 maxL p95≈0.19-0.24 / 面积 p95≈0.012，鼓包 tri 0.0262/0.301 跨穹面；
// - 合成网格 fixture（cell 1.0 高度场）p95≈4.8°、圆管 seg24 p95≈15°、细管 seg16 p95≈22.5°。
// 曲率门控（CURV_MIN_DEG）：只对局部曲率超过该角度的三角形生效，平坦区（合成 fixture/大腿平面）
// 不受限。真实模型校准（fix6-plan §8 步骤 5，实测数据）：袜子区顶点曲率 p50≈16°/p75≈27°、
// 大腿 p50≈16°、屁股 p50≈13°；网格 fixture p95 仅 4.8°（2% 顶点 ≥12°，接缝/高度场尖点，不阻塞
// 50% 减面目标）。CURV_MIN_DEG=12 在「拦截真实模型跨曲面合并（fix5 实测 444 个 >20° 弯曲面新超尺寸，
// fix6 降到 0）」与「放行平坦区合法合并（56 个新超尺寸全在平坦区，视觉无害）」之间取平衡；12° 时
// 圆管 seg24(15°)/细管(22.5°) 也被门控，BDD 管状 fixture 实测目标仍可达（29/29 全绿）。
// 若校准发现 12° 太紧/太松，按 §2.4 方向在 [8, 20] 区间调整并重跑验证矩阵。
export const CURV_MIN_DEG = 12;
// MAXL_COEF：许可 maxL = 系数 × 顶点局部输入 maxL p95。定稿校准（fix6 校准扫描最优组合，实测
// LOD50 地板 ≈39949、质量断言 6 项全绿）：2.0 在「封住跨曲面合并（fix5 444 个弯曲面新超尺寸 → 0）」
// 与「尽量压低地板」之间取平衡；1.5 时地板更高（41237），1.8/2.0 时地板降到 ≈39949 且质量仍绿。
export const MAXL_COEF = 2.0;
// AREA_COEF：许可面积 = 系数 × 顶点局部输入面积 p95。定稿校准 1.5（与 MAXL_COEF 2.0 配套，实测
// LOD50 地板 ≈39949、质量断言全绿）。
export const AREA_COEF = 1.5;
// P1 大鼓包面积系数（非导出，定稿校准 1.4）：突起大鼓包条件的面积许可独立于尺寸守卫 AREA_COEF。
// 校准扫描最优组合为 MAXL=2.0 / size-AREA=1.5 / big-bump=1.4（实测 39949 面、质量全绿）；若让
// big-bump 复用 AREA_COEF=1.5，实测质量变红（area p99 0.1173 > 1.5×0.0768、跨曲面新超尺寸 3 个，
// 胸部 x≈-1.3/y≈16.5/z≈3.5 处 nbrAngle 94°-106°），故保留独立内部常量（P1 解耦实验的定稿值）。
const P1_BIG_BUMP_AREA_COEF = 1.4;
// 全局下限（兜底）：预算为空的顶点（无有效邻接输入三角形）不得被「0 预算」误杀。
// floorL = MAXL_FLOOR_RATIO × medE（真模型 medE≈0.13 → 0.13；grid fixture medE≈1.0 → 1.0 自动放大）；
// floorA = AREA_FLOOR_RATIO × medE²（真模型 → 0.0085，低于局部 p95 一般不生效）。若诊断发现 floor
// 主导了某曲率区，把 MAXL_FLOOR_RATIO 降到 0.6（§2.4 / §6 R5）。
export const MAXL_FLOOR_RATIO = 1.0;
export const AREA_FLOOR_RATIO = 0.5;
// 局部尺寸预算的最小有效三角形面积：面积 < 该值（如双面微片/近退化片）被排除——垃圾法线虚报曲率、
// 微尺寸污染预算。与 FLIP_LOCK_AREA 同值（1e-3，单一来源，见下）；指尖合法小三角面积 0.0073 ≥ 1e-3
// 不被误排除。
export const SIZE_BUDGET_MIN_AREA = 1e-3;

/**
 * 点到线段最短距离平方（diag-holes.mjs 同口径）。供边界边空间包含校验复用。
 */
export function pointSegDist2(p, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
    const len2 = abx * abx + aby * aby + abz * abz;
    if (len2 < 1e-16) return apx * apx + apy * apy + apz * apz;
    let t = (apx * abx + apy * aby + apz * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a[0] + abx * t - p[0], cy = a[1] + aby * t - p[1], cz = a[2] + abz * t - p[2];
    return cx * cx + cy * cy + cz * cz;
}

/**
 * 输入边界边线段 → 空间哈希（线段按中点入格，diag-holes.mjs 同口径）。
 * @returns {{grid: Map<string, number[][][]>, cell: number}}
 */
export function buildBoundaryEdgeGrid(positions, tris, aliveT, cell = 0.5) {
    const cnt = new Map();
    const segByKey = new Map();
    const midByKey = new Map();
    for (let ti = 0; ti < tris.length; ti++) {
        if (aliveT && !aliveT[ti]) continue;
        const t = tris[ti];
        for (let k = 0; k < 3; k++) {
            const x = t[k], y = t[(k + 1) % 3];
            const key = x < y ? `${x}:${y}` : `${y}:${x}`;
            cnt.set(key, (cnt.get(key) || 0) + 1);
            if (!segByKey.has(key)) {
                const px = posOf(positions, x), py = posOf(positions, y);
                segByKey.set(key, [px, py]);
                midByKey.set(key, [(px[0] + py[0]) / 2, (px[1] + py[1]) / 2, (px[2] + py[2]) / 2]);
            }
        }
    }
    const grid = new Map();
    for (const [key, c] of cnt) {
        if (c !== 1) continue;
        const p = midByKey.get(key);
        const gk = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
        if (!grid.has(gk)) grid.set(gk, []);
        grid.get(gk).push(segByKey.get(key));
    }
    return { grid, cell };
}

/**
 * 空间上「新增」的边界边数量（输出边界边中点距输入边界边线段最小距离 > tol）。
 * 减面后洞校验兜底（collapseMesh 内部）与 BDD/诊断（check.mjs / diag）共用，单一来源。
 * positions 支持 { position:[3] } 或纯位置数组；aliveT 可选（有效三角形标记）。
 * @returns {number} 输出边界边中无法在输入边界边（tol 内）匹配的数量
 */
export function countSpatiallyNewBoundaryEdges(inPositions, inTris, inAlive, outPositions, outTris, outAlive, tol = HOLE_TOL, cell = 0.5) {
    const { grid } = buildBoundaryEdgeGrid(inPositions, inTris, inAlive, cell);
    const cnt = new Map();
    const mid = new Map();
    for (let ti = 0; ti < outTris.length; ti++) {
        if (outAlive && !outAlive[ti]) continue;
        const t = outTris[ti];
        for (let k = 0; k < 3; k++) {
            const x = t[k], y = t[(k + 1) % 3];
            const key = x < y ? `${x}:${y}` : `${y}:${x}`;
            cnt.set(key, (cnt.get(key) || 0) + 1);
            if (!mid.has(key)) {
                const px = posOf(outPositions, x), py = posOf(outPositions, y);
                mid.set(key, [(px[0] + py[0]) / 2, (px[1] + py[1]) / 2, (px[2] + py[2]) / 2]);
            }
        }
    }
    const tol2 = tol * tol;
    let newCount = 0;
    for (const [key, c] of cnt) {
        if (c !== 1) continue;
        const p = mid.get(key);
        const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell), gz = Math.floor(p[2] / cell);
        let ok = false;
        outer: for (let dx = -1; dx <= 1 && !ok; dx++) for (let dy = -1; dy <= 1 && !ok; dy++) for (let dz = -1; dz <= 1 && !ok; dz++) {
            const segs = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
            if (!segs) continue;
            for (const [sa, sb] of segs) if (pointSegDist2(p, sa, sb) < tol2) { ok = true; break outer; }
        }
        if (!ok) newCount++;
    }
    return newCount;
}
// 双面微片锁定阈值：面积 < FLIP_LOCK_AREA 且与任一邻居法线夹角 > FLIP_LOCK_ANGLE 的三角形
// （指甲/指缝双面薄片：两三角共边、法线相反 150°~172°、面积 ≤5e-4）→ 锁定其 3 顶点。
// 双面微片是合法几何（指甲正反面），不能删/不能合并，只能锁 = 100% 保留外观。
export const FLIP_LOCK_ANGLE = 120;
export const FLIP_LOCK_AREA = 1e-3;
// 材质保护：原始三角形数 ≤ SMALL_MATERIAL_TRI 的材质被视为「小材质」，完全不减面（顶点全锁）
// （verify.mjs 从本模块 import，保证双维护单一来源）
export const SMALL_MATERIAL_TRI = 500;

/* ------------------------------------------------------------------ *
 * 面三角化
 * ------------------------------------------------------------------ */

/**
 * mmdparser faces → 三角形数组 [[a,b,c],...]。
 * mmdparser 已保证每面 indices 长度 3；本函数防御性处理 quad（长度 4 → 拆两个三角形）。
 */
export function triangulateFaces(faces) {
    const tris = [];
    for (const f of faces) {
        const idx = f.indices;
        if (idx.length === 4) {
            tris.push([idx[0], idx[1], idx[2]]);
            tris.push([idx[0], idx[2], idx[3]]);
        } else {
            tris.push([idx[0], idx[1], idx[2]]);
        }
    }
    return tris;
}

/* ------------------------------------------------------------------ *
 * 属性继承
 * ------------------------------------------------------------------ */

/**
 * 合并两端点皮肤数据（BDEF4）。
 * 输入 skinIndices/skinWeights 可为任意长度（mmdparser BDEF1/2/4 分别为 1/2/4）。
 * 输出：indices[4] + weights[4]，同 boneIndex 权重相加，取权重最大前 4，归一化 Σ=1，不足补 0。
 * @param {{indices:number[], weights:number[]}} a
 * @param {{indices:number[], weights:number[]}} b
 */
export function mergeSkin(a, b) {
    const boneWeight = new Map();
    const add = (idx, w) => {
        if (w <= 1e-9) return;
        boneWeight.set(idx, (boneWeight.get(idx) || 0) + w);
    };
    for (let i = 0; i < a.indices.length; i++) add(a.indices[i], a.weights[i]);
    for (let i = 0; i < b.indices.length; i++) add(b.indices[i], b.weights[i]);
    const entries = [...boneWeight.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
    const top = entries.slice(0, 4);
    const total = top.reduce((s, [, w]) => s + w, 0);
    const indices = new Array(4).fill(0);
    const weights = new Array(4).fill(0);
    for (let i = 0; i < top.length; i++) {
        indices[i] = top[i][0];
        weights[i] = total > 1e-12 ? top[i][1] / total : 0;
    }
    return { indices, weights };
}

/**
 * UV/法线/edgeRatio 线性插值（t ∈ [0,1]）。
 * UV 与 edgeRatio 用 plain lerp；法线插值后重新归一化（两个单位向量 lerp 后长度 < 1，
 * 多次折叠累积衰减会让法线长度偏离 1 → MMD 光照明暗错乱 → 视觉破面）。
 * @returns {{uv:number[], normal:number[], edgeRatio:number}}
 */
export function interpolateAttrs(a, b, t) {
    const lerp = (x, y) => x + (y - x) * t;
    const nx = lerp(a.normal[0], b.normal[0]);
    const ny = lerp(a.normal[1], b.normal[1]);
    const nz = lerp(a.normal[2], b.normal[2]);
    const len = Math.hypot(nx, ny, nz);
    const normal = len < 1e-12 ? a.normal.slice() : [nx / len, ny / len, nz / len];
    return {
        uv: [lerp(a.uv[0], b.uv[0]), lerp(a.uv[1], b.uv[1])],
        normal,
        edgeRatio: lerp(a.edgeRatio, b.edgeRatio),
    };
}

/* ------------------------------------------------------------------ *
 * 形状有效性
 * ------------------------------------------------------------------ */

/** 三角形面积（叉积模长 / 2），供 verify 与 BDD 测试复用。 */
export function triArea(p0, p1, p2) {
    const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
    const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

export function triNormal(p0, p1, p2) {
    const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
    const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
    return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
}

/**
 * 点到平面距离（点 p 到「法线 n、过点 q」的平面的距离）。突起度量的基础原语。
 * 注：与 scripts/diag-fingertip.mjs 的 ptPlaneDist 一致，单一来源。
 */
export function pointPlaneDist(p, n, q) {
    return Math.abs((p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] + (p[2] - q[2]) * n[2]);
}

/**
 * 边 → 三角形邻接表（key = "minIdx:maxIdx"）。供 maxProtrudeOfVerts / BDD / 诊断复用。
 */
export function buildEdgeTris(tris) {
    const edgeMap = new Map();
    for (let ti = 0; ti < tris.length; ti++) {
        const t = tris[ti];
        for (let k = 0; k < 3; k++) {
            const a = t[k], b = t[(k + 1) % 3];
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            if (!edgeMap.has(key)) edgeMap.set(key, []);
            edgeMap.get(key).push(ti);
        }
    }
    return edgeMap;
}

const posOf = (positions, i) => (positions[i].position ? positions[i].position : positions[i]);

/**
 * 突起度量（单一来源，第五轮统一口径 = diag-fingertip.mjs）：三角形 ti 的 3 个顶点，
 * 到其 1-ring 邻接三角形（共享边）平面的最大距离。衡量「顶点从曲面戳出」程度。
 * 无邻接三角形 → 返回 0。positions 支持 { position:[3] } 或纯位置数组。
 * @param {number[][]|Object[]} positions
 * @param {number[][]} tris
 * @param {number} ti
 * @param {Map} [edgeMap] 预构建的 buildEdgeTris 结果（避免重复构建）
 */
export function maxProtrudeOfVerts(positions, tris, ti, edgeMap = null) {
    if (!edgeMap) edgeMap = buildEdgeTris(tris);
    const t = tris[ti];
    const verts = [posOf(positions, t[0]), posOf(positions, t[1]), posOf(positions, t[2])];
    const nbs = new Set();
    for (let k = 0; k < 3; k++) {
        const x = t[k], y = t[(k + 1) % 3];
        const key = x < y ? `${x}:${y}` : `${y}:${x}`;
        for (const tj of edgeMap.get(key) || []) if (tj !== ti) nbs.add(tj);
    }
    let maxP = 0;
    for (const tj of nbs) {
        const tn = tris[tj];
        const n = triNormal(posOf(positions, tn[0]), posOf(positions, tn[1]), posOf(positions, tn[2]));
        const len = Math.hypot(n[0], n[1], n[2]);
        if (len < 1e-12) continue;
        const nx = n[0] / len, ny = n[1] / len, nz = n[2] / len;
        const q = posOf(positions, tn[0]);
        for (const p of verts) {
            const d = pointPlaneDist(p, [nx, ny, nz], q);
            if (d > maxP) maxP = d;
        }
    }
    return maxP;
}

/**
 * 三角形三边长度统计：最长边 maxL、最短边 minL、aspect = maxL/minL。
 * aspect 用边长比度量细长程度（与 scripts/diag-sliver.mjs 一致）；minL≈0 时 aspect=Infinity。
 */
export function triEdgeStats(p0, p1, p2) {
    const e0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const e1 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const e2 = Math.hypot(p0[0] - p2[0], p0[1] - p2[1], p0[2] - p2[2]);
    const maxL = Math.max(e0, e1, e2);
    const minL = Math.min(e0, e1, e2);
    return { maxL, minL, aspect: minL > 1e-12 ? maxL / minL : Infinity };
}

/**
 * 原始网格边长中位数：用于尺度归一化突起阈值（PROTRUDE_RATIO × medE）。
 * 绝对常量阈值会对 coarser 网格（合成 fixture cell≈1.0）误杀，必须相对模型尺度。
 */
export function medianEdgeLength(positions, tris) {
    const es = [];
    for (const t of tris) {
        for (const [x, y] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
            const p = positions[x], q = positions[y];
            es.push(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
        }
    }
    es.sort((a, b) => a - b);
    return es.length ? es[Math.floor(es.length / 2)] : 0;
}

/**
 * 是否「细且长」sliver 三角形：aspect ≥ SLIVER_ASPECT_MAX 且 maxL ≥ SLIVER_MAXL_MIN。
 * 该三角形在渲染上是视觉致命的细长条/多余三角（跨区域长条）；原始模型的细短发丝级
 * sliver（maxL < SLIVER_MAXL_MIN）不满足条件，不会被误判。
 */
export function isSliverTriangle(p0, p1, p2) {
    const s = triEdgeStats(p0, p1, p2);
    return s.aspect >= SLIVER_ASPECT_MAX && s.maxL >= SLIVER_MAXL_MIN;
}

/**
 * 判定将三角形 tri 中顶点 u/v 替换为 newPos 后是否仍有效（非退化、非法线翻转、非细长条 sliver）。
 * 用于折叠前的形状校验。
 * @param {number[][]} positions
 * @param {number[]} tri [a,b,c]
 * @param {number} u 折叠端点
 * @param {number} v 折叠端点
 * @param {number[]} newPos
 * @returns {boolean} true=有效可折叠
 */
export function isValidCollapse(positions, tri, u, v, newPos) {
    const old = tri.map((i) => positions[i]);
    const rep = (i) => (i === u || i === v ? newPos : positions[i]);
    const cur = tri.map(rep);
    if (triArea(cur[0], cur[1], cur[2]) < DEGENERATE_AREA) return false;
    const on = triNormal(old[0], old[1], old[2]);
    const nn = triNormal(cur[0], cur[1], cur[2]);
    const dot = on[0] * nn[0] + on[1] * nn[1] + on[2] * nn[2];
    if (dot <= 0) return false;
    // sliver 约束：拒绝折叠后产生「细且长」三角形（aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN）的候选。
    // 否则 QEM 只优化几何误差（点到面距离），细长条面积≈0 → 误差度量认为「无损失」，
    // 但视觉上是冒出的长条/多余三角（兄弟反馈的破面 + 长条现象根因）。
    if (isSliverTriangle(cur[0], cur[1], cur[2])) return false;
    return true;
}

/* ------------------------------------------------------------------ *
 * 拓扑 / 翻转守卫（折叠前校验）
 * ------------------------------------------------------------------ */

/**
 * 构建顶点→三角形邻接表。collapseMesh 内部维护 vTris 复用此结构；测试/诊断从 tris 自建。
 * @param {number} vertexCount
 * @param {number[][]} tris
 * @param {Uint8Array} [aliveT]
 */
export function buildVertexTris(vertexCount, tris, aliveT) {
    const vTris = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) vTris[i] = [];
    for (let ti = 0; ti < tris.length; ti++) {
        if (aliveT && !aliveT[ti]) continue;
        for (const idx of tris[ti]) vTris[idx].push(ti);
    }
    return vTris;
}

/**
 * 拓扑守卫（P0 洞）：边折叠的 link condition（Hoppe 1996）。
 * 折叠 (u,v) 保持流形（不产生非流形边/缝合）的充要条件是：
 *   link(u) ∩ link(v) == 边(u,v) 的对立顶点集合（与边相邻三角形的第三个顶点）。
 * 若 u/v 除对立顶点外还有额外公共邻居，折叠会制造「非流形边」（共享三角形数 > 2）或把
 * 边界缝合成内部（pinching）。注：此条件不防「内部边变边界」这一种洞（见 collapseCreatesHole）。
 * @returns {boolean} true=拓扑合法可折叠
 */
export function linkConditionValid(tris, aliveT, vTris, u, v) {
    const nu = new Set();
    for (const ti of vTris[u]) if (aliveT[ti]) for (const w of tris[ti]) if (w !== u) nu.add(w);
    const nv = new Set();
    for (const ti of vTris[v]) if (aliveT[ti]) for (const w of tris[ti]) if (w !== v) nv.add(w);
    const common = new Set();
    for (const w of nu) if (w !== v && nv.has(w)) common.add(w);
    const opp = new Set();
    for (const ti of vTris[u]) {
        if (!aliveT[ti]) continue;
        const t = tris[ti];
        if (t.includes(v)) for (const w of t) if (w !== u && w !== v) opp.add(w);
    }
    if (common.size !== opp.size) return false;
    for (const w of common) if (!opp.has(w)) return false;
    return true;
}

/**
 * 拓扑守卫（P0 洞，直接版）：检查折叠是否制造「洞」（内部边 → 边界边）或「非流形边」（共享 >2）。
 * 对每个受影响邻居 w 统计合并边 (u,w) 的折叠前后共享三角形数：
 * - post > 2 → 非流形（pinching）→ 拒绝；
 * - 边当前为内部（共享 2）且折叠后 < 2（变边界/悬空）→ 洞 → 拒绝。
 * 注意：link condition 只防「额外公共邻居/缝合」，不防「内部边变边界」这一种洞，
 * （例：内部边 (u,v) 一端 v 落在边界上，折叠后 (u,a) 由内部变边界），故需本检查兜底。
 * @param {number[][]} tris
 * @param {Uint8Array} aliveT
 * @param {number[][]} vTris
 * @param {number} u
 * @param {number} v
 * @param {Set<string>} [ignoreEdges] 豁免边集（edge key "a:b"，a<b）。仅豁免该边「分离成边界」
 *   这一种洞（近退化三角形清理的共点边分离），post>2 的非流形与其它洞仍拒绝。
 * @returns {boolean} true=有洞/非流形，应拒绝
 */
export function collapseCreatesHole(tris, aliveT, vTris, u, v, ignoreEdges = null) {
    const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    const neighbors = new Set();
    for (const ti of vTris[u]) if (aliveT[ti]) for (const w of tris[ti]) if (w !== u && w !== v) neighbors.add(w);
    for (const ti of vTris[v]) if (aliveT[ti]) for (const w of tris[ti]) if (w !== u && w !== v) neighbors.add(w);
    for (const w of neighbors) {
        let preU = 0, preV = 0, post = 0;
        for (const ti of vTris[u]) {
            if (!aliveT[ti] || !tris[ti].includes(w)) continue;
            preU++;
            if (!tris[ti].includes(v)) post++;
        }
        for (const ti of vTris[v]) {
            if (!aliveT[ti] || !tris[ti].includes(w)) continue;
            preV++;
            if (!tris[ti].includes(u)) post++;
        }
        if (post > 2) return true;
        if ((preU === 2 || preV === 2) && post < 2) {
            // 洞：内部边分离成边界。仅当该边属于 ignoreEdges（共点边缺陷清理）时才豁免。
            const keyU = edgeKey(u, w);
            const keyV = edgeKey(v, w);
            if (!(ignoreEdges && (ignoreEdges.has(keyU) || ignoreEdges.has(keyV)))) return true;
        }
    }
    return false;
}

/**
 * 收窄后的洞守卫（第五轮，removesSlit 路径）：本次折叠清理了含「共点边」（边长 < NEAR_DEGENERATE_EDGE）
 * 的近退化三角形时，只豁免「该共点边分离成边界」这一种洞，仍拒绝其它任何洞。
 * 旧实现（第四轮）在 removesSlit 时完全跳过 collapseCreatesHole —— 实测 61 次触发、放行 30 个真洞。
 * @returns {boolean} true=有洞/非流形（removesSlit 豁免仅覆盖共点边分离），应拒绝
 */
export function collapseCreatesHoleNarrow(tris, aliveT, vTris, u, v, positions) {
    const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    const ignoreEdges = new Set();
    for (const ti of vTris[u]) {
        if (!aliveT[ti]) continue;
        const t = tris[ti];
        if (!(t.includes(u) && t.includes(v))) continue; // 被移除的近退化三角形
        const p0 = positions[t[0]], p1 = positions[t[1]], p2 = positions[t[2]];
        if (Math.hypot(p0[0]-p1[0], p0[1]-p1[1], p0[2]-p1[2]) < NEAR_DEGENERATE_EDGE) ignoreEdges.add(edgeKey(t[0], t[1]));
        if (Math.hypot(p1[0]-p2[0], p1[1]-p2[1], p1[2]-p2[2]) < NEAR_DEGENERATE_EDGE) ignoreEdges.add(edgeKey(t[1], t[2]));
        if (Math.hypot(p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]) < NEAR_DEGENERATE_EDGE) ignoreEdges.add(edgeKey(t[2], t[0]));
    }
    return collapseCreatesHole(tris, aliveT, vTris, u, v, ignoreEdges);
}

/**
 * 折叠翻转守卫（P2 fold-over）：模拟 u/v 折叠到 newPos，检查每个受影响存活三角形的新法线
 * 与其相邻三角形（共享边）法线夹角是否突变（> FOLD_ANGLE_MAX_DEG 且原始夹角正常）。
 * 手指/细长圆柱高曲率区折叠易把三角形「翻回自身」→ 视觉冒出多余面片。
 * @returns {boolean} true=存在折叠翻转（应拒绝）
 */
export function collapseFoldOver(positions, tris, aliveT, vTris, u, v, newPos) {
    const nrm = (p0, p1, p2) => {
        const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
        const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
        return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
    };
    const dot = (a, b) => {
        const la = Math.hypot(a[0], a[1], a[2]);
        const lb = Math.hypot(b[0], b[1], b[2]);
        if (la < 1e-12 || lb < 1e-12) return 1;
        return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
    };
    const FOLD_DOT_MIN = Math.cos((FOLD_ANGLE_MAX_DEG * Math.PI) / 180);
    const newN = new Map(); // ti -> 新法线（受影响存活三角形）
    const post = new Map(); // ti -> post-collapse 索引（v→u）
    const affected = [];
    for (const ti of vTris[u].concat(vTris[v])) {
        if (!aliveT[ti]) continue;
        const t = tris[ti];
        if (t.includes(u) && t.includes(v)) continue; // 将被移除
        const posOf = (i) => (i === u || i === v ? newPos : positions[i]);
        post.set(ti, t.map((i) => (i === v ? u : i)));
        newN.set(ti, nrm(posOf(t[0]), posOf(t[1]), posOf(t[2])));
        affected.push(ti);
    }
    for (const ti of affected) {
        const n = newN.get(ti);
        const nt = post.get(ti);
        for (let k = 0; k < 3; k++) {
            const a = nt[k], b = nt[(k + 1) % 3];
            const inc = new Set();
            if (a !== u && b !== u) {
                for (const tj of vTris[a]) if (aliveT[tj] && tris[tj].includes(b)) inc.add(tj);
            } else {
                const x = a === u ? b : a;
                for (const tj of vTris[u]) if (aliveT[tj] && tris[tj].includes(x)) inc.add(tj);
                for (const tj of vTris[v]) if (aliveT[tj] && tris[tj].includes(x)) inc.add(tj);
            }
            inc.delete(ti);
            for (const tj of inc) {
                const t = tris[tj];
                if (t.includes(u) && t.includes(v)) continue; // 将被移除，不是邻居
                const nbrN = newN.has(tj)
                    ? newN.get(tj)
                    : nrm(positions[t[0]], positions[t[1]], positions[t[2]]);
                const cosNew = dot(n, nbrN);
                const on = nrm(positions[tris[ti][0]], positions[tris[ti][1]], positions[tris[ti][2]]);
                const onbr = nrm(positions[t[0]], positions[t[1]], positions[t[2]]);
                const cosOrig = dot(on, onbr);
                if (cosNew < FOLD_DOT_MIN && cosOrig > FOLD_DOT_MIN) return true;
            }
        }
    }
    return false;
}

/**
 * 折叠后受影响存活三角形的 post 几何（含 u 或 v、不同时含两者，v→u 重映射）。
 * 突起守卫（collapseProtrudes / collapseProtrudeMax）与尺寸守卫（collapseCreatesOversizeTriangle）
 * 共用同一实现，保证「守卫判定」口径一致（fix6-plan §2.5：受影响三角形折叠后几何枚举单一来源）。
 * @returns {{ti:number, postIdx:number[], postVerts:number[][]}[]}
 */
function affectedPostTris(positions, tris, aliveT, vTris, u, v, newPos) {
    const posOf = (i) => (i === u || i === v ? newPos : positions[i]);
    const out = [];
    for (const ti of vTris[u].concat(vTris[v])) {
        if (!aliveT[ti]) continue;
        const t = tris[ti];
        if (t.includes(u) && t.includes(v)) continue; // 将被移除
        const postIdx = t.map((i) => (i === v ? u : i));
        out.push({ ti, postIdx, postVerts: postIdx.map(posOf) });
    }
    return out;
}

/**
 * 折叠后受影响存活三角形的突起值列表（post 几何）。collapseProtrudes 与 collapseProtrudeMax
 * 共用同一实现，保证「守卫判定」与「测试校准」口径一致。
 * 数学复用 maxProtrudeOfVerts（顶点到邻接平面距离），只是邻接平面取折叠后几何。
 * @returns {{ti:number, newProtrude:number}[]}
 */
function affectedProtrudes(positions, tris, aliveT, vTris, u, v, newPos) {
    const nrm = (p0, p1, p2) => {
        const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
        const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
        return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
    };
    const posOf = (i) => (i === u || i === v ? newPos : positions[i]);
    const newN = new Map(); // ti -> 折叠后法线（受影响存活三角形）
    const post = new Map(); // ti -> post-collapse 索引（v→u）
    const affected = [];
    for (const { ti, postIdx, postVerts } of affectedPostTris(positions, tris, aliveT, vTris, u, v, newPos)) {
        post.set(ti, postIdx);
        newN.set(ti, nrm(postVerts[0], postVerts[1], postVerts[2]));
        affected.push(ti);
    }
    // 邻居平面：usePost=true（折叠后几何）时受影响三角形用 newN/post，否则（折叠前几何）全用当前位置/法线
    const nbrPlane = (tj, usePost) => {
        if (usePost && newN.has(tj)) return { n: newN.get(tj), q: posOf(tris[tj][0]) };
        const t = tris[tj];
        return { n: nrm(positions[t[0]], positions[t[1]], positions[t[2]]), q: positions[t[0]] };
    };
    // 顶点到一组邻接平面的最大距离（数学同 maxProtrudeOfVerts / scripts/diag-fingertip.mjs）
    const maxProtrudeOf = (verts, nbs) => {
        let m = 0;
        for (const tj of nbs) {
            const { n, q } = nbrPlane(tj, true);
            const len = Math.hypot(n[0], n[1], n[2]);
            if (len < 1e-12) continue;
            const nx = n[0] / len, ny = n[1] / len, nz = n[2] / len;
            for (const p of verts) {
                const d = pointPlaneDist(p, [nx, ny, nz], q);
                if (d > m) m = d;
            }
        }
        return m;
    };
    const out = [];
    for (const ti of affected) {
        const nt = post.get(ti);
        const postVerts = nt.map((i) => posOf(i)); // 折叠后三角形 3 顶点
        const nbs = new Set();
        for (let k = 0; k < 3; k++) {
            const a = nt[k], b = nt[(k + 1) % 3];
            if (a !== u && b !== u) {
                for (const tj of vTris[a]) if (aliveT[tj] && tris[tj].includes(b)) nbs.add(tj);
            } else {
                const x = a === u ? b : a;
                for (const tj of vTris[u]) if (aliveT[tj] && tris[tj].includes(x)) nbs.add(tj);
                for (const tj of vTris[v]) if (aliveT[tj] && tris[tj].includes(x)) nbs.add(tj);
            }
        }
        nbs.delete(ti);
        for (const tj of [...nbs]) {
            if (tris[tj].includes(u) && tris[tj].includes(v)) nbs.delete(tj); // 将被移除，不是邻居
        }
        if (!nbs.size) continue;
        out.push({ ti, newProtrude: maxProtrudeOf(postVerts, nbs), postVerts });
    }
    return out;
}

/**
 * 折叠候选的最大突起值（post 几何，所有受影响存活三角形取最大）。供 BDD 单元测试校准
 * （Scenario C：预算 vs cap 的数值以本函数实测为准，避免口径漂移）。
 * @returns {number} 最大突起；无受影响三角形返回 0
 */
export function collapseProtrudeMax(positions, tris, aliveT, vTris, u, v, newPos) {
    let maxP = 0;
    for (const { newProtrude } of affectedProtrudes(positions, tris, aliveT, vTris, u, v, newPos)) {
        if (newProtrude > maxP) maxP = newProtrude;
    }
    return maxP;
}

/**
 * 突起（protrude）守卫：模拟 u/v 折叠到 newPos，对每个受影响且存活的三角形（含 u 或 v、
 * 不同时含两者的）计算折叠后其 3 个顶点到「相邻存活三角形平面」的最大距离 protrude；
 * 任一 > maxProtrude → 返回 true（拒绝折叠）。
 * 数学复用 scripts/diag-fingertip.mjs 的 ptPlaneDist/maxProtrude：顶点到邻接平面距离衡量
 * 「顶点从曲面戳出」程度。指尖/指甲区的近共面微三角团被 QEM 免费合并成跨曲面大平面 →
 * 新三角形顶点从邻面戳出（突起 0.08~0.184）→ 本守卫在折叠前拦下此类折叠。
 * @param {number} [maxProtrude] 绝对/尺度归一化阈值下限（默认 PROTRUDE_MAX）
 * @param {Float64Array} [budgets] 每顶点原始突起预算（局部许可）；缺省 = 不启用预算
 * @param {number} [protrudeCap] 预算上限（protrudeCap(medE)，本模型 ≈0.078）；缺省 Infinity = 不封顶
 * @param {Float64Array} [sizeA] 每顶点局部输入面积预算（P1 大鼓包条件，见下）；缺省 null = 不启用
 * @param {number} [areaCoef] 大鼓包面积系数（默认 AREA_COEF）
 * @param {number} [areaFloor] 大鼓包面积全局下限（默认 0）
 * @returns {boolean} true=存在会制造凸起的折叠（应拒绝）
 */
export function collapseProtrudes(positions, tris, aliveT, vTris, u, v, newPos, maxProtrude = PROTRUDE_MAX, budgets = null, protrudeCapValue = Infinity, sizeA = null, areaCoef = AREA_COEF, areaFloor = 0) {
    for (const { ti, newProtrude, postVerts } of affectedProtrudes(positions, tris, aliveT, vTris, u, v, newPos)) {
        // 局部许可（local allowance）：绝对阈值 与 受影响三角形顶点的原始突起预算（随折叠累积）取大。
        // 预算固定取自输入几何 → 高曲率区（原始就凸）许可高、指尖近共面微三角团（原始平）许可低，
        // 既拦住「免费合并成跨曲面大平面」（突起 0.08~0.184 >> 预算 0.03），又不误杀高曲率区正常简化。
        // 第五轮预算 cap 机制：allowance = max(protrudeMax, min(budget, protrudeCapValue))，可传入
        // protrudeCap(medE) 封住「微特征突起被当曲率许可」的预算。生产路径默认 protrudeCapValue=Infinity
        // （实测全局 cap 改变折叠顺序 → 指尖残留大平面恶化到 0.133 > 输入 0.0983，且无真洞收益）；单元测试
        // （BDD Scenario C）显式传 cap 验证该机制本身。
        const allowance = budgets
            ? Math.max(
                  maxProtrude,
                  Math.min(budgets[tris[ti][0]], protrudeCapValue),
                  Math.min(budgets[tris[ti][1]], protrudeCapValue),
                  Math.min(budgets[tris[ti][2]], protrudeCapValue)
              )
            : maxProtrude;
        if (newProtrude > allowance) return true;
        // 大鼓包条件（第六轮 P1）：突起超过「基础阈值」且三角形面积超过「局部输入面积预算 × 系数」
        // → 拒绝（大 + 鼓 = 圆锥体）。语义：小三角形（≤ 局部面积预算）保留预算许可（高曲率区合法
        // 微凸起不误杀）；大三角形（> 局部面积预算）的突起不得超过基础阈值。指尖鼓包 tri#10122
        // （protrude 0.088 > 0.066 且 area 0.0262 > AREA_COEF×0.012=0.0156）被拒；正常高曲率小三角
        // 折叠（面积 ≤ 预算）不受影响。传 sizeA=null（旧调用）时该条件完全关闭 → 向后兼容。
        if (sizeA) {
            let minBudgetA = Infinity;
            for (const idx of tris[ti]) {
                if (Number.isFinite(sizeA[idx]) && sizeA[idx] < minBudgetA) minBudgetA = sizeA[idx];
            }
            if (Number.isFinite(minBudgetA)) {
                const area = triArea(postVerts[0], postVerts[1], postVerts[2]);
                if (newProtrude > maxProtrude && area > Math.max(areaFloor, areaCoef * minBudgetA)) return true;
            }
        }
    }
    return false;
}

/**
 * 计算每顶点的「原始突起预算」：该顶点在原始输入几何中，其邻接三角形到邻接平面的最大突起距离。
 * 作为 collapseProtrudes 的局部许可（local allowance）：高曲率区（手/耳/袜口）原始就凸，预算高；
 * 指尖近共面微三角团原始平，预算低 → 折叠不允许产生超过局部原始水平的凸起。
 * 预算固定取自输入几何（不随折叠漂移），杜绝「增量漂移」绕过绝对阈值。
 * @returns {Float64Array} budgets[i] = 顶点 i 的原始突起预算
 */
/**
 * 计算每顶点的「原始突起预算」：该顶点在原始输入几何中，其邻接三角形到邻接平面的最大突起距离。
 * 作为 collapseProtrudes 的局部许可（local allowance）：高曲率区（手/耳/袜口）原始就凸，预算高；
 * 指尖近共面微三角团原始平，预算低 → 折叠不允许产生超过局部原始水平的凸起。
 * 预算固定取自输入几何（不随折叠漂移），杜绝「增量漂移」绕过绝对阈值。
 * 第五轮：支持 aliveT（排除已丢弃的退化三角形，避免零面积三角形污染预算）+ minArea
 * （微特征三角形面积 ≤ minArea 不贡献预算，避免「微特征突起被误当成曲面曲率许可」）。
 * @param {number[][]|Object[]} positions
 * @param {number[][]} tris
 * @param {{aliveT?:Uint8Array, minArea?:number}} [opts]
 * @returns {Float64Array} budgets[i] = 顶点 i 的原始突起预算
 */
export function computeVertexProtrudeBudgets(positions, tris, opts = {}) {
    const { aliveT = null, minArea = 0 } = opts;
    const n = positions.length;
    const edgeMap = buildEdgeTris(tris);
    const budgets = new Float64Array(n);
    const isDead = (ti) => aliveT && !aliveT[ti];
    for (let ti = 0; ti < tris.length; ti++) {
        if (isDead(ti)) continue;
        if (minArea > 0) {
            const t = tris[ti];
            if (triArea(posOf(positions, t[0]), posOf(positions, t[1]), posOf(positions, t[2])) <= minArea) continue;
        }
        const maxP = maxProtrudeOfVerts(positions, tris, ti, edgeMap);
        if (maxP > 0) {
            for (const v of tris[ti]) if (maxP > budgets[v]) budgets[v] = maxP;
        }
    }
    return budgets;
}

/**
 * 计算每顶点的「局部输入尺寸预算」（第六轮 P0）：顶点 v 邻接的「有效输入三角形」
 * （aliveT 且面积 ≥ minArea）的 maxL p95（sizeL[v]）与面积 p95（sizeA[v]），以及任意两邻接
 * 有效三角形法线夹角的**最大值**（curv[v]，度）。
 * - 尺寸预算 = 局部输入分布：屁股球面允许的三角形比大腿平面小，指尖允许的比前臂小；
 *   折叠候选新三角形超过 max(全局下限, 系数 × 三顶点最小预算) 且顶点曲率超阈值 → 拒绝
 *   （collapseCreatesOversizeTriangle）→ QEM 不再跨曲面合并大平面（袜子/内裤破面根因）。
 * - 曲率门控：curv[v] < CURV_MIN_DEG 的顶点所在三角形不受尺寸限制（平坦区合并大三角形视觉无害），
 *   保证合成网格 fixture（≈17°）/圆管（≈15°）不受影响、不误杀减面（防回归关键）。
 * - 微三角形（面积 < minArea，如双面微片/近退化片）被排除——垃圾法线虚报曲率、微尺寸污染预算。
 * - 预算 immutable（不随折叠传播）：QEM 折叠后 u 的新位置始终在原始顶点 u 局部邻域内，原始预算
 *   始终代表当前位置局部尺度；三角形级取「三顶点最小预算」保守方向天然正确（fix6-plan §2.2）。
 * @param {number[][]|Object[]} positions
 * @param {number[][]} tris
 * @param {{aliveT?:Uint8Array, minArea?:number}} [opts]
 * @returns {{sizeL:Float64Array, sizeA:Float64Array, curv:Float64Array}}
 */
export function computeVertexSizeStats(positions, tris, opts = {}) {
    const { aliveT = null, minArea = SIZE_BUDGET_MIN_AREA } = opts;
    const n = positions.length;
    const sizeL = new Float64Array(n).fill(Infinity);
    const sizeA = new Float64Array(n).fill(Infinity);
    const curv = new Float64Array(n);
    const posOf = (i) => (positions[i].position ? positions[i].position : positions[i]);
    const isDead = (ti) => aliveT && !aliveT[ti];
    // 有效输入三角形（排除退化/微特征）→ 预计算法线 + 每顶点邻接
    const validNormal = new Map(); // ti -> 单位法线
    const vTri = new Array(n);
    for (let i = 0; i < n; i++) vTri[i] = [];
    for (let ti = 0; ti < tris.length; ti++) {
        if (isDead(ti)) continue;
        const t = tris[ti];
        const p0 = posOf(t[0]), p1 = posOf(t[1]), p2 = posOf(t[2]);
        const nrm = triNormal(p0, p1, p2);
        const len = Math.hypot(nrm[0], nrm[1], nrm[2]);
        if (len < 1e-12 || 0.5 * len < minArea) continue; // 退化或微特征，不贡献预算
        validNormal.set(ti, [nrm[0] / len, nrm[1] / len, nrm[2] / len]);
        for (const idx of t) vTri[idx].push(ti);
    }
    const p95 = (arr) => {
        if (!arr.length) return Infinity;
        arr.sort((a, b) => a - b);
        return arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * 0.95))];
    };
    for (let v = 0; v < n; v++) {
        const list = vTri[v];
        if (!list.length) continue;
        const maxLs = [], areas = [];
        let maxAng = 0;
        for (const ti of list) {
            const t = tris[ti];
            const p0 = posOf(t[0]), p1 = posOf(t[1]), p2 = posOf(t[2]);
            maxLs.push(triEdgeStats(p0, p1, p2).maxL);
            areas.push(triArea(p0, p1, p2));
        }
        for (let i = 0; i < list.length; i++) {
            const ni = validNormal.get(list[i]);
            for (let j = i + 1; j < list.length; j++) {
                const nj = validNormal.get(list[j]);
                const cos = Math.max(-1, Math.min(1, ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2]));
                const ang = Math.acos(cos) * (180 / Math.PI);
                if (ang > maxAng) maxAng = ang;
            }
        }
        sizeL[v] = p95(maxLs);
        sizeA[v] = p95(areas);
        curv[v] = maxAng;
    }
    return { sizeL, sizeA, curv };
}

/**
 * 曲率感知三角形尺寸守卫（第六轮 P0）：模拟 u/v 折叠到 newPos，对每个受影响存活三角形（post 几何），
 * 若其顶点局部曲率 ≥ curvMinDeg，则拒绝「新三角形 maxL 或面积超过 相对局部输入分布预算」的折叠：
 *   1. c = max(curv[三顶点]，缺省 0)；若 c < curvMinDeg → continue（平坦区不设限）；
 *   2. budgetL = min(sizeL[三顶点])、budgetA = min(sizeA[三顶点])（缺省 +∞）——取最小 =
 *      三角形触碰的最细尺度区域是约束来源（跨「球面↔平面」边界的三角形也必须满足球面尺度）；
 *   3. maxL > max(floorL, coefL × budgetL) → 拒绝；
 *   4. area > max(floorA, coefA × budgetA) → 拒绝。
 * 根因：QEM quadric 误差是平面拟合误差，对「跨曲率合并」失明——球面相邻小三角几乎共面（误差≈0
 * 免费折叠），但大平面跨过球面弧段后矢高随跨度²增长 → 袜子/内裤屁股「破面」。突起守卫只测顶点
 * 戳出邻面的距离，不测三角形本身多大（跨度/胖度）→ 本守卫补上「尺寸 vs 局部曲率」这条轴。
 * @param {Float64Array} [sizeL] 每顶点局部输入 maxL 预算
 * @param {Float64Array} [sizeA] 每顶点局部输入面积预算
 * @param {Float64Array} [curv] 每顶点局部曲率（度）
 * @param {number} [curvMinDeg] 曲率门控阈值（默认 CURV_MIN_DEG）
 * @param {number} [coefL] maxL 系数（默认 MAXL_COEF）
 * @param {number} [coefA] 面积系数（默认 AREA_COEF）
 * @param {number} [floorL] maxL 全局下限（默认 0）
 * @param {number} [floorA] 面积全局下限（默认 0）
 * @returns {boolean} true=存在超尺寸三角形（应拒绝）
 */
export function collapseCreatesOversizeTriangle(
    positions, tris, aliveT, vTris, u, v, newPos,
    sizeL = null, sizeA = null, curv = null,
    curvMinDeg = CURV_MIN_DEG, coefL = MAXL_COEF, coefA = AREA_COEF,
    floorL = 0, floorA = 0
) {
    for (const { postIdx, postVerts } of affectedPostTris(positions, tris, aliveT, vTris, u, v, newPos)) {
        let c = 0;
        for (const idx of postIdx) if (curv && curv[idx] > c) c = curv[idx];
        if (c < curvMinDeg) continue; // 曲率门控：平坦区不设限（防误杀减面）
        let bl = Infinity, ba = Infinity;
        for (const idx of postIdx) {
            if (sizeL && Number.isFinite(sizeL[idx]) && sizeL[idx] < bl) bl = sizeL[idx];
            if (sizeA && Number.isFinite(sizeA[idx]) && sizeA[idx] < ba) ba = sizeA[idx];
        }
        const s = triEdgeStats(postVerts[0], postVerts[1], postVerts[2]);
        if (s.maxL > Math.max(floorL, coefL * bl)) return true;
        const area = triArea(postVerts[0], postVerts[1], postVerts[2]);
        if (area > Math.max(floorA, coefA * ba)) return true;
    }
    return false;
}

/**
 * 收集「双面微片」顶点（守卫 2）：扫描原始三角形，凡「与任一邻居法线夹角 > FLIP_LOCK_ANGLE
 * 且面积 < FLIP_LOCK_AREA」的三角形 → 锁定其 3 个顶点。指甲/指缝双面薄片（两三角共边、法线相反、
 * 面积 ≤5e-4）折叠会被合并放大或恶化成 >150° 翻转 → 直接锁顶点保证 100% 保留外观。
 * positions 接受 { position:[3] } 顶点数组或纯位置数组（单元测试传纯数组）。
 * @returns {Set<number>} 需锁定的顶点索引集
 */
export function collectFlipMicroFaceVertices(positions, tris) {
    const posOf = (i) => (positions[i].position ? positions[i].position : positions[i]);
    const nrm = (t) => {
        const p0 = posOf(t[0]), p1 = posOf(t[1]), p2 = posOf(t[2]);
        const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
        const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
        return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
    };
    const edgeMap = new Map();
    for (let ti = 0; ti < tris.length; ti++) {
        const t = tris[ti];
        for (let k = 0; k < 3; k++) {
            const a = t[k], b = t[(k + 1) % 3];
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            if (!edgeMap.has(key)) edgeMap.set(key, []);
            edgeMap.get(key).push(ti);
        }
    }
    const COS_FLIP = Math.cos((FLIP_LOCK_ANGLE * Math.PI) / 180);
    const info = tris.map((t) => {
        const n = nrm(t);
        return { n, area: 0.5 * Math.hypot(n[0], n[1], n[2]) };
    });
    const locked = new Set();
    for (let ti = 0; ti < tris.length; ti++) {
        const { n, area } = info[ti];
        if (area >= FLIP_LOCK_AREA) continue; // 只锁微面积三角
        const nl = Math.hypot(n[0], n[1], n[2]);
        if (nl < 1e-12) continue; // 退化三角形无法判断法线夹角
        const t = tris[ti];
        const nbs = new Set();
        for (let k = 0; k < 3; k++) {
            const a = t[k], b = t[(k + 1) % 3];
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            for (const tj of edgeMap.get(key) || []) if (tj !== ti) nbs.add(tj);
        }
        for (const tj of nbs) {
            const jn = info[tj].n;
            const jl = Math.hypot(jn[0], jn[1], jn[2]);
            if (jl < 1e-12) continue;
            const cos = (n[0] * jn[0] + n[1] * jn[1] + n[2] * jn[2]) / (nl * jl);
            if (cos < COS_FLIP) {
                for (const idx of t) locked.add(idx);
                break;
            }
        }
    }
    return locked;
}

/* ------------------------------------------------------------------ *
 * 法线重算（面积加权）
 * ------------------------------------------------------------------ */

/**
 * 对存活顶点重新计算法线：邻接三角形面法线按面积加权累加后归一化。
 * 折叠循环结束后调用——仅修正法线方向，不动顶点位置；
 * 作用于所有存活顶点（含锁定顶点）：锁定顶点位置不变，但法线可能被改写。
 * 面积和 < 1e-12 的顶点保留原法线（归一化后）。
 * @param {any[]} vertices 顶点数组（normal 会被就地改写）
 * @param {number[][]} positions 当前位置
 * @param {number[][]} tris 三角形（含存活/死亡标记）
 * @param {Uint8Array} aliveV 顶点存活标记
 * @param {Uint8Array} aliveT 三角形存活标记
 */
export function recomputeNormals(vertices, positions, tris, aliveV, aliveT) {
    const acc = vertices.map(() => [0, 0, 0]);
    const areaSum = new Float64Array(vertices.length);
    for (let ti = 0; ti < tris.length; ti++) {
        if (!aliveT[ti]) continue;
        const [a, b, c] = tris[ti];
        if (!aliveV[a] || !aliveV[b] || !aliveV[c]) continue;
        // 叉积向量长度 = 2×面积，未除以 2 即等效面积加权（对累加方向无影响）
        const n = triNormal(positions[a], positions[b], positions[c]);
        const area = 0.5 * Math.hypot(n[0], n[1], n[2]);
        for (const v of [a, b, c]) {
            acc[v][0] += n[0];
            acc[v][1] += n[1];
            acc[v][2] += n[2];
            areaSum[v] += area;
        }
    }
    for (let i = 0; i < vertices.length; i++) {
        if (!aliveV[i]) continue;
        const s = acc[i];
        const len = Math.hypot(s[0], s[1], s[2]);
        if (areaSum[i] < 1e-12 || len < 1e-12) {
            // 无邻接存活三角形或面积和过小：保留原法线（归一化后）
            const on = vertices[i].normal;
            const ol = Math.hypot(on[0], on[1], on[2]);
            vertices[i].normal = ol > 1e-12 ? [on[0] / ol, on[1] / ol, on[2] / ol] : [0, 0, 1];
        } else {
            vertices[i].normal = [s[0] / len, s[1] / len, s[2] / len];
        }
    }
}

/* ------------------------------------------------------------------ *
 * 边折叠引擎
 * ------------------------------------------------------------------ */

class MinHeap {
    constructor() { this.arr = []; }
    get size() { return this.arr.length; }
    push(key, cost, version) {
        const h = this.arr;
        h.push({ key, cost, version });
        let i = h.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (h[p].cost <= h[i].cost) break;
            [h[p], h[i]] = [h[i], h[p]];
            i = p;
        }
    }
    pop() {
        const h = this.arr;
        if (!h.length) return null;
        const top = h[0];
        const last = h.pop();
        if (h.length) {
            h[0] = last;
            let i = 0;
            for (;;) {
                let l = i * 2 + 1, r = l + 1, m = i;
                if (l < h.length && h[l].cost < h[m].cost) m = l;
                if (r < h.length && h[r].cost < h[m].cost) m = r;
                if (m === i) break;
                [h[m], h[i]] = [h[i], h[m]];
                i = m;
            }
        }
        return top;
    }
}

/**
 * 完整边折叠引擎（含材质保护）。
 *
 * 材质保护（triMaterials 传入时启用）：
 * - 小材质锁定（lockSmallMaterials）：原始三角形数 ≤ SMALL_MATERIAL_TRI 的材质，
 *   其全部三角形顶点一开始就加入锁定集 → 该材质完全不减面（100% 保留）。
 * - 动态保护（minRetention > 0）：折叠候选边若会移除某材质的三角形，使其剩余数
 *   跌破 max(floor(origTri × minRetention), 0)，则拒绝该折叠（该材质剩余三角形不可再移除）。
 *
 * @param {{
 *   vertices:any[], triangles:number[][], locked?:Set<number>, targetTriangles:number,
 *   dropDegenerate?:boolean,
 *   triMaterials?:Uint16Array|null,   // 每三角形材质索引（与 triangles 平行）；null = 不启用材质保护
 *   minRetention?:number,             // 动态保护保留比例（默认 0.3；0 = 关闭动态保护）
 *   lockSmallMaterials?:boolean       // 小材质（≤500 面）全锁（默认 true）
 * }} params
 * @returns {{vertices:any[], triangles:number[][], indexMap:Int32Array, keptTriIndices:number[], stats:Object}}
 */
export function collapseMesh({
    vertices,
    triangles,
    locked = new Set(),
    targetTriangles = 1,
    dropDegenerate = true,
    triMaterials = null,
    minRetention = 0.3,
    lockSmallMaterials = true,
}) {
    minRetention = Math.max(0, Math.min(1, minRetention || 0));
    const n = vertices.length;
    // 工作副本：位置、邻接
    const positions = vertices.map((v) => v.position.slice());
    const aliveV = new Uint8Array(n).fill(1);
    const tris = triangles.map((t) => t.slice());
    const aliveT = new Uint8Array(tris.length).fill(1);

    // 双面微片锁定（守卫 2）：指甲/指缝双面薄片顶点全锁，100% 保留外观。
    // 用原始顶点对象（position 未参与折叠），与 collapseMesh 内部分发 positions 拷贝解耦。
    for (const vi of collectFlipMicroFaceVertices(vertices, tris)) locked.add(vi);

    // 突起守卫阈值：绝对 PROTRUDE_MAX 与尺度归一化 PROTRUDE_RATIO × medE 取大。
    // 细网格（本模型 medE≈0.13）→ 0.066 绝对阈值生效（校准保证指尖突起面 ≤ 输入、翻转面 34、LOD50 达标）；
    // coarser 网格（合成 fixture cell≈1.0）→ 阈值随尺度放大，避免误杀正常简化。
    const medE = medianEdgeLength(positions, tris);
    const protrudeMax = Math.max(PROTRUDE_MAX, PROTRUDE_RATIO * medE);
    // 预算 cap（第五轮，默认不启用）：protrudeCap(medE)（本模型 ≈0.078）本意是封住
    // 「微特征突起被当曲率许可」放行的 0.088 跨曲面大平面。实测：cap 全局绑定（本模型 25% 顶点
    // 原始突起预算 > cap，来自裤裆/叠放几何的真 1.85 级突起）→ 全局折叠顺序改变 → 指尖路径恶化，
    // 残留大平面突起 0.133 > 输入 0.0983（违反「max ≤ 输入」验收），且两个版本都 0 真洞（cap 无额外收益）。
    // 故生产路径默认不启用 cap（Infinity）；protrudeCap 函数保留导出，供 BDD 单元测试（Scenario C）
    // 验证 cap 机制本身（cap 传入时生效）。
    const protrudeCapValue = Infinity;

    // 材质保护初始化：每材质原始三角形数 / 最低保留数 / 当前存活数 / 是否触发过保护
    // 小材质锁定（lockSmallMaterials）：原始三角形数 ≤ SMALL_MATERIAL_TRI 的材质 → 全部三角形顶点入锁定集
    let numMats = 0;
    let origMatTri = null;
    let minMatTri = null;
    let aliveMatTri = null;
    let protectedHit = null;
    const initMaterialProtection = () => {
        if (!triMaterials || !(minRetention > 0 || lockSmallMaterials)) return;
        for (let ti = 0; ti < triMaterials.length; ti++) {
            const mi = triMaterials[ti];
            if (mi >= 0 && mi + 1 > numMats) numMats = mi + 1;
        }
        if (numMats <= 0) return;
        origMatTri = new Array(numMats).fill(0);
        for (const mi of triMaterials) if (mi >= 0 && mi < numMats) origMatTri[mi]++;
        // 地板基于原始（含退化）三角形数计算，比有效三角形地板略保守，属可接受语义（见 dropDegenerate）
        minMatTri = origMatTri.map((c) => (c > 0 ? Math.max(Math.floor(c * minRetention), 0) : 0));
        aliveMatTri = origMatTri.slice();
        protectedHit = new Uint8Array(numMats);
        if (lockSmallMaterials) {
            for (let mi = 0; mi < numMats; mi++) {
                if (origMatTri[mi] === 0 || origMatTri[mi] > SMALL_MATERIAL_TRI) continue;
                for (let ti = 0; ti < triMaterials.length; ti++) {
                    if (triMaterials[ti] !== mi) continue;
                    for (const idx of tris[ti]) locked.add(idx);
                }
            }
        }
    };
    initMaterialProtection();

    // 丢弃输入中已有的退化三角形（重复索引 或 零面积），避免污染输出。
    // 零面积三角形常见于叠放的共面 alpha 平面/装饰面：面积恒 < DEGENERATE_AREA，
    // 直接输出是视觉垃圾，且会卡住周围边的折叠（isValidCollapse 对退化邻接三角形恒拒绝）。
    // 真实模型（如 demo 孙晓美体操服）验证发现 49 个此类三角形 → 在此一并丢弃。
    // （roundtrip 校验时需保留原样，传 dropDegenerate=false）
    // 注：minMatTri 保底基于原始（含退化）三角形数计算，比有效三角形地板略保守，属可接受语义。
    if (dropDegenerate) {
        for (let ti = 0; ti < tris.length; ti++) {
            const [a, b, c] = tris[ti];
            const isDegen =
                a === b || b === c || a === c ||
                triArea(positions[a], positions[b], positions[c]) < DEGENERATE_AREA;
            if (isDegen) {
                aliveT[ti] = 0;
                if (aliveMatTri) {
                    const mi = triMaterials[ti];
                    if (mi >= 0 && mi < numMats) aliveMatTri[mi]--;
                }
            }
        }
    }
    let triCount = 0;
    for (let ti = 0; ti < aliveT.length; ti++) if (aliveT[ti]) triCount++;

    // 减面后洞校验（第五轮兜底）：快照「有效输入」的顶点位置/三角形存活标记，
    // 折叠结束后用 countSpatiallyNewBoundaryEdges 扫描输出边界边是否空间上 ⊆ 输入边界边
    // （距离 > HOLE_TOL 视为新增洞）计 stats.newHoleEdges。与折叠顺序解耦：顺序再变，最终输出也保证无洞。
    // 注意：positions 数组只替换元素（positions[u] = pos）从不就地改 → 浅拷贝即可保持输入几何快照；
    // 但 tris 数组元素会被就地改（v→u 重映射），输入三角形必须深拷贝快照。
    const inputPositions = positions.slice();
    const inputTris = tris.map((t) => t.slice());
    const inputAlive = aliveT.slice();

    // 每顶点原始突起预算（局部许可）：固定取自「有效输入」（dropDegenerate 之后，排除零面积退化三角形污染），
    // 随折叠 max 累积（merge 时传播）。
    const protrudeBudgets = computeVertexProtrudeBudgets(positions, tris, { aliveT: inputAlive });

    // 每顶点局部输入尺寸预算 + 曲率（第六轮 P0）：固定取自「有效输入」快照（immutable，不随折叠漂移）。
    // 供 collapseCreatesOversizeTriangle（新三角形超过 max(floor, 系数×三顶点最小预算) 且曲率超阈值 → 拒）
    // 与 collapseProtrudes 大鼓包条件（P1，传 sizeA）复用。floor 用 medE 兜底空预算顶点。
    const { sizeL, sizeA, curv } = computeVertexSizeStats(positions, tris, { aliveT: inputAlive });
    const floorL = MAXL_FLOOR_RATIO * medE;
    const floorA = AREA_FLOOR_RATIO * medE * medE;

    // 顶点→三角形邻接
    const vTris = new Array(n);
    for (let i = 0; i < n; i++) vTris[i] = [];
    for (let ti = 0; ti < tris.length; ti++) {
        for (const idx of tris[ti]) vTris[idx].push(ti);
    }

    // 顶点→边邻接（边 key "min:max"）
    const edgeMap = new Map();
    const vEdges = new Array(n);
    for (let i = 0; i < n; i++) vEdges[i] = [];
    let edgeVersion = 0;
    const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

    const buildEdgesFromTris = (triList) => {
        for (const ti of triList) {
            if (!aliveT[ti]) continue;
            const [a, b, c] = tris[ti];
            for (const [x, y] of [[a, b], [b, c], [c, a]]) {
                const key = edgeKey(x, y);
                if (!edgeMap.has(key)) {
                    edgeMap.set(key, { a: x, b: y, dead: true, version: 0 });
                }
            }
        }
    };

    const incidentTriCount = (e) => {
        let cnt = 0;
        const set = new Set();
        for (const ti of vTris[e.a]) if (aliveT[ti] && tris[ti].includes(e.b)) set.add(ti);
        cnt += set.size;
        return cnt;
    };

    const recomputeEdge = (e) => {
        const u = e.a, v = e.b;
        if (!aliveV[u] || !aliveV[v]) { e.dead = true; return; }
        if (locked.has(u) || locked.has(v)) { e.dead = true; return; }
        // 边界边（仅属于 1 个三角形）代价加权惩罚
        const cnt = incidentTriCount(e);
        if (cnt === 0) { e.dead = true; return; }
        const Q = new Float64Array(16);
        addQuadric(Q, quadrics[u]);
        addQuadric(Q, quadrics[v]);
        const { cost: rawCost } = solveQuadric(Q, positions[u], positions[v]);
        let cost = rawCost;
        if (cnt === 1) cost *= BOUNDARY_PENALTY;
        e.dead = false;
        e.version = ++edgeVersion;
        e.cost = cost;
        heap.push(edgeKey(u, v), cost, e.version);
    };

    // 初始化 quadric + 边：初始边构建 + 代价计算（buildInitialEdges）
    const quadrics = computeQuadrics(positions, tris);
    const heap = new MinHeap();
    const buildInitialEdges = () => {
        const allTri = tris.map((_, i) => i);
        buildEdgesFromTris(allTri);
        for (const [key, e] of edgeMap) {
            if (!vEdges[e.a].includes(key)) vEdges[e.a].push(key);
            if (!vEdges[e.b].includes(key)) vEdges[e.b].push(key);
        }
        for (const [key, e] of edgeMap) recomputeEdge(e);
    };
    buildInitialEdges();

    const stats = {
        initialTriangles: triCount,
        finalTriangles: triCount,
        collapses: 0,
        rejected: 0,
        shapeRejects: 0,
        linkRejects: 0,
        holeRejects: 0,
        foldOverRejects: 0,
        protrudeRejects: 0,
        sizeRejects: 0,
        materialRejects: 0,
        newHoleEdges: 0,
        warnings: [],
    };

    // 折叠主循环：单步折叠（共享状态经闭包访问：heap/edgeMap/tris/vTris/quadrics/positions/aliveV/aliveT/
    // triCount/aliveMatTri/minMatTri/minRetention/protectedHit/stats 等）
    const collapseStep = () => {
        const top = heap.pop();
        const e = edgeMap.get(top.key);
        if (!e || e.dead || e.version !== top.version) return;
        const u = e.a, v = e.b;
        if (!aliveV[u] || !aliveV[v]) return;
        if (locked.has(u) || locked.has(v)) return;

        // 计算最优位置
        const Q = new Float64Array(16);
        addQuadric(Q, quadrics[u]);
        addQuadric(Q, quadrics[v]);
        const { pos } = solveQuadric(Q, positions[u], positions[v]);

        // 形状惩罚：检查所有受影响三角形（含 u 或 v）。
        // 注意：同时含 u 和 v 的三角形折叠后必然退化为 [u,u,x]，将作为"被移除面"处理，
        // 不参与形状校验；只校验"仅含一端点"的存活三角形是否退化/翻转。
        const affected = new Set();
        for (const ti of vTris[u]) if (aliveT[ti]) affected.add(ti);
        for (const ti of vTris[v]) if (aliveT[ti]) affected.add(ti);
        let ok = true;
        for (const ti of affected) {
            const t = tris[ti];
            const hasU = t.includes(u), hasV = t.includes(v);
            if (hasU && hasV) continue; // 将被移除
            if (!isValidCollapse(positions, t, u, v, pos)) { ok = false; break; }
        }
        if (!ok) { e.dead = true; stats.rejected++; stats.shapeRejects++; return; }

        // 拓扑守卫（P0 洞）：link condition（防非流形/缝合） + 洞检测（防内部边变边界）。
        // 洞检测用收窄版：清理近退化（共点边）三角形时只豁免「共点边分离成边界」这一种洞，
        // 仍拒绝其它任何洞（第四轮 removesSlit 完全跳过洞检测 → 实测放行 30 个真洞）。
        if (!linkConditionValid(tris, aliveT, vTris, u, v)) { e.dead = true; stats.rejected++; stats.linkRejects++; return; }
        if (collapseCreatesHoleNarrow(tris, aliveT, vTris, u, v, positions)) { e.dead = true; stats.rejected++; stats.holeRejects++; return; }

        // 折叠翻转守卫（P2）：折叠后新三角形与其相邻三角形法线夹角突变（fold-over）→ 拒绝。
        // 细长圆柱（手指）高曲率区折叠易「翻回自身」冒出多余面片。
        if (collapseFoldOver(positions, tris, aliveT, vTris, u, v, pos)) { e.dead = true; stats.rejected++; stats.foldOverRejects++; return; }

        // 突起守卫（P3）：折叠后受影响三角形顶点到邻接平面距离 > protrudeMax（尺度归一化）→ 拒绝。
        // 近共面微三角团被 QEM 免费合并成跨曲面大平面 → 顶点戳出邻面（指尖「突出的面」根因）。
        // 第五轮预算 cap 机制保留（protrudeCapValue 可传 protrudeCap(medE)），但生产路径默认 Infinity
        // （实测全局 cap 改变折叠顺序 → 指尖残留大平面突起恶化到 0.133 > 输入 0.0983，且无真洞收益）。
        // 第六轮 P1 大鼓包条件（传入 sizeA）：突起超基础阈值且面积超局部预算的大三角形 → 拒绝。
        if (collapseProtrudes(positions, tris, aliveT, vTris, u, v, pos, protrudeMax, protrudeBudgets, protrudeCapValue, sizeA, P1_BIG_BUMP_AREA_COEF, 0)) { e.dead = true; stats.rejected++; stats.protrudeRejects++; return; }

        // 曲率感知三角形尺寸守卫（第六轮 P0）：折叠后受影响三角形超「相对局部输入分布的尺寸上限」
        // （曲率门控，maxL/面积双轴）→ 拒绝。QEM 对跨曲率合并失明（球面相邻小三角几乎共面 → 免费合并
        // 成跨曲面大平面 → 袜子/内裤屁股破面）；突起守卫只测顶点戳出邻面距离，不测三角形本身多大 →
        // 本守卫补上「尺寸 vs 局部曲率」这条轴。
        if (collapseCreatesOversizeTriangle(positions, tris, aliveT, vTris, u, v, pos,
                sizeL, sizeA, curv, CURV_MIN_DEG, MAXL_COEF, AREA_COEF, floorL, floorA)) {
            e.dead = true; stats.rejected++; stats.sizeRejects++; return;
        }

        // 材质动态保护：本次折叠会移除「同时含 u 与 v 的存活三角形」；
        // 若任一材质移除后剩余数跌破最低保留数 → 拒绝折叠（该材质剩余三角形不可再移除）
        if (aliveMatTri && minRetention > 0) {
            const removals = new Map();
            for (const ti of affected) {
                const t = tris[ti];
                if (!(t.includes(u) && t.includes(v))) continue;
                const mi = triMaterials[ti];
                if (mi >= 0 && mi < numMats) removals.set(mi, (removals.get(mi) || 0) + 1);
            }
            let blocked = false;
            for (const [mi, cnt] of removals) {
                if (aliveMatTri[mi] - cnt < minMatTri[mi]) {
                    blocked = true;
                    protectedHit[mi] = 1;
                }
            }
            if (blocked) { e.dead = true; stats.rejected++; stats.materialRejects++; return; }
        }

        // 折叠：v 并入 u，u 位置更新，v 标记死亡
        // 属性继承：skin 合并（BDEF4 归一化），UV/法线/edgeRatio 按 t 线性插值
        // t = 新位置到 u 的距离 / (到 u + 到 v 的距离)，基于折叠前两端点位置
        {
            const pu = positions[u], pv = positions[v];
            let t = 0.5;
            const dtoU = Math.hypot(pos[0] - pu[0], pos[1] - pu[1], pos[2] - pu[2]);
            const dtoV = Math.hypot(pos[0] - pv[0], pos[1] - pv[1], pos[2] - pv[2]);
            if (dtoU + dtoV > 1e-12) t = dtoU / (dtoU + dtoV);
            t = Math.max(0, Math.min(1, t));
            const skin = mergeSkin(
                { indices: vertices[u].skinIndices, weights: vertices[u].skinWeights },
                { indices: vertices[v].skinIndices, weights: vertices[v].skinWeights }
            );
            const attrs = interpolateAttrs(vertices[u], vertices[v], t);
            vertices[u].normal = attrs.normal;
            vertices[u].uv = attrs.uv;
            if (vertices[u].auvs && vertices[v].auvs && vertices[u].auvs.length === vertices[v].auvs.length) {
                vertices[u].auvs = vertices[u].auvs.map((auv, k) =>
                    auv.map((c, j) => c + (vertices[v].auvs[k][j] - c) * t)
                );
            }
            vertices[u].edgeRatio = attrs.edgeRatio;
            vertices[u].skinIndices = skin.indices;
            vertices[u].skinWeights = skin.weights;
            vertices[u].type = 2; // 合并后统一 BDEF4
        }
        positions[u] = pos;
        addQuadric(quadrics[u], quadrics[v]);
        quadrics[v].fill(0);
        aliveV[v] = 0;
        // 突起预算随顶点合并传播（max 累积）：大三角的顶点携带其合并子区域的原始突起预算，
        // 避免静态预算对重度减面后的大三角形低估局部许可。
        if (protrudeBudgets[v] > protrudeBudgets[u]) protrudeBudgets[u] = protrudeBudgets[v];

        // 更新受影响三角形：v→u；含 u 与 v 的三角形退化标记死亡
        let removed = 0;
        const trisOfU = [];
        for (const ti of affected) {
            const t = tris[ti];
            for (let k = 0; k < 3; k++) if (t[k] === v) t[k] = u;
            // 折叠后若三索引有重复 → 退化，标记死亡
            if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) {
                aliveT[ti] = 0;
                removed++;
                if (aliveMatTri) {
                    const mi = triMaterials[ti];
                    if (mi >= 0 && mi < numMats) aliveMatTri[mi]--;
                }
                continue;
            }
            trisOfU.push(ti);
        }
        triCount -= removed;
        stats.collapses++;

        // 重建 vTris[u]（含 u 的存活三角形）
        vTris[u] = trisOfU;
        vTris[v] = [];

        // 重建 vEdges[u]：从 vTris[u] 收集邻居边
        const newEdgeKeys = new Set();
        for (const ti of vTris[u]) {
            const [a, b, c] = tris[ti];
            for (const [x, y] of [[a, b], [b, c], [c, a]]) {
                if (x === u || y === u) newEdgeKeys.add(edgeKey(x, y));
            }
        }
        vEdges[u] = [...newEdgeKeys];
        for (const key of newEdgeKeys) {
            if (!edgeMap.has(key)) edgeMap.set(key, { a: Number(key.split(':')[0]), b: Number(key.split(':')[1]), dead: true, version: 0 });
        }
        // 使 v 相关的旧边失效
        for (const key of vEdges[v]) {
            const oe = edgeMap.get(key);
            if (oe) oe.dead = true;
        }
        vEdges[v] = [];

        // 重算 u 邻接边代价（新创建的边也一并重算，recomputeEdge 内部处理 dead/有效性）
        for (const key of newEdgeKeys) {
            const ne = edgeMap.get(key);
            if (ne) recomputeEdge(ne);
        }
        // 受影响三角形其他顶点对应边的代价也可能变化，保守处理：重算与 u 相连的所有新边即可
    };

    while (triCount > targetTriangles && heap.size > 0) {
        collapseStep();
    }

    // 减面后校验：丢弃输出中残留的退化三角形（重复索引/零面积，同 dropDegenerate 语义）。
    // 仅 dropDegenerate=true 时生效（roundtrip 保留输入原样，与输入 dropDegenerate 同条件）。
    // 输入中的近退化共点三角形（面积 ≥ DEGENERATE_AREA 未在输入丢弃）在减面中被压缩到零面积，
    // 需在输出前清理，否则 verify 的 noDegenerateTriangles 失败（真实模型头/颈发区 y20-21 实测 4 个）。
    // 用 Math.fround 模拟写盘 float32 精度：双精度面积 1.7e-9~2.6e-9 的共点三角形在 f32 序列化后
    // 变成 < 1e-9 的退化三角形（verify AREA_MIN=1e-9），必须在内存阶段按 f32 精度判定并丢弃。
    if (dropDegenerate) {
        for (let ti = 0; ti < tris.length; ti++) {
            if (!aliveT[ti]) continue;
            const t = tris[ti];
            const a = t[0], b = t[1], c = t[2];
            if (a === b || b === c || a === c) { aliveT[ti] = 0; triCount--; continue; }
            const pa = positions[a], pb = positions[b], pc = positions[c];
            const f32Area = triArea(
                [Math.fround(pa[0]), Math.fround(pa[1]), Math.fround(pa[2])],
                [Math.fround(pb[0]), Math.fround(pb[1]), Math.fround(pb[2])],
                [Math.fround(pc[0]), Math.fround(pc[1]), Math.fround(pc[2])]
            );
            if (f32Area < DEGENERATE_AREA) { aliveT[ti] = 0; triCount--; }
        }
    }

    // 减面后洞校验（只读）：输出边界边中点距输入边界边线段距离 > HOLE_TOL → 计 stats.newHoleEdges。
    // 与折叠顺序解耦的兜底（顺序再变，最终输出也保证无洞）；只统计不阻断（verify/BDD 断言 0）。
    stats.newHoleEdges = countSpatiallyNewBoundaryEdges(inputPositions, inputTris, inputAlive, positions, tris, aliveT);

    // 折叠循环结束后重算法线：所有存活顶点按邻接三角形面积加权平均并归一化。
    // 插值法线只修长度不修方向，多次折叠后方向可能偏差；此处统一收敛方向，
    // 只改 normal 不改位置。作用于所有存活顶点（含锁定顶点）：锁定顶点位置不变，
    // 但法线可能被改写。
    recomputeNormals(vertices, positions, tris, aliveV, aliveT);

    // 压缩输出：仅保留存活顶点；非锁定且不属任何存活三角形 → 丢弃（锁定顶点恒保留）
    const indexMap = new Int32Array(n).fill(-1);
    const usedByTri = new Uint8Array(n);
    for (let ti = 0; ti < tris.length; ti++) {
        if (!aliveT[ti]) continue;
        for (const idx of tris[ti]) usedByTri[idx] = 1;
    }
    const newVerts = [];
    for (let i = 0; i < n; i++) {
        if (!aliveV[i]) continue;
        if (!locked.has(i) && !usedByTri[i]) continue; // 非锁定孤儿顶点丢弃
        indexMap[i] = newVerts.length;
        const src = vertices[i];
        newVerts.push({
            position: positions[i],
            normal: src.normal.slice(),
            uv: src.uv.slice(),
            auvs: src.auvs ? src.auvs.map((a) => a.slice()) : [],
            type: src.type, // 未折叠顶点保持原 type；合并顶点已置为 BDEF4(2)
            skinIndices: src.skinIndices.slice(),
            skinWeights: src.skinWeights.slice(),
            edgeRatio: src.edgeRatio,
        });
    }
    const newTris = [];
    const keptTriIndices = [];
    for (let ti = 0; ti < tris.length; ti++) {
        if (!aliveT[ti]) continue;
        const [a, b, c] = tris[ti];
        newTris.push([indexMap[a], indexMap[b], indexMap[c]]);
        keptTriIndices.push(ti);
    }

    // 材质保护统计：每材质原始/最低/最终三角形数 + 保护类型
    // 'small' = 原始面数 ≤ SMALL_MATERIAL_TRI 全锁；'retention' = 动态保护触发；'none' = 无保护
    const protectedStats = [];
    if (aliveMatTri) {
        for (let mi = 0; mi < numMats; mi++) {
            if (origMatTri[mi] === 0) continue;
            let protectedType = 'none';
            if (lockSmallMaterials && origMatTri[mi] <= SMALL_MATERIAL_TRI) protectedType = 'small';
            else if (minRetention > 0 && (protectedHit[mi] === 1 || aliveMatTri[mi] <= minMatTri[mi])) protectedType = 'retention';
            protectedStats.push({
                materialIndex: mi,
                origTri: origMatTri[mi],
                minTri: minMatTri[mi],
                finalTri: aliveMatTri[mi],
                protected: protectedType,
            });
        }
    }
    stats.protectedStats = protectedStats;
    stats.finalTriangles = newTris.length;
    return { vertices: newVerts, triangles: newTris, indexMap, keptTriIndices, stats };
}


