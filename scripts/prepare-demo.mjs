// prepare-demo.mjs — Demo 素材预生成：对 demo/assets 下的 3 个模型分别跑 reduce.mjs 生成 4 档 LOD，
// 并把每档的顶点数/三角形数/材质数/减面率/perMaterial 统计 dump 到 demo/assets/stats.json
// 用法：node scripts/prepare-demo.mjs
// 产物：demo/assets/<baseDir><model>.LOD100/70/55/50.pmx + demo/assets/stats.json（demo 页面 HUD 读取）
// 说明：XiaoMei 已有 LOD 全平铺在 demo/assets/（LOD100/70/55/50），直接复用不重新生成；
//       Xiaye1 / XiaHui 为子目录输出（baseDir = Xiaye1/ / XiaHui/），LOD 写到各自子目录。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REDUCE = path.join(ROOT, 'src/tool/pmx-face-reduce/reduce.mjs');
const ASSETS = path.join(ROOT, 'demo/assets');
const STATS_JSON = path.join(ASSETS, 'stats.json');

// 跳过阈值（demo 用 1 万面）：totalTri ≤ targetTri 且 ≤ skipThreshold 才跳过 QEM 透传输入。
// 默认 50000 保持（reduce.mjs 内），demo 的 LOD 生成显式传 10000，让 1 万~5 万面的小模型也走 QEM。
const SKIP_THRESHOLD = 10000;

// 全部 LOD 档位统一加 --quality-first：minRetention 抬到 0.5、targetRatio 抬到 max(ratio, 0.7)，
// 减面率上限 30%，避免 LOD55/50 过度削面破坏质量（显式 --target-ratio 仍可覆盖，见 reduce.mjs）。

// LOD 档位（质量优先，第五轮）：targetRatio 1.0 / 0.7 / 0.55 / 0.5 → LOD_100 / LOD_70 / LOD_55 / LOD_50。
// 放弃「LOD25/10」名不副实的档位：质量守卫（sliver/拓扑/翻转/突起+cap）把减面地板抬到 ≈33493
// （>27114），LOD55/50 名义比例低于地板 → 贴地板（HUD 显示「已到保护下限」）。
const LODS = [
    { name: 'LOD_100', label: 'LOD 100%', targetRatio: 1.0 },
    { name: 'LOD_70', label: 'LOD 70%', targetRatio: 0.7 },
    { name: 'LOD_55', label: 'LOD 55%', targetRatio: 0.55 },
    { name: 'LOD_50', label: 'LOD 50%', targetRatio: 0.5 },
];

// 模型注册表：key（demo main.ts 的 curModelKey）/ label / 文件名 / baseDir（相对 demo/assets/）
// XiaoMei 平铺在 assets/ 且已有 LOD（reuseExisting: true，直接复用 stats 不再跑 reduce）。
const MODELS = [
    {
        key: 'XiaoMei',
        label: 'XiaoMei (孙晓美)',
        fileName: 'XiaoMeiOriginFix_02_elrein.pmx',
        baseDir: '',
        reuseExisting: true,
    },
    {
        key: 'Xiaye1',
        label: 'Xiaye1 (夏夜1)',
        fileName: 'Tda HMS illustrious Prom Dress Ver1.00 [Silver].pmx',
        baseDir: 'Xiaye1/',
    },
    {
        key: 'XiaHui',
        label: 'XiaHui (夏卉)',
        fileName: 'TDA Utage CORAL COAST.pmx',
        baseDir: 'XiaHui/',
    },
];

function lodOutFile(model, lod) {
    // fileName 含 .pmx（input 需要），LOD 文件名 = 去扩展名 + .LOD<n>.pmx（与 main.ts MODEL_LODS_MAP 对齐）
    const base = model.fileName.replace(/\.pmx$/i, '');
    return `${base}.${lod.name.replace('LOD_', 'LOD')}.pmx`;
}

function runReduce(model, lod) {
    const inputPath = path.join(ASSETS, model.baseDir, model.fileName);
    const outFile = lodOutFile(model, lod);
    const outputPath = path.join(ASSETS, model.baseDir, outFile);
    const args = [
        '--input', inputPath,
        '--output', outputPath,
        '--target-ratio', String(lod.targetRatio),
        '--skip-threshold', String(SKIP_THRESHOLD),
        '--quality-first',
    ];
    const res = spawnSync(process.execPath, [REDUCE, ...args], { encoding: 'utf-8', timeout: 600000 });
    if (res.status !== 0) {
        throw new Error(`reduce.mjs failed (${model.key} ${lod.name}):\n${String(res.stderr || '').slice(-2000)}`);
    }
    let stats = null;
    try {
        stats = JSON.parse(res.stdout.trim());
    } catch (e) {
        throw new Error(`reduce.mjs stdout not JSON (${model.key} ${lod.name}): ${String(res.stdout || '').slice(-2000)}`);
    }
    return { outFile, outputPath, stats };
}

