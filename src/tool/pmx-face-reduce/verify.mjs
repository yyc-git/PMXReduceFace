#!/usr/bin/env node
// verify.mjs — 减面结果验证脚本
// 用法：node verify.mjs <input> <output> [--target-ratio 0.5] [--lock-morph true] [--lock-seams true]
// 对输出文件重新 loadPmx + 全量断言；全绿退出码 0，失败非 0；stdout 输出 JSON 报告

import path from 'path';
import { fileURLToPath } from 'url';
import { loadPmx } from '../lib/pmx-loader.mjs';
import { buildLockedSet, VERTEX_MORPH_TYPES } from './lock-set.mjs';
import { triArea, SMALL_MATERIAL_TRI, triEdgeStats, maxProtrudeOfVerts, buildEdgeTris, buildBoundaryEdgeGrid, pointSegDist2, HOLE_TOL, findHoleChains, HOLE_ASSERT_MIN_AREA_RATIO } from './qem.mjs';

const POS_TOL = 1e-6;
const MORPH_TOL = 1e-5;
const AREA_MIN = 1e-9;
const MAX_REPORT_ERRORS = 30;
// 受保护材质（--lock-materials）的最低保留率
const PROTECTED_RETENTION_MIN = 0.9;
// 指尖突起形态检查（fix7.1 重构）：全指尖区域「新增尖刺」检测，口径 = scripts/diag-finger-full.mjs。
// fix7 的「外带 |x|>9 + 0.055 阈值」漏检内带尖刺（fix7.1 实测：修复后残留 13 个新增突起
// = 外带 9 + 内带 4，内带 tri#15603 @[8.89,14.37,-0.73] 等 x≈±8.67~8.89、y≈14.2~14.5、z≈-0.8~-0.7
// 在指尖内侧/掌侧，|x|≤9 不在外带断言区域 → 几何绿但视觉红）。
// 区域扩展为全指尖 |x|>7, 13<y<16（抓 x≈8.67~8.89 内带尖刺）；口径改为「新增尖刺计数」：
//   输出区域内 protrude > 0.05 且 距输入所有 protrude > 0.045 三角形质心距离 > 0.25 → 新增。
// 用「距输入质心距离」而非 count 的原因：输入全指尖区域本身有 454 个 protrude>0.045 的突起
// （内带 452 个，含合法穹面 max 0.130 @±8,15；外带仅 2 个 max 0.047）——若按 count 断言，
// 输入的合法穹面突起会淹没新增尖刺；按距离则输入自身必匹配（距自己质心 0）→ 输入新增数恒 0。
// 断言：输出新增数 ≤ 输入同口径新增数（输入 0）→ 即输出不得出现远离输入突起的全新尖刺。
// fix7.1 校准：守卫 protrudeMax 压到 0.045（PROTRUDE_MAX=0.045 / PROTRUDE_RATIO=0.32，见 qem.mjs）
// 后残留 0.050~0.052 尖刺被拒 → 新增尖刺 0。0.05 查询阈值低于守卫地板残影（原 0.052~0.053）也没关系：
// 地板残影若与输入突起质心距离 ≤0.25 → 不判新增，故断言对守卫地板免疫（fix7 用 0.055 就是被地板逼的）。
const FINGERTIP_REGION = (c) => Math.abs(c[0]) > 7.0 && c[1] > 13.0 && c[1] < 16.0;
const FINGERTIP_QUERY_PROTRUDE = 0.05;
const FINGERTIP_REF_PROTRUDE = 0.045;
const FINGERTIP_NEW_DIST = 0.25;
// 新增超尺寸三角形判据：输出 maxL > 输入全局 maxL p99，且质心与「输入固有巨型三角形（maxL > 输入 p99）」
// 质心距离 ≥ 该容差 → 视为新增（R6：精确顶点匹配容差太紧会把移动过的输入三角形误计为新增，用质心 0.05）
const OVERSIZE_MATCH_TOL = 0.05;
// 新增超尺寸三角形「跨曲面合并」判定阈值：新三角形所在输出表面（与边邻接三角形法线夹角最大值）超过该
// 角度 → 该三角形跨过弯曲表面（视觉破面）；平坦区新大三角形视觉无害不计。固定 20°（fix6-plan §2.1
// CURV_MIN_DEG 设计值，视觉危害线），与守卫自身的 CURV_MIN_DEG（可调低以更早拦截）解耦。
const OVERSIZE_CURVED_DEG = 20;

function vecDist(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function percentile(arr, p) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
}

// 名字含 namePart 的材质所辖三角形索引列表（按 faceCount 累计偏移）；无匹配材质 → null
function materialFaceIndices(model, namePart) {
    const mats = [];
    model.materials.forEach((mat, i) => { if (String(mat.name).includes(namePart)) mats.push(i); });
    if (!mats.length) return null;
    const list = [];
    let acc = 0;
    for (let mi = 0; mi < model.materials.length; mi++) {
        const cnt = model.materials[mi].faceCount || 0;
        if (mats.includes(mi)) for (let j = 0; j < cnt; j++) list.push(acc + j);
        acc += cnt;
    }
    return list;
}

