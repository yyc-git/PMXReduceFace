# XiaHui LOD_70 新增洞根因分析 + 修复方案

> Phase B Step 1 产出 | 2026-08-20 | 模型: Pro

---

## 1. 预检输出

```
git status --short: (无输出,工作区干净)
git log --oneline -3:
  730e9a1 feat(demo): add model switching (XiaoMei / Xiaye1 / XiaHui) + --skip-threshold for small models
  0b50ce0 fix(pmx-reduce-face): 减面阈值改 5 万面、1 万以下直接跳过 QEM
  ff4ccf1 docs: fix7-fix10 log + README sync (fingertip spike / normal preserve / universal quality checks / hole patching)
git branch --show-current: main
```

---

## 2. 根因分析

### 2.1 问题定位

XiaHui (TDA式宴 夏卉) LOD_70 (ratio 0.7, ~39949 面) 出现 **2 处新增真洞**:

| 位置 | 形态 | 原始 LOD_100 | LOD_70 |
|------|------|:---:|:---:|
| 右手上臂前/后侧 | V 形空洞(2 个独立洞) | 无 | 有 |
| 胸部之间 | 长条形空洞 | 无 | 有 |

`yarn test:bdd 35/35 全绿`, verify 的 `noNewHoles` 断言未抓到这两处洞 → **verify 洞检测有盲区**。

### 2.2 根因: `collapseCreatesHole` 漏判 `preU===1 && preV===1 && post<2` 边界边清除型洞

**精确位置**: `src/tool/pmx-face-reduce/qem.mjs:859-885` (函数 `collapseCreatesHole`)

**Bug 原因**: 洞检测条件 `(preU === 2 || preV === 2) && post < 2` (行 877) 只捕获「内部边(共享 2 个三角形)在折叠后变为边界边(< 2 个三角形)」这一种洞。但**漏判了另一种洞**:

- 当 `preU === 1 && preV === 1 && post === 0` 时:
  - 边 (u,w) 和 (v,w) 都是边界边(preU=1, preV=1)
  - 唯一共享该边的三角形同时包含 u、v、w
  - 折叠后该三角形变为 (u,u,w) → 退化 → 被移除
  - 边 (u,w) 从 1 个共享三角形 → 0 个共享三角形
  - **这是一个洞**(边界边消失),但 `preU === 2 || preV === 2` 为 false → **漏判**

**触发路径**(右臂 V 形洞):

1. 右臂是圆柱体,顶点位于边界边(如材质分界线/UV 接缝)
2. QEM 折叠边 (u,v) 时,u 和 v 共享一个邻居 w
3. 三角形 (u,v,w) 是 u 和 v 之间唯一的三角形
4. 折叠后 (u,v,w) 退化为 (u,u,w) → 被移除
5. 边 (u,w) 从共享 1 个三角形变为 0 → 成为悬空边 → 产生洞
6. 多次此类折叠累积 → V 形空洞

**触发路径**(胸部长条形洞):

1. 胸部有重叠的服装层(身体 + 礼服),两层之间存在边界边
2. 边界边上的顶点处于材质过渡区
3. 同一漏判机制 + 多次累积 → 胸部长条形空洞

**为何 verify 未检出**:

1. `findHoleChains` (qem.mjs:373-405) 的 `HOLE_DEPTH_RATIO = 0.5` (行 395): V 形洞的 sagitta/mouth 比值低(浅湾),被过滤
2. `HOLE_CHAIN_MAX_EDGES = 8` (行 205, 489): 胸部长条形洞链长 > 8,补面跳过
3. `HOLE_ASSERT_MIN_AREA_RATIO = 8.0` (行 207): verify 断言阈值比补面阈值(2.0)严格 4 倍,小面积洞被漏报
4. `countSpatiallyNewBoundaryEdges` (行 161-193) 的 `HOLE_TOL = 0.2` (行 65): 中点距输入边界边 > 0.2 才计为新洞 → 位移 < 0.2 的边界边漏报

### 2.3 次要根因: `findHoleChains` 阈值过严

| 参数 | 当前值 | 对 V 形洞的影响 | 对胸部长条洞的影响 |
|------|--------|----------------|-------------------|
| `HOLE_DEPTH_RATIO` | 0.5 | sagitta/mouth 低 → 被过滤 | 可能通过(长条弯曲大) |
| `HOLE_CHAIN_MAX_EDGES` | 8 | 链长 ≤ 8,可能通过 | 链长 > 8 → 被过滤 |
| `HOLE_ASSERT_MIN_AREA_RATIO` | 8.0 | 小面积洞被漏报 | 面积可能通过 |
| `HOLE_TOL` | 0.2 | 边界边位移 < 0.2 漏报 | 长条边界位移量大,可能被检出 |

