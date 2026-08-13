# PMXReduceFace

**MMD PMX 模型减面工具**：基于 **QEM 约束边折叠**，在保留 morph、UV 接缝与小材质的前提下削减模型面数。减面后的 PMX 可直接在 MMD 中使用，配合预生成的 LOD 档可在游戏/渲染中按距离切换。

> 背景：PMX 模型常携带大量高模面数，直接压低会破坏表情 morph、撕裂 UV 接缝、削掉小材质细节。本工具用二次误差度量（QEM）逐个折叠代价最低的边，同时用「锁定集 + 材质保护」守住不可动的结构 —— 面数降下来，该留的都留下。

## ✨ 特性

- **QEM 约束边折叠**：二次误差度量（`quadric.mjs` 纯数学零依赖）求每边折叠代价，每次折叠代价最低边
- **细长条 sliver 防护**：折叠代价前校验形状，拒绝会产生「细且长」三角形（aspect ≥ 10 且最长边 ≥ 0.5）的折叠 —— 防止头部/手指/袜子等处冒出长条、多余三角与破面
- **拓扑守卫（防洞）**：边折叠前用 link condition（Hoppe 1996）+ 洞检测拒绝会制造「非流形边」（共享 >2）或把内部边变边界（洞）的折叠 —— 袜子/内裤等薄壳不再露洞
- **折叠翻转防护**：拒绝折叠后新三角形与相邻三角形法线夹角突变（>120°）的候选 —— 手指等细长圆柱高曲率区不再冒出多余面片
- **保留 morph**：顶点位移/UV 等 morph 引用的顶点全部进入锁定集，折叠后 morph 索引自动重映射
- **保留 UV 接缝**：空间重合顶点聚类（`findSeamClusters`），接缝两侧顶点锁定，UV 贴图不撕裂
- **小材质自动保护**：原始面数 ≤ 500 的材质（眼睛、睫毛等细节）默认 100% 保留
- **材质级锁定**：`--lock-materials` 指定材质（如脸/眼）整组保留，保留率 ≥ 90%（verify 断言）
- **min-retention 保底**：每材质最多削到原面数的 `--min-retention` 比例，防止某部位过度减面
- **双目标控制**：`--target-ratio`（比例）与 `--target-tri`（绝对三角形数）任选其一
- **字节级重写**：减面段（顶点/面/材质面数）就地重写，morph/骨/刚体等未减面段原样保留
- **内置验证**：`verify.mjs` 全量断言（锁定顶点保留 / 无退化 / 法线单位 / 权重归一化 / 材质一致）
- **MIT 协议**：完全开源，可自由商用

## 🚀 快速开始

### 安装

```bash
git clone git@github.com:yyc-git/PMXReduceFace.git
cd PMXReduceFace
yarn install
```

> 环境要求：Node.js 22+（`mmdparser.module.js` 为 ESM，`require()` 加载需 Node ≥22），使用 yarn（推荐）或 npm。

### 减面 + 验证

```bash
yarn test:bdd       # BDD 全绿（19 场景）
npx tsc --noEmit    # 类型检查
```

### 核心 CLI

