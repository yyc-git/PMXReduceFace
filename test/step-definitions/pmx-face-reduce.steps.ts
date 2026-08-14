import { defineFeature, loadFeature } from 'jest-cucumber';
import { execSync } from 'child_process';
import * as path from 'path';

const feature = loadFeature('test/features/pmx-face-reduce.feature');

// 字段与 test/helpers/pmx-face-reduce-check.mjs 输出的 facts JSON 对齐
interface PerMaterialStat {
  index: number;
  name: string;
  origTri: number;
  newTri: number;
}
interface MaterialProtectionStat {
  materialIndex: number;
  origTri: number;
  minTri: number;
  finalTri: number;
  protected: string;
}
interface ReduceStats {
  input: string;
  output: string;
  originalVertices: number;
  newVertices: number;
  originalTriangles: number;
  newTriangles: number;
  targetTriangles: number;
  lockedCount: number;
  lockMaterials: number[];
  protectedMaterials: Array<{ index: number; origTri: number }>;
  minRetention: number;
  lockSmallMaterials: boolean;
  materialProtection: MaterialProtectionStat[];
  reductionRatio: number;
  reductionMet: boolean;
  collapses: number;
  rejected: number;
  protrudeRejects?: number;
  newHoleEdges?: number;
  durationMs: number;
  perMaterial: PerMaterialStat[];
}
interface VerifyStats {
  originalVertices: number;
  newVertices: number;
  originalTriangles: number;
  newTriangles: number;
  targetTriangles: number;
  lockedCount: number;
  reductionRatio: number;
  minNormalLength: number | null;
  maxNormalLength: number;
  durationMs: number;
}
interface VerifyChecks {
  parseable: boolean;
  vertexReduced: boolean;
  triWithinTarget: boolean;
  lockedVertsPreserved: boolean;
  lockedCount: number;
  morphIndicesValid: boolean;
  morphMappingCorrect: boolean;
  morphApplyCorrect: boolean;
  noDegenerateTriangles: boolean;
  noDuplicateTriangles: boolean;
  everyNonLockedVertexUsed: boolean;
  weightsNormalized: boolean;
  normalsUnitLength: boolean;
  materialSumConsistent: boolean;
  headerConsistent: boolean;
  protectedRetention?: boolean;
  materialRetentionOk: boolean;
}
interface VerifyReport {
  ok: boolean;
  checks: VerifyChecks;
  errorCount: number;
  errors: string[];
  stats: VerifyStats | null;
  perMaterial: PerMaterialStat[];
}
interface FixtureSelfCheck {
  vertexCount: boolean;
  faceCount: boolean;
  materialCount: boolean;
  materialFaceCounts: boolean;
  morphCount: boolean;
  seamLockedVerts: boolean;
}
interface Facts {
  inputExists: boolean;
  fixtureSelfCheck: FixtureSelfCheck;
  originalVertices: number;
  originalTriangles: number;
  originalMaterials: number;
  originalMaterialFaceCounts: number[];
  originalHashBefore: string;
  originalHashAfter: string;
  originalHashUnchanged: boolean;
  outputPath05: string;
  outputExists: boolean;
  outputNonEmpty: boolean;
  targetTriangles: number;
  reduce05Exit: number;
  reduce05Stats: ReduceStats;
  reduce05Stderr: string;
  verify05Exit: number;
  verify05: VerifyReport;
  outParseable: boolean;
  outVertexCount: number;
  outTriCount: number;
  reduce10Exit: number;
  roundtripParseable: boolean;
  roundtripVertexCount: number;
  roundtripTriCount: number;
  roundtripFirstMaterialFaceCount: number;
  roundtripFirstMaterialOrigFaceCount: number;
  reduceTriExit: number;
  reduceTriStats: ReduceStats;
  verifyTriExit: number;
  verifyTri: VerifyReport;
  reduceAutoExit: number;
  reduceAutoStats: ReduceStats;
  verifyAutoExit: number;
  verifyAuto: VerifyReport;
  reduceAutoBExit: number;
  reduceAutoBStats: ReduceStats;
  floorTriangles: number;
  reduceLockExit: number;
  reduceLockStats: ReduceStats;
  verifyLockExit: number;
  verifyLock: VerifyReport;
  reduceDegenExit: number;
  reduceDegenStats: ReduceStats;
  degenParseable: boolean;
  degenTriCount: number;
  degenNoDegenerate: boolean;
  unitSliverCollapse: {
    rejected: boolean;
    resultIsSliver: boolean;
    aspect: number;
    maxL: number;
  };
  unitNormalCollapse: {
    accepted: boolean;
    resultNotSliver: boolean;
    aspect: number;
    maxL: number;
  };
  unitSliverBand: {
    rejected: boolean;
    resultIsSliver: boolean;
    aspect: number;
    maxL: number;
  };
  unitLinkViolated: { rejected: boolean };
  unitHoleCreated: { rejected: boolean; linkPasses: boolean };
  unitTopologyNormal: { linkAccepted: boolean; holeAccepted: boolean; foldAccepted: boolean };
  unitFoldOver: { rejected: boolean; normalAccepted: boolean };
  unitProtrudeCollapse: {
    rejected: boolean;
    normalAccepted: boolean;
    protrudeMax: number;
  };
  unitFlipLock: {
    lockedMicro: boolean;
    lockCount: number;
    notMislock: boolean;
  };
  unitHoleNarrow: {
    nonCoincidentRejected: boolean;
    wrongIgnoreRejected: boolean;
    coincidentExempted: boolean;
    narrowExemptsCoincident: boolean;
    narrowRejectsOther: boolean;
  };
  unitProtrudeCap: {
    measured: number;
    inBand: boolean;
    budgetWouldAllow: boolean;
    capRejects: boolean;
    capAllowsNormal: boolean;
    capValue: number;
  };
  mixedTubeInputTri: number;
  mixedTubeInBoundary: number;
  mixedTubeInNonManifold: number;
  mixedTubeExit: number;
  mixedTubeStats: ReduceStats | null;
  mixedTubeParseable: boolean;
  mixedTubeOutTri: number;
  mixedTubeOutNewBnd: number;
  mixedTubeOutNonManifold: number;
  fingerTipInputTri: number;
  fingerTipInProtrude: number;
  fingerTipInProtrudeWorst: number;
  fingerTipInFlips: number;
  fingerTipExit: number;
  fingerTipStats: ReduceStats | null;
  fingerTipParseable: boolean;
  fingerTipOutProtrude: number;
  fingerTipOutProtrudeWorst: number;
  fingerTipOutFlips: number;
  fingerTipOutTri: number;
  sliverTubeInputTri: number;
  sliverTubeInSliverCount: number;
  sliverTubeInBoundary: number;
  sliverTubeInNonManifold: number;
  sliverTubeExit: number;
  sliverTubeStats: ReduceStats | null;
  sliverTubeParseable: boolean;
  sliverTubeOutSliverCount: number;
  sliverTubeOutWorst: { aspect: number; maxL: number };
  sliverTubeOutTri: number;
  sliverTubeOutBoundary: number;
  sliverTubeOutNonManifold: number;
  thinTubeInputTri: number;
  thinTubeInSliverCount: number;
  thinTubeExit: number;
  thinTubeStats: ReduceStats | null;
  thinTubeParseable: boolean;
  thinTubeOutSliverCount: number;
  thinTubeOutWorst: { aspect: number; maxL: number };
  thinTubeOutTri: number;
  unitOversizeCollapse: {
    highCurvOversizeRejected: boolean;
    flatGatePasses: boolean;
    inBudgetPasses: boolean;
    maxL: number;
    area: number;
    maxLBudget: number;
    areaBudget: number;
    curvMinDeg: number;
  };
  unitProtrudeBump: {
    measured: number;
    bigBumpRejected: boolean;
    legacyCompatible: boolean;
    areaBudget: number;
  };
  unitSpikeGuard: {
    measured: number;
    spikeRejected: boolean;
    smallAllowed: boolean;
    allowance: number;
    protrudeMax: number;
  };
  unitTipNewProtrude: {
    inSelf: number;
    outSame: number;
    outNew: number;
  };
  unitTouchedNormals: {
    collapses: number;
    lockedPreserved: boolean;
    preservedCount: number;
    lockedCount: number;
    allNormalsUnitLength: boolean;
    allInputUnitLength: boolean;
    redCapable: boolean;
  };
  sphereExit: number;
  sphereStats: ReduceStats | null;
  sphereParseable: boolean;
  sphereInputTri: number;
  sphereInputMaxLP95: number;
  sphereInputAreaP95: number;
  sphereBoundMaxL: number;
  sphereBoundArea: number;
  sphereOutTri: number;
  sphereOutMaxOver: { maxL: number; area: number };
  sphereOutWithinSize: boolean;
}

