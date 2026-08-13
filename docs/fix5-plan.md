# PMXReduceFace 第五轮：破面回归 + 小指残留突起 — 质量优先修复方案

> 状态：仅方案，未改任何源码/测试/README（本仓库工作树干净，HEAD `64463db` 四轮守卫）。
> 前置：四轮（`64463db`，突起守卫 + 双面微片锁）已提交；三轮（`13e5d5c`，洞守卫）是洞回归对照基线。
> 数据来源：本文所有数字均用 `scripts/*.mjs` 或 `%TEMP%\opencode\` 下的临时诊断脚本实测（临时脚本勿入库）。

---

## 0. 结论速览

1. **破面回归（P0）已确认**：第四轮突起守卫 `collapseProtrudes` 在 LOD50 拒绝了 **11139** 次折叠（占全部拒绝的 50%，是成功折叠数 14325 的 0.78×），彻底改变折叠顺序 → 洞守卫（linkCondition + collapseCreatesHole）在新顺序下被绕过。对比三轮 LOD50：袜子区（y 13-16）**三轮 0 洞候选 / 四轮 10 个**；四轮相对三轮新增 ~37 条边界边（净 +7），集中在**内裤 BurumaSet（y 19.5，6 边）+ 长发发丝（y 13.5-17，~14 边）**。
2. **根因判定 = A + C**：A（折叠顺序改变，主因）+ C（洞守卫自身有漏洞，具体为 `removesSlit` 豁免盲区：LOD50 全程触发 61 次、其中 30 次让「内部边→边界边」的洞穿透了洞守卫，集中在头部/颈发区 y 20-21）。
3. **小指残留突起**：残留 6 个突起面（≤ 原始基线 8 个），最显著 `@[±8.76,14.83,0.26]`（面积 0.0262、maxL 0.301）。根因是**突起预算机制**：`allowance = max(protrudeMax, 顶点原始突起预算)`，指尖原始突起已达 0.098，预算≈0.098 放行了 0.088 的新大平面。**已实测收紧绝对阈值 PROTRUDE_MAX 0.066→0.05 对残留突起无任何效果（仍 6 个）**——预算才是绑定约束。
4. **质量优先的代价已量化**：四轮突起守卫把减面地板从三轮的 **19668** 抬到 **26082**（+6414 面）。LOD25/10 已卡在同一地板，属无效档位，需重标。
5. **修复方向**（质量优先）：(a) 收窄/替换 `removesSlit` 豁免（只豁免「共点微片分离」本身，不豁免其它洞）；(b) 加**减面后洞校验**（输出边界边空间 ⊆ 输入边界边）作为顺序无关的兜底；(c) 预算加**上限**（cap），消除残留突起；(d) demo LOD 档位重标 + `real-model-check` 目标改 `--target-ratio`。

---

## 1. P0 破面回归根因（量化 + 机制 + 修复方向）

### 1.1 量化：四轮 LOD50 相对三轮新增了哪些边界边

用 `git show 13e5d5c:demo/assets/XiaoMeiOriginFix_02_elrein.LOD50.pmx` 导出三轮 LOD50（`%TEMP%\opencode\LOD50_r3.pmx`，1319665 字节），与四轮 LOD50 对比边界边（边共享数=1 的边）：

| 区域（y 区间） | 三轮边界边 | 四轮边界边 | 三轮洞候选 | 四轮洞候选 |
|---|---|---|---|---|
| 袜子 sock (13-16) | 3263 | 3232 | **0** | **10** |
| 屁股 butt (17-19) | 761 | 759 | 7 | 0 |
| 全局 | 12363 | 12337 | 372 (tol 0.05) | 331 (tol 0.05) |

> 洞候选 = 输出边界边中点与输入所有边界边线段的空间距离 > 容差（即出现在输入「内部」的新边界 = 真破面/撕裂）。

**四轮相对三轮的新增边界边**（直接 diff，容差 0.2，`diag-newbnd.mjs`）：

| 聚类坐标 | 数量 | 材质 |
|---|---|---|
| `[±0.5, 19.5, -0.5..-1.0]` | 6 | **2000_BurumaSet_Liltoon（内裤/屁股）** |
| `[±1..3, 13.5..17, 3.5..5.5]` | ~14 | 2000_Hair（垂落长发丝） |
| `[±1, 0.5, -1]` | 2 | 2000_BurumaSet_Liltoon（脚踝） |
| `[±0.5..0.9, 20.8..21.1, -0.4..-1.1]` | ~15 | 2000_Hair（头/颈发） |

模型布局（`diag-layout.mjs`）：Hair 长 y 11.2-25.7（长发尖垂到 y 11-15 = 袜子/大腿高度），BurumaSet 内裤 y 0-19.8。所以兄弟说的「袜子破面」实为**垂落长发丝边界退缩**（长发盖在袜子区上），「屁股内裤破面」为**内裤腰口边界退缩**。

### 1.2 机制：突起守卫为何导致洞

用临时插桩（`%TEMP%\opencode\src-instr`，在洞守卫块与折叠提交处埋点）对四轮 LOD50 全流程实测：

| 指标 | 数值 | 含义 |
|---|---|---|
| collapses | 14325 | 成功折叠数 |
| rejected | 22430 | 总拒绝数 |
| **protrudeRejects** | **11139** | 突起守卫拒绝（占 50%） |
| holeRejects | 6721 | 洞守卫拒绝 |
| linkRejects | 13 | link condition 拒绝 |
| foldOverRejects | 201 | 翻转拒绝 |
| `removesSlit` 触发 | 61 | 洞守卫被豁免的次数（全部 y 20-21 头发区） |
| `removesSlit` 中「本会造成洞」 | 30 | 豁免让 `collapseCreatesHole` 本会返回 true 的洞穿透 |
| 折叠后实测新边界边（内部→边界） | 45 | 全部 y 20-21，模式 `cu=2/cv=1 post=1` |

**结论（根因 = A + C）**：

- **A（主因，顺序改变）**：突起守卫 11139 次拒绝「免费合并近共面微三角团」的低代价折叠 → QEM 退而求其次选更高代价折叠 → 折叠顺序全局改变。洞守卫是「局部、单步」检查，它的有效性**依赖折叠顺序**——顺序变，暴露的洞位点就变（三轮的顺序不产生袜子/内裤洞，四轮的顺序产生）。
- **C（洞守卫自身漏洞）**：`removesSlit` 豁免（`qem.mjs:850-867`）在检测到「本次折叠清理了含共点边（<1e-4）的近退化三角形」时**完全跳过 `collapseCreatesHole`**。实测它全程触发 61 次、放行 30 个真洞（全部在头/颈发 y 20-21）。虽然兄弟直接看到的袜子/内裤破面是「发丝/内裤边界退缩」（薄特征边界的另一种失效，见下），但 `removesSlit` 是「洞守卫能被绕过」的**硬证据**，也是本轮必须修的明确漏洞。
- **薄特征边界退缩（补充机制）**：发丝（Hair）与内裤腰口是**开放薄壳**，其轮廓边界在减面中会被折叠重排。突起守卫改变顺序后，这些薄特征的轮廓边在四轮退缩得比三轮更多/更靠内，视觉上形成「破面/洞」。这属于 `collapseCreatesHole` 只管「内部边→边界边」、不管「边界边退缩到已减面区域的内部」的盲区。

### 1.3 修复方向（质量优先，可执行）

1. **收窄 `removesSlit` 豁免（必做，P0）**：不要把「含共点边」作为「跳过整个洞检测」的开关。改为：`removesSlit` 时仍调用 `collapseCreatesHole`，但传入「豁免边集」（本次被移除的近退化三角形涉及的那条共点边），让 `collapseCreatesHole` 忽略「那条共点边分离成边界」这一种洞、仍拒绝其它任何 `post>2` / `preU===2||preV===2 && post<2` 的洞。实现要点：`collapseCreatesHole` 增加第 6 参 `ignoreEdges:Set<string>`，命中 `(u,w)`/`(v,w)` 的 key 时跳过该项。
2. **减面后洞校验兜底（强烈建议，P0）**：减面完成后（`collapseMesh` 返回前）加一次**纯只读**校验：输出所有边界边，其边中点不得落在输入网格「内部」（即距离输入任何边界边 > `HoleTol`，且附近存在输入的内部三角形）。命中即视为洞，可选策略：(a) 直接把相关顶点加入 locked 重跑一次（代价高但简单），或 (b) 至少统计透出 `stats.newHoleEdges` 供 verify/BDD 断言。**这是让洞保护与折叠顺序解耦的兜底**——顺序再变，最终输出也保证无洞。
3. **薄特征边界退缩（可选，本轮可不做）**：把 `collapseCreatesHole` 从「查内部边→边界」扩展到「查边界边退缩是否越过输入已有表面」代价高、收益低；建议用上面的「减面后洞校验」统一兜底，不再单独实现。
4. **不要**重排守卫顺序（protrude 在 foldOver 后、material 前的位置本身没问题，问题不在检查顺序而在折叠顺序 + 豁免盲区）——即假设 B 排除。

---

## 2. 小指残留突起根因

### 2.1 量化

`diag-fingertip.mjs`（指尖 |x|>8.0, y 13.8-15.0）四轮 LOD50：

| 指标 | 原始 | 四轮 LOD50 |
|---|---|---|
| 突起>0.08 面数 | 8 | **6** |
| 最大突起 | 0.098 | 0.095 |
| 翻转>120° | 34 | 34（无新增） |

残留 6 个突起面：

| tri# | protrude | angle | area | maxL | 位置 |
|---|---|---|---|---|---|
| 10163/12902 | 0.095 | 110° | 0.0073 | 0.172 | [±8.88,14.65,0.22] |
| 10113/12124 | 0.088 | 24° | **0.0262** | **0.301** | **[±8.76,14.83,0.26]** |
| 10173/12884 | 0.087 | 26° | 0.0118 | 0.273 | [±8.99,14.63,0.18] |

> 兄弟/任务里写「protrude=0.133、夹角 39°、tri#10178/12186」。同位置（面积 0.0262、maxL 0.301 完全一致）我用 `diag-fingertip.mjs`（顶点到 1-ring 邻接面最大距离）量到 0.088/24°，2-ring 量到 0.093。**0.133 与 0.088 是度量口径差异**（兄弟侧可能用「顶点到平滑曲面/局部拟合面距离」或更大邻域）。这是必须先在 Flash 落地的第一步：**统一突起度量口径**（建议沿用 `diag-fingertip.mjs` 的「顶点到 1-ring 邻接面距离」为唯一标准，BDD/verify 均 import 同一实现）。若统一口径后仍 > 输入 max 0.098，则违反验收；若 ≤ 0.098，则当前 6 面已达标、只需盯住 max。

### 2.2 根因：预算机制（不是绝对阈值）

`collapseProtrudes` 的许可 `allowance = max(protrudeMax, budgets[三顶点])`（`qem.mjs:427-429`），`budgets` 来自 `computeVertexProtrudeBudgets`（每顶点在输入几何里的最大突起距离）。指尖输入最大突起已达 0.098（那 8 个双面微片/指甲缝），于是：

- 指尖区顶点预算 ≈ 0.098 → 新大平面突起 0.088 < 0.098 → **放行**。
- 绝对阈值 `protrudeMax = max(0.066, 0.4×medE≈0.052) = 0.066` 在指尖区**根本不起作用**（预算更大）。

**实证**：临时把 `PROTRUDE_MAX` 从 0.066 改 0.05 重跑 LOD50 → 突起面仍 **6 个**、最大仍 0.095，纹丝不动（`%TEMP%\opencode\src-exp`）。证明**收紧绝对阈值无效，预算才是绑定约束**。

为什么预算「不该」这么高：那 8 个 0.098 的突起面是**原始微特征**（双面微片/指甲缝），它们已被 `collectFlipMicroFaceVertices` 锁定、无需「预算放行」；但 `computeVertexProtrudeBudgets` 把这 0.098 当「局部曲率预算」传播给合并顶点，再放行了**新造的跨曲面大平面**（0.088）。预算把「微特征突起」误当成「曲面曲率许可」。

### 2.3 修复方向（可执行，按优先级）

1. **预算加上限（cap）（必做，最简单）**：`allowance = max(protrudeMax, min(budget, CAP))`，`CAP = PROTRUDE_RATIO × medE × 1.5`（本模型 ≈ 0.052×1.5 = 0.078；保留尺度归一化，粗网格 fixture 自动放大，不误杀）。效果：指尖 allowance 降到 0.078 < 0.088 → 0.088 的新大平面被拒。副作用：高曲率区（手/耳/袜口）若原预算 > cap 会被收紧 → 减面率进一步下降（质量优先可接受，见 §3）。
2. **区分「微特征 vs 曲面曲率」预算（可选，更准）**：`computeVertexProtrudeBudgets` 只在**面积 > 某阈值（如 1e-3）**的三角形上累计突起预算（微特征面积 ≤5e-4 不贡献预算），避免微特征污染预算。可与 cap 二选一或叠加。
3. **后处理局部修复（暂不做，复杂度高）**：减面后扫描残留突起面，做局部拆分/换边/锁定。任务明确「不新增实现复杂度」优先，本轮不落。
4. **保留 drift 观察**：四轮报告已发现「折叠后邻接折叠漂移使突起增长」；cap 后仍可能有少量残留，属「≤ 原始基线 8 个/0.098」验收范围内的接受项。

---

## 3. 质量优先策略落地

### 3.1 关键数据：四轮突起守卫的减面代价

| 档位 | 三轮 LOD50/25/10 | 四轮 LOD50/25/10 | 说明 |
|---|---|---|---|
| LOD50 | 27113 | 27113 | 两者相同（target 27114 都达） |
| LOD25 | **19668** | **26082** | 四轮地板被突起守卫抬高 **+6414** |
| LOD10 | 19668 | 26082 | 同上（LOD25/10 已同值 = 无效档位） |

- 四轮突起守卫的代价**只在深度减面**（<27113）体现；LOD50 本身免费。
- 当前地板 26082 = 48.1% 减面（保留 51.9%）。修洞 + cap 预算后地板只会**更高**（更多拒绝），具体值待 Flash 实测，但方向明确：**地板 ≥ 26082**。

### 3.2 demo 四档 LOD 怎么定（质量优先）

放弃「LOD25/10」这种名不副实的档位，改为**名义比例 ≥ 实际地板**、每档都「名义可达且质量干净」：

| 档位 | target-ratio | 预期三角形 | reductionMet | 说明 |
|---|---|---|---|---|
| LOD 100% | 1.0 | 54228 | true | 原始 |
| LOD 70% | 0.7 | ~37960 | true | 新档 |
| LOD 55% | 0.55 | ~29825 | true（保守） | 新档 |
| LOD 50% | 0.5 | ~27113 | true（修洞后若 >27114 则 false，可接受） | 保持 |

> 若修洞 + cap 预算后地板 > 29825，则把 LOD55/50 都贴地板（HUD 显示「保护地板已达」，同现状 README 已有措辞）。原则：**每个档位要么达标，要么明确贴地板**，不再出现「LOD25 与 LOD10 完全相同」的假档位。

### 3.3 需要改的文件（Flash 执行）

- `scripts/prepare-demo.mjs`：`LODS` 数组从 `[1.0, 0.5, 0.25, 0.1]` 改为 `[1.0, 0.7, 0.55, 0.5]`（label 同步 `LOD 100%/70%/55%/50%`）。
- `demo/assets/stats.json`：重生成后 LOD25/10 条目消失、出现 LOD70/55（`prepare-demo.mjs` 自动产出，无需手改）。
- `README.md`：§Demo 表格（LOD 100/50/25/10 → 100/70/55/50）、「--target-tri 20000 不可达」的示例改为「--target-tri 低于地板时 reductionMet=false」，floor 描述从「26082」改为「待实测（≥26082）」。
- `scripts/real-model-check.mjs`：默认 `--target-ratio 0.5` 保留，但**去掉 `--target-tri 20000` 相关文档示例**（README 两处 `--target-tri 20000`），改为仅 `--target-ratio`；若坚持保留 target-tri 示例，值改成 ≥ 地板（如 28000）。`expected-state`（stats.json 里 `reductionMet` 对 LOD25/10 是 false）同步为 LOD70/55 的 true。
- `verify.mjs`：`checkParseable` 里 `triWithinTarget = newTri <= triLimit` 对贴地板的档位会 false——若 demo 档位都改成「名义比例 ≥ 地板」，则 verify 默认 `--target-ratio 0.5` 仍绿；无需改 verify 逻辑本身，只改 demo 档位定义即可。

### 3.4 验收矩阵修订

- 破面 0（新加，见 §5 BDD）：**输出边界边空间 ⊆ 输入边界边**（全局 + 袜子 y13-16 / 屁股 y17-19 两个子区域分别 0 新增）。
- 指尖突起：`突起>0.08 面数 ≤ 输入（8）` **且 `maxProtrude ≤ 输入 max（0.098）`**（新增 max 断言）。
- 减面率：**不再硬性要求 reductionMet**；LOD50 若 >27114 可接受，仅记录。
- `real-model-check`：`--target-tri 20000` 弃用 → 改用 `--target-ratio 0.5`（或 ≥ 地板值），`expected-state` 同步为「quality-first：reductionMet 可为 false」。

---

## 4. BDD RED 方案（兄弟硬性要求：断言必须能抓 bug）

### 4.1 破面回归（P0，核心新增）

**现状缺陷**：现有洞集成断言 `sliverTubeOutBoundary <= sliverTubeInBoundary`（`steps.ts:605-606`）只比**总边界数**，四轮输出总边界 12337 < 输入 13940，**该断言恒绿，抓不到回归**。必须升级为**空间边界包含**断言。

**Scenario A（单元级，抓 `removesSlit` 豁免漏洞）**：
- Given：构造「内部边 (0,1) 一端落边界 + 被移除三角形含共点边（<NEAR_DEGENERATE_EDGE）」的折叠候选（复用 B2 rim-corner 结构，把其中被移除三角形加一条近退化边）。
- When：调用收窄后的洞检测（`collapseCreatesHole` 带 `ignoreEdges`，或新抽出的 `collapseCreatesHoleNarrow`）。
- Then：对「非共点边」产生的内部→边界洞返回 true（拒绝）；对「仅共点边分离」返回 false（不误杀）。
- **RED 触发**：把收窄逻辑退化回「removesSlit 恒跳过洞检测」→ 内部→边界洞被放行 → 断言失败。

**Scenario B（集成级，抓「突起守卫改变顺序 → 洞」回归）**：
- Given：合成**混合 fixture** = 细管（R=0.3/16 段×20 环，袜子/手指比例，开放薄壳）+ 在管壁中段贴一簇**近共面微三角**（触发突起守卫大量拒绝）+ 注入 1 处**共点近退化微片**（触发 removesSlit）。复用 `buildRawMeshPmx` 输出。
- When：`reduce.mjs --target-ratio 0.5`（关 morph/seams/min-retention，同现有细管场景）。
- Then：**输出边界边空间 ⊆ 输入边界边**（新增 helper `countSpatiallyNewBoundaryEdges(mIn, mOut)`：输出每条边界边中点距输入边界边最小距离 < tol 才匹配，否则计数；断言 = 0）。
- And：输出无共享>2 非流形边（保留现有断言）。
- **RED 触发**：revert 突起守卫（`collapseProtrudes` 恒 false）或 revert 洞守卫（`collapseCreatesHole` 恒 false / removesSlit 恒豁免）→ 顺序改变/豁免盲区 → 空间新边界边 > 0 → 断言失败；恢复守卫 → 0 → 绿。

**helper 接线**：`pmx-face-reduce-check.mjs` 新增 `countSpatiallyNewBoundaryEdges` + `mixedTubeOutNewBnd`/`mixedTubeInBnd` 字段；feature 新增 2 个 Scenario；`steps.ts` 新增步骤。

### 4.2 残留突起（P3，加强）

**Scenario C（单元级，抓预算 cap）**：
- Given：构造「平面条带 + 折叠使顶点戳出 `PROTRUDE_MAX` 但 < 原预算」候选，传入预算数组（模拟指尖 0.098 预算）。
- When：调用 `collapseProtrudes(..., budgets)`。
- Then：cap 后返回 true（拒绝，不再被 0.098 预算放行）。
- And：戳出 < cap 的正常高曲率折叠仍 false（cap 不误杀）。
- **RED 触发**：去掉 cap（`allowance = max(protrudeMax, budget)` 不变）→ 0.088 级突起被预算放行 → 断言失败。

**Scenario D（集成级，加强现有指尖 fixture 断言）**：
- 在现有「减面输出不新增凸起面与翻转面（指尖 fixture）」场景加一条：
- And：`fingerTipOutProtrudeWorst <= fingerTipInProtrudeWorst`（输出最大突起 ≤ 输入最大突起）。
- helper 已有 `fingerTipInProtrudeWorst`/`fingerTipOutProtrudeWorst` 字段（`check.mjs:896/910`），只补 steps 断言即可。
- **RED 触发**：revert 预算 cap → 指尖 fixture 输出 maxProtrude 超过输入 max → 断言失败。

### 4.3 断言总表（RED 触发方式）

| 断言 | 现有/新增 | RED 触发 |
|---|---|---|
| 输出边界边空间 ⊆ 输入（混合 fixture） | 新增 | revert 突起守卫 或 removesSlit 恒豁免 |
| `collapseCreatesHole` 收窄：非共点洞拒绝 / 共点分离放行 | 新增 | 退化回 removesSlit 恒跳过 |
| 指尖 maxProtrude ≤ 输入 max | 加强 | revert 预算 cap |
| `collapseProtrudes` 预算 cap：0.066~预算区间拒绝 | 新增 | 去掉 cap |
| 输出无非流形 + 边界不扩大（现有） | 保留 | 现有 RED 已覆盖 |

---

## 5. Flash 执行步骤清单

0. **清理 + 度量口径统一**：`git status` 确认工作树干净（当前已干净）。在 `qem.mjs`/`verify.mjs`/`check.mjs` 统一突起度量 = `diag-fingertip.mjs` 的「顶点到 1-ring 邻接面最大距离」（抽成可导出函数，单一来源）。
1. **修 `removesSlit`（P0）**：`collapseCreatesHole` 增 `ignoreEdges` 参；`collapseStep` 里 `removesSlit` 时收集共点边 key 传入，只豁免该边、仍拒绝其它洞。`stats` 加 `newHoleEdges`（可选）。
2. **加减面后洞校验（P0 兜底）**：`collapseMesh` 返回前只读扫描输出边界边 vs 输入边界边（空间匹配），命中即 `stats.newHoleEdges`（供 verify/BDD）。本轮最小集可先只透出统计，verify 再断言 0。
3. **预算 cap（P3）**：`collapseProtrudes` 的 `allowance` 改为 `max(protrudeMax, min(budget, CAP))`，`CAP` 常量导出（`PROTRUDE_RATIO × medE × 1.5` 或独立常量，供 BDD import）。
4. **BDD**：按 §4 改 `check.mjs` + `feature` + `steps.ts`。
5. **RED 验证**：先 `npx jest test/step-definitions/pmx-face-reduce.steps.ts` 确认现有 22 场景全绿（基线）；再临时 revert 收窄逻辑/cap → 新增断言应红；恢复 → 绿。
6. **真实模型回归**：`node scripts/prepare-demo.mjs`（重生成 4 档）；`diag-holes.mjs` + `diag-newbnd.mjs`（临时脚本，输出边界边空间 ⊆ 输入、袜子/屁股区 0 新增）；`diag-fingertip.mjs`（max ≤ 0.098、面数 ≤ 8）；`real-model-check.mjs`（改 --target-ratio）。
7. **提交**：一轮一个 commit（修 removesSlit → 减面后校验 → 预算 cap → BDD → demo 档位/README）。

---

## 6. 验证矩阵

| 检查 | 工具/命令 | 修复前（RED 基线） | 修复后（GREEN 目标） |
|---|---|---|---|
| 单元：非共点洞被拒 | jest Scenario A | removesSlit 恒豁免 → 红 | 收窄后拒绝 → 绿 |
| 集成：混合 fixture 无空间新边界边 | jest Scenario B | revert 突起守卫 → 红 | 0 新边界 → 绿 |
| 单元：预算 cap 拒绝 0.066~预算突起 | jest Scenario C | 无 cap → 红 | 拒绝 → 绿 |
| 集成：指尖 maxProtrude ≤ 输入 max | jest Scenario D | revert cap → 红 | ≤ → 绿 |
| 现有 22 场景回归 | `npx jest` | — | 全绿 |
| 袜子/屁股区新边界边 | `diag-newbnd.mjs` | sock 10 / buruma 6 | 0 / 0 |
| 指尖突起面/max | `diag-fingertip.mjs` | 6 / 0.088(或 0.133) | ≤8 / ≤0.098 |
| 减面达标 | `stats.json` / reduce JSON | LOD50 reductionMet=true | 可为 false（质量优先） |
| verify 全绿 | `verify.mjs` | — | 退出码 0 |

---

## 附：本轮关键诊断数据（供 Flash 复查）

- 四轮 LOD50 守卫统计：collapses 14325 / rejected 22430 / **protrudeRejects 11139** / holeRejects 6721 / linkRejects 13 / foldOverRejects 201 / shapeRejects 3826 / materialRejects 530 / lockedCount 12186。
- `removesSlit` 触发 61 次（全 y 20-21），其中 30 次 `collapseCreatesHole` 本会返回 true（洞穿透）；折叠后实测 45 条「内部→边界」新边界边，模式 `cu=2/cv=1 post=1`。
- 三轮 vs 四轮地板：LOD25/10 = 19668 vs 26082（突起守卫代价 +6414 面）。
- 残留突起最显著面：`@[±8.76,14.83,0.26]`，顶点 `[8.856,14.800,0.142] [8.625,14.925,0.288] [8.791,14.751,0.342]`，1-ring 突起 0.0884、2-ring 0.0931、area 0.0262、maxL 0.301；`PROTRUDE_MAX=0.05` 实验对残留无影响（仍 6 个）。
- 模型布局（材质 y 范围）：Hair y 11.2-25.7（长发尖垂到 y11-15=袜子区）、BurumaSet 内裤 y 0-19.8、Body all y 1.7-20.4、尾巴 y 3.1-12.9、Alpha/Body y 19.8-22.8（头）。
- 输入近退化边（<1e-4）共 84 条：butt 45 / mid 39；零面积三角形 49（dropDegenerate 丢弃）。
