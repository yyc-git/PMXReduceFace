#!/usr/bin/env node
// reduce.mjs — PMX 减面主入口（QEM 约束边折叠）
// 用法：node reduce.mjs --input <pmx> --output <pmx> [--target-ratio 0.5] [--target-tri <absoluteTri>] [--lock-morph true] [--lock-seams true] [--lock-materials "7,8,9,10,11,12,13"] [--skip-threshold <n>] [--quality-first]
// 默认目标：未给 --target-tri / --target-ratio 时按 5 万面（targetTriangles 默认 50000）；
// 跳过阈值：--skip-threshold N 独立于目标（默认 50000），totalTri ≤ targetTri 且 ≤ skipThreshold 时跳过 QEM 透传输入。
// 质量优先：--quality-first 自动抬升保守参数（minRetention → 0.5、targetRatio → max(targetRatio, 0.7)），
//           显式传参（如 --min-retention 0.2 / --target-ratio 0.9）优先于 quality-first 设置的默认值。
// 输出：stdout 打印统计 JSON

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPmx } from '../lib/pmx-loader.mjs';
import { buildLockedSet } from './lock-set.mjs';
import { triangulateFaces, collapseMesh } from './qem.mjs';
import { locateSections, buildDecimatedPmx } from './pmx-writer.mjs';

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--input') args.input = argv[++i];
        else if (a === '--output') args.output = argv[++i];
        else if (a === '--target-ratio') args.targetRatio = parseFloat(argv[++i]);
        else if (a === '--target-tri') { args.targetTriangles = parseInt(String(argv[++i]).replace(/,/g, ''), 10); args.targetTriGiven = true; }
        else if (a === '--lock-morph') { args.lockMorph = argv[++i] !== 'false'; args.lockMorphSet = true; }
        else if (a === '--lock-seams') args.lockSeams = argv[++i] !== 'false';
        else if (a === '--lock-materials') {
            args.lockMaterials = String(argv[++i])
                .split(',')
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => Number.isInteger(n) && n >= 0);
            if (!args.lockMaterials.length) args.lockMaterials = null;
        }
        else if (a === '--min-retention') args.minRetention = parseFloat(argv[++i]);
        else if (a === '--lock-small-materials') args.lockSmallMaterials = argv[++i] !== 'false';
        else if (a === '--skip-threshold') args.skipThreshold = parseInt(String(argv[++i]).replace(/,/g, ''), 10);
        else if (a === '--quality-first') args.qualityFirst = true;
    }
    // 只给了 --target-ratio（未给 --target-tri）→ 比例模式：显式置 targetTriangles=null，
    // 避免 reduceFaces 的默认目标 50000 覆盖比例目标。
    if (args.targetTriGiven !== true && args.targetRatio !== undefined) args.targetTriangles = null;
    // 必填项 + 数值项校验（非法即明确报错退出，避免静默 NaN 减面）
    if (!args.input || !args.output) {
        console.error('usage: node reduce.mjs --input <pmx> --output <pmx> [--target-ratio 0.5] [--target-tri <absoluteTri>] [--lock-morph true] [--lock-seams true] [--lock-materials "7,8,9,10,11,12,13"] [--min-retention 0.3] [--lock-small-materials true|false] [--quality-first]');
        process.exit(1);
    }
    for (const [name, val] of [['--target-ratio', args.targetRatio], ['--target-tri', args.targetTriangles], ['--min-retention', args.minRetention], ['--skip-threshold', args.skipThreshold]]) {
        if (val !== undefined && val !== null && !Number.isFinite(val)) {
            console.error(`invalid numeric value for ${name}: ${String(val)}`);
            process.exit(1);
        }
    }
    return args;
}