function runHelper(): Facts {
  const helper = path.resolve(__dirname, '..', 'helpers', 'pmx-face-reduce-check.mjs');
  const out = execSync(`node "${helper}"`, { encoding: 'utf-8', cwd: path.resolve(__dirname, '../..'), timeout: 600000 });
  return JSON.parse(out.trim());
}

let facts: Facts | null = null;
let factsLoaded = false;

defineFeature(feature, (test) => {
    // 集成 helper 较慢（合成 fixture 生成 + 7 组 reduce + verify），全 feature 只跑一次并缓存
    const ensureFacts = (): Facts => {
        if (!factsLoaded) {
            facts = runHelper();
            factsLoaded = true;
        }
        return facts!;
    };
    test('减面输出文件存在且可重新解析', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = ensureFacts();
        });
        then(/^输出 pmx 文件存在且非空$/, () => {
            expect(facts.inputExists).toBe(true);
            expect(facts.reduce05Exit).toBe(0);
            expect(facts.outputExists).toBe(true);
            expect(facts.outputNonEmpty).toBe(true);
        });
        and(/^输出文件可被 MMDParser\.parsePmx 重新解析成功$/, () => {
            expect(facts.outParseable).toBe(true);
            expect(facts.verify05Exit).toBe(0);
        });
    });

    test('面数至少减少 50%', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^输出三角形数不超过原始三角形数的一半（向上取整）$/, () => {
            const stats = facts.reduce05Stats;
            expect(stats).toBeTruthy();
            expect(stats.newTriangles).toBeLessThanOrEqual(facts.targetTriangles);
            expect(stats.newTriangles).toBeLessThan(facts.originalTriangles);
        });
        and(/^输出顶点数小于原始顶点数$/, () => {
            expect(facts.reduce05Stats.newVertices).toBeLessThan(facts.originalVertices);
        });
    });

    test('morph 引用顶点全锁定且位置不变', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^全部 morph 引用顶点在输出中存在且位置误差小于 1e-6$/, () => {
            expect(facts.verify05).toBeTruthy();
            expect(facts.verify05.checks.lockedVertsPreserved).toBe(true);
        });
        and(/^全部 morph 元素索引有效且小于新顶点数$/, () => {
            expect(facts.verify05.checks.morphIndicesValid).toBe(true);
        });
    });

    test('输出网格无退化三角形且权重归一化', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^输出无退化三角形（面积大于 1e-9）$/, () => {
            expect(facts.verify05.checks.noDegenerateTriangles).toBe(true);
        });
        and(/^输出无重复三角形$/, () => {
            expect(facts.verify05.checks.noDuplicateTriangles).toBe(true);
        });
        and(/^输出全部顶点 skinWeights 归一化（Σ≈1）$/, () => {
            expect(facts.verify05.checks.weightsNormalized).toBe(true);
        });
    });

    test('材质与 header 计数一致', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^材质 faceCount 总和等于新 faces 长度$/, () => {
            expect(facts.verify05.checks.materialSumConsistent).toBe(true);
        });
        and(/^输出 header 记录的 vertexCount 与实际一致$/, () => {
            expect(facts.verify05.checks.headerConsistent).toBe(true);
        });
    });

    test('原始 pmx 文件字节不变', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^记录原始文件 hash$/, () => {
            facts = runHelper();
        });
        and(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            // facts 已包含前后 hash（helper 内部执行）
        });
        then(/^操作后原始文件 hash 与操作前一致$/, () => {
            expect(facts.originalHashUnchanged).toBe(true);
            expect(facts.originalHashBefore).toBe(facts.originalHashAfter);
        });
    });

    test('roundtrip 零改动重写数据一致', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 1\.0）$/, () => {
            facts = runHelper();
        });
        then(/^输出顶点数与原始一致$/, () => {
            expect(facts.reduce10Exit).toBe(0);
            expect(facts.roundtripParseable).toBe(true);
            expect(facts.roundtripVertexCount).toBe(facts.originalVertices);
        });
        and(/^输出三角形数与原始一致$/, () => {
            expect(facts.roundtripTriCount).toBe(facts.originalTriangles);
        });
        and(/^输出首个材质面数与原始一致$/, () => {
            expect(facts.roundtripFirstMaterialFaceCount).toBe(facts.roundtripFirstMaterialOrigFaceCount);
        });
    });

    test('verify 断言输出全部顶点法线单位长度', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^verify 输出 checks\.normalsUnitLength 为 true$/, () => {
            expect(facts.verify05).toBeTruthy();
            expect(facts.verify05.checks.normalsUnitLength).toBe(true);
        });
        and(/^verify 输出最小\/最大法线长度均在 1 误差 1e-3 内$/, () => {
            const stats = facts.verify05.stats;
            expect(stats.minNormalLength).toBeCloseTo(1, 3);
            expect(stats.maxNormalLength).toBeCloseTo(1, 3);
        });
    });

    test('用 --target-tri 指定绝对目标三角形数', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（--target-tri 1600）$/, () => {
            facts = runHelper();
        });
        then(/^输出三角形数不超过 1600$/, () => {
            expect(facts.reduceTriExit).toBe(0);
            expect(facts.reduceTriStats).toBeTruthy();
            expect(facts.reduceTriStats.newTriangles).toBeLessThanOrEqual(1600);
        });
        and(/^验证脚本 --target-tri 1600 全绿$/, () => {
            expect(facts.verifyTriExit).toBe(0);
            expect(facts.verifyTri.ok).toBe(true);
            expect(facts.verifyTri.stats.targetTriangles).toBe(1600);
        });
    });

    test('自动材质保护下小材质全保留且大材质保留率达标', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（--min-retention 0\.3，--target-tri 1600，不带 --lock-materials）$/, () => {
            facts = runHelper();
        });
        then(/^mat3\/mat4（原始面数 ≤500）保留率等于 100%$/, () => {
            expect(facts.reduceAutoExit).toBe(0);
            expect(facts.reduceAutoStats).toBeTruthy();
            for (const mi of [3, 4]) {
                const pm = (facts.reduceAutoStats.perMaterial || []).find((x: PerMaterialStat) => x.index === mi);
                expect(pm).toBeTruthy();
                expect(pm.newTri).toBe(pm.origTri);
            }
        });
        and(/^mat0\/mat1\/mat2（原始面数 >500）保留率不低于 30%$/, () => {
            for (const mi of [0, 1, 2]) {
                const pm = (facts.reduceAutoStats.perMaterial || []).find((x: PerMaterialStat) => x.index === mi);
                expect(pm).toBeTruthy();
                expect(pm.newTri).toBeGreaterThanOrEqual(Math.floor(pm.origTri * 0.3));
            }
        });
        and(/^输出三角形数不超过 1600$/, () => {
            expect(facts.reduceAutoStats.newTriangles).toBeLessThanOrEqual(1600);
        });
        and(/^验证脚本 --min-retention 0\.3 全绿（含材质保留率断言）$/, () => {
            expect(facts.verifyAutoExit).toBe(0);
            expect(facts.verifyAuto).toBeTruthy();
            expect(facts.verifyAuto.ok).toBe(true);
            expect(facts.verifyAuto.checks.materialRetentionOk).toBe(true);
            expect(facts.verifyAuto.checks.normalsUnitLength).toBe(true);
        });
        and(/^绝对目标 1000（低于保底 1520）时输出被保底阻断：实际三角形数未达 1000 且不低于保底$/, () => {
            const stats = facts.reduceAutoBStats;
            expect(stats).toBeTruthy();
            // 保底 = 小材质 500 + 大材质下限 1020 = 1520；greedy 实测在 1521 处被阻断（非 1000）
            expect(stats.reductionMet).toBe(false);
            expect(stats.newTriangles).toBeGreaterThan(1000);
            expect(stats.newTriangles).toBeGreaterThanOrEqual(facts.floorTriangles);
            const retention = (stats.materialProtection || []).find((e: MaterialProtectionStat) => e.protected === 'retention');
            expect(retention).toBeTruthy();
            expect(retention.finalTri).toBeGreaterThanOrEqual(retention.minTri);
        });
    });

    test('--lock-materials 材质级锁定保留率达标', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（--lock-materials "0"，--min-retention 0，--lock-small-materials false，target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^锁定材质 mat0 保留率不低于 90%$/, () => {
            expect(facts.reduceLockExit).toBe(0);
            expect(facts.reduceLockStats).toBeTruthy();
            const pm = (facts.reduceLockStats.perMaterial || []).find((x: PerMaterialStat) => x.index === 0);
            expect(pm).toBeTruthy();
            expect(pm.newTri).toBe(pm.origTri);
            expect(facts.verifyLock.checks.protectedRetention).toBe(true);
        });
        and(/^输出三角形数不超过 1951 且验证脚本全绿$/, () => {
            expect(facts.reduceLockStats.newTriangles).toBeLessThanOrEqual(1951);
            expect(facts.verifyLockExit).toBe(0);
            expect(facts.verifyLock.ok).toBe(true);
            expect(facts.verifyLock.checks.triWithinTarget).toBe(true);
        });
    });

    test('减面丢弃输入中的零面积与重复索引退化三角形', ({ given, when, then, and }) => {
        given(/^合成 fixture PMX 已生成（2040 顶点 \/ 3902 三角形，含 2 个非法三角形）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（--target-ratio 0\.999 --target-tri 3900）$/, () => {
            facts = runHelper();
        });
        then(/^输出三角形数为 3900（2 个非法三角形被丢弃）$/, () => {
            expect(facts.reduceDegenExit).toBe(0);
            expect(facts.degenParseable).toBe(true);
            expect(facts.degenTriCount).toBe(3900);
        });
        and(/^输出无退化三角形（面积大于 1e-9）且无重复索引三角形$/, () => {
            expect(facts.degenNoDegenerate).toBe(true);
        });
    });

    test('isValidCollapse 拒绝会产生细长条（sliver）三角形的折叠', ({ given, when, then, and }) => {
        given(/^构造折叠后新三角形 aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN 的折叠候选（u=0 折叠到 \[20,0\.01,0\]）$/, () => {
            facts = null;
        });
        when(/^对该候选直接调用 qem\.mjs 的 isValidCollapse$/, () => {
            facts = runHelper();
        });
        then(/^返回 false（该折叠被拒绝）$/, () => {
            expect(facts.unitSliverCollapse.rejected).toBe(true);
        });
        and(/^折叠结果三角形确实被 isSliverTriangle 判定为 sliver（候选构造正确，aspect 与 maxL 均达标）$/, () => {
            expect(facts.unitSliverCollapse.resultIsSliver).toBe(true);
            expect(facts.unitSliverCollapse.aspect).toBeGreaterThanOrEqual(20);
            expect(facts.unitSliverCollapse.maxL).toBeGreaterThanOrEqual(2);
        });
        and(/^正常折叠（新三角形 aspect<20）返回 true（sliver 约束不误杀）$/, () => {
            expect(facts.unitNormalCollapse.accepted).toBe(true);
        });
        and(/^正常折叠结果三角形不被 isSliverTriangle 判定为 sliver$/, () => {
            expect(facts.unitNormalCollapse.resultNotSliver).toBe(true);
            expect(facts.unitNormalCollapse.aspect).toBeLessThan(20);
        });
    });

    test('isValidCollapse 拒绝 maxL 在 0.5~1.0 区间的手指级窄条折叠', ({ given, when, then, and }) => {
        given(/^构造折叠后新三角形 maxL∈\[0\.5,1\.0\) 且 aspect≥SLIVER_ASPECT_MAX 的折叠候选（u=0 折叠到 \[0,0\.05,0\]）$/, () => {
            facts = null;
        });
        when(/^对该候选直接调用 qem\.mjs 的 isValidCollapse$/, () => {
            facts = runHelper();
        });
        then(/^返回 false（该折叠被拒绝，收紧到 0\.5 生效）$/, () => {
            expect(facts.unitSliverBand.rejected).toBe(true);
        });
        and(/^折叠结果三角形确实被 isSliverTriangle 判定为 sliver（maxL 在 0\.5~1\.0 区间）$/, () => {
            expect(facts.unitSliverBand.resultIsSliver).toBe(true);
            expect(facts.unitSliverBand.maxL).toBeGreaterThanOrEqual(0.5);
            expect(facts.unitSliverBand.maxL).toBeLessThan(1.0);
            expect(facts.unitSliverBand.aspect).toBeGreaterThanOrEqual(10);
        });
    });

    test('减面输出不存在长条 sliver 三角形（合成管状 fixture）', ({ given, when, then, and }) => {
        given(/^合成管状 fixture PMX 已生成（1025 顶点 \/ 1920 三角形，输入无 sliver）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^输出中不存在 aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN 的三角形（阈值 import 自 qem\.mjs）$/, () => {
            expect(facts.sliverTubeExit).toBe(0);
            expect(facts.sliverTubeParseable).toBe(true);
            expect(facts.sliverTubeOutSliverCount).toBe(0);
        });
        and(/^输出文件可解析且 reduce 退出码为 0$/, () => {
            expect(facts.sliverTubeOutTri).toBeGreaterThan(0);
            expect(facts.sliverTubeStats).toBeTruthy();
            expect(facts.sliverTubeStats!.newTriangles).toBeLessThan(facts.sliverTubeInputTri);
        });
        and(/^输入 fixture 自身无长条 sliver（断言前提成立）$/, () => {
            expect(facts.sliverTubeInSliverCount).toBe(0);
        });
    });

    test('减面输出不存在手指级窄条 sliver 三角形（细管 fixture）', ({ given, when, then, and }) => {
        given(/^合成细管 fixture PMX 已生成（R=0\.3 管径 \/ 16 段 × 20 环，输入无 sliver）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^输出中不存在 aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN 的三角形（阈值 import 自 qem\.mjs）$/, () => {
            expect(facts.thinTubeExit).toBe(0);
            expect(facts.thinTubeParseable).toBe(true);
            expect(facts.thinTubeOutSliverCount).toBe(0);
        });
        and(/^输出文件可解析且 reduce 退出码为 0$/, () => {
            expect(facts.thinTubeOutTri).toBeGreaterThan(0);
            expect(facts.thinTubeStats).toBeTruthy();
            expect(facts.thinTubeStats!.newTriangles).toBeLessThan(facts.thinTubeInputTri);
        });
        and(/^输入 fixture 自身无长条 sliver（断言前提成立）$/, () => {
            expect(facts.thinTubeInSliverCount).toBe(0);
        });
    });

    test('拓扑守卫拒绝会产生洞或非流形边的折叠', ({ given, when, then, and }) => {
        given(/^构造 link condition 违反的折叠候选（菱形，u\/v 公共邻居多于对立顶点）$/, () => {
            facts = null;
        });
        when(/^直接调用 qem\.mjs 的 linkConditionValid$/, () => {
            facts = runHelper();
        });
        then(/^返回 false（该折叠被拒绝，防非流形\/缝合）$/, () => {
            expect(facts.unitLinkViolated.rejected).toBe(true);
        });
        and(/^构造内部边变边界的折叠候选（rim corner，一端落在边界上）$/, () => {
            // facts 已包含该候选（helper 内部构造）
        });
        and(/^直接调用 collapseCreatesHole 返回 true（洞被拒绝）$/, () => {
            expect(facts.unitHoleCreated.rejected).toBe(true);
        });
        and(/^linkConditionValid 对该候选仍返回 true（证明洞检测是 link condition 的必要补充）$/, () => {
            expect(facts.unitHoleCreated.linkPasses).toBe(true);
        });
        and(/^5×5 网格中心边折叠（正常折叠）link\/hole\/fold 守卫均不误杀$/, () => {
            expect(facts.unitTopologyNormal.linkAccepted).toBe(true);
            expect(facts.unitTopologyNormal.holeAccepted).toBe(true);
            expect(facts.unitTopologyNormal.foldAccepted).toBe(true);
        });
    });

    test('折叠翻转守卫拒绝 fold-over 折叠', ({ given, when, then, and }) => {
        given(/^构造折叠后新三角形相对邻接三角形法线翻转的折叠候选（共边三角形翻到对侧）$/, () => {
            facts = null;
        });
        when(/^直接调用 qem\.mjs 的 collapseFoldOver$/, () => {
            facts = runHelper();
        });
        then(/^返回 true（该折叠被拒绝）$/, () => {
            expect(facts.unitFoldOver.rejected).toBe(true);
        });
        and(/^折叠到原位附近（不翻转）返回 false（fold-over 守卫不误杀）$/, () => {
            expect(facts.unitFoldOver.normalAccepted).toBe(true);
        });
    });

    test('减面输出不存在非流形边且边界边集合不扩大（合成管状 fixture）', ({ given, when, then, and }) => {
        given(/^合成管状 fixture PMX 已生成（1025 顶点 \/ 1920 三角形，输入无 sliver）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^输出无共享数大于 2 的非流形边$/, () => {
            expect(facts.sliverTubeExit).toBe(0);
            expect(facts.sliverTubeInNonManifold).toBe(0);
            expect(facts.sliverTubeOutNonManifold).toBe(0);
        });
        and(/^输出边界边数量不超过输入边界边数量$/, () => {
            expect(facts.sliverTubeOutBoundary).toBeLessThanOrEqual(facts.sliverTubeInBoundary);
        });
    });

    test('突起守卫拒绝会产生凸起面的折叠', ({ given, when, then, and }) => {
        given(/^构造平面条带折叠候选（全 z=0，折叠 \(0,1\) 到 \[0\.5,0,1\] 戳出平面 1\.0 >> PROTRUDE_MAX）$/, () => {
            facts = null;
        });
        when(/^直接调用 qem\.mjs 的 collapseProtrudes$/, () => {
            facts = runHelper();
        });
        then(/^返回 true（该折叠被拒绝，制造凸起）$/, () => {
            expect(facts.unitProtrudeCollapse.rejected).toBe(true);
        });
        and(/^折叠到原位附近（\[0\.5,0,0\] 平面内）返回 false（突起守卫不误杀）$/, () => {
            expect(facts.unitProtrudeCollapse.normalAccepted).toBe(true);
        });
    });

    test('双面微片锁定守卫锁定共边反向法线微三角顶点', ({ given, when, then, and }) => {
        given(/^构造一对共边、法线相反的微三角形（面积 < FLIP_LOCK_AREA）$/, () => {
            facts = null;
        });
        when(/^直接调用 qem\.mjs 的 collectFlipMicroFaceVertices$/, () => {
            facts = runHelper();
        });
        then(/^返回的锁定集包含该对三角形的全部 3 顶点$/, () => {
            expect(facts.unitFlipLock.lockedMicro).toBe(true);
            expect(facts.unitFlipLock.lockCount).toBe(4);
        });
        and(/^一对法线一致、面积正常的三角形不触发锁定（不误锁）$/, () => {
            expect(facts.unitFlipLock.notMislock).toBe(true);
        });
    });

    test('减面输出不新增凸起面与翻转面（指尖 fixture）', ({ given, when, then, and }) => {
        given(/^合成指尖 fixture PMX 已生成（细管 \+ 半球形指甲盖 \+ 2 对双面微片）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^输出中顶点到邻接平面距离 > PROTRUDE_MAX 的三角形数不超过输入该数量$/, () => {
            expect(facts.fingerTipExit).toBe(0);
            expect(facts.fingerTipParseable).toBe(true);
            expect(facts.fingerTipOutProtrude).toBeLessThanOrEqual(facts.fingerTipInProtrude);
        });
        and(/^输出中法线夹角 >150° 的翻转面数不超过输入该数量$/, () => {
            expect(facts.fingerTipOutFlips).toBeLessThanOrEqual(facts.fingerTipInFlips);
        });
        and(/^输出文件可解析且 reduce 退出码为 0$/, () => {
            expect(facts.fingerTipOutTri).toBeGreaterThan(0);
            expect(facts.fingerTipStats).toBeTruthy();
            expect(facts.fingerTipStats!.newTriangles).toBeLessThan(facts.fingerTipInputTri);
        });
    });

    test('洞守卫收窄只豁免共点边分离仍拒绝其它洞', ({ given, when, then, and }) => {
        given(/^构造内部边变边界 \+ 被移除三角形含共点边（<NEAR_DEGENERATE_EDGE）的折叠候选（u=0\/v=1\/w=2，边 \(0,2\) 近退化）$/, () => {
            facts = null;
        });
        when(/^直接调用 qem\.mjs 的 collapseCreatesHole（带\/不带 ignoreEdges）与 collapseCreatesHoleNarrow$/, () => {
            facts = runHelper();
        });
        then(/^无 ignoreEdges 时洞被拒绝（collapseCreatesHole 返回 true）$/, () => {
            expect(facts.unitHoleNarrow.nonCoincidentRejected).toBe(true);
        });
        and(/^传入非共点 ignoreEdges（"0:4"）仍被拒绝（只有共点边本身被豁免）$/, () => {
            expect(facts.unitHoleNarrow.wrongIgnoreRejected).toBe(true);
        });
        and(/^传入共点边 ignoreEdges（"0:2"）被豁免（返回 false，不误杀）$/, () => {
            expect(facts.unitHoleNarrow.coincidentExempted).toBe(true);
        });
        and(/^collapseCreatesHoleNarrow 自动收集共点边并豁免（近退化清理放行）$/, () => {
            expect(facts.unitHoleNarrow.narrowExemptsCoincident).toBe(true);
        });
        and(/^无近退化边的洞候选 collapseCreatesHoleNarrow 仍返回 true（洞被拒绝）$/, () => {
            expect(facts.unitHoleNarrow.narrowRejectsOther).toBe(true);
        });
    });

    test('突起预算加 cap 后拒绝 0.088 级突起且不误杀正常折叠', ({ given, when, then, and }) => {
        given(/^构造平面 3×3 网格 \+ 折叠 \(4,5\) 到 \[0\.5,1,0\.044\] 的候选（突起 P≈0\.088，collapseProtrudeMax 实测）$/, () => {
            facts = null;
        });
        when(/^直接调用 qem\.mjs 的 collapseProtrudes（预算数组 0\.098，cap 0\.078 \/ 不封顶）$/, () => {
            facts = runHelper();
        });
        then(/^实测 P 落在 \(cap=0\.078, 预算=0\.098\) 带内（候选构造有效）$/, () => {
            expect(facts.unitProtrudeCap.inBand).toBe(true);
            expect(facts.unitProtrudeCap.measured).toBeGreaterThan(facts.unitProtrudeCap.capValue * 0.9);
        });
        and(/^无 cap（Infinity）时 0\.088 级突起被 0\.098 预算放行（返回 false）$/, () => {
            expect(facts.unitProtrudeCap.budgetWouldAllow).toBe(true);
        });
        and(/^有 cap（0\.078）时该突起被拒绝（返回 true，cap 生效）$/, () => {
            expect(facts.unitProtrudeCap.capRejects).toBe(true);
        });
        and(/^小突起折叠（d=0\.02，P≈0\.04 < cap）仍放行（cap 不误杀正常高曲率折叠）$/, () => {
            expect(facts.unitProtrudeCap.capAllowsNormal).toBe(true);
        });
    });

    test('混合 fixture 减面输出边界边空间包含于输入且无非流形', ({ given, when, then, and }) => {
        given(/^合成混合 fixture PMX 已生成（细管 R0\.3\/16×20 \+ 管壁中段近共面微三角簇 \+ 1 处共点近退化微片）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^输出边界边空间 ⊆ 输入边界边（countSpatiallyNewBoundaryEdges 为 0）$/, () => {
            expect(facts.mixedTubeExit).toBe(0);
            expect(facts.mixedTubeParseable).toBe(true);
            expect(facts.mixedTubeOutNewBnd).toBe(0);
        });
        and(/^输出无共享数大于 2 的非流形边$/, () => {
            expect(facts.mixedTubeInNonManifold).toBe(0);
            expect(facts.mixedTubeOutNonManifold).toBe(0);
        });
        and(/^减面统计 newHoleEdges 为 0（collapseMesh 内部洞校验兜底）$/, () => {
            expect(facts.mixedTubeStats).toBeTruthy();
            expect(facts.mixedTubeStats!.newHoleEdges).toBe(0);
        });
    });

    test('指尖 fixture 输出最大突起不超过输入最大突起', ({ given, when, then, and }) => {
        given(/^合成指尖 fixture PMX 已生成（细管 \+ 半球形指甲盖 \+ 2 对双面微片 \+ 高突起 spike）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^输出最大突起（fingerTipOutProtrudeWorst）不超过输入最大突起（fingerTipInProtrudeWorst）$/, () => {
            expect(facts.fingerTipExit).toBe(0);
            expect(facts.fingerTipOutProtrudeWorst).toBeLessThanOrEqual(facts.fingerTipInProtrudeWorst);
        });
        and(/^输出文件可解析且 reduce 退出码为 0$/, () => {
            expect(facts.fingerTipParseable).toBe(true);
            expect(facts.fingerTipOutTri).toBeGreaterThan(0);
        });
    });

    test('曲率感知尺寸守卫拒绝高曲率区超尺寸折叠且不误杀平坦区', ({ given, when, then, and }) => {
        given(/^构造高曲率（40°≥CURV_MIN_DEG）超尺寸折叠候选（post 三角形 maxL\/面积 = 1\.4× 预算 0\.5\/0\.05，随 qem 系数动态构造）$/, () => {
            facts = null;
        });
        when(/^直接调用 qem\.mjs 的 collapseCreatesOversizeTriangle$/, () => {
            facts = runHelper();
        });
        then(/^返回 true（该折叠被拒绝，post 三角形超 max\(系数 × 预算\) 上限）$/, () => {
            expect(facts.unitOversizeCollapse.highCurvOversizeRejected).toBe(true);
            expect(facts.unitOversizeCollapse.maxL).toBeGreaterThan(facts.unitOversizeCollapse.maxLBudget);
            expect(facts.unitOversizeCollapse.area).toBeGreaterThan(facts.unitOversizeCollapse.areaBudget);
        });
        and(/^同一尺寸但平坦（曲率 0° < CURV_MIN_DEG）的候选返回 false（曲率门控不误杀平坦区）$/, () => {
            expect(facts.unitOversizeCollapse.flatGatePasses).toBe(true);
        });
        and(/^高曲率但尺寸内（预算放大到 0\.9\/0\.1）的候选返回 false（不误杀正常高曲率折叠）$/, () => {
            expect(facts.unitOversizeCollapse.inBudgetPasses).toBe(true);
            // CURV_MIN_DEG import 自 qem.mjs（真实模型校准后为 12°；断言 > 0 确保取到真实常量而非退化兜底）
            expect(facts.unitOversizeCollapse.curvMinDeg).toBeGreaterThan(0);
        });
    });

    test('突起守卫拒绝突起超基础阈值的大鼓包三角形', ({ given, when, then, and }) => {
        given(/^构造平面 3×3 网格 \+ 折叠 \(4,5\) 到 \[0\.5,1,0\.044\] 的候选（突起 P≈0\.088，collapseProtrudeMax 实测）$/, () => {
            facts = null;
        });
        when(/^直接调用 qem\.mjs 的 collapseProtrudes（预算 0\.098，sizeA 预算 0\.01）$/, () => {
            facts = runHelper();
        });
        then(/^面积超局部预算时返回 true（大鼓包被拒绝）$/, () => {
            expect(facts.unitProtrudeBump.bigBumpRejected).toBe(true);
            expect(facts.unitProtrudeBump.measured).toBeGreaterThan(0.066);
        });
        and(/^传 sizeA=null（旧调用兼容）返回 false（证明是新增条件在起作用）$/, () => {
            expect(facts.unitProtrudeBump.legacyCompatible).toBe(true);
            expect(facts.unitProtrudeBump.areaBudget).toBeGreaterThan(0);
        });
    });

    test('突起守卫拒绝指尖尖刺折叠且不误杀正常折叠', ({ given, when, then, and }) => {
        given(/^构造平面 3×3 网格 \+ 折叠 \(4,5\) 到 \[0\.5,1,0\.030\] 的候选（突起 P≈0\.060，介于预算 0\.04 与阈值之间）$/, () => {
            facts = null;
        });
        when(/^直接调用 qem\.mjs 的 collapseProtrudes（预算数组 0\.04）$/, () => {
            facts = runHelper();
        });
        then(/^尖刺候选被拒绝（返回 true，0\.06 级突起超 allowance）$/, () => {
            expect(facts.unitSpikeGuard.spikeRejected).toBe(true);
            expect(facts.unitSpikeGuard.measured).toBeGreaterThan(0.055);
            expect(facts.unitSpikeGuard.measured).toBeLessThan(0.066);
            expect(facts.unitSpikeGuard.allowance).toBeLessThan(facts.unitSpikeGuard.measured);
        });
        and(/^小突起折叠（d=0\.02，P≈0\.04 ≤ allowance）仍放行（不误杀）$/, () => {
            expect(facts.unitSpikeGuard.smallAllowed).toBe(true);
        });
    });

    test('全指尖区域新增尖刺检测能抓到远离输入突起的输出三角形', ({ given, when, then, and }) => {
        given(/^构造指尖区域（\|x\|>7, 13<y<16）两块 3×3 网格簇（各中心戳出 0\.06，protrude>0\.05），输入=簇 A、输出=簇 A\+簇 B$/, () => {
            facts = null;
        });
        when(/^直接调用 verify\.mjs 的 countNewFingertipProtrusions$/, () => {
            facts = runHelper();
        });
        then(/^输入自比新增 0（inSelf=0，查询集 ⊆ 参考集）$/, () => {
            expect(facts.unitTipNewProtrude.inSelf).toBe(0);
        });
        and(/^输出与输入相同时新增 0（outSame=0，无误报）$/, () => {
            expect(facts.unitTipNewProtrude.outSame).toBe(0);
        });
        and(/^输出含远离输入突起的簇 B 时新增 ≥1（outNew≥1，内带尖刺形态必被抓）$/, () => {
            expect(facts.unitTipNewProtrude.outNew).toBeGreaterThanOrEqual(1);
        });
    });

    test('未触碰顶点保留输入法线（touchedV 法线重写过滤）', ({ given, when, then, and }) => {
        given(/^构造 5×5 平面网格（边界环锁定，输入法线 \[1,0,0\] 与邻面平均 \[0,0,1\] 正交）$/, () => {
            facts = null;
        });
        when(/^直接调用 qem\.mjs 的 collapseMesh（targetTriangles=8）$/, () => {
            facts = runHelper();
        });
        then(/^确实发生了折叠（stats\.collapses > 0，断言前提成立）$/, () => {
            expect(facts.unitTouchedNormals.collapses).toBeGreaterThan(0);
        });
        and(/^输入法线均为单位长度（前置，redCapable 区分「保留\/重写」）$/, () => {
            expect(facts.unitTouchedNormals.allInputUnitLength).toBe(true);
            expect(facts.unitTouchedNormals.redCapable).toBe(true);
        });
        and(/^所有锁定（未触碰）顶点输出法线 === 输入法线（保留）$/, () => {
            expect(facts.unitTouchedNormals.lockedPreserved).toBe(true);
            expect(facts.unitTouchedNormals.preservedCount).toBe(facts.unitTouchedNormals.lockedCount);
        });
        and(/^全部输出顶点法线单位长度（折叠顶点重算后仍归一化）$/, () => {
            expect(facts.unitTouchedNormals.allNormalsUnitLength).toBe(true);
        });
    });

    test('球面 fixture 减面输出无跨曲面超尺寸三角形', ({ given, when, then, and }) => {
        given(/^合成球面 fixture PMX 已生成（R=1，seg=8×rings=8，128 输入三角形，曲率全表面 > CURV_MIN_DEG）$/, () => {
            facts = null;
        });
        when(/^用 reduce\.mjs 生成减面 pmx（target-ratio 0\.5）$/, () => {
            facts = runHelper();
        });
        then(/^输出中每个三角形 maxL 与面积均不超过 max\(floor, 系数 × 顶点局部预算上限\)（阈值 import 自 qem\.mjs）$/, () => {
            expect(facts.sphereExit).toBe(0);
            expect(facts.sphereParseable).toBe(true);
            expect(facts.sphereOutWithinSize).toBe(true);
            expect(facts.sphereOutMaxOver.maxL).toBeLessThanOrEqual(facts.sphereBoundMaxL);
            expect(facts.sphereOutMaxOver.area).toBeLessThanOrEqual(facts.sphereBoundArea);
        });
        and(/^输出文件可解析且 reduce 退出码为 0$/, () => {
            expect(facts.sphereOutTri).toBeGreaterThan(0);
            expect(facts.sphereStats).toBeTruthy();
            expect(facts.sphereStats!.newTriangles).toBeLessThan(facts.sphereInputTri);
        });
    });
});
