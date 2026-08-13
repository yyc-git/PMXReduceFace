# PMXReduceFace 第六轮：曲率感知三角形尺寸守卫 + 断言升级 — 视觉质量根因修复方案

> 状态：仅方案，未改任何源码/测试/README。
> 前置：fix5（`9c1cfbd`）BDD 26/26 全绿、真实模型诊断全绿，但兄弟视觉实测 LOD50 仍有「指尖圆锥体」与「袜子/内裤屁股破面」。
> 数据来源：本文所有数字均来自 fix5 产物的脚本实测（`diag-fingertip.mjs`、`_tmp-sock-diag.mjs` 落盘 `_tmp-sock-diag.json`），无拍脑袋值。
> 结论一句话：**fix5 的守卫只限制「顶点戳出邻面的距离（protrude）」，从不限制「三角形本身有多大（面积/跨度）」；QEM 在球面/指尖等高曲率区把局部小三角形合并成跨曲面大平面，突起距离不超标但形态失控 → 视觉圆锥体/破面。本轮给折叠加「相对局部输入分布的三角形尺寸上限（曲率门控）」，并把真实模型视觉质量指标固化为自动化断言（RED 能抓）。**

---

## 0. 结论速览

1. **指尖圆锥体**：突起数量断言（输出 6 ≤ 输入 8）通过但**形态**失控——输出突起三角形最大面积 0.0262 / maxL 0.301，比输入最大值（0.0182 / 0.243）**大 44%**。根因：`collapseProtrudes` 只测「顶点到 1-ring 邻接平面距离」，跨指尖穹面的**弦三角形**顶点离邻面不远（0.088~0.095，被预算 0.098 放行），但三角形跨度 0.3（手指直径才 0.3-0.5）→ 视觉圆锥体。
2. **袜子/内裤破面**：不是洞——0.05 容差下仅 1 条未匹配边界（dist 0.089）；洞守卫/空间校验正常。**是三角形尺寸爆炸**：BurumaSet 输出面积 p99 = 0.156（输入 0.078，×2.0）、maxL p99 = 1.494（输入 1.30）；输出 maxL 1.7-1.9、area 0.27-0.34 的巨型三角形质心全部 y=13.76（屁股球面）→ QEM 把球面小三角形合并成**跨曲面大平面**，平面跨球面 → 中间悬空/透空 → 视觉破面。
3. **断言为什么没抓到**（兄弟核心质疑，§1.4 逐条回答）：BDD 合成 fixture 无「高曲率球面 + 深度减面」组合；real-model-check 只查结构性指标（面数/退化/法线/权重），无视觉质量指标；diag 脚本人工跑。**修复 = 折叠守卫层加「曲率感知尺寸上限」（P0）+ 突起守卫加「大鼓包」条件（P1）+ diag 指标自动化进 verify/real-model-check 并加球面 BDD fixture（P2）。**
4. **面数代价**：新守卫拒绝更多折叠 → LOD50 地板从 27110 上升（预期 28k-32k，需校准）。质量优先，reductionMet=false 可接受（fix5 已拍板），四档 demo 重生成（`demo:prepare`）。
5. **守卫设计核心**：**拒绝条件是「相对局部输入分布」而非全局绝对阈值**——屁股球面允许的三角形比大腿平面小，指尖允许的比前臂小。预计算每顶点的「局部输入尺寸预算」（邻接输入三角形 maxL/area 的 p95）+「局部曲率」（邻接法线夹角 max），折叠候选新三角形超过 `max(全局下限, 系数 × 三顶点最小预算)` 且顶点曲率超阈值 → 拒绝。**曲率门控保证平坦区（合成网格 fixture、大腿平面）不受限、不误杀减面**（防回归的关键）。

---

## 1. 根因分析（引用 fix5 实测数据）

### 1.1 指尖圆锥体（|x|>8.0, 13.8<y<15.0）

| 指标 | 输入 | fix5 LOD50 输出 | 结论 |
|---|---|---|---|
| 突起 >0.08 三角形数 | 8 | 6 | 数量断言通过 |
| 突起三角形最大面积 | **0.0182** | **0.0262** | **输出大 44%** |
| 突起三角形最大 maxL | **0.243** | **0.301** | **输出大 24%** |
| 典型突起面 | — | tri#10122 protrude=0.088 **area=0.0262 maxL=0.301** @[8.76,14.83,0.26]；tri#10172 protrude=0.095 area=0.0073 maxL=0.172；tri#10182 protrude=0.087 area=0.0118 maxL=0.273 | — |