export function reduceFaces(rawOpts = {}) {
    // quality-first：只在未显式给定时抬升默认值（显式参数优先，可覆盖 quality-first 设置的保守值）
    const opts = { ...rawOpts };
    if (opts.qualityFirst) {
        if (!('minRetention' in opts)) opts.minRetention = 0.5;
        opts.targetRatio = Math.max(opts.targetRatio ?? 0.5, 0.7);
    }
    const {
        input,
        output,
        targetRatio = 0.5,
        targetTriangles = 50000,
        lockMorph = true,
        lockSeams = true,
        lockMaterials = null,
        minRetention = 0.3,
        lockSmallMaterials = true,
        skipThreshold = 50000,
        qualityFirst = false,
    } = opts;
    const t0 = Date.now();
    const model = loadPmx(input, false);

    // 三角化（mmdparser faces 已全三角形；防御性拆 quad）
    const triangles = triangulateFaces(model.faces);
    const totalTri = triangles.length;
    // --target-tri 与 --target-ratio 并存时，--target-tri 优先；
    // 两者都未给出（默认）→ 目标 = 50000（≤5 万面模型直接跳过，不再被 0.5 比例硬削）
    const targetTri = targetTriangles != null ? targetTriangles : Math.ceil(totalTri * targetRatio);

    // 锁定顶点集（morph 引用 + 空间重合接缝 + 材质级锁定）
    const locked = buildLockedSet(model.vertices, model.morphs, {
        lockMorph,
        lockSeams,
        lockMaterials,
        faces: model.faces,
        materials: model.materials,
    });

    // 受保护材质列表（材质级锁定）：index + origTri，便于验证保留率
    const protectedMaterials = lockMaterials && lockMaterials.length
        ? lockMaterials.map((mi) => ({
              index: mi,
              origTri: model.materials[mi] ? model.materials[mi].faceCount : 0,
          }))
        : [];

    // 跳过 QEM 的判定 = 目标已达成(totalTri ≤ targetTri,含默认 50000)且 totalTri ≤ skipThreshold(跳过阈值,
    // 默认 50000,demo 传 10000)→ 直接透传输入文件(字节级一致)，
    // stats 如实标记 skipped/lockedCount；不调 collapseMesh，不影响 qem.mjs 质量 reject 逻辑。
    if (totalTri <= targetTri && totalTri <= skipThreshold) {
        fs.copyFileSync(input, output);
        return {
            input,
            output,
            originalVertices: model.metadata.vertexCount,
            newVertices: model.metadata.vertexCount,
            originalTriangles: totalTri,
            newTriangles: totalTri,
            targetTriangles: targetTri,
            skipThreshold,
            lockedCount: locked.size,
            lockMaterials: lockMaterials || [],
            protectedMaterials,
            minRetention,
            lockSmallMaterials,
            qualityFirst,
            materialProtection: [],
            patchedHoles: 0,
            patchedTriangles: 0,
            reductionRatio: 0,
            reductionMet: true,
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
            skipped: true,
            durationMs: Date.now() - t0,
            perMaterial: model.materials.map((m, i) => ({ index: i, name: m.name, origTri: m.faceCount, newTri: m.faceCount })),
        };
    }

    // 材质→三角形归属：按材质 faceCount 累计偏移生成每三角形材质索引（与 triangles 平行）。
    // 供 collapseMesh 做小材质全锁 + min-retention 动态保护。
    let triMaterials = null;
    if (model.materials && model.materials.length) {
        triMaterials = new Uint16Array(triangles.length);
        let off = 0;
        for (let mi = 0; mi < model.materials.length; mi++) {
            const cnt = model.materials[mi].faceCount || 0;
            triMaterials.fill(mi, off, off + cnt);
            off += cnt;
        }
        // 防御：若 triangulateFaces 拆出比 faceCount 更多的三角形（quad），多余归最后材质
        if (off < triMaterials.length) triMaterials.fill(model.materials.length - 1, off);
    }

    // QEM 边折叠（targetRatio < 1 时丢弃输入已有的退化三角形，roundtrip 保留原样）
    const { vertices, triangles: newTriangles, patchedTris = [], indexMap, keptTriIndices, stats } = collapseMesh({
        vertices: model.vertices,
        triangles,
        locked,
        targetTriangles: targetTri,
        dropDegenerate: targetRatio < 1.0,
        triMaterials,
        minRetention,
        lockSmallMaterials,
    });

    // 每材质新三角形数：keptTriIndices 保留原三角形顺序（材质按原范围连续排列），
    // 直接按材质 faceCount 累计存活三角形数量
    const materialTriCounts = new Array(model.materials.length).fill(0);
    {
        const keptSet = new Set(keptTriIndices);
        let src = 0;
        for (let mi = 0; mi < model.materials.length; mi++) {
            const count = model.materials[mi].faceCount;
            let kept = 0;
            for (let k = 0; k < count; k++) {
                if (keptSet.has(src + k)) kept++;
            }
            materialTriCounts[mi] = kept;
            src += count;
        }
        const sum = materialTriCounts.reduce((s, c) => s + c, 0);
        if (sum !== newTriangles.length) {
            // eslint-disable-next-line no-console
            console.error(`[warn] material tri sum ${sum} != newTriangles ${newTriangles.length}`);
        }
    }

    // fix10 补面三角形合并：插入对应材质段末尾（保持材质连续，writer 按 faceCount 顺序写 faces）。
    const finalTriangles = [];
    const finalMaterialTriCounts = new Array(model.materials.length).fill(0);
    {
        const buckets = [];
        let off = 0;
        for (let mi = 0; mi < model.materials.length; mi++) {
            const cnt = materialTriCounts[mi] || 0;
            buckets.push(newTriangles.slice(off, off + cnt));
            off += cnt;
        }
        for (const pt of patchedTris) {
            const mi = pt.material;
            if (mi >= 0 && mi < buckets.length) buckets[mi].push(pt.indices);
            else buckets[buckets.length - 1].push(pt.indices);
        }
        for (let mi = 0; mi < buckets.length; mi++) {
            finalMaterialTriCounts[mi] = buckets[mi].length;
            for (const t of buckets[mi]) finalTriangles.push(t);
        }
    }

    // 字节级重写
    const buf = fs.readFileSync(input);
    const sections = locateSections(buf, model.metadata);
    const out = buildDecimatedPmx(buf, sections, model.metadata, {
        vertices,
        triangles: finalTriangles,
        materialTriCounts: finalMaterialTriCounts,
        indexMap,
    });
    fs.writeFileSync(output, out);

    const reduction = (1 - finalTriangles.length / totalTri) * 100;
    const result = {
        input,
        output,
        originalVertices: model.metadata.vertexCount,
        newVertices: vertices.length,
        originalTriangles: totalTri,
        newTriangles: finalTriangles.length,
        targetTriangles: targetTri,
        skipThreshold,
        lockedCount: locked.size,
        lockMaterials: lockMaterials || [],
        protectedMaterials,
        minRetention,
        lockSmallMaterials,
        qualityFirst,
        materialProtection: stats.protectedStats || [],
        patchedHoles: stats.patchedHoles || 0,
        patchedTriangles: stats.patchedTriangles || 0,
        reductionRatio: reduction,
        reductionMet: finalTriangles.length <= targetTri,
        collapses: stats.collapses,
        rejected: stats.rejected,
        shapeRejects: stats.shapeRejects,
        linkRejects: stats.linkRejects,
        holeRejects: stats.holeRejects,
        foldOverRejects: stats.foldOverRejects,
        protrudeRejects: stats.protrudeRejects,
        sizeRejects: stats.sizeRejects,
        materialRejects: stats.materialRejects,
        newHoleEdges: stats.newHoleEdges,
        durationMs: Date.now() - t0,
        perMaterial: model.materials.map((m, i) => ({ index: i, name: m.name, origTri: m.faceCount, newTri: finalMaterialTriCounts[i] })),
    };
    return result;
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = parseArgs(process.argv.slice(2));
    if (args.lockMorphSet && args.lockMorph === false) {
        // --lock-morph false：morph 引用顶点不锁定，被移除顶点的 morph 元素会在重写时丢弃（stderr 提示，不影响 stdout JSON）
        console.error("[warn] --lock-morph false: morph-referenced vertices are not locked; removed vertices' morph elements will be dropped");
    }
    try {
        const result = reduceFaces(args);
        console.log(JSON.stringify(result));
    } catch (e) {
        console.error('reduce failed: ' + (e && e.stack ? e.stack : e));
        process.exit(1);
    }
}
