// prepare-demo.mjs — Demo 素材预生成：对 demo/assets 的原版 PMX 依次跑 reduce.mjs 生成 4 档 LOD，
// 并把每档的顶点数/三角形数/材质数/减面率/perMaterial 统计 dump 到 demo/assets/stats.json
// 用法：node scripts/prepare-demo.mjs
// 产物：demo/assets/<model>.LOD100/50/25/10.pmx + demo/assets/stats.json（demo 页面 HUD 读取）

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REDUCE = path.join(ROOT, 'src/tool/pmx-face-reduce/reduce.mjs');
const ASSETS = path.join(ROOT, 'demo/assets');

// 原版模型（demo 素材，pmx 与 tex/ 同目录，纹理相对路径自动解析）
const MODEL_NAME = 'XiaoMeiOriginFix_02_elrein';
const INPUT_PMX = path.join(ASSETS, `${MODEL_NAME}.pmx`);
const STATS_JSON = path.join(ASSETS, 'stats.json');

// LOD 档位：targetRatio 1.0 / 0.5 / 0.25 / 0.1 → LOD_100 / LOD_50 / LOD_25 / LOD_10
const LODS = [
    { name: 'LOD_100', label: 'LOD 100%', targetRatio: 1.0 },
    { name: 'LOD_50', label: 'LOD 50%', targetRatio: 0.5 },
    { name: 'LOD_25', label: 'LOD 25%', targetRatio: 0.25 },
    { name: 'LOD_10', label: 'LOD 10%', targetRatio: 0.1 },
];

function runReduce(lod) {
    const outFile = `${MODEL_NAME}.${lod.name.replace('LOD_', 'LOD')}.pmx`;
    const outputPath = path.join(ASSETS, outFile);
    const args = ['--input', INPUT_PMX, '--output', outputPath, '--target-ratio', String(lod.targetRatio)];
    const res = spawnSync(process.execPath, [REDUCE, ...args], { encoding: 'utf-8', timeout: 600000 });
    if (res.status !== 0) {
        throw new Error(`reduce.mjs failed (${lod.name}):\n${String(res.stderr || '').slice(-2000)}`);
    }
    let stats = null;
    try {
        stats = JSON.parse(res.stdout.trim());
    } catch (e) {
        throw new Error(`reduce.mjs stdout not JSON (${lod.name}): ${String(res.stdout || '').slice(-2000)}`);
    }
    return { outFile, outputPath, stats };
}

// ---------- 主流程 ----------
if (!fs.existsSync(INPUT_PMX)) {
    console.error(`[prepare-demo] 模型不存在：${INPUT_PMX}`);
    console.error('[prepare-demo] 请把原版 PMX + tex/ 放入 demo/assets/ 后重试');
    process.exit(1);
}

console.log(`[prepare-demo] 原版模型：${path.relative(ROOT, INPUT_PMX)}`);
console.log(`[prepare-demo] 生成 ${LODS.length} 档 LOD（reduce.mjs）...`);

const lods = [];
for (const lod of LODS) {
    const t0 = Date.now();
    const { outFile, outputPath, stats } = runReduce(lod);
    const materials = (stats.perMaterial || []).length;
    const entry = {
        name: lod.name,
        label: lod.label,
        targetRatio: lod.targetRatio,
        file: outFile,
        vertices: stats.newVertices,
        triangles: stats.newTriangles,
        originalVertices: stats.originalVertices,
        originalTriangles: stats.originalTriangles,
        targetTriangles: stats.targetTriangles,
        materials,
        reductionRatio: stats.reductionRatio,
        reductionMet: stats.reductionMet,
        perMaterial: stats.perMaterial || [],
        durationMs: stats.durationMs,
    };
    lods.push(entry);
    console.log(
        `[prepare-demo] ${lod.name.padEnd(8)} ratio=${String(lod.targetRatio).padEnd(4)} ` +
        `v=${String(stats.newVertices).padStart(6)} tri=${String(stats.newTriangles).padStart(7)} ` +
        `mat=${materials} reduce=${stats.reductionRatio.toFixed(2)}% (${Date.now() - t0}ms)`
    );
}

// original 统计以 LOD_100（roundtrip）为准，与源码 metadata 一致
const orig = lods[0];
const statsJson = {
    model: MODEL_NAME,
    file: `${MODEL_NAME}.pmx`,
    generatedAt: new Date().toISOString(),
    generator: 'scripts/prepare-demo.mjs → reduce.mjs',
    original: {
        vertices: orig.originalVertices,
        triangles: orig.originalTriangles,
        materials: orig.materials,
    },
    lods,
};

fs.writeFileSync(STATS_JSON, JSON.stringify(statsJson, null, 2) + '\n');
console.log(`[prepare-demo] 完成：stats → ${path.relative(ROOT, STATS_JSON)}`);
console.log(`[prepare-demo] 生成 ${LODS.length} 个 LOD PMX（demo/assets/）`);