function buildLodEntries(model) {
    const lods = [];
    for (const lod of LODS) {
        const t0 = Date.now();
        const { outFile, stats } = runReduce(model, lod);
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
            skipThreshold: stats.skipThreshold,
            materials,
            reductionRatio: stats.reductionRatio,
            reductionMet: stats.reductionMet,
            skipped: stats.skipped === true,
            perMaterial: stats.perMaterial || [],
            durationMs: stats.durationMs,
        };
        lods.push(entry);
        console.log(
            `[prepare-demo] ${model.key.padEnd(8)} ${lod.name.padEnd(8)} ratio=${String(lod.targetRatio).padEnd(4)} ` +
            `v=${String(stats.newVertices).padStart(6)} tri=${String(stats.newTriangles).padStart(7)} ` +
            `mat=${materials} reduce=${stats.reductionRatio.toFixed(2)}% (${Date.now() - t0}ms)`
        );
    }
    return lods;
}

// ---------- 主流程 ----------
// XiaoMei 已有 LOD：复用 stats.json 里 XiaoMei 的数据（兼容旧格式 { model, original, lods }
// 与本次新格式 { models: [...] }，避免误重新生成覆盖已有 LOD 文件）
function loadLegacyXiaoMei() {
    if (!fs.existsSync(STATS_JSON)) return null;
    try {
        const old = JSON.parse(fs.readFileSync(STATS_JSON, 'utf-8'));
        if (old && Array.isArray(old.models)) {
            const entry = old.models.find((m) => m.model === 'XiaoMei');
            if (entry && Array.isArray(entry.lods) && entry.lods.length) {
                return { original: entry.original || null, lods: entry.lods };
            }
        }
        if (old && old.model && Array.isArray(old.lods) && old.lods.length) {
            return { original: old.original || null, lods: old.lods };
        }
    } catch (e) {
        console.warn(`[prepare-demo] 旧 stats.json 解析失败，XiaoMei 将重新生成：${String(e)}`);
    }
    return null;
}

const modelsStats = [];
for (const model of MODELS) {
    const inputPath = path.join(ASSETS, model.baseDir, model.fileName);
    if (!fs.existsSync(inputPath)) {
        console.error(`[prepare-demo] 模型不存在：${path.relative(ROOT, inputPath)}`);
        console.error('[prepare-demo] 请把原版 PMX + 纹理放入 demo/assets/ 后重试');
        process.exit(1);
    }
    console.log(`[prepare-demo] 模型：${model.key}（${path.relative(ROOT, inputPath)}）`);

    let original = null;
    let lods = [];
    if (model.reuseExisting) {
        const legacy = loadLegacyXiaoMei();
        if (legacy) {
            original = legacy.original;
            lods = legacy.lods;
            console.log(`[prepare-demo] ${model.key} 复用已有 LOD（${lods.length} 档，demo/assets/ 平铺）`);
        }
    }
    if (!lods.length) {
        console.log(`[prepare-demo] 生成 ${LODS.length} 档 LOD（reduce.mjs，--skip-threshold ${SKIP_THRESHOLD}）...`);
        lods = buildLodEntries(model);
        const orig = lods[0];
        original = {
            vertices: orig.originalVertices,
            triangles: orig.originalTriangles,
            materials: orig.materials,
        };
    }

    modelsStats.push({
        model: model.key,
        label: model.label,
        file: model.baseDir + model.fileName,
        baseDir: model.baseDir,
        original,
        lods,
    });
}

const statsJson = {
    models: modelsStats,
    generatedAt: new Date().toISOString(),
    generator: 'scripts/prepare-demo.mjs → reduce.mjs',
    skipThreshold: SKIP_THRESHOLD,
};

fs.writeFileSync(STATS_JSON, JSON.stringify(statsJson, null, 2) + '\n');
console.log(`[prepare-demo] 完成：stats → ${path.relative(ROOT, STATS_JSON)}（${MODELS.length} 个模型）`);