**机制**：fix5 的突起度量 = 三角形 3 顶点到 1-ring 邻接平面（也是折叠后平面）的最大距离。指尖穹面被合并成「跨穹面大平面」后，大平面的**顶点**离邻面 0.088（< 局部预算 0.098 → 放行），但**平面中间悬在穹面之上**——顶点距离度量不捕捉「三角形跨曲面」的形态失控。手指直径 0.3-0.5，跨度 0.301、面积 0.0262 的鼓包三角形 = 视觉「圆锥体」。

fix5 已试过收紧绝对阈值 PROTRUDE_MAX（0.066→0.05，突起面仍 6 个）与预算 cap（全局绑定后折叠顺序恶化，生产关闭）——**都证明「突起距离」这条轴修不好形态问题，必须换「三角形尺寸」这条轴。**

### 1.2 袜子/内裤屁股破面（BurumaSet 材质，输入 11116 面）

| 指标 | 输入 | fix5 LOD50 输出 | 增长 |
|---|---|---|---|
| 边界未匹配（tol 0.05） | — | **1 条**（dist 0.089 @[-3.66,17.83,0.33]） | **破面不是洞** |
| 面积 p50 / p90 / p99 | 0.0122 / 0.0347 / 0.078 | 0.0172 / **0.0622** / **0.156** | p99 **×2.0** |
| maxL p50 / p90 / p99 | 0.261 / 0.415 / 1.30 | 0.328 / **0.636** / **1.494** | p90 ×1.53 |
| 巨型三角形 | — | maxL 1.7-1.9、area 0.27-0.34，质心**全部 y=13.76（屁股球面）**、x=±1.2-1.45、z=-0.6~0.36 | 输入该形态≈0 |

**机制**：QEM 误差 = 顶点到平面距离平方和。球面相邻小三角形几乎共面（局部近似平面），QEM 认为「把 4-8 个小三角形合并成大平面」误差≈0 → 免费折叠。但球面曲率在那里：大平面跨过球面弧段后，**平面与球面的间隙（矢高）随跨度平方增长**（跨度 0.4 → 矢高≈0.02；跨度 1.8 → 矢高≈0.4）。视觉上 = 平面贴球面 → 中间悬空/前后穿插/透空 → 「屁股破面」。**洞守卫、空间边界校验全部正常，因为边界确实没动——这是纯「三角形尺寸 vs 局部曲率」失配，现有守卫体系无任何检查覆盖这条轴。**

### 1.3 机制总结

QEM 的 quadric 误差是**平面拟合误差**，天然对「跨曲率合并」失明：

```
局部平坦小三角（误差≈0 可免费合并）──QEM 认为无损──▶ 跨曲面大平面（矢高随跨度²爆炸）
```

fix5 已有守卫链：形状（退化/翻转/sliver）→ 拓扑（link/洞）→ fold-over → protrude。**缺的正是「新三角形尺寸相对局部输入分布」这一环**。本轮守卫插入点在 collapseStep（§2.5）。

### 1.4 为什么断言没抓到（兄弟核心质疑，逐条回答）

| # | 兄弟质疑 | 根因确认 | 本轮对策 |
|---|---|---|---|
| 1 | BDD 合成 fixture 复现不了真实模型复杂性 | 现有 fixture：平面网格（无曲率）、圆管/细管（曲率恒定且低于阈值）、指尖（指甲盖小但无「大球面+深度减面」组合）。**没有一个 fixture 是「高曲率曲面 + 50% 深度减面」**——这正是屁股球面破面的最小复现条件 | 新增球面 fixture（§4.2 Scenario F），RED 验证「禁守卫后出现跨曲面超尺寸三角形」 |
| 2 | real-model-check 无视觉质量指标 | 只查面数/退化/法线单位/权重归一化——全是**结构性**指标，视觉破面（大三角形跨球面）在这套断言下 100% 合法 | verify/real-model-check 新增 5 项质量断言（§4.1），`yarn test:real` 强制全绿 |
| 3 | diag 脚本手动跑人工看 | `diag-fingertip.mjs`/`_tmp-sock-diag.mjs` 是诊断工具不是断言；人工看得见的 bug 才被抓 | 两脚本核心指标（BurumaSet 面积/maxL 分位数、指尖突起面积、全局超尺寸三角形计数）固化进 verify.mjs 检查项 |
| 4 | 突起「数量 ≤ 输入」不比较形态 | 断言只比 count（6≤8），不比面积/跨度分布 → 0.0262 鼓包比输入大 44% 仍绿 | P0/P1 守卫源头禁大三角形；断言升级为「输出突起三角形最大面积 ≤ 输入最大面积」+「全局新增超尺寸三角形 = 0」 |
| 5 | 洞语义容差 0.2 对 0.3-0.5 尺度太大 | 本轮袜子边界确实没动（0.05 容差下仅 1 条 0.089）→ **破面不是洞，0.2 容差不是本轮失效原因**。「边界沿原边界回缩」是合法简化不是洞，该语义保留正确性 | 不动 HOLE_TOL 语义（本轮无洞证据充分）。「破面感」改由「尺寸 vs 曲率」断言覆盖，是**新增的断言维度**，不是改洞语义 |