```bash
# 按比例减半面数
node src/tool/pmx-face-reduce/reduce.mjs --input in.pmx --output out.pmx --target-ratio 0.5

# 完整参数
node src/tool/pmx-face-reduce/reduce.mjs \
  --input in.pmx --output out.pmx \
  --target-ratio 0.5 \
  [--target-tri 20000] \
  [--lock-morph true] \
  [--lock-seams true] \
  [--lock-materials "0,1"] \
  [--min-retention 0.3] \
  [--lock-small-materials true]

# 安装为 npm 依赖后可直接用 bin
npx pmx-reduce-face --input in.pmx --output out.pmx --target-ratio 0.5
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `--input` | 必填 | 输入 PMX 路径 |
| `--output` | 必填 | 输出 PMX 路径 |
| `--target-ratio` | `0.5` | 目标三角形数 = `ceil(原始三角形数 × ratio)` |
| `--target-tri` | 无 | 绝对目标三角形数，与 `--target-ratio` 并存时优先 |
| `--lock-morph` | `true` | morph 引用顶点是否锁定（`false` 关闭）。⚠️ 关闭后含顶点 morph 的模型上，被移除顶点的 morph 元素会被**丢弃**（morph 可能变空），reduce 会输出警告；此时 verify 需传 `--lock-morph false` 且 morph 位置锁定断言不适用 |
| `--lock-seams` | `true` | 空间重合接缝顶点是否锁定（`false` 关闭） |
| `--lock-materials` | 无 | 逗号分隔材质索引（如 `"0,1"`），整组锁定 |
| `--min-retention` | `0.3` | 大材质最低保留比例（0 = 关闭动态保护） |
| `--lock-small-materials` | `true` | 小材质（≤500 面）是否 100% 保留（`false` 关闭） |

`reduce.mjs` 的 stdout 输出统计 JSON（`originalTriangles` / `newTriangles` / `reductionRatio` / `perMaterial` / `reductionMet` 等），失败退出码非 0。

### 验证 CLI

```bash
node src/tool/pmx-face-reduce/verify.mjs in.pmx out.pmx --target-ratio 0.5 [--target-tri N] [--lock-morph true] [--lock-seams true] [--lock-materials "0,1"] [--min-retention 0.3] [--lock-small-materials true]
# 全绿退出码 0；stdout JSON 报告（ok / checks / errorCount / errors / stats / perMaterial）
npx pmx-reduce-face-verify in.pmx out.pmx --target-ratio 0.5
```

> ⚠️ **verify 的锁定参数必须与 reduce 一致**：若 reduce 用了 `--lock-morph false` / `--lock-seams false`，verify 必须传相同参数，否则「morph/接缝顶点锁定」断言会按默认锁定集校验而误报（此时锁定顶点位置断言不适用）。

> ⚠️ **`--target-tri` 与保护下限**：`--min-retention` 与小材质锁定合计出一个「保底三角形数」，任何减面都不会低于它。若 `--target-tri` 低于保底，减面会在保底处停下 —— 工具不报错，但 `newTriangles > target` → 统计里的 `reductionMet=false`，`verify` 的 `triWithinTarget=false` 红。选目标时请让 `--target-tri ≥ 保底`（demo 模型保底约 19668 面，其中含细长条 sliver + 拓扑/翻转守卫额外拦下的少量折叠）。

## 🔬 核心 API

`.mjs` 纯函数模块，可直接 `import` 使用（`npm i pmx-reduce-face` 后从 `node_modules` 导入）：

```js
import { reduceFaces } from 'pmx-reduce-face/src/tool/pmx-face-reduce/reduce.mjs';
import { verifyFaces } from 'pmx-reduce-face/src/tool/pmx-face-reduce/verify.mjs';
import { collapseMesh } from 'pmx-reduce-face/src/tool/pmx-face-reduce/qem.mjs';
import { buildLockedSet } from 'pmx-reduce-face/src/tool/pmx-face-reduce/lock-set.mjs';
```

**`reduceFaces(options)`** — 完整减面流程（等价于 CLI）

| 参数 | 默认 | 说明 |
|------|------|------|
| `input` | 必填 | 输入 PMX 路径 |
| `output` | 必填 | 输出 PMX 路径 |
| `targetRatio` | `0.5` | 比例目标 |
| `targetTriangles` | `null` | 绝对目标（优先） |
| `lockMorph` | `true` | morph 顶点锁定 |
| `lockSeams` | `true` | 接缝顶点锁定 |
| `lockMaterials` | `null` | 材质索引数组 |
| `minRetention` | `0.3` | 大材质保底比例 |
| `lockSmallMaterials` | `true` | 小材质全锁 |

返回：`{ input, output, originalVertices, newVertices, originalTriangles, newTriangles, targetTriangles, lockedCount, reductionRatio, reductionMet, perMaterial, materialProtection, collapses, rejected, durationMs }`。

**`verifyFaces(options)`** — 减面结果全量断言（等价于 verify CLI）

| 参数 | 默认 | 说明 |
|------|------|------|
| `input` / `output` | 必填 | 原文件 / 减面后文件 |
| `targetRatio` | `0.5` | 比例目标 |
| `targetTri` | `null` | 绝对目标 |
| `lockMaterials` | `null` | 与 reduce 一致的材质锁定 |
| `minRetention` | `0.3` | 材质保留断言阈值 |
| `lockSmallMaterials` | `true` | 小材质 100% 断言 |
| `lockMorph` | `true` | 与 reduce 一致的 morph 顶点锁定（`false` 时跳过「映射后顶点 = 原顶点」比对） |
| `lockSeams` | `true` | 与 reduce 一致的接缝顶点锁定 |

返回：`{ ok, checks, errorCount, errors, stats, perMaterial }`。`checks` 含 `lockedVertsPreserved` / `noDegenerateTriangles` / `noDuplicateTriangles` / `weightsNormalized` / `normalsUnitLength` / `materialSumConsistent` / `materialRetentionOk` / `protectedRetention` 等。

**`collapseMesh(params)`** — 核心边折叠引擎（QEM）

| 参数 | 默认 | 说明 |
|------|------|------|
| `vertices` | 必填 | 顶点数组（含 position） |
| `triangles` | 必填 | 三角形数组 `[[a,b,c], ...]` |
| `locked` | `Set()` | 锁定顶点集（不参与折叠） |
| `targetTriangles` | `1` | 折叠目标 |
| `dropDegenerate` | `true` | 丢弃输入中的退化三角形（重复索引/零面积） |
| `triMaterials` | `null` | 每三角形材质索引（材质保护用） |
| `minRetention` | `0.3` | 材质保底 |
| `lockSmallMaterials` | `true` | 小材质全锁 |

返回：`{ vertices, triangles, indexMap, keptTriIndices, stats }`（`stats` 含 `collapses` / `rejected` / `protectedStats`）。

**`buildLockedSet(vertices, morphs, opts)`** — 构建锁定顶点集

| 参数 | 默认 | 说明 |
|------|------|------|
| `vertices` / `morphs` | 必填 | 顶点 / morph 数组 |
| `lockMorph` | `true` | morph 引用顶点锁定 |
| `lockSeams` | `true` | 空间重合顶点聚类锁定 |
| `tolerance` | `1e-6` | 接缝聚类容差 |
| `lockMaterials` | `null` | 材质索引数组（需同时传 `faces` + `materials`） |
| `faces` / `materials` | `null` | 材质→顶点映射用 |

返回：`Set<number>`（锁定顶点索引）。

## 🔄 减面管线

```
loadPmx（three mmdparser 解析）
  → triangulateFaces（faces → 三角形数组）
  → buildLockedSet（morph 引用 + UV 接缝聚类 + 材质级锁定 → 锁定顶点集）
  → collapseMesh（QEM 边折叠 + 材质保护）
      ① 每边折叠代价 = Q（二次误差度量，qem/quadric 纯函数）
      ② 每次从堆顶取最低代价边，折叠前守卫（isValidCollapse 形状 + link condition/洞检测拓扑 + fold-over 翻转）
      ③ 每材质按 min-retention 动态保护 + 小材质全锁
      ④ 折叠完面积加权重算法线（recomputeNormals）
  → buildDecimatedPmx（字节级重写：顶点/面/材质 faceCount 就地 patch，其余段原样保留）