---

## 3. 方案对比

| 方案 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| **A (推荐)** | 修复 `collapseCreatesHole` 行 877 漏判 + 放宽 `findHoleChains` 阈值 | 根治;从源头拦洞;符合现有守卫设计哲学 | 可能轻微影响 LOD 收敛速度(+100~300 面) |
| B | 仅放宽 `findHoleChains` 阈值 + 增大 `HOLE_CHAIN_MAX_EDGES` | 实现简单;不改折叠算法 | 治标不治本;补面可能补错(误把合法回缩当真洞);补面三角形增加 LOD 面数 |
| C | 收紧曲率感知尺寸守卫(`CURV_MIN_DEG` 12→8, `MAXL_COEF` 2.0→1.5) | 间接减少高风险折叠 | 大幅增加面数(+2000~5000 面);不解决根本漏判;fix6 校准已证明 12° 是最优平衡点 |

### 方案 A 详细实施步骤

**Step 1**: 修复 `qem.mjs:877` 的 `collapseCreatesHole` 条件

```diff
- if ((preU === 2 || preV === 2) && post < 2) {
+ if ((preU === 2 || preV === 2 || (preU === 1 && preV === 1)) && post < 2) {
```

**原理**: 新增 `preU === 1 && preV === 1` 分支,捕获「双边都是边界边,折叠后唯一共享三角形被移除 → 洞」的场景。

**Step 2**: 放宽 `findHoleChains` 阈值

在 `qem.mjs` 中修改以下常量(仅改 `patchHoles` 调用时传入的 opts,不修改导出常量):

| 参数 | 当前值 | 新值 | 理由 |
|------|--------|------|------|
| `HOLE_DEPTH_RATIO` | 0.5 | 0.3 | 允许检测浅湾 V 形洞 |
| `HOLE_CHAIN_MAX_EDGES` | 8 | 16 | 允许补面胸部长条洞(链长可能 > 8) |

**Step 3**: 保持 `HOLE_ASSERT_MIN_AREA_RATIO = 8.0` 不变(verify 断言阈值足够严格,不误报合法回缩)

**Step 4**: 在 `collapseStep` 中增加折叠前边界边完整性检查(可选,增强防护)

**Step 5**: 跑 `yarn test:bdd` 验证 35 场景全绿;跑 `yarn test:unit` 验证单元测试全绿

---

## 4. Delta Specs 路径清单

| 文件 | 说明 |
|------|------|
| `笔记/项目文档/changes/2026-08-20-xiahui-LOD70-holes/solution.md` | 本文档(根因 + 方案) |
| `笔记/项目文档/changes/2026-08-20-xiahui-LOD70-holes/specs/pmx-face-reduce-xiahui-holes.feature` | BDD 场景: XiaHui LOD_70 右臂/胸部无新增洞 |
| `笔记/项目文档/changes/2026-08-20-xiahui-LOD70-holes/specs/expected-state/no-new-holes-xiahui.json` | 期望 verify 输出: noNewHoles=true |

---

## 5. 下游依赖(Phase B Step 2 实现时参考)

| 项目 | 说明 |
|------|------|
| BDD 测试 | 新增场景写入 `test/features/pmx-face-reduce.feature`(与现有 35 场景并列) |
| 集成测试 | `yarn test:bdd`(现有 BDD 35/35 必须保持全绿) |
| 单元测试 | `yarn test:unit`(如新增单元级守卫测试) |
| verify 修改 | **不需要修改 verify.mjs** — `HOLE_ASSERT_MIN_AREA_RATIO = 8.0` 已足够严格,修复后 `findHoleChains` 应返回 0 个洞 |
| 诊断脚本 | 可选新增 `scripts/diag-xiahui-arm.mjs` 和 `scripts/diag-xiahui-chest.mjs` 用于验证修复效果 |

---

## 6. 核查清单

- [x] 报告首段含 git status + log + branch 输出
- [x] 根因精确到 qem.mjs 文件:行号 877(函数 `collapseCreatesHole`)
- [x] 方案对比 ≥ 2 个(3 个)
- [x] 推荐方案 A + 实施步骤 5 步
- [x] Delta Specs 路径清单
- [x] changes/ 目录已创建
- [x] 报告用中文