---

## 2. P0（核心）：曲率感知三角形尺寸上限守卫

### 2.1 方案选择（A/B/C 评估）

| 方案 | 内容 | 评估 |
|---|---|---|
| A | 新三角形 maxL ≤ max(局部输入 maxL p95 × 系数, 全局下限) | **采用**。直接封住跨度爆炸（屁股 maxL 1.7-1.9 vs 局部 p95 0.49） |
| B | 新三角形面积 ≤ 局部输入面积 p95 × 系数 | **采用，与 A 并存**。maxL 管「跨度」，面积管「胖度」——sliver 面积≈0 但 maxL 大（已由 sliver 守卫管）；**胖三角形面积大但 maxL 中等（指尖 0.0262/0.301 正是这种）**，两条轴互补缺一不可 |
| C | quadric error 加曲率项 | **不做硬守卫**。软惩罚无硬保证、调参面大；本轮以硬守卫（A+B+曲率门控）达成同等效果且可 RED 验证。记为 future work |

**关键补充：曲率门控（curvature gating）**。对全网格无差别套 A+B 会误杀平坦区（大腿平面、合成网格 fixture）——平坦区合并大三角形视觉无害（本来就是平面）。守卫只对**顶点局部曲率超过阈值的三角形**生效：

- 屁股球面：输入三角形 maxL≈0.4-0.5，球半径≈1 → 邻边法线夹角 ≈ 2·asin(0.25) ≈ **29°** → 门控生效；
- 指尖穹面：maxL 0.24、半径≈0.3 → 夹角 ≈ **47°** → 门控生效；
- 合成网格 fixture（cell 1.0 高度场）：每 cell 法线变化 ≈ atan(0.3) ≈ **17°** < 阈值 → **跳过守卫 → 现有 12 个基础场景完全不受影响**（防回归关键设计）。

### 2.2 数据结构（预计算，输入快照，不随折叠漂移）

在 `collapseMesh` 内、`dropDegenerate` 之后（复用 `inputAlive` 快照），一次性计算每顶点三个预算数组（与 `computeVertexProtrudeBudgets` 同模式）：

```
computeVertexSizeStats(positions, tris, { aliveT, minArea = SIZE_BUDGET_MIN_AREA })
  → { sizeL: Float64Array, sizeA: Float64Array, curv: Float64Array }
```

- **sizeL[v]** = 顶点 v 邻接的「有效输入三角形」（aliveT 且面积 ≥ minArea）的 **maxL 的 p95**；
- **sizeA[v]** = 同集合的 **面积 p95**；
- **curv[v]** = 同集合中任意两邻接三角形法线夹角的**最大值**（度）。微三角形（面积 < minArea，如双面微片/近退化片）被排除——垃圾法线虚报曲率、微尺寸污染预算。
- `SIZE_BUDGET_MIN_AREA = 1e-3`（= FLIP_LOCK_AREA，单一来源复用）。指尖合法小三角面积 0.0073 ≥ 1e-3 不被误排除。
- **合并传播：不传播（immutable）**。理由：QEM 折叠后 u 的新位置始终在原始顶点 u 的局部邻域内（solveQuadric 最优位置在折叠边附近），原始顶点的输入预算始终代表其当前位置的局部尺度；三角形级检查取「三顶点最小预算」（§2.3），保守方向天然正确。传播只会引入历史污染。

