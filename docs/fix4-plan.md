# PMXReduceFace 第四轮：手指头突出的面 — 修复方案

> 状态：仅方案，未改任何源码/测试（本仓库当前还有一个未提交的 `QEM_DEBUG_FINGER` 诊断块，见 §5）。
> 前置：三轮已提交（HEAD `13e5d5c`），本方案是第四轮。

---

## 1. 结论：根因判断（定量）

兄弟说「手指头有**突出的面**」——措辞从「多余面」变成「**突出**」。用 `scripts/diag-fingertip.mjs`（指尖区域 |x|>8, y 13.8-14.8）对原始 vs LOD50 量化：

| 指标 | 原始 | LOD50 | 变化 |
|---|---|---|---|
| 突起面数（顶点到邻接平面距离 > 0.08） | **8** | **98** | **12×↑** |
| 最大突起距离 | 0.098 | **0.184** | ~2×↑ |
| 法线夹角 >120° 翻转面数 | 34 | 34 | 持平（但有 6 个从 120-150° 恶化到 >150°） |
| 翻转面面积范围 | 4e-5~4.9e-4 | 1e-4~8.5e-4 | 部分放大 ×2~6 |

**根因 = A + B 叠加，A 是主因：**

- **A（主因，对应「突出」）**：指尖指甲区是一团**近共面微三角形**（面积 ~1e-4、maxL 0.03~0.08、约 200 个）。`computeQuadrics` 是**非面积加权**的标准平面 quadric（`quadric.mjs:8-25`），这些微三角的平面几乎平行 → quadric 近奇异 → 折叠代价 ≈ 0 → QEM 把它们「免费」合并成一个**跨曲面的大平面三角**（面积最大 0.037、maxL 0.58），不再贴合指尖弧面，顶点从邻接面戳出（protrude 0.08~0.184）。这就是「突出的面」。
- **B（次因，对应「翻转放大」）**：指甲/指缝自带**双面微片**（两三角共边、法线相反 150°~172°、面积 ≤5e-4，共 20 个 >150° + 14 个 120-150°）。折叠时它们被合并放大（面积 ×2~6、角 158°→179°），或把 120-150° 的片恶化成 >150°（净 6 个）。`collapseFoldOver` 的 `cosOrig` 用**当前法线**做基线（`qem.mjs:313-315`），一旦邻域已翻转，`cosOrig > FOLD_DOT_MIN` 恒假 → 守卫豁免，拦不住「已翻转区的恶化」。

> 一句话：**QEM 对近共面微三角团的「免费合并」制造了跨曲面的凸起大三角（A），并放大/恶化了指甲双面微片（B）。** 现有 sliver/fold-over 守卫都拦不住——sliver 查的是长宽比（这些大三角 aspect 1.1~8.5 < 10），fold-over 查的是「新翻转且原正常」，两者都不覆盖「曲率凸起」。

---

## 2. 修复方案（两个守卫，一主一次）

### 守卫 1（主）：`collapseProtrudes` 突起守卫（拦 A）

在 `qem.mjs` 新增，仿照 `collapseFoldOver` 的签名与调用位，紧挨 fold-over 之后调用。

- **语义**：模拟 u/v 折叠到 `newPos`，对每个**受影响且存活**的三角形（含 u 或 v、不同时含两者的）计算折叠后其 3 个顶点到「相邻存活三角形平面」的最大距离 `protrude`；任一 > `PROTRUDE_MAX` → 拒绝折叠。
- **实现要点**（直接复用 `diag-fingertip.mjs:46-81` 的 `ptPlaneDist`/`maxProtrude` 数学）：
  1. 收集受影响存活三角形 `post`（u/v → newPos，v → u 重映射），计算各自折叠后法线。
  2. 对每个受影响三角形，遍历其 3 条边，用 `vTris`（折叠前，同 `collapseFoldOver`）找共享边邻居；邻居若也是受影响三角形，用其**折叠后**法线/位置，否则用当前位置。
  3. 对受影响三角形的 3 个顶点，算到每个邻居平面的距离，取最大。
  4. `protrude > PROTRUDE_MAX` → `return true`。
