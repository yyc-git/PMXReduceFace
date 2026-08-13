#!/usr/bin/env node
// reduce.mjs — PMX 减面主入口（QEM 约束边折叠）
// 用法：node reduce.mjs --input <pmx> --output <pmx> [--target-ratio 0.5] [--lock-morph true] [--lock-seams true] [--lock-materials "7,8,9,10,11,12,13"]
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
        else if (a === '--target-tri') args.targetTriangles = parseInt(String(argv[++i]).replace(/,/g, ''), 10);
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
    }
    // 必填项 + 数值项校验（非法即明确报错退出，避免静默 NaN 减面）
    if (!args.input || !args.output) {
        console.error('usage: node reduce.mjs --input <pmx> --output <pmx> [--target-ratio 0.5] [--target-tri <absoluteTri>] [--lock-morph true] [--lock-seams true] [--lock-materials "7,8,9,10,11,12,13"] [--min-retention 0.3] [--lock-small-materials true|false]');
        process.exit(1);
    }
    for (const [name, val] of [['--target-ratio', args.targetRatio], ['--target-tri', args.targetTriangles], ['--min-retention', args.minRetention]]) {
        if (val !== undefined && !Number.isFinite(val)) {
            console.error(`invalid numeric value for ${name}: ${String(val)}`);
            process.exit(1);
        }
    }
    return args;
}

export function reduceFaces({
    input,
    output,
    targetRatio = 0.5,
    targetTriangles = null,
    lockMorph = true,
    lockSeams = true,
    lockMaterials = null,
    minRetention = 0.3,
    lockSmallMaterials = true,
}) {
    const t0 = Date.now();
    const model = loadPmx(input, false);

    // 三角化（mmdparser faces 已全三角形；防御性拆 quad）
    const triangles = triangulateFaces(model.faces);
    const totalTri = triangles.length;
    // --target-tri 与 --target-ratio 并存时，--target-tri 优先
    const targetTri = targetTriangles != null ? targetTriangles : Math.ceil(totalTri * targetRatio);

    // 锁定顶点集（morph 引用 + 空间重合接缝 + 材质级锁定）
    const locked = buildLockedSet(model.vertices, model.morphs, {
        lockMorph,
        lockSeams,
        lockMaterials,
        faces: model.faces,
        materials: model.materials,
    });

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
    const { vertices, triangles: newTriangles, indexMap, keptTriIndices, stats } = collapseMesh({
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

    // 字节级重写
    const buf = fs.readFileSync(input);
    const sections = locateSections(buf, model.metadata);
    const out = buildDecimatedPmx(buf, sections, model.metadata, {
        vertices,
        triangles: newTriangles,
        materialTriCounts,
        indexMap,
    });
    fs.writeFileSync(output, out);

    const reduction = (1 - newTriangles.length / totalTri) * 100;
    // 受保护材质列表（材质级锁定）：index + origTri，便于验证保留率
    const protectedMaterials = lockMaterials && lockMaterials.length
        ? lockMaterials.map((mi) => ({
              index: mi,
              origTri: model.materials[mi] ? model.materials[mi].faceCount : 0,
          }))
        : [];
    const result = {
        input,
        output,
        originalVertices: model.metadata.vertexCount,
        newVertices: vertices.length,
        originalTriangles: totalTri,
        newTriangles: newTriangles.length,
        targetTriangles: targetTri,
        lockedCount: locked.size,
        lockMaterials: lockMaterials || [],
        protectedMaterials,
        minRetention,
        lockSmallMaterials,
        materialProtection: stats.protectedStats || [],
        reductionRatio: reduction,
        reductionMet: newTriangles.length <= targetTri,
        collapses: stats.collapses,
        rejected: stats.rejected,
        shapeRejects: stats.shapeRejects,
        linkRejects: stats.linkRejects,
        holeRejects: stats.holeRejects,
        foldOverRejects: stats.foldOverRejects,
        protrudeRejects: stats.protrudeRejects,
        materialRejects: stats.materialRejects,
        durationMs: Date.now() - t0,
        perMaterial: model.materials.map((m, i) => ({ index: i, name: m.name, origTri: m.faceCount, newTri: materialTriCounts[i] })),
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