### 2.3 守卫函数签名与拒绝条件

```
collapseCreatesOversizeTriangle(
  positions, tris, aliveT, vTris, u, v, newPos,
  sizeL, sizeA, curv,
  curvMinDeg = CURV_MIN_DEG,
  coefL = MAXL_COEF, coefA = AREA_COEF,
  floorL = 0, floorA = 0
) → boolean（true = 拒绝）
```

对每个受影响且存活的三角形（含 u 或 v、不同时含两者，折叠后几何）：

1. `c = max(curv[三顶点]，缺省 0)`；**若 c < curvMinDeg → continue（平坦区不设限）**；
2. `budgetL = min(sizeL[三顶点]，缺省 +∞)`；`budgetA = min(sizeA[三顶点]，缺省 +∞)`（**取最小** = 三角形触碰的最细尺度区域是约束来源——跨「球面↔平面」边界的三角形也必须满足球面尺度，这正是屁股破面三角形的形态）；
3. `maxL > max(floorL, coefL × budgetL)` → 拒绝；
4. `area > max(floorA, coefA × budgetA)` → 拒绝。

### 2.4 阈值与校准（全部基于 §1 真实数据，Flash 校准闭环见 §8）

| 常量 | 初值 | 依据 | 校准方向 |
|---|---|---|---|
| `CURV_MIN_DEG` | **20°** | 屁股球面 29°/指尖 47° 必须 ≥ 阈值；网格 fixture 17°、圆管 seg=24 ≈ 15° 必须 < 阈值 | 若圆管/细管 fixture 目标不达，上调到 25°（细管 seg=16 ≈ 23°，见 §6 风险 R2） |
| `MAXL_COEF` | **1.5**（任务建议 1.2-1.5 上限） | 屁股局部 p95≈0.49 → 许可 0.73；输出巨型 1.7-1.9 必拒 | 若 LOD50 输出 maxL p90 仍 > 0.62（断言线），降到 1.2-1.3 |
| `AREA_COEF` | **1.3** | 屁股局部 p95≈0.043 → 许可 0.056；巨型 0.27-0.34 必拒；指尖局部 p95≈0.012 → 许可 0.0156 < 鼓包 0.0262 必拒 | 同上，与面积 p99 ≤ 0.101 断言线联调 |
| `MAXL_FLOOR_RATIO`（× medE） | **1.0** | 真模型 medE≈0.13 → floor 0.13；防预算为空的顶点（无有效邻接输入三角形）被「0 预算」误杀 | fixture 尺度自动放大（grid medE≈1.0 → 1.0） |
| `AREA_FLOOR_RATIO`（× medE²） | **0.5** | 真模型 → 0.0085，低于局部 p95 一般不生效，仅兜底 | 同左 |

所有常量从 `qem.mjs` 导出（单一来源，BDD helper / verify 动态 import，沿用 fix5 防御性 import 模式）。

### 2.5 集成点（collapseStep 顺序 + stats）

插入位置：**foldOver 之后、protrude 之后、material 保护之前**（顺序：shape → link/hole → foldOver → protrude → **oversize** → material）：

```js
// qem.mjs collapseStep 内
if (collapseCreatesOversizeTriangle(positions, tris, aliveT, vTris, u, v, pos,
        sizeL, sizeA, curv, CURV_MIN_DEG, MAXL_COEF, AREA_COEF,
        floorL, floorA)) {
    e.dead = true; stats.rejected++; stats.sizeRejects++; return;
}
```

- `stats` 新增 `sizeRejects: 0`；`reduce.mjs` 结果 JSON 透出 `sizeRejects`。
- 受影响三角形折叠后几何枚举与 `affectedProtrudes` 共用同一实现（抽私有 helper `affectedPostTris`，单一来源）。
- 复杂度：每候选 O(受影响三角形数) ≤ ~20，无 heap 变更。
---

## 3. P1：突起守卫形态加强（防大鼓包）

`collapseProtrudes` 现有逻辑只比较「突起距离 vs 许可」。新增大鼓包条件——**大三角形不允许超过基础阈值的突起**（大 + 鼓 = 圆锥体）：

```
collapseProtrudes(positions, tris, aliveT, vTris, u, v, newPos,
    maxProtrude = PROTRUDE_MAX, budgets = null, protrudeCapValue = Infinity,
    sizeA = null, areaCoef = AREA_COEF, areaFloor = 0)   // 新增 3 个可选参数，向后兼容
```