```

**算法要点**：

- **二次误差度量（QEM）**：每个顶点累加邻接三角形面的基础平面方程，折叠时合并两端点误差矩阵，新位置 = 使误差最小的解（`quadric.mjs` 纯线性代数，零依赖）。
- **边折叠**：每轮从最小堆取全局代价最低的边折叠 `u → v`，被折叠三角形从邻接表移除；折叠前依次校验形状（非退化 / 法线不翻转 / 细长条 sliver）、拓扑（link condition + 洞检测）与折叠翻转（fold-over），任一失败即拒绝该候选。
- **细长条 sliver 防护**：QEM 只优化几何误差（点到面距离），细长条面积≈0 会被误判为「无损失」——但视觉上是冒出的长条/多余三角。折叠前对每个存活受影响三角形校验 aspect（最长边/最短边）与最长边长度，若 `aspect ≥ 10 且 maxL ≥ 0.5`（「细且长」）则拒绝该折叠。阈值来自实测：第一轮 `aspect≥20 && maxL≥2` 消灭了「长条」（maxL≥2），但头部仍残留 1~2 的「短长条」；原始模型 `aspect≥10 && maxL≥1` 的三角形仅 154/54228（0.28%），收紧到 10/1.0 消灭减面引入的短长条；第三轮手部（|x|>4.5, y 9-18）原始 aspect>10 三角形为 0，但 LOD50 仍新增 8 个 aspect≈11、maxL≈0.5 的手指窄条（maxL<1.0 被放行）→ 再收紧到 10/0.5 清零手指窄条，对原始固有细片（集中袜子位/胸口）影响极小。
- **拓扑守卫（防洞）**：link condition（Hoppe 1996）保证折叠不制造「非流形边」（共享 >2）或「缝合」（边界→内部）；洞检测兜底拒绝「内部边变边界」（洞）的折叠（如袜子/内裤薄壳露洞）。清理近退化（共点）三角形时不视为造洞（豁免），避免卡住缺陷清理。
- **锁定集**：morph 引用顶点、UV 接缝聚类顶点、指定材质全部顶点进入锁定集 —— 锁定顶点位置永不移动，折叠时两侧等价值重新分配。
- **min-retention**：折叠会移除某材质三角形时，若该材质剩余数将跌破 `floor(原始面数 × minRetention)` 则拒绝该折叠（该材质剩余三角形不可再移除），防止局部过度减面。
- **小材质保护**：原始面数 ≤ 500 的材质（眼睛、睫毛等）整个加入锁定集，100% 保留。
- **字节级重写**：`pmx-writer.mjs` 按 PMX 分段定位，只重写顶点段 / 面索引段 / 材质 faceCount，其余（morph、骨、刚体、关节、显示帧等）逐字节原样保留 → 非减面段零风险。

## 🖥️ 运行 Demo（静态 LOD 对比）

Demo 是浏览器里的静态减面对比页：用 three `MMDLoader` 加载原版 PMX 与预生成的 4 档 LOD，OrbitControls 旋转/缩放，HUD 实时显示当前 LOD 的顶点数 / 三角形数 / 材质数 / 减面率。

```bash
yarn demo:prepare          # 预生成 LOD：reduce.mjs 按 ratio 1.0/0.5/0.25/0.1 产出 4 档 + stats.json
yarn webpack:dev-server    # 启动 dev-server → http://localhost:8096（demo/assets 静态托管到 /assets）
```

浏览器打开 `http://localhost:8096`，底部 LOD 按钮切换对比：