- **阈值**（相对手指尺度，手指直径 0.3-0.5）：`PROTRUDE_MAX = 0.08`（≈ 手指直径的 20-25%）。选择依据：原始模型指尖 p90 突起 0.031、p99≈0.098，即「正常」≤0.03、「原模型最差」≈0.098；取 0.08 = 略低于原模型最差 → 折叠只允许产生 ≤ 原模型最差级别的凸起，杜绝「比原模型还凸」的新大三角。
  - **尺度无关化**（建议，避免其它模型硬编码）：在 `collapseMesh` 载入时算原始模型边长中位数 `medE`，`PROTRUDE_MAX = PROTRUDE_RATIO × medE`，`PROTRUDE_RATIO ≈ 0.4`。本模型 medE≈0.2 → 0.08，自洽。Flash 可先落绝对 0.08 + 常量导出 `PROTRUDE_MAX`（供 BDD import 单一来源），尺度归一化作为后续增强。
- **统计**：`stats.protrudeRejects++`（新字段，仿 `foldOverRejects`），`reduce.mjs` 结果 JSON 透出。

### 守卫 2（次，建议）：`collectFlipMicroFaceVertices` 双面微片锁（拦 B）

在 `qem.mjs` 新增纯函数，`collapseMesh` 初始化时调用，把结果并入 `locked` 集。

- **语义**：扫描原始三角形，凡「与任一邻居法线夹角 > `FLIP_LOCK_ANGLE` 且面积 < `FLIP_LOCK_AREA`」的三角形，锁定其 3 个顶点 → 指甲双面微片完全不折叠，杜绝放大/恶化。
- **阈值**：`FLIP_LOCK_ANGLE = 120`（与 `FOLD_ANGLE_MAX_DEG` 一致）、`FLIP_LOCK_AREA = 1e-3`。实测本模型锁定仅 **34 个三角形（20 个 >150° + 14 个 120-150°）**，顶点 <100，减面率影响可忽略；`area<5e-4 且 angle>120°` 这一档全模型也才 ~1680 三角（3.1%），`1e-3 且 120°` ~2219（4.09%），不会误锁大面积。
- **注意**：双面微片是合法几何（指甲薄片正反面），**不能删、不能合并**，只能锁定；锁 = 100% 保留外观。

> 顺序建议：**守卫 1 必做**（直接命中「突出的面」）；**守卫 2 建议同轮做**（成本极低，一并解决「翻转放大」）。fold-over 的「当前法线基线漂移」属已知小缺口（净翻转总数 34→34 未变），本轮不强改，留作备注。

---

## 3. BDD 断言方案（兄弟硬性要求：断言必须能 RED）

### 3.1 单元级（新增 2 个 Scenario，仿现有 sliver/fold-over 单元测试的写法）

**Scenario 1：`collapseProtrudes` 拒绝会产生凸起面的折叠**

- Given：构造「XY 平面条带 + 折叠使顶点戳出平面」候选（见 `test/helpers/pmx-face-reduce-check.mjs` 现有 fold-over 测试 C1 结构）：
  ```js
  // 平面条带（全 z=0），折叠 (0,1) 到 z=+1 之外
  const positions = [[0,0,0],[1,0,0],[2,0,0],[0,1,0],[1,1,0],[2,1,0]];
  const tris = [[0,1,4],[0,4,3],[1,2,5],[1,5,4]];
  // collapse(0,1) newPos=[0.5,0,1] → [newPos,4,3] 的顶点 newPos 距邻面 z=0 距离=1 >> PROTRUDE_MAX
  ```
- When：直接调用 `collapseProtrudes(positions, tris, aliveT, vTris, 0, 1, [0.5,0,1])`。
- Then：返回 `true`（拒绝）。
- And：折叠到原位附近（`newPos=[0.5,0,0]`）返回 `false`（不误杀）。
- **RED 能力**：把 `collapseProtrudes` 退化为恒 `false` → 本 Scenario 立即失败。

**Scenario 2：`collectFlipMicroFaceVertices` 锁定双面微片顶点**

- Given：构造一对共边、法线相反的微三角形（面积 < `FLIP_LOCK_AREA`）。
- When：调用 `collectFlipMicroFaceVertices(...)`。
- Then：返回的锁定集包含这对三角形的 3 个顶点。
- And：一对法线一致、面积正常的三角形不触发锁定（不误锁）。
- **RED 能力**：把判定里的 `angle > FLIP_LOCK_ANGLE` 改成恒 false → 返回空集 → 断言失败。

### 3.2 集成级（1 个 Scenario，仿「细管 fixture」C 场景）

**Scenario 3：指尖 fixture 减面输出无新增凸起面**