对每个受影响存活三角形：

1. 现有条件不变：`newProtrude > allowance`（allowance = max(protrudeMax, min(budget, cap))）→ 拒绝；
2. **新增**：`newProtrude > maxProtrude && 三角形面积 > max(areaFloor, areaCoef × min(sizeA[三顶点]))` → 拒绝。

语义：小三角形（≤ 局部面积预算）保留预算许可（高曲率区合法微凸起不误杀）；**大三角形（> 局部面积预算）的突起不得超过基础阈值**——指尖鼓包 tri#10122（protrude 0.088 > 0.066 且 area 0.0262 > 0.0156）被拒；正常高曲率小三角折叠（面积 ≤ 预算）不受影响。

`collapseMesh` 内把已算好的 `sizeA` 传入该调用。

---

## 4. P2：断言升级（RED 能力，硬性要求）

### 4.1 verify.mjs / real-model-check.mjs 质量断言（`yarn test:real` 强制）

原则：**阈值全部在运行时从输入实测**（输入 p99/p90/突起面积），断言里只有「增长系数」（1.3/1.5 等比例常数），**不硬编码任何被测输出值**。verify.mjs 已同时加载 orig + dec，天然承载这些检查（BDD helper 复用 verify → 合成 fixture 上自动跳过）。

新增检查项（checks 对象）：

| 检查项 key | 口径（运行时实测） | 断言 |
|---|---|---|
| `qualityChecksActive` | 是否存在名字含 `BurumaSet` 的材质 | 真模型必须 true（real-model-check 额外断言；fixture 无此材质 → 各质量项跳过且视为 ok） |
| `burumaAreaP99Growth` | BurumaSet 材质三角形面积 p99：输入 vs 输出 | 输出 ≤ 输入 × **1.3**（输入 0.078 → ≤ 0.101） |
| `burumaMaxLP90Growth` | BurumaSet 材质三角形 maxL p90 | 输出 ≤ 输入 × **1.5**（输入 0.415 → ≤ 0.622） |
| `fingertipProtrudeShape` | 区域 \|x\|>8.0, 13.8<y<15.0 内突起>0.08 的三角形：数量 + 最大面积（输入 vs 输出，口径 = qem.mjs `maxProtrudeOfVerts` 单一来源） | 输出数量 ≤ 输入数量 **且** 输出最大面积 ≤ 输入最大面积（0.0262 → 必须 ≤ 0.0182） |
| `noNewOversizeTriangles` | 全局：输出 maxL > 输入全局 maxL p99（≈1.296）的三角形，逐个按「三顶点位置精确匹配（POS_TOL）」查输入三角形集合，**匹配不到 = 新增超尺寸** | 新增数量 **= 0**（输入固有的 1.9 巨型三角形被保留则能匹配 → 不计） |
| `noNonManifoldEdges`（新增，补 fix5 缺口） | 输出边共享三角形数 > 2 的边数量 | = 0 |
| `noNewHoles`（新增，补 fix5 缺口） | `countSpatiallyNewBoundaryEdges(输入, 输出)`（qem.mjs 单一来源，HOLE_TOL=0.2） | = 0 |

原有检查保留：reductionMet（可为 false，质量优先）、无退化、法线单位、权重归一化、材质一致等。

**real-model-check.mjs 扩展**：默认模型跑完 reduce+verify 后断言 `qualityChecksActive === true`（BurumaSet 必须找到）且上述质量项全绿；报告 JSON 增加 `quality` 段（含各项输入/输出实测值，供校准观察）；自定义模型（`--input`）无 BurumaSet 时质量项跳过并输出 warning，`--skip-quality` 显式跳过。全绿 exit 0。

### 4.2 BDD 新场景（26 → 29，全部带 RED 触发方式）

**Scenario E（P0 单元级）：collapseCreatesOversizeTriangle 拒绝跨局部尺寸的折叠**

- Given：构造 3 顶点曲率 40°、sizeL 预算 0.5、sizeA 预算 0.05 的折叠候选（新三角形 maxL=0.9 / area=0.08 超预算）；再构造平坦候选（曲率 0°，其余相同）。
- When：直接调用 qem.mjs `collapseCreatesOversizeTriangle`（阈值 import 自 qem.mjs）。
- Then：高曲率 + 超尺寸 → 返回 true（拒绝）；平坦 + 超尺寸 → 返回 false（曲率门控不误杀平坦区）；高曲率 + 尺寸内 → false（不误杀正常高曲率折叠）。
- **RED**：把守卫退化为恒 false → 第一条断言立即失败。