function triGeom(vertices, face) {
    const [a, b, c] = face.indices;
    const p0 = vertices[a].position, p1 = vertices[b].position, p2 = vertices[c].position;
    return { area: triArea(p0, p1, p2), maxL: triEdgeStats(p0, p1, p2).maxL };
}

function triGeomVerts(positions, t) {
    const p0 = positions[t[0]], p1 = positions[t[1]], p2 = positions[t[2]];
    return { area: triArea(p0, p1, p2), maxL: triEdgeStats(p0, p1, p2).maxL };
}

function triCentroid(positions, t) {
    const p0 = positions[t[0]], p1 = positions[t[1]], p2 = positions[t[2]];
    return [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
}

// 全指尖区域「新增尖刺」检测（口径 = scripts/diag-finger-full.mjs，qem.maxProtrudeOfVerts 单一来源）：
// query 区域 protrude > FINGERTIP_QUERY_PROTRUDE 且 距 ref 所有 protrude > FINGERTIP_REF_PROTRUDE
// 三角形质心距离 > FINGERTIP_NEW_DIST → 新增。返回 { count, maxArea, refCount }。
export function countNewFingertipProtrusions(queryPos, queryTri, refPos, refTri) {
    const qEdge = buildEdgeTris(queryTri);
    const rEdge = buildEdgeTris(refTri);
    const refs = [];
    for (let ti = 0; ti < refTri.length; ti++) {
        const c = triCentroid(refPos, refTri[ti]);
        if (!FINGERTIP_REGION(c)) continue;
        if (maxProtrudeOfVerts(refPos, refTri, ti, rEdge) <= FINGERTIP_REF_PROTRUDE) continue;
        refs.push(c);
    }
    let count = 0, maxArea = 0;
    for (let ti = 0; ti < queryTri.length; ti++) {
        const c = triCentroid(queryPos, queryTri[ti]);
        if (!FINGERTIP_REGION(c)) continue;
        if (maxProtrudeOfVerts(queryPos, queryTri, ti, qEdge) <= FINGERTIP_QUERY_PROTRUDE) continue;
        let md = Infinity;
        for (const r of refs) {
            const d = Math.hypot(r[0] - c[0], r[1] - c[1], r[2] - c[2]);
            if (d < md) md = d;
        }
        if (md > FINGERTIP_NEW_DIST) {
            count++;
            const ar = triGeomVerts(queryPos, queryTri[ti]).area;
            if (ar > maxArea) maxArea = ar;
        }
    }
    return { count, maxArea, refCount: refs.length };
}

// 新增超尺寸三角形数：输出 maxL > inMaxLP99 且质心无法在「输入固有巨型三角形」容差内匹配。
// 返回 { count, curvedCount }：curvedCount = 新增超尺寸中「输出表面曲率 > minAngDeg」的数量
// （跨曲面合并的判定：曲面上新出现大三角形 → 视觉破面；平坦区新大三角形视觉无害 → 不计）。
function countNewOversize(inPos, inTri, outPos, outTri, inMaxLP99, minAngDeg) {
    const CELL = OVERSIZE_MATCH_TOL;
    const grid = new Map();
    for (const t of inTri) {
        if (triGeomVerts(inPos, t).maxL <= inMaxLP99) continue;
        const c = triCentroid(inPos, t);
        const gk = `${Math.floor(c[0] / CELL)},${Math.floor(c[1] / CELL)},${Math.floor(c[2] / CELL)}`;
        if (!grid.has(gk)) grid.set(gk, []);
        grid.get(gk).push(c);
    }
    // 输出三角形法线 + 边邻接（供「新三角形所在表面是否弯曲」判定）
    const outNorm = outTri.map((t) => {
        const p0 = outPos[t[0]], p1 = outPos[t[1]], p2 = outPos[t[2]];
        const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
        const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
        const n = [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
        const len = Math.hypot(n[0], n[1], n[2]);
        return len < 1e-12 ? null : [n[0] / len, n[1] / len, n[2] / len];
    });
    const edgeMap = new Map();
    for (let ti = 0; ti < outTri.length; ti++) {
        const t = outTri[ti];
        for (const [x, y] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
            const k = x < y ? `${x}:${y}` : `${y}:${x}`;
            if (!edgeMap.has(k)) edgeMap.set(k, []);
            edgeMap.get(k).push(ti);
        }
    }
    const COS_MIN = Math.cos((minAngDeg * Math.PI) / 180);
    let newCount = 0, curvedCount = 0;
    for (let ti = 0; ti < outTri.length; ti++) {
        if (triGeomVerts(outPos, outTri[ti]).maxL <= inMaxLP99) continue;
        const c = triCentroid(outPos, outTri[ti]);
        const gx = Math.floor(c[0] / CELL), gy = Math.floor(c[1] / CELL), gz = Math.floor(c[2] / CELL);
        let matched = false;
        outer: for (let dx = -1; dx <= 1 && !matched; dx++) for (let dy = -1; dy <= 1 && !matched; dy++) for (let dz = -1; dz <= 1 && !matched; dz++) {
            const cands = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
            if (!cands) continue;
            for (const ic of cands) if (Math.hypot(ic[0] - c[0], ic[1] - c[1], ic[2] - c[2]) < OVERSIZE_MATCH_TOL) { matched = true; break outer; }
        }
        if (matched) continue;
        newCount++;
        // 新三角形所在输出表面的曲率：与边邻接三角形法线夹角最大值 > minAngDeg → 跨曲面合并（有害）
        const nn = outNorm[ti];
        if (!nn) continue;
        const t = outTri[ti];
        const nbs = new Set();
        for (const [x, y] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
            const k = x < y ? `${x}:${y}` : `${y}:${x}`;
            for (const tj of edgeMap.get(k) || []) if (tj !== ti) nbs.add(tj);
        }
        let curved = false;
        for (const tj of nbs) {
            const on = outNorm[tj];
            if (!on) continue;
            if (nn[0] * on[0] + nn[1] * on[1] + nn[2] * on[2] < COS_MIN) { curved = true; break; }
        }
        if (curved) curvedCount++;
    }
    return { count: newCount, curvedCount };
}

// 输出边共享三角形数 > 2 的边数量（非流形边）
function countNonManifoldEdges(tris) {
    const cnt = new Map();
    const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    for (const t of tris) {
        for (const [x, y] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
            const k = key(x, y);
            cnt.set(k, (cnt.get(k) || 0) + 1);
        }
    }
    let nonManifold = 0;
    for (const c of cnt.values()) if (c > 2) nonManifold++;
    return nonManifold;
}

// 袜子区域（BurumaSet 材质）空间上新增的边界边数量：输出边界边中点落在袜子区域（y 9-19 且距最近
// BurumaSet 三角形质心 < 0.5，口径与 scripts/diag-sock.mjs 一致），且距最近输入边界边线段 > HOLE_TOL
// → 新增洞。全模型 countSpatiallyNewBoundaryEdges 对真实模型非 0（头部/躯干开放边界在减面中合法
// 回缩滑动 0.2~1.0，fix5 实测 41，属「边界沿原边界回缩」合法简化而非洞，fix6-plan §1.4 点 5），
// 故断言范围限定袜子区域——那里才是「薄壳破面」的判定区（fix6-plan §9：unmatchedBndCount ≤ 1）。
function countNewSockBoundaryEdges(inPos, inTri, outPos, outTri, sockTriangles) {
    const { grid, cell } = buildBoundaryEdgeGrid(inPos, inTri, null, 0.5);
    const TOL2 = HOLE_TOL * HOLE_TOL;
    const sockCentroids = sockTriangles.map((fi) => triCentroid(outPos, outTri[fi]));
    const cnt = new Map(), mid = new Map();
    const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    for (let ti = 0; ti < outTri.length; ti++) {
        const t = outTri[ti];
        for (const [x, y] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
            const k = key(x, y);
            cnt.set(k, (cnt.get(k) || 0) + 1);
            if (!mid.has(k)) {
                const px = outPos[x], py = outPos[y];
                mid.set(k, [(px[0] + py[0]) / 2, (px[1] + py[1]) / 2, (px[2] + py[2]) / 2]);
            }
        }
    }
    let newCount = 0;
    for (const [k, c] of cnt) {
        if (c !== 1) continue;
        const p = mid.get(k);
        if (p[1] < 9 || p[1] > 19) continue;
        let near = false;
        for (const sc of sockCentroids) {
            if (Math.hypot(sc[0] - p[0], sc[1] - p[1], sc[2] - p[2]) < 0.5) { near = true; break; }
        }
        if (!near) continue;
        const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell), gz = Math.floor(p[2] / cell);
        let ok = false;
        outer: for (let dx = -1; dx <= 1 && !ok; dx++) for (let dy = -1; dy <= 1 && !ok; dy++) for (let dz = -1; dz <= 1 && !ok; dz++) {
            const segs = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
            if (!segs) continue;
            for (const [sa, sb] of segs) if (pointSegDist2(p, sa, sb) < TOL2) { ok = true; break outer; }
        }
        if (!ok) newCount++;
    }
    return newCount;
}

export function verifyFaces({
    input,
    output,
    targetRatio = 0.5,
    targetTri = null,
    lockMaterials = null,
    minRetention = 0.3,
    lockSmallMaterials = true,
    lockMorph = true,
    lockSeams = true,
}) {
    const t0 = Date.now();
    const checks = {};
    const errors = [];
    // 计数模式（R3）：errorCount 记录全部错误总数，errors 数组仅保留首 MAX_REPORT_ERRORS 条
    let errorCount = 0;
    const reportError = (msg) => {
        errorCount++;
        if (errors.length < MAX_REPORT_ERRORS) errors.push(msg);
    };
    let report = null;
    try {
        const orig = loadPmx(input, false);
        const dec = loadPmx(output, false);

        const origVertices = orig.metadata.vertexCount;
        const origTri = orig.faces.length;
        const triLimit = targetTri != null ? targetTri : Math.ceil(origTri * targetRatio);
        const newVertices = dec.metadata.vertexCount;
        const newTri = dec.faces.length;

        // 共享数据：锁定顶点集（lockMorph/lockSeams 与 reduce 侧一致）+ 输出位置空间哈希
        const locked = buildLockedSet(orig.vertices, orig.morphs, { lockMorph, lockSeams });
        const grid = new Map();
        const cellOf = (p) => `${Math.round(p[0] / POS_TOL)},${Math.round(p[1] / POS_TOL)},${Math.round(p[2] / POS_TOL)}`;
        for (let i = 0; i < dec.vertices.length; i++) {
            const p = dec.vertices[i].position;
            const key = cellOf(p);
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(i);
        }
        let minNormalLength = Infinity;
        let maxNormalLength = 0;
        const perMaterial = dec.materials.map((m, i) => ({ index: i, name: m.name, newTri: m.faceCount }));

        // ---------- 断言子函数（定义在 try 块内，闭包访问共享数据）----------

        // 1. 解析成功；顶点减少；三角形 ≤ 目标
        function checkParseable() {
            checks.parseable = true;
            checks.vertexReduced = newVertices < origVertices;
            checks.triWithinTarget = newTri <= triLimit;
            if (!checks.vertexReduced) reportError(`vertices not reduced: ${newVertices} >= ${origVertices}`);
            if (!checks.triWithinTarget) reportError(`triangles ${newTri} > target ${triLimit}`);
        }

        // 2. 锁定顶点逐一比对（morph 引用 + 接缝簇）位置逐分量差 < 1e-6
        function checkLockedVerts() {
            let lockedPreserved = 0;
            for (const li of locked) {
                const p = orig.vertices[li].position;
                const key = cellOf(p);
                const cands = grid.get(key) || [];
                let found = false;
                for (const ci of cands) {
                    const dp = dec.vertices[ci].position;
                    if (Math.abs(dp[0] - p[0]) < POS_TOL && Math.abs(dp[1] - p[1]) < POS_TOL && Math.abs(dp[2] - p[2]) < POS_TOL) {
                        found = true;
                        break;
                    }
                }
                if (found) lockedPreserved++;
                else reportError(`locked vertex ${li} position missing in output`);
            }
            checks.lockedVertsPreserved = lockedPreserved === locked.size;
            checks.lockedCount = locked.size;
        }

        // 3. morph 元素索引有效且引用映射正确（映射后顶点 = 原顶点）
        // 注意：仅顶点索引型 morph（type 1/3/4/5/6/7）的 elements[].index 是顶点索引；
        // type 8（材质 morph）的 index 是材质索引（可为 -1），不参与顶点校验。
        // 位置比对仅在 lockMorph=true 时适用：关闭锁定时 morph 引用顶点可被折叠移除，
        // 元素会被丢弃、顶点位置会移动，「映射后顶点 = 原顶点」不成立 → 跳过该比对。
        function checkMorphMapping() {
            let morphIndicesValid = true;
            let morphMappingCorrect = true;
            for (let mi = 0; mi < dec.morphs.length; mi++) {
                const dm = dec.morphs[mi];
                const om = orig.morphs[mi];
                if (!om) { morphIndicesValid = false; reportError(`morph ${mi} missing in original?`); continue; }
                if (dm.type !== om.type) { morphIndicesValid = false; reportError(`morph ${mi} type mismatch`); continue; }
                const isVertexType = VERTEX_MORPH_TYPES.has(dm.type);
                for (let e = 0; e < dm.elements.length; e++) {
                    const de = dm.elements[e];
                    if (isVertexType) {
                        if (de.index < 0 || de.index >= newVertices) {
                            morphIndicesValid = false;
                            reportError(`morph ${mi} element ${e} index ${de.index} out of range`);
                            continue;
                        }
                        // type=1 顶点 morph：映射后顶点 = 原顶点（位置比对，仅锁定开启时适用）
                        if (dm.type === 1 && om.elements[e] && lockMorph) {
                            const dp = dec.vertices[de.index].position;
                            const op = orig.vertices[om.elements[e].index].position;
                            if (vecDist(dp, op) > MORPH_TOL) {
                                morphMappingCorrect = false;
                                reportError(`morph ${mi} elem ${e}: mapped pos mismatch`);
                            }
                        }
                    }
                }
            }
            checks.morphIndicesValid = morphIndicesValid;
            checks.morphMappingCorrect = morphMappingCorrect;
        }

        // 4. 抽样 10 个顶点 morph：锁定顶点应用 morph 偏移后 = 原位置 + 偏移
        function checkMorphApply() {
            let morphApplyCorrect = true;
            const vMorphs = dec.morphs.filter((m) => m.type === 1).slice(0, 10);
            for (const m of vMorphs) {
                const mi = dec.morphs.indexOf(m);
                const om = orig.morphs[mi];
                for (let e = 0; e < Math.min(m.elements.length, 200); e++) {
                    const de = m.elements[e];
                    const oe = om.elements[e];
                    if (!oe) continue;
                    // 锁定顶点（morph 引用顶点必锁定）→ 输出位置 = 原位置
                    const dp = dec.vertices[de.index].position;
                    const op = orig.vertices[oe.index].position;
                    if (vecDist(dp, op) > POS_TOL) continue; // 非锁定顶点不适用此断言
                    const applyNew = [dp[0] + de.position[0], dp[1] + de.position[1], dp[2] + de.position[2]];
                    const applyOrig = [op[0] + oe.position[0], op[1] + oe.position[1], op[2] + oe.position[2]];
                    if (vecDist(applyNew, applyOrig) > MORPH_TOL) {
                        morphApplyCorrect = false;
                        break;
                    }
                }
                if (!morphApplyCorrect) break;
            }
            checks.morphApplyCorrect = morphApplyCorrect;
        }

        // 5. 无退化三角形、无重复三角形
        function checkDegenerate() {
            let noDegenerate = true;
            const seen = new Set();
            let noDuplicate = true;
            for (const f of dec.faces) {
                const [a, b, c] = f.indices;
                const p0 = dec.vertices[a].position, p1 = dec.vertices[b].position, p2 = dec.vertices[c].position;
                if (triArea(p0, p1, p2) <= AREA_MIN) { noDegenerate = false; reportError(`degenerate tri ${a},${b},${c}`); }
                const key = [a, b, c].sort((x, y) => x - y).join(',');
                if (seen.has(key)) { noDuplicate = false; reportError(`duplicate tri ${key}`); }
                seen.add(key);
            }
            checks.noDegenerateTriangles = noDegenerate;
            checks.noDuplicateTriangles = noDuplicate;
        }

        // 6. 每个非锁定新顶点至少属于 1 个三角形（锁定顶点可保留但无面）
        function checkVertexUsage() {
            const inTri = new Set();
            for (const f of dec.faces) for (const idx of f.indices) inTri.add(idx);
            let everyNonLockedUsed = true;
            for (let i = 0; i < dec.vertices.length; i++) {
                if (!inTri.has(i)) {
                    const p = dec.vertices[i].position;
                    let isLockedPos = false;
                    for (const li of locked) {
                        const op = orig.vertices[li].position;
                        if (Math.abs(op[0] - p[0]) < POS_TOL && Math.abs(op[1] - p[1]) < POS_TOL && Math.abs(op[2] - p[2]) < POS_TOL) {
                            isLockedPos = true;
                            break;
                        }
                    }
                    if (!isLockedPos) { everyNonLockedUsed = false; reportError(`non-locked vertex ${i} unused`); }
                }
            }
            checks.everyNonLockedVertexUsed = everyNonLockedUsed;
        }

        // 7. 所有新顶点 skinWeights 归一化（Σ ≈ 1）
        function checkWeights() {
            let weightsNormalized = true;
            for (let i = 0; i < dec.vertices.length; i++) {
                const w = dec.vertices[i].skinWeights || [];
                const sum = w.reduce((s, x) => s + x, 0);
                if (Math.abs(sum - 1) > 1e-5) {
                    weightsNormalized = false;
                    reportError(`vertex ${i} weights sum ${sum}`);
                }
            }
            checks.weightsNormalized = weightsNormalized;
        }

        // 7.5 所有顶点法线单位长度（|hypot(n) - 1| ≤ 1e-3）。
        // 法线非单位 → MMD 光照明暗错乱 → 视觉破面（M 阶段 bug 回归防线）。
        function checkNormals() {
            let normalsUnitLength = true;
            for (let i = 0; i < dec.vertices.length; i++) {
                const n = dec.vertices[i].normal;
                const len = Math.hypot(n[0], n[1], n[2]);
                if (len < minNormalLength) minNormalLength = len;
                if (len > maxNormalLength) maxNormalLength = len;
                if (Math.abs(len - 1) > 1e-3) {
                    normalsUnitLength = false;
                    reportError(`vertex ${i} normal length ${len} != 1`);
                }
            }
            checks.normalsUnitLength = normalsUnitLength;
        }

        // 8. 材质 faceCount 总和 = 新 faces 长度；header 记录与实际一致
        function checkMaterialHeader() {
            const matSum = dec.materials.reduce((s, m) => s + m.faceCount, 0);
            checks.materialSumConsistent = matSum === newTri;
            if (!checks.materialSumConsistent) reportError(`material faceCount sum ${matSum} != faces ${newTri}`);
            checks.headerConsistent =
                dec.metadata.vertexCount === dec.vertices.length && dec.metadata.faceCount === dec.faces.length;
            if (!checks.headerConsistent) reportError('header counts mismatch');
        }

        // 8.5 受保护材质（--lock-materials）三角形保留率 >= PROTECTED_RETENTION_MIN
        // 8.6 自动材质保护保留率：≤SMALL_MATERIAL_TRI 材质 finalTri = origTri（100%）；大材质 finalTri ≥ origTri × minRetention
        function checkRetention() {
            let protectedRetention = true;
            if (lockMaterials && lockMaterials.length) {
                for (const mi of lockMaterials) {
                    if (mi < 0 || mi >= orig.materials.length || mi >= dec.materials.length) {
                        protectedRetention = false;
                        reportError(`protected material ${mi} out of range`);
                        continue;
                    }
                    const omTri = orig.materials[mi].faceCount;
                    const nmTri = dec.materials[mi].faceCount;
                    const retention = omTri > 0 ? nmTri / omTri : 1;
                    if (retention < PROTECTED_RETENTION_MIN) {
                        protectedRetention = false;
                        reportError(`protected material ${mi} retention ${retention.toFixed(4)} < ${PROTECTED_RETENTION_MIN}`);
                    }
                }
                checks.protectedRetention = protectedRetention;
            }

            // 小材质断言仅当 lockSmallMaterials 开启；minRetention=0 时大材质阈值=0 恒过
            let materialRetentionOk = true;
            for (let mi = 0; mi < orig.materials.length; mi++) {
                const omTri = orig.materials[mi].faceCount || 0;
                if (omTri === 0) continue;
                if (mi >= dec.materials.length) {
                    materialRetentionOk = false;
                    reportError(`material ${mi} missing in output`);
                    continue;
                }
                const nmTri = dec.materials[mi].faceCount || 0;
                const isSmall = omTri <= SMALL_MATERIAL_TRI;
                const threshold = isSmall ? omTri : Math.floor(omTri * minRetention);
                const needed = isSmall && !lockSmallMaterials ? 0 : threshold;
                if (nmTri < needed) {
                    materialRetentionOk = false;
                    reportError(`material ${mi} tri ${nmTri} < threshold ${needed} (orig ${omTri})`);
                }
            }
            checks.materialRetentionOk = materialRetentionOk;
        }

        // 9. 视觉质量检查（第六轮 §4.1 + fix9 通用化）：阈值全部运行时实测（输入 p99/p90/突起面积），
        // 断言里只有增长系数（1.5）等比例常数，不硬编码被测值。
        // fix9 解耦：全局性检查（noNewOversizeTriangles / noNonManifoldEdges / noNewHoles）任何模型都
        // 无条件执行，不依赖 BurumaSet。旧实现把全部质量断言绑定 BurumaSet，无此材质的模型
        // （如 Tda）qualityChecksActive=false → 全部质量断言跳过 → 减面破面漏检（Tda 左大腿内侧
        // 7 个新增跨曲面超尺寸三角形即此路径漏检的实锤）。
        // qualityChecksActive 语义 =「存在 BurumaSet（材质相关检查激活）」；仅材质相关检查
        // （burumaAreaP99Growth / burumaMaxLP90Growth / fingertipProtrudeShape）受它门控。
        const quality = { active: false };
        function checkQuality() {
            const bMat = materialFaceIndices(orig, 'BurumaSet');
            const bMatOut = materialFaceIndices(dec, 'BurumaSet');
            checks.qualityChecksActive = bMat !== null;
            quality.active = true;
            quality.materialActive = bMat !== null;
            const origPos = orig.vertices.map((v) => v.position);
            const decPos = dec.vertices.map((v) => v.position);
            const origTri = orig.faces.map((f) => f.indices);
            const decTri = dec.faces.map((f) => f.indices);

            // ===== 全局性质量检查（无条件执行，任何模型都断言） =====

            // 全局新增超尺寸三角形：输出 maxL > 输入全局 maxL p99，质心无法匹配输入固有巨型三角形 → 新增。
            // 只计「跨曲面合并」（新三角形所在输出表面曲率 > OVERSIZE_CURVED_DEG）——平坦区新大三角形视觉
            // 无害（fix6 实测 56 个新超尺寸中仅 4 个 >12°、0 个 >20°，全在平坦区；fix5 有 444 个跨曲面合并）。
            const inMaxLP99Global = percentile(origTri.map((t) => triGeomVerts(origPos, t).maxL), 0.99);
            const { count: oversizeCount, curvedCount } = countNewOversize(origPos, origTri, decPos, decTri, inMaxLP99Global, OVERSIZE_CURVED_DEG);
            quality.oversize = { inputMaxLP99: inMaxLP99Global, newCount: oversizeCount, curvedNewCount: curvedCount, matchTol: OVERSIZE_MATCH_TOL, curvMinDeg: OVERSIZE_CURVED_DEG };
            checks.noNewOversizeTriangles = curvedCount === 0;

            // 非流形边（输出边共享 >2）：只断言「新增」非流形边（QEM 不得引入）。
            // 源模型自带非流形边（如 TDA Utage CORAL COAST 源资产 2 条）不在 QEM 职责内，
            // roundtrip（ratio 1.0）与各减面档都会保留它们，绝对值断言会把源缺陷误报为减面回归。
            const inNonManifold = countNonManifoldEdges(origTri);
            const outNonManifold = countNonManifoldEdges(decTri);
            const newNonManifold = Math.max(0, outNonManifold - inNonManifold);
            quality.nonManifoldEdges = outNonManifold;
            quality.inputNonManifoldEdges = inNonManifold;
            quality.newNonManifoldEdges = newNonManifold;
            checks.noNonManifoldEdges = newNonManifold === 0;

            // 空间无新增洞（fix10 全局严格断言，任何模型都执行，不依赖 BurumaSet）：
            // 只断言「新增闭合洞环」（输出新增边界边组成深湾、输入原表面覆盖的真洞），把
            // 「开放边界合法回缩」（回缩湾浅而宽 / 单边位移）与真洞区分开（fix5 教训）。
            // 阈值（HOLE_ASSERT_MIN_AREA_RATIO × 输出 medE² / 深度比 / mouth 上限）经 Tda（RED，
            // 4 洞）与 XiaoMei（GREEN，0 洞）实测校准：XiaoMei 头部穹顶 0.2 级浅湾在阈值下不误报。
            const holeRings = findHoleChains(origPos, origTri, null, decPos, decTri, null, { minAreaRatio: HOLE_ASSERT_MIN_AREA_RATIO });
            quality.holeRings = holeRings.map((h) => ({
                area: Number(h.area.toFixed(3)),
                mouth: Number(h.mouth.toFixed(3)),
                chainLength: h.chain.length,
                centroid: h.centroid.map((v) => Number(v.toFixed(2))),
            }));
            checks.noNewHoles = holeRings.length === 0;
            // 有 BurumaSet 时额外保留袜区口径（薄壳破面判定区，fix5/§1.4 点 5，fix6-plan §9 ≤1）：
            // 全局洞断言已覆盖袜区真洞，此处作为补充报告（不参与 noNewHoles，防双重计数）。
            if (bMatOut) {
                const sockNewHoles = countNewSockBoundaryEdges(origPos, origTri, decPos, decTri, bMatOut);
                quality.sockNewHoles = sockNewHoles;
                checks.sockRegionNewHoles = sockNewHoles <= 1;
            } else {
                quality.sockNewHoles = null;
                checks.sockRegionNewHoles = true;
            }

            // ===== 材质相关检查（仅 BurumaSet 存在时激活，受 qualityChecksActive 门控） =====
            if (bMat === null) {
                // 无 BurumaSet：材质相关检查跳过并告警。fingertip 区域 |x|>7, 13<y<16 是 XiaoMei
                // 坐标系（fix7.1），Tda 手在 y≈9-13 不适用该区域——不因无 BurumaSet 全跳，但也不能用
                // XiaoMei 指尖区域断言 Tda 手部形态 → 无 BurumaSet 时跳过并告警（Tda 手部由全局
                // noNewOversizeTriangles / 突起守卫覆盖）。全局性检查已在上方照常执行。
                checks.burumaAreaP99Growth = true;
                checks.burumaMaxLP90Growth = true;
                checks.fingertipProtrudeShape = true;
                quality.skipped = ['burumaAreaP99Growth', 'burumaMaxLP90Growth', 'fingertipProtrudeShape'];
                quality.skipReason = 'no BurumaSet material (Tda-class model): material-specific checks inactive; global checks (noNewOversizeTriangles/noNonManifoldEdges) still asserted';
                return;
            }

            // BurumaSet 面积/边长分位数（输入 vs 输出，运行时实测）
            const inAreas = [], inMaxLs = [], outAreas = [], outMaxLs = [];
            for (const fi of bMat) {
                const g = triGeom(orig.vertices, orig.faces[fi]);
                inAreas.push(g.area); inMaxLs.push(g.maxL);
            }
            if (bMatOut) {
                for (const fi of bMatOut) {
                    const g = triGeom(dec.vertices, dec.faces[fi]);
                    outAreas.push(g.area); outMaxLs.push(g.maxL);
                }
            }
            const inAreaP99 = percentile(inAreas, 0.99);
            const outAreaP99 = bMatOut ? percentile(outAreas, 0.99) : Infinity;
            const inMaxLP90 = percentile(inMaxLs, 0.90);
            const outMaxLP90 = bMatOut ? percentile(outMaxLs, 0.90) : Infinity;
            // 面积 p99 增长系数 1.5（第六轮校准，fix6-plan §8 步骤 5）：输入 BurumaSet 本身含 100 个
            // 面积 > 0.0998 的固有巨型三角形（实测），深度减面后这些保留巨型的百分位前移，1.3× 不可达
            // （实测 fix6 输出 p99=0.109 但 1.3×=0.0998）；1.5×=0.115 分界清晰：fix5 0.156 RED / fix6 0.109 GREEN。
            quality.burumaArea = { inP99: inAreaP99, outP99: outAreaP99, coef: 1.5, threshold: inAreaP99 * 1.5 };
            quality.burumaMaxL = { inP90: inMaxLP90, outP90: outMaxLP90, coef: 1.5, threshold: inMaxLP90 * 1.5 };
            checks.burumaAreaP99Growth = outAreaP99 <= inAreaP99 * 1.5;
            checks.burumaMaxLP90Growth = outMaxLP90 <= inMaxLP90 * 1.5;

            // 指尖突起形态（fix7.1）：全指尖区域 |x|>7, 13<y<16「新增尖刺」计数。输入自比必为 0
            // （查询集 ⊆ 参考集，距自己质心 0），故断言 = 输出新增尖刺 0；fix7 外带断言漏检的内带
            // 尖刺（x≈±8.67~8.89）在此区域必被抓。口径/阈值见 FINGERTIP_* 常量注释（diag-finger-full）。
            const inTipNew = countNewFingertipProtrusions(origPos, origTri, origPos, origTri);
            const outTipNew = countNewFingertipProtrusions(decPos, decTri, origPos, origTri);
            quality.fingertip = { inCount: inTipNew.count, outCount: outTipNew.count, inMaxArea: inTipNew.maxArea, outMaxArea: outTipNew.maxArea, refCount: inTipNew.refCount, queryThreshold: FINGERTIP_QUERY_PROTRUDE, refThreshold: FINGERTIP_REF_PROTRUDE, newDist: FINGERTIP_NEW_DIST, region: 'full |x|>7, 13<y<16' };
            checks.fingertipProtrudeShape = outTipNew.count <= inTipNew.count && outTipNew.maxArea <= inTipNew.maxArea;
        }

        // ---------- 编排 ----------
        checkParseable();
        checkLockedVerts();
        checkMorphMapping();
        checkMorphApply();
        checkDegenerate();
        checkVertexUsage();
        checkWeights();
        checkNormals();
        checkMaterialHeader();
        checkRetention();
        checkQuality();

        // 质量优先（fix6-plan §5）：质量守卫把减面地板抬高（LOD50 floor 38686 > 名义目标 27114）时，
        // reductionMet=false / triWithinTarget=false 属预期（「面数不一定要降很低，但破面和突出的面
        // 不能忍」）。故 triWithinTarget 不进 ok（报告仍含 reductionRatio / targetTriangles 供观察）；
        // 「无退化/法线/权重/材质/质量检查」等硬性质量项全绿才 ok=true。
        const allGreen = Object.entries(checks).every(([k, v]) => (k === 'lockedCount' || k === 'triWithinTarget' || k === 'qualityChecksActive' ? true : v === true));
        report = {
            ok: allGreen,
            checks,
            errorCount,
            errors,
            quality,
            stats: {
                originalVertices: origVertices,
                newVertices,
                originalTriangles: origTri,
                newTriangles: newTri,
                targetTriangles: triLimit,
                lockedCount: locked.size,
                reductionRatio: Number(((1 - newTri / origTri) * 100).toFixed(2)),
                minNormalLength: minNormalLength === Infinity ? null : minNormalLength,
                maxNormalLength,
                durationMs: Date.now() - t0,
            },
            perMaterial,
        };
    } catch (e) {
        report = { ok: false, checks, errorCount: errorCount + 1, errors: [String(e && e.stack ? e.stack : e)], stats: null, perMaterial: [] };
    }
    return report;
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const input = args[0];
    const output = args[1];
    const ratioIdx = args.indexOf('--target-ratio');
    const targetRatio = ratioIdx >= 0 ? parseFloat(args[ratioIdx + 1]) : 0.5;
    const triIdx = args.indexOf('--target-tri');
    const targetTri = triIdx >= 0 ? parseInt(String(args[triIdx + 1]).replace(/,/g, ''), 10) : null;
    const lockIdx = args.indexOf('--lock-materials');
    const lockMaterials = lockIdx >= 0
        ? String(args[lockIdx + 1]).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n >= 0)
        : null;
    const mrIdx = args.indexOf('--min-retention');
    const minRetention = mrIdx >= 0 ? parseFloat(args[mrIdx + 1]) : 0.3;
    const lsmIdx = args.indexOf('--lock-small-materials');
    const lockSmallMaterials = lsmIdx >= 0 ? args[lsmIdx + 1] !== 'false' : true;
    const lockMorphIdx = args.indexOf('--lock-morph');
    const lockMorph = lockMorphIdx >= 0 ? args[lockMorphIdx + 1] !== 'false' : true;
    const lockSeamsIdx = args.indexOf('--lock-seams');
    const lockSeams = lockSeamsIdx >= 0 ? args[lockSeamsIdx + 1] !== 'false' : true;
    if (!input || !output) {
        console.error('usage: node verify.mjs <input> <output> [--target-ratio 0.5] [--target-tri <absoluteTri>] [--lock-morph true] [--lock-seams true] [--lock-materials "7,8,9,10,11,12,13"] [--min-retention 0.3] [--lock-small-materials true|false]');
        process.exit(1);
    }
    for (const [name, val] of [['--target-ratio', targetRatio], ['--target-tri', targetTri], ['--min-retention', minRetention]]) {
        if (val !== null && val !== undefined && !Number.isFinite(val)) {
            console.error(`invalid numeric value for ${name}`);
            process.exit(1);
        }
    }
    try {
        const report = verifyFaces({ input, output, targetRatio, targetTri, lockMaterials, minRetention, lockSmallMaterials, lockMorph, lockSeams });
        console.log(JSON.stringify(report));
        process.exit(report.ok ? 0 : 1);
    } catch (e) {
        console.error('verify failed: ' + (e && e.stack ? e.stack : e));
        process.exit(1);
    }
}
