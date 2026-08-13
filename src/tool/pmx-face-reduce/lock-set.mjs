// lock-set.mjs — 锁定顶点集构建：morph 引用 + 空间重合顶点聚类（材质/UV 接缝闭合）
// 纯函数模块，无 mmdparser 依赖，可被 jest 直接 import。
//
// 输入顶点结构（mmdparser 风格）：{ position: [x,y,z], ... }
// morphs：mmdparser 解析后的 morph 数组，type=1 顶点 morph 元素 { index, position }

// 顶点索引型 morph 类型（elements[].index 引用顶点索引）：type 1 顶点位移 / 3-7 UV morph
// type=8 材质 morph 的 index 是材质索引，不参与顶点锁定。
export const VERTEX_MORPH_TYPES = new Set([1, 3, 4, 5, 6, 7]);

// 接缝聚类网格单元 = tolerance × SEAM_CLUSTER_SCALE（1e-6 × 100 = 1e-4 格宽，
// 使同格 + 26 邻格范围内的点对都可被候选集覆盖）
const SEAM_CLUSTER_SCALE = 100;

/**
 * 用空间哈希聚类空间重合顶点（容差 tolerance）。
 * 返回簇数组，每簇为一个顶点索引数组（簇内任意两顶点距离 < tolerance 连通）。
 */
export function findSeamClusters(vertices, tolerance = 1e-6) {
    const cellSize = tolerance * SEAM_CLUSTER_SCALE; // 1e-4
    const map = new Map(); // key: "ix,iy,iz" -> number[]（顶点索引）
    for (let i = 0; i < vertices.length; i++) {
        const p = vertices[i].position;
        const key = `${Math.floor(p[0] / cellSize)},${Math.floor(p[1] / cellSize)},${Math.floor(p[2] / cellSize)}`;
        let bucket = map.get(key);
        if (!bucket) {
            bucket = [];
            map.set(key, bucket);
        }
        bucket.push(i);
    }
    const clusters = [];
    const visited = new Uint8Array(vertices.length);
    const posOf = (i) => vertices[i].position;
    const dist2 = (a, b) => {
        const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        return dx * dx + dy * dy + dz * dz;
    };
    const tol2 = tolerance * tolerance;
    for (const [key, bucket] of map) {
        if (bucket.length < 2) continue;
        // 收集同格 + 26 邻格所有候选索引
        const [ix, iy, iz] = key.split(',').map(Number);
        const candidates = new Set(bucket);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    const nb = map.get(`${ix + dx},${iy + dy},${iz + dz}`);
                    if (nb) for (const idx of nb) candidates.add(idx);
                }
            }
        }
        const arr = [...candidates];
        // 在当前候选集内部做并查集（距离 < tolerance 连通）
        const parent = new Map(arr.map((i) => [i, i]));
        const find = (x) => {
            if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
            return parent.get(x);
        };
        for (let i = 0; i < arr.length; i++) {
            for (let j = i + 1; j < arr.length; j++) {
                const a = arr[i], b = arr[j];
                if (dist2(posOf(a), posOf(b)) < tol2) {
                    const ra = find(a), rb = find(b);
                    if (ra !== rb) parent.set(rb, ra);
                }
            }
        }
        // 按并查集根分组
        const groups = new Map();
        for (const idx of arr) {
            const root = find(idx);
            let g = groups.get(root);
            if (!g) {
                g = [];
                groups.set(root, g);
            }
            g.push(idx);
        }
        for (const g of groups.values()) {
            if (g.length >= 2) {
                const anyVisited = g.some((i) => visited[i]);
                if (!anyVisited) {
                    clusters.push(g);
                    for (const i of g) visited[i] = 1;
                }
            }
        }
    }
    return clusters;
}

/**
 * 计算每材质的 face 索引范围 [start, count)（按材质 faceCount 累计偏移）。
 * @param {Array} materials mmdparser 材质数组（含 faceCount）
 * @returns {Array<[number, number]>}
 */
export function materialFaceRanges(materials) {
    const ranges = [];
    let offset = 0;
    for (const m of materials) {
        const count = m.faceCount != null ? m.faceCount : 0;
        ranges.push([offset, count]);
        offset += count;
    }
    return ranges;
}

/**
 * 收集指定材质引用的全部三角形顶点索引（材质级锁定）。
 * 材质 i 的三角形在 faces 中的连续范围由 materials[i].faceCount 累计决定
 * （与 reduce.mjs 中 per-material 计数、pmx-writer faceCount patch 使用同一约定）。
 * @param {Array} faces mmdparser faces 数组（每 face 含 indices）
 * @param {Array} materials mmdparser 材质数组（含 faceCount）
 * @param {number[]} materialIndices 要锁定的材质索引数组
 * @returns {Set<number>} 顶点索引集
 */
export function collectLockedVerticesForMaterials(faces, materials, materialIndices) {
    const locked = new Set();
    if (!faces || !materials || !materialIndices || !materialIndices.length) return locked;
    const ranges = materialFaceRanges(materials);
    for (const mi of materialIndices) {
        if (mi < 0 || mi >= ranges.length) continue;
        const [start, count] = ranges[mi];
        for (let f = start; f < start + count; f++) {
            const face = faces[f];
            if (!face) continue;
            const idx = face.indices;
            if (idx) for (const v of idx) locked.add(v);
        }
    }
    return locked;
}

/**
 * 构建锁定顶点集。
 * @param {Array} vertices 顶点数组（含 position）
 * @param {Array} morphs morph 数组
 * @param {{
 *   lockMorph?: boolean, lockSeams?: boolean, tolerance?: number,
 *   lockMaterials?: number[] | null, faces?: Array, materials?: Array
 * }} opts — lockMaterials 传入时需同时提供 faces + materials 以确定材质→顶点映射；
 *   默认 null 不改变原有行为（morph + 接缝锁定）。
 * @returns {Set<number>}
 */
export function buildLockedSet(vertices, morphs, {
    lockMorph = true,
    lockSeams = true,
    tolerance = 1e-6,
    lockMaterials = null,
    faces = null,
    materials = null,
} = {}) {
    const locked = new Set();
    if (lockMorph && morphs) {
        for (const m of morphs) {
            if (!VERTEX_MORPH_TYPES.has(m.type)) continue; // 仅顶点索引型 morph 含顶点索引；type=8 材质 morph 跳过
            for (const el of m.elements || []) {
                locked.add(el.index);
            }
        }
    }
    if (lockSeams && vertices) {
        for (const cluster of findSeamClusters(vertices, tolerance)) {
            for (const idx of cluster) locked.add(idx);
        }
    }
    if (lockMaterials) {
        for (const idx of collectLockedVerticesForMaterials(faces, materials, lockMaterials)) locked.add(idx);
    }
    return locked;
}