**Scenario E2（P1 单元级）：突起守卫拒绝「突起超基础阈值的大鼓包」**

- Given：复用 fix5 Scenario C 的平面 3×3 网格折叠候选（突起 P 介于 maxProtrude 与预算之间），传 sizeA 预算（如 0.01）。
- When：调用 `collapseProtrudes(..., sizeA)`。
- Then：面积超预算时返回 true（大鼓包拒绝）；传 `sizeA=null` 时返回 false（证明是新增条件在起作用，兼容旧调用）。
- **RED**：把新增条件删掉（或传 null 并断言应拒绝）→ 红。

**Scenario F（P0 集成级）：球面 fixture 减面输出无跨曲面超尺寸三角形**

- Given：新增 `buildSpherePmx(R=1, seg=12, rings=24)` 合成 fixture（576 输入三角形，seg=12 → 邻边法线夹角 30° > CURV_MIN_DEG 20° → 门控生效；输入无 sliver/无洞）。
- When：`reduce.mjs --target-ratio 0.5`。
- Then：输出每个三角形 maxL ≤ max(floorL, MAXL_COEF × 输入 p95_maxL) 且 area ≤ max(floorA, AREA_COEF × 输入 p95_area)（阈值 import 自 qem.mjs，输入 p95 运行时实测）；输出可解析且 reduce 退出码 0。
- **RED**：把 `collapseCreatesOversizeTriangle` 恒 false（或 qem.mjs 内不调用它）→ QEM 跨球面合并出大平面（实测预期 maxL > 1.0 级）→ 断言失败；恢复 → 绿。

**helper 接线**：`pmx-face-reduce-check.mjs` 新增 `buildSpherePmx` + `sphereOutMaxL/Area/inputP95` 字段 + 动态 import 新常量（沿用现有防御性 import 模式，RED 时降级本地兜底值 → 只让新增断言红、其余场景不受影响）；feature 新增 3 个 Scenario；steps.ts 新增步骤。

### 4.3 断言总表（RED 触发方式）

| 断言 | 现有/新增 | RED 触发 |
|---|---|---|
| collapseCreatesOversizeTriangle：高曲率超尺寸拒 / 平坦不误杀 / 尺寸内放行 | 新增（E） | 守卫恒 false |
| collapseProtrudes 大鼓包条件 | 新增（E2） | 删新增条件 |
| 球面 fixture 输出无超尺寸三角形 | 新增（F） | oversize 守卫不接入 collapseStep |
| real-model：BurumaSet 面积 p99 ≤ 1.3× / maxL p90 ≤ 1.5× | 新增 | 守卫恒 false 重跑 LOD50 → 断言红 |
| real-model：指尖突起数量+最大面积 ≤ 输入 | 新增 | 守卫恒 false → 0.0262 级鼓包回归 → 红 |
| real-model：全局新增超尺寸三角形 = 0 / 非流形 0 / 空间无新洞 | 新增 | 同上 |
| 现有 26 场景（结构/守卫/hole/protrude/sliver 等） | 保留 | 现有 RED 已覆盖 |
---

## 5. 面数预期与 demo

| 档位 | 现状（fix5） | fix6 预期 | 说明 |
|---|---|---|---|
| LOD50（target 27114） | 27110，reductionMet=true | **28000-32000**（地板抬升，需校准），reductionMet 可能 false | 质量优先，兄弟 13:40 拍板「面数不一定要降很低，但破面和突出的面不能忍」 |
| LOD55（target 29825） | — | 可能被新地板顶住（若地板 > 29825 → 贴地板） | 与 fix5 §3.2 同原则：每档要么达标要么明确贴地板 |
| LOD70 / LOD100 | — | 不变（守卫只影响深度减面区） | — |

