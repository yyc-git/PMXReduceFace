// real-model-check.mjs — 真实模型可选集成检查（§6.3）
// 对指定 PMX 跑 reduce.mjs + verify.mjs，输出 JSON 报告；无参数时默认用 demo/assets 的原版模型。
// 不纳入 test:bdd（真实模型较大，非合成 fixture，跑一次耗时较长）。
// 用法：
//   node scripts/real-model-check.mjs                          # 默认 demo/assets 模型，--target-ratio 0.5
//   node scripts/real-model-check.mjs --input x.pmx            # 指定模型
//   node scripts/real-model-check.mjs --input x.pmx --target-ratio 0.55 --keep
// 选项：
//   --input <pmx>        要检查的模型（默认 demo/assets/XiaoMeiOriginFix_02_elrein.pmx）
//   --output <pmx>       减面产物路径（默认 os.tmpdir() 临时文件，不污染仓库）
//   --target-ratio <n>   减面目标比例（默认 0.5）
//   --keep               保留减面产物（默认结束后删除临时文件）
//   --skip-quality       跳过视觉质量断言（BurumaSet 尺寸/指尖突起/跨曲面超尺寸/非流形/袜区洞）
// 注意（质量优先，第六轮）：质量守卫把 demo 模型减面地板抬到 ≈38686（> 名义目标 27114）→
// reductionMet=false、verify triWithinTarget=false，属预期（「质量优先允许 reductionMet=false」，
// verify 的 ok 已不含 triWithinTarget）；其余质量检查（BurumaSet 面积 p99 ≤ 1.5× / maxL p90 ≤ 1.5× /
// 指尖突起形态 / 跨曲面新增超尺寸 = 0 / 非流形 0 / 袜区无新增洞）应全绿。
// 输出：stdout JSON { ok, input, output, targetRatio, reduce, verify, quality }；全绿 exit 0，否则 exit 1

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REDUCE = path.join(ROOT, 'src/tool/pmx-face-reduce/reduce.mjs');
const VERIFY = path.join(ROOT, 'src/tool/pmx-face-reduce/verify.mjs');
const DEFAULT_INPUT = path.join(ROOT, 'demo/assets/XiaoMeiOriginFix_02_elrein.pmx');
// 视觉质量断言项（与 verify.mjs QUALITY_CHECKS 对应；qualityChecksActive=false 时跳过并 warning）
const QUALITY_KEYS = [
    'burumaAreaP99Growth',
    'burumaMaxLP90Growth',
    'fingertipProtrudeShape',
    'noNewOversizeTriangles',
    'noNonManifoldEdges',
    'noNewHoles',
];

function parseArgs(argv) {
    const args = { input: null, output: null, targetRatio: 0.5, targetTri: null, keep: false, skipQuality: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--input') args.input = argv[++i];
        else if (a === '--output') args.output = argv[++i];
        else if (a === '--target-ratio') args.targetRatio = parseFloat(argv[++i]);
        else if (a === '--target-tri') args.targetTri = parseInt(String(argv[++i]).replace(/,/g, ''), 10);
        else if (a === '--keep') args.keep = true;
        else if (a === '--skip-quality') args.skipQuality = true;
        else if (!a.startsWith('-') && !args.input) args.input = a; // 兼容位置参数
    }
    return args;
}

function runReduce(args) {
    const extra = [];
    if (args.targetTri != null) extra.push('--target-tri', String(args.targetTri));
    const res = spawnSync(process.execPath, [REDUCE, '--input', args.input, '--output', args.output, '--target-ratio', String(args.targetRatio), ...extra], { encoding: 'utf-8', timeout: 600000 });
    let stats = null;
    try {
        stats = JSON.parse(res.stdout.trim());
    } catch (e) {
        stats = { stdoutTail: String(res.stdout || '').slice(-500), stderrTail: String(res.stderr || '').slice(-500) };
    }
    return { exit: res.status, stats, stderr: String(res.stderr || '').slice(-500) };
}

function runVerify(args) {
    const extra = [];
    if (args.targetTri != null) extra.push('--target-tri', String(args.targetTri));
    const res = spawnSync(process.execPath, [VERIFY, args.input, args.output, '--target-ratio', String(args.targetRatio), ...extra], { encoding: 'utf-8', timeout: 600000 });
    let report = null;
    try {
        report = JSON.parse(res.stdout.trim());
    } catch (e) {
        report = { ok: false, stdoutTail: String(res.stdout || '').slice(-500), stderrTail: String(res.stderr || '').slice(-500) };
    }
    return { exit: res.status, report };
}

// ---------- 主流程 ----------
const args = parseArgs(process.argv.slice(2));
args.input = path.resolve(args.input || DEFAULT_INPUT);

if (!fs.existsSync(args.input)) {
    console.error(`[real-model-check] 模型不存在：${args.input}`);
    process.exit(1);
}

const tempOutput = !args.output;
const output = args.output || path.join(os.tmpdir(), `pmx-reduce-face-realcheck-${Date.now()}.pmx`);

console.error(`[real-model-check] input: ${args.input}`);
console.error(`[real-model-check] output: ${output} (target-ratio=${args.targetRatio}${args.targetTri != null ? `, target-tri=${args.targetTri}` : ''})`);

const reduce = runReduce({ input: args.input, output, targetRatio: args.targetRatio, targetTri: args.targetTri });
const verify = reduce.exit === 0
    ? runVerify({ input: args.input, output, targetRatio: args.targetRatio, targetTri: args.targetTri })
    : { exit: -1, report: { ok: false, error: 'reduce failed, verify skipped' } };

if (!args.keep && fs.existsSync(output)) {
    fs.unlinkSync(output);
}

// ---------- 视觉质量断言段（fix6-plan §4.1） ----------
const vchecks = (verify.report && verify.report.checks) || {};
let qualityOk = true;
const quality = { active: vchecks.qualityChecksActive === true };
if (args.skipQuality) {
    quality.skipped = true;
} else if (vchecks.qualityChecksActive !== true) {
    // 无 BurumaSet 材质（自定义 --input 常见）：质量项跳过并输出 warning，不判失败
    quality.skipped = 'no BurumaSet material';
    console.error('[real-model-check] quality checks skipped: input has no BurumaSet material');
    if (!args.input) {
        qualityOk = false;
        quality.error = 'default model missing BurumaSet material';
    }
} else {
    const results = {};
    for (const k of QUALITY_KEYS) results[k] = vchecks[k] === true;
    quality.checks = results;
    qualityOk = QUALITY_KEYS.every((k) => vchecks[k] === true);
    if (!qualityOk) {
        console.error('[real-model-check] quality checks FAILED:');
        for (const k of QUALITY_KEYS) console.error(`  ${k}: ${String(vchecks[k])}`);
    }
}
quality.verifyQuality = verify.report && verify.report.quality ? verify.report.quality : null;

const report = {
    ok: reduce.exit === 0 && verify.exit === 0 && verify.report.ok === true && qualityOk,
    input: args.input,
    output,
    targetRatio: args.targetRatio,
    targetTri: args.targetTri,
    keepOutput: !!args.output || args.keep,
    skipQuality: args.skipQuality,
    reduce: {
        exit: reduce.exit,
        stats: reduce.stats,
    },
    verify: {
        exit: verify.exit,
        report: verify.report,
    },
    quality,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
