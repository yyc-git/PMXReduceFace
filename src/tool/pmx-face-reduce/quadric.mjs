// quadric.mjs — 二次误差矩阵（quadric）数学：平面 K_p、4×4 对称矩阵、最优位置求解
// 纯函数模块，无 mmdparser 依赖，可被 jest 直接 import。
// 从 qem.mjs 拆分（R1）：qem.mjs 仅保留三角化 / 属性继承 / 形状有效性 / 边折叠引擎。

const EPS = 1e-12;

// 三角形平面 K_p（4×4 对称，16 float，行主序）
function planeQuadric(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < EPS) return null; // 退化三角形，忽略
    nx /= len; ny /= len; nz /= len;
    const d = -(nx * ax + ny * ay + nz * az);
    const q = new Float64Array(16);
    // [nx;ny;nz;d] ⊗ [nx;ny;nz;d]
    q[0] = nx * nx; q[1] = nx * ny; q[2] = nx * nz; q[3] = nx * d;
    q[4] = ny * nx; q[5] = ny * ny; q[6] = ny * nz; q[7] = ny * d;
    q[8] = nz * nx; q[9] = nz * ny; q[10] = nz * nz; q[11] = nz * d;
    q[12] = d * nx; q[13] = d * ny; q[14] = d * nz; q[15] = d * d;
    return q;
}

export function addQuadric(dst, src) {
    for (let i = 0; i < 16; i++) dst[i] += src[i];
}

/**
 * 计算每顶点二次误差矩阵 Q(v) = Σ(相邻三角形平面 K_p)。
 * @param {number[][]} positions 顶点位置数组
 * @param {number[][]} triangles 三角形索引数组
 * @returns {Float64Array[]} 每顶点 16 float 对称矩阵
 */
export function computeQuadrics(positions, triangles) {
    const n = positions.length;
    const Q = new Array(n);
    for (let i = 0; i < n; i++) Q[i] = new Float64Array(16);
    for (const [a, b, c] of triangles) {
        const q = planeQuadric(...positions[a], ...positions[b], ...positions[c]);
        if (!q) continue;
        addQuadric(Q[a], q);
        addQuadric(Q[b], q);
        addQuadric(Q[c], q);
    }
    return Q;
}

// 3×3 高斯消元（带部分主元），解 A x = b；奇异返回 null
function solve3(A, b) {
    const m = [
        [A[0], A[1], A[2], b[0]],
        [A[3], A[4], A[5], b[1]],
        [A[6], A[7], A[8], b[2]],
    ];
    for (let col = 0; col < 3; col++) {
        let piv = col, maxv = Math.abs(m[col][col]);
        for (let r = col + 1; r < 3; r++) {
            const v = Math.abs(m[r][col]);
            if (v > maxv) { maxv = v; piv = r; }
        }
        if (maxv < 1e-10) return null;
        if (piv !== col) [m[piv], m[col]] = [m[col], m[piv]];
        const d = m[col][col];
        for (let j = col; j <= 3; j++) m[col][j] /= d;
        for (let r = 0; r < 3; r++) {
            if (r === col) continue;
            const f = m[r][col];
            if (f === 0) continue;
            for (let j = col; j <= 3; j++) m[r][j] -= f * m[col][j];
        }
    }
    return [m[0][3], m[1][3], m[2][3]];
}

// 在 Q 下计算点 (x,y,z,1) 的误差（代价）
function evalQuadric(Q, x, y, z) {
    return (
        Q[0] * x * x + 2 * Q[1] * x * y + 2 * Q[2] * x * z + 2 * Q[3] * x +
        Q[5] * y * y + 2 * Q[6] * y * z + 2 * Q[7] * y +
        Q[10] * z * z + 2 * Q[11] * z +
        Q[15]
    );
}

/**
 * 求 Q（= Q(u)+Q(v)）下的最优折叠位置与代价。
 * 4×4 线性系统：解 A p = -b（A=左上 3×3，b=第 4 列前 3 行）。
 * @param {Float64Array} Q 16 float 对称矩阵
 * @param {number[]} fallbackU
 * @param {number[]} fallbackV
 * @returns {{pos: number[], cost: number, singular: boolean}}
 */
export function solveQuadric(Q, fallbackU, fallbackV) {
    const A = [Q[0], Q[1], Q[2], Q[4], Q[5], Q[6], Q[8], Q[9], Q[10]];
    const b = [-Q[3], -Q[7], -Q[11]];
    const sol = solve3(A, b);
    if (sol) {
        return { pos: sol, cost: evalQuadric(Q, sol[0], sol[1], sol[2]), singular: false };
    }
    // 奇异：退化到取两端点中代价较小的位置
    const cu = evalQuadric(Q, fallbackU[0], fallbackU[1], fallbackU[2]);
    const cv = evalQuadric(Q, fallbackV[0], fallbackV[1], fallbackV[2]);
    return cu <= cv
        ? { pos: fallbackU.slice(), cost: cu, singular: true }
        : { pos: fallbackV.slice(), cost: cv, singular: true };
}
