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

function triNormal(p0, p1, p2) {
    const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
    const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
    return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
}

/**
 * 判定将三角形 tri 中顶点 u/v 替换为 newPos 后是否仍有效（非退化、非法线翻转）。
 * 用于形状惩罚。
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
    return dot > 0;
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

    const stats = { initialTriangles: triCount, finalTriangles: triCount, collapses: 0, rejected: 0, warnings: [] };

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
        if (!ok) { e.dead = true; stats.rejected++; return; }

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
            if (blocked) { e.dead = true; stats.rejected++; return; }
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