| LOD | 顶点数 | 三角形数 | 减面率 |
|-----|--------|----------|--------|
| LOD 100%（原版） | 34,394 | 54,228 | — |
| LOD 50% | 20,025 | 27,113 | 50.00% |
| LOD 25% | 16,109 | 19,668 | 63.73% |
| LOD 10% | 16,109 | 19,668 | 63.73% |

> LOD 25% / 10% 三角数相同，因为已触达 **min-retention + 小材质锁定 + sliver/拓扑/翻转守卫的保底下限**（HUD 会提示「已到保护下限」）—— 这正是材质保护 + 形状/拓扑保护的直观演示。

- Demo 统计源：`demo/assets/stats.json`（`yarn demo:prepare` 生成）；缺失时 HUD 回退到页面内实时解析 mesh 几何。
- 模型 + 纹理：`demo/assets/XiaoMeiOriginFix_02_elrein.pmx` + `demo/assets/tex/`（pmx 与 tex 同目录，纹理相对路径自动解析）。
- 前端实时减面（QEM 浏览器化）属 roadmap：`qem.mjs`/`quadric.mjs` 已是纯函数，只需把 `pmx-writer`/`pmx-lib` 的 Node Buffer 层改写为 Uint8Array/DataView 即可。

## 📁 目录结构

```
PMXReduceFace/
├── src/
│   └── tool/
│       ├── lib/                      # 共享 PMX IO
│       │   ├── pmx-loader.mjs        #   loadPmx（three mmdparser）
│       │   └── pmx-lib.mjs           #   PmxWalker / 字节编码工具
│       └── pmx-face-reduce/          # 减面核心
│           ├── reduce.mjs            #   CLI + reduceFaces()
│           ├── qem.mjs               #   QEM 边折叠引擎 collapseMesh()
│           ├── quadric.mjs           #   二次误差度量（纯数学零依赖）
│           ├── pmx-writer.mjs        #   PMX 字节级重写
│           ├── lock-set.mjs          #   锁定顶点集（morph/接缝/材质）
│           └── verify.mjs            #   验证 CLI + verifyFaces()
├── demo/                             # 浏览器 Demo（静态 LOD 对比）
│   ├── index.html                    #   HUD 统计面板 + LOD 切换条
│   ├── main.ts                       #   three + MMDLoader + OrbitControls + HUD
│   └── assets/                       #   模型 + 纹理 + stats.json（LOD 减面版）
├── scripts/
│   ├── prepare-demo.mjs              # 预生成 4 档 LOD + stats.json
│   └── real-model-check.mjs          # 真实模型可选集成检查（reduce + verify）
├── test/
│   ├── features/pmx-face-reduce.feature
│   ├── step-definitions/pmx-face-reduce.steps.ts
│   └── helpers/pmx-face-reduce-check.mjs   # 合成 fixture（纯字节生成，不依赖真实模型）
├── package.json / README.md / LICENSE / .gitignore
├── tsconfig.json / babel.config.cjs / jest.config.cjs / webpack.config.cjs
```

## ✅ 测试

```bash
yarn test:bdd          # BDD（jest-cucumber，19 场景）：合成 fixture（纯字节生成 PMX，无真实模型依赖）
npx tsc --noEmit       # 类型检查（demo/main.ts / test steps 是 .ts）

# 可选：真实模型集成检查（不进 test:bdd；对 demo/assets 模型跑 reduce + verify 输出 JSON 报告）
yarn test:real         # node scripts/real-model-check.mjs（默认 --target-ratio 0.5）
node scripts/real-model-check.mjs --input your.pmx --target-ratio 0.25 --keep
```

BDD 覆盖：输出可重解析 / 面数减半 / morph 锁定位置不变 / 无退化 + 权重归一化 / 材质-header 一致 / 原文件字节不变 / roundtrip 零改动 / 法线单位长度 / `--target-tri` 绝对目标 / 自动材质保护（min-retention 触发）/ `--lock-materials` 材质级锁定 / dropDegenerate 丢弃零面积 + 重复索引退化三角形 / sliver 守卫（单元级 + 管状 fixture 集成级 + 细管手指 fixture 集成级）/ 拓扑守卫（link condition + 洞检测）/ fold-over 翻转守卫。