- 四档 demo 重生成：`node scripts/prepare-demo.mjs`（`demo:prepare`）；stats.json 自动更新。
- README（中/英）同步：floor 描述从「26082/33493」改为 fix6 实测值；HUD 文案「已到保护下限」语义保持。
- 真实模型预期指标（校准目标，均运行时实测口径）：
  - BurumaSet 面积 p99：0.078 → ≤ 0.101；p90：0.0347 → ≤ ~0.045
  - BurumaSet maxL p90：0.415 → ≤ 0.622；巨型三角形（maxL > 1.5 且非输入固有）→ 0
  - 指尖突起面：数量 ≤ 8、最大面积 ≤ 0.0182、最大 maxL ≤ 0.243
  - 全局新增超尺寸三角形（maxL > 输入 p99 且非输入保留）→ 0

## 6. 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| R1 | 新守卫把 LOD50 地板抬得过高（>35k，视觉收益 vs 面数失衡） | 系数放松一档（MAXL_COEF 1.5→1.8 / AREA_COEF 1.3→1.6）重新校准；质量断言线（1.3×/1.5×）不动，若守卫与断言冲突以断言为硬约束调守卫 |
| R2 | 曲率门控误伤圆管/细管 fixture（seg=24 → 15°、seg=16 → 23°），现有 26 场景目标不达 | CURV_MIN_DEG 初值 20°：圆管 15° 天然跳过；细管 23° 可能门控 → 若细管场景目标不达，上调 CURV_MIN_DEG 到 25° 或验证细管目标在门控下仍可达（细管局部 p95≈0.6 → 许可 0.9，目标 480 三角应可达，先实测再定） |
| R3 | 球面 fixture（seg=12）自身门控后达不到 50% 目标（288） | 球面 R=1 许可 maxL≈0.78 → 全表面 ~84-130 三角「理论地板」远低于 288，预期可达；若不可达，fixture 改 seg=16 增加输入面数（fixture 是测试，改 fixture 不改守卫） |
| R4 | 预算 immutable 的顶点漂移假设不成立（局部尺度失真） | 折叠步长受限（单边），漂移 >1 邻域的情况需实测；若发现失真，退回「merge 时 max 累积」的传播方案（与 protrudeBudgets 同模式），三角形级仍取 min |
| R5 | 全局下限 floor 对细网格过于宽松（floorL=0.13 时允许 0.13 跨度三角形出现在曲率区小预算（<0.13）顶点上） | 指尖局部 p95 ≈ 0.19-0.24 > floor 0.13，floor 不生效；若诊断发现 floor 主导了某曲率区，把 MAXL_FLOOR_RATIO 降到 0.6 重新校准 |
| R6 | `noNewOversizeTriangles` 误伤「输入固有巨型三角形被小幅移动」的情形 | 匹配容差 POS_TOL=1e-6 太紧会把「顶点移动过」的输入三角形误计为新增 → 用输出三角形质心 vs 输入三角形质心距离 < tol（如 0.05，与洞校验同数量级）作为「输入保留」判据，精确匹配仅作快速路径 |

## 7. 硬性纪律（防止前几轮事故重演）

1. **禁止 `git checkout qem.mjs`（或 `git checkout .`）清理 RED 痕迹**——工作区有未提交改动时 checkout 全部回滚（前 3 轮 3 次事故）。RED 验证用 `git stash push src/tool/pmx-face-reduce/qem.mjs`（验证后 `git stash pop`）或手动改回单行。
2. **阈值必须基于真实模型量化数据校准**（本文 §1 数据 + Flash 实测闭环，§8 步骤 5），不拍脑袋；每个常量导出并注释校准依据（沿用 qem.mjs 现有注释风格）。
3. **只改** `src/tool/pmx-face-reduce/` + `scripts/` + `test/` + `README.md` + `demo/`，不动 `src/tool/lib/`（pmx-lib.mjs / pmx-loader.mjs）；`pmx-writer.mjs` 在 pmx-face-reduce 目录内，仅在需透出 stats 时改动。
4. 工作区现有未跟踪文件 `_tmp-sock-diag.json` / `scripts/_tmp-sock-diag.mjs`：本轮把 `_tmp-sock-diag.mjs` 转正为 `scripts/diag-sock.mjs`（去掉 `_tmp-` 前缀，纳入质量诊断工具集），`_tmp-sock-diag.json` 加 `.gitignore` 或删除，提交前 `git status` 必须无 `_tmp-` 遗留。
5. RED 实录：每个新断言都要记录「禁守卫 → Expected/Received」实测输出进 commit message 或 feature 注释（fix5 惯例）。

## 8. Flash 执行步骤清单