- Given：合成「指尖」fixture —— 在 `buildTubePmx(16, 2, 0.3, 20)`（现有细管，手指比例）的一端加一个**半球形指甲盖**（几圈小三角形，制造近共面微三角团）+ 注入 2 对**双面微片**（共边反向法线小三角）。复用 `buildRawMeshPmx` 输出 PMX。
- When：`reduce.mjs --target-ratio 0.5`（关 morph/seams/min-retention，同现有细管场景）。
- Then：输出中「顶点到邻接平面距离 > `PROTRUDE_MAX` 的三角形数」**≤ 输入该数量**（不新增凸起面）。
- And：输出中「法线夹角 >150° 的翻转面数」**≤ 输入该数量**（无新增翻转）。
- And：输入 fixture 自身的突起面数为已知基线（断言前提成立，仿现有「输入自身无 sliver」）。
- **RED 能力**：revert 守卫 1+2（`collapseProtrudes` 恒 false、`collectFlipMicroFaceVertices` 返回空）→ 输出凸起面数 98 级暴增 → 断言失败；恢复后 ≈ 输入基线 → 通过。

### 3.3 helper 接线

- `pmx-face-reduce-check.mjs` 新增 `unitProtrudeCollapse` / `unitFlipLock` / `fingerTipInProtrude` / `fingerTipOutProtrude` / `fingerTipInFlips` / `fingerTipOutFlips` 字段，仿现有 `unitFoldOver` / `thinTubeOutSliverCount` 的收集方式。
- `feature` 文件新增 3 个 Scenario + 中文步骤；`steps.ts` 新增对应 `defineFeature` 步骤。
- `collapseProtrudes` / `collectFlipMicroFaceVertices` / `PROTRUDE_MAX` / `FLIP_LOCK_ANGLE` / `FLIP_LOCK_AREA` 从 `qem.mjs` 导出（单一来源，helper 用 `await import` 动态获取，仿 `SLIVER_*` 的防御式 fallback，保证 RED 时其它场景仍可跑）。

---

## 4. 副作用评估

- **减面率**：守卫 1 只拦「制造凸起」的折叠（指尖/高曲率区），守卫 2 锁 <100 顶点。对 demo 模型目标 27114 面，预计额外拦下几十~几百个折叠，`reductionMet` 大概率仍 true（当前已有余量）；若触及保底下限，`reductionMet` 会变 false——**验证矩阵要同时盯 `newTriangles` 是否仍 ≤ 目标**。
- **保护地板**：材质保护/小材质锁定不受影响（守卫是新增拒绝项，不删任何已有保护）。
- **指甲外观**：守卫 2 锁定后指甲 100% 保留（不删不合并）；守卫 1 只挡新凸起，不动已有几何。
- **误杀风险**：守卫 1 阈值若偏低会挡掉高曲率区的正常简化（手指/耳廓/袜口等细圆柱）。缓解：阈值取「原模型最差 × 0.8」，即绝不产生比原模型更凸的面——正常简化本就该保持 ≤ 原模型曲率。若 `reductionMet` 显著恶化，微调 `PROTRUDE_RATIO` 0.4→0.5。
- **性能**：两守卫都是折叠前的局部邻域计算，与 `collapseFoldOver` 同量级，对 5.4 万面模型可忽略（可加 `QEM_DEBUG_FINGER` 式的耗时埋点确认）。

---

## 5. Flash 执行步骤清单

0. **先清理**：`git checkout -- src/tool/pmx-face-reduce/qem.mjs` 丢弃上一 bot 留下的 `QEM_DEBUG_FINGER` 诊断块（`scripts/diag-fingertip.mjs` 可保留，是有用诊断脚本，建议 `git add` 提交）。

1. **改 `src/tool/pmx-face-reduce/qem.mjs`**：
   - 新增常量 `PROTRUDE_MAX = 0.08`、`FLIP_LOCK_ANGLE = 120`、`FLIP_LOCK_AREA = 1e-3`（导出）。
   - 新增 `collapseProtrudes(positions, tris, aliveT, vTris, u, v, newPos, maxProtrude = PROTRUDE_MAX)`。
   - 新增 `collectFlipMicroFaceVertices(positions, tris)`（内部建边表算邻接法线夹角 + 面积）。
   - `collapseMesh`：初始化时 `for (const vi of collectFlipMicroFaceVertices(positions, tris)) locked.add(vi)`；`stats` 加 `protrudeRejects: 0`；主循环 fold-over 之后插入 `if (collapseProtrudes(...)) { e.dead=true; stats.rejected++; stats.protrudeRejects++; return; }`。
   - **注意**：`positions` 在 `collapseMesh` 里是 `vertices` 的拷贝（`qem.mjs:440`），`collectFlipMicroFaceVertices` 应在拷贝前用 `vertices[i].position` 或等价，保证锁的是原始几何。