## 📄 License

[MIT](./LICENSE) — 可自由使用、修改、商用，保留版权声明即可。

---

**来源**：本项目源自 GTS-Play 项目的 mmd_tool 包，独立开源为 MIT 仓库。欢迎提 [Issue](https://github.com/yyc-git/PMXReduceFace/issues)。

---

# PMXReduceFace (English)

**PMX face reduction tool for MMD models**: reduce polygon count via **QEM constrained edge collapse** while preserving morphs, UV seams, and small materials. The decimated PMX works directly in MMD, and pre-generated LOD levels can be swapped by distance in games/rendering.

> Background: PMX models often carry high polygon counts; naive decimation breaks expression morphs, tears UV seams, and wipes out small-material details. This tool collapses the lowest-cost edge one at a time using a quadric error metric, while a "locked set + material protection" guards the structures that must not move — faces go down, everything that matters stays.

## ✨ Features

- **QEM constrained edge collapse**: per-edge collapse cost from the quadric error metric (`quadric.mjs` — pure math, zero deps); each step collapses the lowest-cost edge
- **Sliver (thin-strip) prevention**: a shape guard runs before each collapse and rejects any collapse that would create a "thin + long" triangle (aspect ≥ 10 with longest edge ≥ 0.5) — preventing long strips / stray triangles / broken surfaces on the head, fingers and socks
- **Topology guard (hole prevention)**: a link condition (Hoppe 1996) + hole detection reject collapses that would create a non-manifold edge (shared > 2) or turn an interior edge into a boundary (a hole) — thin shells like socks/underwear no longer show holes
- **Fold-over prevention**: rejects collapses where a surviving triangle's normal would flip > 120° relative to its neighbor — high-curvature thin cylinders like fingers no longer produce stray protruding faces
- **Morph preservation**: every vertex referenced by vertex/UV morphs enters the locked set; morph indices are remapped after collapse
- **UV seam preservation**: spatially coincident vertices are clustered (`findSeamClusters`) and locked so textures don't tear
- **Automatic small-material protection**: materials with ≤ 500 original faces (eyes, lashes, ...) are kept 100% by default
- **Material-level locking**: `--lock-materials` keeps selected materials (face/eyes) entirely, retention ≥ 90% (asserted by verify)
- **min-retention floor**: each material is capped at `--min-retention` of its original face count, preventing over-decimation of any region
- **Dual targets**: `--target-ratio` (ratio) or `--target-tri` (absolute triangle count), either one works
- **Byte-level rewrite**: only the vertex / face-index / material-faceCount sections are rewritten in place; morphs, bones, rigid bodies and other untouched sections are preserved byte-for-byte
- **Built-in verification**: `verify.mjs` full assertions (locked vertices preserved / no degenerates / unit normals / normalized weights / material consistency)
- **MIT licensed**: fully open source, free for commercial use

## 🚀 Quick Start

### Install

```bash
git clone git@github.com:yyc-git/PMXReduceFace.git
cd PMXReduceFace
yarn install
```

> Requirements: Node.js 22+ (`mmdparser.module.js` is ESM; `require()` loading needs Node ≥22), use yarn (recommended) or npm.

### Reduce + Verify

```bash
yarn test:bdd       # BDD green (19 scenarios)
npx tsc --noEmit    # type check
```

### Core CLI

```bash
# Halve the face count by ratio
node src/tool/pmx-face-reduce/reduce.mjs --input in.pmx --output out.pmx --target-ratio 0.5

# Full options
node src/tool/pmx-face-reduce/reduce.mjs \
  --input in.pmx --output out.pmx \
  --target-ratio 0.5 \
  [--target-tri 20000] \
  [--lock-morph true] \
  [--lock-seams true] \
  [--lock-materials "0,1"] \
  [--min-retention 0.3] \
  [--lock-small-materials true]

# As an npm dependency, use the bin directly
npx pmx-reduce-face --input in.pmx --output out.pmx --target-ratio 0.5
```

| Option | Default | Description |
|--------|---------|-------------|
| `--input` | required | input PMX path |
| `--output` | required | output PMX path |
| `--target-ratio` | `0.5` | target triangles = `ceil(original × ratio)` |
| `--target-tri` | none | absolute target triangle count; takes precedence over `--target-ratio` |
| `--lock-morph` | `true` | lock morph-referenced vertices (`false` disables). ⚠️ With `false`, on models with vertex morphs, morph elements referencing removed vertices are **dropped** (morphs may become empty) and reduce prints a warning; verify then needs `--lock-morph false` and the morph position-lock assertion doesn't apply |
| `--lock-seams` | `true` | lock spatially-coincident seam vertices (`false` disables) |
| `--lock-materials` | none | comma-separated material indices (e.g. `"0,1"`) to lock entirely |
| `--min-retention` | `0.3` | minimum retention ratio for large materials (0 disables dynamic protection) |
| `--lock-small-materials` | `true` | keep small materials (≤ 500 faces) at 100% (`false` disables) |

`reduce.mjs` prints a stats JSON to stdout (`originalTriangles` / `newTriangles` / `reductionRatio` / `perMaterial` / `reductionMet`, ...); exit code is non-zero on failure.

### Verify CLI

```bash
node src/tool/pmx-face-reduce/verify.mjs in.pmx out.pmx --target-ratio 0.5 [--target-tri N] [--lock-morph true] [--lock-seams true] [--lock-materials "0,1"] [--min-retention 0.3] [--lock-small-materials true]
# exit 0 on all green; stdout JSON report (ok / checks / errorCount / errors / stats / perMaterial)
npx pmx-reduce-face-verify in.pmx out.pmx --target-ratio 0.5
```

> ⚠️ **verify's lock flags must match reduce**: if reduce ran with `--lock-morph false` / `--lock-seams false`, verify must be given the same flags, otherwise the "morph/seam locked vertices" assertions validate against the default locked set and report false failures (the locked-position assertion doesn't apply then).

