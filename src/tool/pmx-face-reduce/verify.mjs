#!/usr/bin/env node
// verify.mjs — 减面结果验证脚本
// 用法：node verify.mjs <input> <output> [--target-ratio 0.5] [--lock-morph true] [--lock-seams true]
// 对输出文件重新 loadPmx + 全量断言；全绿退出码 0，失败非 0；stdout 输出 JSON 报告

import path from 'path';
import { fileURLToPath } from 'url';
import { loadPmx } from '../lib/pmx-loader.mjs';
import { buildLockedSet, VERTEX_MORPH_TYPES } from './lock-set.mjs';
import { triArea, SMALL_MATERIAL_TRI } from './qem.mjs';

const POS_TOL = 1e-6;
const MORPH_TOL = 1e-5;
const AREA_MIN = 1e-9;
const MAX_REPORT_ERRORS = 30;
// 受保护材质（--lock-materials）的最低保留率
const PROTECTED_RETENTION_MIN = 0.9;

function vecDist(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
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

        const allGreen = Object.entries(checks).every(([k, v]) => (k === 'lockedCount' ? true : v === true));
        report = {
            ok: allGreen,
            checks,
            errorCount,
            errors,
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