2. **改 `src/tool/pmx-face-reduce/reduce.mjs`**：结果 JSON 加 `protrudeRejects: stats.protrudeRejects`。

3. **改 `src/tool/pmx-face-reduce/verify.mjs`**（可选增强）：`verifyFaces` 加 `protrudeRejects` 透传 + （可选）`noNewProtrudingFaces` 断言（指尖区域突起面数不增）。本轮最小集可先不加 verify，等 BDD 集成断言落地后再决定。

4. **BDD**：按 §3 改 `test/helpers/pmx-face-reduce-check.mjs` + `test/features/pmx-face-reduce.feature` + `test/step-definitions/pmx-face-reduce.steps.ts`。

5. **RED 验证**（顺序）：
   - `npx jest test/step-definitions/pmx-face-reduce.steps.ts` 先确认现有 19 场景全绿（基线）。
   - 临时把 `collapseProtrudes` 改恒 `false`、`collectFlipMicroFaceVertices` 改返回空 → 新增 3 个 Scenario 应**红**（抓 bug）。
   - 恢复守卫 → **绿**。

6. **真实模型回归**（`node scripts/prepare-demo.mjs` 重生成 4 档 LOD）：
   - `node scripts/diag-fingertip.mjs demo/assets/XiaoMeiOriginFix_02_elrein.pmx demo/assets/XiaoMeiOriginFix_02_elrein.LOD50.pmx`
   - 验收：`突起>0.08` 从 98 回到 ≈8、`最大突起` 从 0.184 回到 ≈0.098、`法线夹角>120°` 仍 34（无新增）；同时 `stats.json` 里 `reductionMet` 仍 true、`newTriangles ≤ 27114`。
   - `node src/tool/pmx-face-reduce/verify.mjs` 全绿。

7. **提交**：一轮一个 commit（先清诊断块、再改守卫、再 BDD），推送到 `origin`。

## 6. 验证矩阵

| 检查 | 工具/命令 | 修复前（RED 基线） | 修复后（GREEN 目标） |
|---|---|---|---|
| 单元：凸起折叠被拒 | jest 新 Scenario 1 | 恒 false → 红 | 返回 true → 绿 |
| 单元：双面微片锁定 | jest 新 Scenario 2 | 恒空 → 红 | 返回顶点集 → 绿 |
| 集成：指尖无新凸起/翻转 | jest 新 Scenario 3 | revert 守卫 → 红 | ≤ 输入基线 → 绿 |
| 现有 19 场景回归 | `npx jest` | — | 全绿 |
| 指尖凸起面数 | `diag-fingertip.mjs` | 98 / max 0.184 | ≈8 / max ≈0.098 |
| 指尖翻转面数 | `diag-fingertip.mjs` | 34（含 6 恶化） | 34（无新增恶化） |
| 减面达标 | `stats.json` / reduce JSON | true | `reductionMet=true` 且 `newTri ≤ 27114` |
| verify 全绿 | `verify.mjs` | — | 退出码 0 |

---

## 附：本轮关键诊断数据（供 Flash 复查）

- 原始指尖翻转面 20 个，位置对称 ±[8.8,14.3,-0.80] / ±[9.87,14.17,-0.19] / ±[9.74,14.20,0.04] / ±[9.47,14.29,0.25]，面积 4e-5~4.9e-4，aspect 2.2~2.9，maxL 0.03~0.08。
- LOD50 新增 4 个翻转面 ±[9.73,14.22,-0.43]（angle 164°，maxL 0.135，aspect 3.3/5.5），原始该位置 maxAng ≤47°（平滑区）→ 由 120-150° 微片恶化而来。
- 输出放大最狠：tri#10295/12031（±8.84,14.33,-0.80）面积 1.2e-4→5.9e-4（×5.1）、angle 158°→179°；tri#13315/12980 面积 1.2e-4→7.6e-4（×6.4）。
- 输出最大凸起 tri#10145/12987（±8.92,14.65,0.31）protrude 0.184、area 0.0091、maxL 0.268、angle 46°（非翻转，是跨曲面大平面）。