> ⚠️ **`--target-tri` vs the protection floor**: `--min-retention` plus small-material locking add up to a minimum triangle count that no reduction goes below. If `--target-tri` is below that floor, reduction stops at the floor — the tool does not error, but `newTriangles > target` → `reductionMet=false` in the stats and `triWithinTarget=false` in verify. Pick `--target-tri ≥ floor` (the demo model's floor is ≈ 19,668, which includes the extra collapses blocked by the sliver/topology/fold-over guards).

## 🔬 Core API

Pure-function `.mjs` modules, importable directly (`npm i pmx-reduce-face` then import from `node_modules`):

```js
import { reduceFaces } from 'pmx-reduce-face/src/tool/pmx-face-reduce/reduce.mjs';
import { verifyFaces } from 'pmx-reduce-face/src/tool/pmx-face-reduce/verify.mjs';
import { collapseMesh } from 'pmx-reduce-face/src/tool/pmx-face-reduce/qem.mjs';
import { buildLockedSet } from 'pmx-reduce-face/src/tool/pmx-face-reduce/lock-set.mjs';
```

**`reduceFaces(options)`** — full reduction pipeline (equivalent to the CLI)

| Param | Default | Description |
|-------|---------|-------------|
| `input` | required | input PMX path |
| `output` | required | output PMX path |
| `targetRatio` | `0.5` | ratio target |
| `targetTriangles` | `null` | absolute target (takes precedence) |
| `lockMorph` | `true` | lock morph vertices |
| `lockSeams` | `true` | lock seam vertices |
| `lockMaterials` | `null` | material index array |
| `minRetention` | `0.3` | large-material floor ratio |
| `lockSmallMaterials` | `true` | lock small materials fully |

Returns: `{ input, output, originalVertices, newVertices, originalTriangles, newTriangles, targetTriangles, lockedCount, reductionRatio, reductionMet, perMaterial, materialProtection, collapses, rejected, durationMs }`.

**`verifyFaces(options)`** — full assertions on a reduced result (equivalent to the verify CLI)

| Param | Default | Description |
|-------|---------|-------------|
| `input` / `output` | required | original / reduced file |
| `targetRatio` | `0.5` | ratio target |
| `targetTri` | `null` | absolute target |
| `lockMaterials` | `null` | material locks matching the reduce run |
| `minRetention` | `0.3` | material retention assertion threshold |
| `lockSmallMaterials` | `true` | small-material 100% assertion |
| `lockMorph` | `true` | morph-vertex locking matching reduce (`false` skips the "mapped pos = original pos" check) |
| `lockSeams` | `true` | seam-vertex locking matching reduce |

Returns: `{ ok, checks, errorCount, errors, stats, perMaterial }`. `checks` includes `lockedVertsPreserved` / `noDegenerateTriangles` / `noDuplicateTriangles` / `weightsNormalized` / `normalsUnitLength` / `materialSumConsistent` / `materialRetentionOk` / `protectedRetention`, etc.

**`collapseMesh(params)`** — core edge-collapse engine (QEM)

| Param | Default | Description |
|-------|---------|-------------|
| `vertices` | required | vertex array (with position) |
| `triangles` | required | triangle array `[[a,b,c], ...]` |
| `locked` | `Set()` | locked vertex set (never collapsed) |
| `targetTriangles` | `1` | collapse target |
| `dropDegenerate` | `true` | drop degenerate input triangles (duplicate index / zero area) |
| `triMaterials` | `null` | per-triangle material index (for material protection) |
| `minRetention` | `0.3` | material floor |
| `lockSmallMaterials` | `true` | lock small materials fully |

Returns: `{ vertices, triangles, indexMap, keptTriIndices, stats }` (`stats` has `collapses` / `rejected` / `protectedStats`).

**`buildLockedSet(vertices, morphs, opts)`** — build the locked vertex set

| Param | Default | Description |
|-------|---------|-------------|
| `vertices` / `morphs` | required | vertex / morph arrays |
| `lockMorph` | `true` | lock morph-referenced vertices |
| `lockSeams` | `true` | lock spatially-coincident clusters |
| `tolerance` | `1e-6` | seam clustering tolerance |
| `lockMaterials` | `null` | material index array (requires `faces` + `materials`) |
| `faces` / `materials` | `null` | used for material→vertex mapping |

Returns: `Set<number>` (locked vertex indices).

## 🔄 Reduction Pipeline

```
loadPmx（parse with three mmdparser）
  → triangulateFaces（faces → triangle array）
  → buildLockedSet（morph refs + UV seam clusters + material locks → locked vertex set）
  → collapseMesh（QEM edge collapse + material protection）
      ① per-edge collapse cost = Q（quadric error metric，pure functions in qem/quadric）
      ② pop lowest-cost edge from the heap each round；guards before collapse（isValidCollapse shape + link-condition/hole topology + fold-over flip）
      ③ per-material dynamic protection by min-retention + small materials fully locked
      ④ area-weighted normal recomputation after collapse（recomputeNormals）
  → buildDecimatedPmx（byte-level rewrite：vertices / faces / material faceCount patched in place，rest preserved）
```

**Algorithm notes**:

- **Quadric error metric (QEM)**: each vertex accumulates the fundamental-plane equations of its incident triangles; collapsing merges both endpoints' error matrices, and the new position is the minimizer of the combined error (`quadric.mjs` — pure linear algebra, zero deps).
- **Edge collapse**: each round pops the globally lowest-cost edge from a min-heap and collapses `u → v`; collapsed triangles are removed from the adjacency. Before each collapse, shape (`isValidCollapse`: degenerate / normal flip / sliver), topology (link condition + hole detection), and fold-over guards all pass — any failure rejects the candidate.
- **Sliver prevention**: QEM only optimizes geometric error (point-to-plane distance), so a sliver with area ≈ 0 is judged "loss-free" — yet it renders as a protruding strip / stray triangle. Before each collapse, every surviving affected triangle is checked for `aspect (longest/shortest edge) ≥ 10 && maxL ≥ 0.5` ("thin + long"), and the collapse is rejected if any triggers it. Round 1 (`≥ 20 && ≥ 2`) already removed the fatal long strips (`maxL ≥ 2`), but short strips (`maxL` 1~2) remained on the head; the original model has only 154/54,228 (0.28%) triangles of the `≥ 10 && ≥ 1` shape, so tightening to 10/1.0 removed decimation-introduced short strips. Round 3: the hand region (|x|>4.5, y 9-18) has 0 original triangles with aspect > 10, yet LOD50 still added 8 finger slivers with aspect ≈ 11 and maxL ≈ 0.5 (allowed because maxL < 1.0) → tightening to 10/0.5 clears the finger slivers with negligible impact on the original inherent slivers (concentrated at the sock/chest).
- **Topology guard (hole prevention)**: the link condition (Hoppe 1996) rejects collapses that would create a non-manifold edge (shared > 2) or sew boundary edges into the interior; hole detection backstops against interior→boundary transitions (e.g. a sock/underwear thin shell showing a hole). Cleaning up near-degenerate (coincident-vertex) triangles is exempt from the hole guard so defect cleanup isn't blocked.
- **Locked set**: morph-referenced vertices, UV-seam cluster vertices, and all vertices of locked materials never move; weights are redistributed to the surviving vertex when a side collapses.
- **min-retention**: when a collapse would remove triangles of a material whose remaining count would drop below `floor(original × minRetention)`, that collapse is rejected (the material's remaining triangles become immovable), preventing over-decimation of any region.
- **Small-material protection**: materials with ≤ 500 original faces are added entirely to the locked set and kept at 100%.
- **Byte-level rewrite**: `pmx-writer.mjs` locates PMX sections and rewrites only the vertex section / face-index section / material faceCount; everything else (morphs, bones, rigid bodies, joints, display frames, ...) is preserved byte-for-byte → zero risk outside the decimated sections.

## 🖥️ Running the Demo (static LOD comparison)

The demo is a browser-based static comparison page: three `MMDLoader` loads the original PMX and the 4 pre-generated LOD levels; OrbitControls rotates/zooms; an HUD shows the current LOD's vertex / triangle / material counts and the reduction ratio.

```bash
yarn demo:prepare          # pre-generate LODs: reduce.mjs at ratios 1.0/0.5/0.25/0.1 → 4 levels + stats.json
yarn webpack:dev-server    # start dev-server → http://localhost:8096（demo/assets served statically at /assets）
```

Open `http://localhost:8096` and switch LOD levels via the bottom bar:

| LOD | Vertices | Triangles | Reduction |
|-----|----------|-----------|-----------|
| LOD 100%（original） | 34,394 | 54,228 | — |
| LOD 50% | 20,025 | 27,113 | 50.00% |
| LOD 25% | 16,109 | 19,668 | 63.73% |
| LOD 10% | 16,109 | 19,668 | 63.73% |

> LOD 25% / 10% share the same triangle count because they hit the **min-retention + small-material protection + sliver/topology/fold-over floor** (the HUD shows "protection floor reached") — a direct demonstration of material + shape + topology preservation.

- Stats source: `demo/assets/stats.json` (generated by `yarn demo:prepare`); the HUD falls back to live mesh geometry parsing when it's missing.
- Model + textures: `demo/assets/XiaoMeiOriginFix_02_elrein.pmx` + `demo/assets/tex/` (the pmx and tex share a directory, so relative texture paths resolve automatically).
- Real-time in-browser decimation (QEM browserization) is a roadmap item: `qem.mjs`/`quadric.mjs` are already pure functions; only the Node `Buffer` layer in `pmx-writer`/`pmx-lib` would need a `Uint8Array`/`DataView` port.

## 📁 Directory Structure

```
PMXReduceFace/
├── src/
│   └── tool/
│       ├── lib/                      # shared PMX IO
│       │   ├── pmx-loader.mjs        #   loadPmx（three mmdparser）
│       │   └── pmx-lib.mjs           #   PmxWalker / byte-encoding helpers
│       └── pmx-face-reduce/          # reduction core
│           ├── reduce.mjs            #   CLI + reduceFaces()
│           ├── qem.mjs               #   QEM edge-collapse engine collapseMesh()
│           ├── quadric.mjs           #   quadric error metric（pure math，zero deps）
│           ├── pmx-writer.mjs        #   PMX byte-level rewrite
│           ├── lock-set.mjs          #   locked vertex set（morph/seams/materials）
│           └── verify.mjs            #   verify CLI + verifyFaces()
├── demo/                             # browser demo（static LOD comparison）
│   ├── index.html                    #   HUD stats panel + LOD switch bar
│   ├── main.ts                       #   three + MMDLoader + OrbitControls + HUD
│   └── assets/                       #   model + textures + stats.json（LOD versions）
├── scripts/
│   ├── prepare-demo.mjs              # pre-generate 4 LOD levels + stats.json
│   └── real-model-check.mjs          # optional real-model check（reduce + verify）
├── test/
│   ├── features/pmx-face-reduce.feature
│   ├── step-definitions/pmx-face-reduce.steps.ts
│   └── helpers/pmx-face-reduce-check.mjs   # synthetic fixture（byte-built PMX，no real model dependency）
├── package.json / README.md / LICENSE / .gitignore
├── tsconfig.json / babel.config.cjs / jest.config.cjs / webpack.config.cjs
```

## ✅ Testing

```bash
yarn test:bdd          # BDD（jest-cucumber，19 scenarios）：synthetic fixture（byte-built PMX，no real models）
npx tsc --noEmit       # type check（demo/main.ts / test steps are .ts）

# Optional：real-model integration check（not part of test:bdd；runs reduce + verify on the demo model and prints a JSON report）
yarn test:real         # node scripts/real-model-check.mjs（default --target-ratio 0.5）
node scripts/real-model-check.mjs --input your.pmx --target-ratio 0.25 --keep
```

BDD coverage: output re-parseable / faces halved / morph-locked positions unchanged / no degenerates + normalized weights / material-header consistency / original file bytes unchanged / roundtrip zero-change / unit normals / `--target-tri` absolute target / automatic material protection (min-retention triggered) / `--lock-materials` material-level locking / dropDegenerate dropping zero-area + duplicate-index degenerate triangles / sliver guard (unit-level + tube fixture integration + thin finger-tube fixture integration) / topology guard (link condition + hole detection) / fold-over flip guard.

## 📄 License

[MIT](./LICENSE) — free to use, modify, and use commercially, provided the copyright notice is retained.

---

**Source**: derived from the mmd_tool package of the GTS-Play project, released standalone under MIT. Issues welcome at [GitHub Issues](https://github.com/yyc-git/PMXReduceFace/issues).