0. `git status` 确认工作树干净（除上述 _tmp 文件）；`git stash list` 为空。
1. **P0 守卫**：qem.mjs 新增常量 + `computeVertexSizeStats` + `collapseCreatesOversizeTriangle` + `affectedPostTris` 抽取 + collapseStep 接入 + `stats.sizeRejects`；reduce.mjs 透出 `sizeRejects`。
2. **P1 守卫**：`collapseProtrudes` 加 3 个可选参数与新条件；collapseMesh 传入 `sizeA`。
3. **BDD**：check.mjs（`buildSpherePmx` + 字段 + 动态 import 新常量）→ feature（3 个 Scenario）→ steps.ts。
4. **RED 验证**（基线 → 逐项 RED → 恢复）：
   - `npx jest` 现有 26 场景全绿基线；
   - Scenario E/E2/F：禁对应守卫 → 断言红（记录 Expected/Received）→ 恢复 → 绿；
   - 现有 12 个基础网格场景在守卫启用下仍全绿（验证曲率门控不误杀，R2/R3 风险在此排除）。
5. **真实模型校准闭环**：`node scripts/diag-sock.mjs` + `diag-fingertip.mjs` 重跑 LOD50 → 对照 §5 指标表；不达标按 §2.4 校准方向调系数 → 重跑直至达标；记录最终系数 + 实测值进 README/常量注释。
6. **verify/real-model-check 升级**：verify.mjs 新增 7 项检查（§4.1）+ real-model-check.mjs 质量断言段 → `yarn test:real` 全绿（真模型实测值落报告）。
7. **demo 重生成**：`node scripts/prepare-demo.mjs` → stats.json；README 中英同步（floor 数字、HUD 说明、新增质量指标表）。
8. **提交**：一轮一 commit（P0 守卫 → P1 → BDD → 断言升级 → demo/README）。

## 9. 验证矩阵

| 检查 | 命令 | 修复前（RED 基线） | 修复后（GREEN 目标） |
|---|---|---|---|
| 类型检查 | `npx tsc --noEmit` | 通过 | 通过 |
| BDD 26 场景基线 | `npx jest` | 26/26 绿 | 26/26 绿（守卫启用不回归） |
| BDD 新增 3 场景 | `npx jest` | E/E2/F 禁守卫红（实录 Expected/Received） | 29/29 绿 |
| 真实模型质量断言 | `yarn test:real` | BurumaSet p99 0.156 > 0.101 → 红 | 全绿（quality 段实测值达标） |
| 袜子诊断 | `diag-sock.mjs` | area p99 0.156 / maxL p90 0.636 / 巨型 0.27-0.34 | p99 ≤ 0.101 / p90 ≤ 0.622 / 巨型新增 0 |
| 指尖诊断 | `diag-fingertip.mjs` | 突起 6 个、最大面积 0.0262 / maxL 0.301 | 数量 ≤ 8、最大面积 ≤ 0.0182、maxL ≤ 0.243 |
| 洞/边界 | `diag-sock.mjs` unmatchedBndCount | 1（0.089，非洞） | ≤ 1（非洞语义不变） |
| demo 四档 | `node scripts/prepare-demo.mjs` | LOD50 27110 | 28000-32000（质量优先，记录地板） |
| 现有 RED 回归 | fix4/fix5 的 RED 清单抽查 | — | 无回归 |

## 附：本轮关键数据（供 Flash 复查，均 fix5 产物实测）

- BurumaSet 输入 11116 面：面积 p50/p90/p99 = 0.0122/0.0347/0.078，maxL p50/p90/p99 = 0.261/0.415/1.296；输出 6717 面：面积 p99=0.156（×2.0）、maxL p99=1.494；巨型三角形（maxL 1.7-1.9 / area 0.27-0.34）质心全部 y=13.76、x=±1.2-1.45、z=-0.6~0.36。
- 指尖（|x|>8.0, 13.8<y<15.0）：突起>0.08 面 8→6；突起面最大面积 0.0182→0.0262、maxL 0.243→0.301；tri#10122 protrude=0.088 area=0.0262 maxL=0.301 @[8.76,14.83,0.26]。
- 边界：0.05 容差下输出仅 1 条未匹配（dist 0.089 @[-3.66,17.83,0.33]）→ 非洞。
- 曲率估计：屁股球面 ≈29°/指尖穹面 ≈47°/网格 fixture ≈17°/圆管 seg24 ≈15°/细管 seg16 ≈23°。


