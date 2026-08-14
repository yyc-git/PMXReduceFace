# PMXReduceFace 第七至十轮：指尖尖刺 → 法线保留 → 通用质量断言 → 折叠后补洞

> 状态：已全部完成并提交（355aca1 / fee4638 / 812f796 / 46186b0）。
> 前置：fix6（`4d211d0`）BDD 29/29、质量地板 ≈39949，但 Kimi 视觉实测 LOD50 仍有问题。
> 数据来源：各轮修复产物的脚本实测（diag-*/shot-*），无拍脑袋值。
> 结论一句话：**fix6 解决了「大三角/破面（跨曲面合并）」，但 Tda 礼服实测暴露三类新问题——① 指尖内外侧尖刺（突起断言只比数量不覆盖位置）② 分层拼块接缝法线被全局重写破坏（肩窝明暗分界线）③ 无 BurumaSet 材质的模型质量断言被整体跳过导致洞漏检；折叠后「新增闭合洞环」需要主动补面而非只统计。第七至十轮逐一修复。**

---

## 0. 结论速览

1. **指尖尖刺（fix7/fix7.1）**：突起断言从「只比数量」升级为「覆盖位置（距输入突起质心距离判新增）」+ 守卫参数 PROTRUDE_MAX 0.045 / PROTRUDE_RATIO 0.32 → 内外带尖刺全消，Kimi 第五轮视觉通过。
2. **接缝法线破坏（fix8）**：`recomputeNormals` 从「全局重写」改为「只重算 touchedV（参与折叠的顶点）+ 方案 B 排除夹角 >60° 邻接面」→ Tda 肩窝法线突变 58→0、接缝夹角 p50 85.4°→37.1°（=输入）、翻转点 108→0。
3. **质量断言解耦（fix9）**：verify 全局性检查（noNewOversizeTriangles / noNonManifoldEdges / noNewHoles）从「BurumaSet 绑定」解耦为「任何模型无条件执行」+ 输入全局 maxL p99 上限 → Tda 左大腿 7 个跨曲面超尺寸三角 7→0。
4. **折叠后补洞（fix10）**：折叠完成后检测「新增闭合边界环」并对环长 ≤8 的洞耳切法三角化补面；noNewHoles 断言用闭环检测（阈值 8×medE²）区分真洞 vs 合法回缩 → Tda 补 4 洞、XiaoMei 补 3 洞无回归、BDD 34/34。

---

## 1. fix7/fix7.1 — 指尖尖刺消除（`355aca1`）

### 1.1 问题（Kimi 视觉打回）

fix6 后 LOD50 指尖**内带尖刺**（x≈±8.7-8.9, y14.4-14.5, z≈-0.73~-0.81 指尖内侧）protrude 0.050-0.052，漏过 fix6 的外带断言（|x|>9, protrude>0.055）。

| 轮次 | 尝试 | 结果 |
|---|---|---|
| fix7 第 1 次 Flash | PROTRUDE_MAX 0.066→0.05 + 外带断言（|x|>9） | 外带尖刺消失（floor 39949→40608）但 Kimi 打回：内带尖刺仍漏过 |
| fix7.1 第 2 次 Flash | 断言重构为**全指尖区域新增尖刺检测**（|x|>7, 13<y<16，距输入突起质心 >0.25 判新增）+ PROTRUDE_MAX 0.045 / PROTRUDE_RATIO 0.32 | 内外带全消，floor 40608→41227 |

### 1.2 教训

① 断言只比 count/maxArea 不覆盖位置 → 漏检；必须用「距输入质心距离」判新增 ② 几何绿 ≠ 视觉 OK（必须 Kimi 截图验证）③ 降守卫阈值要防「尺度归一化主导」（0.4×medE=0.053 > PROTRUDE_MAX 0.05 时降 MAX 无效）。

## 2. fix8 — 未触碰顶点法线保留（`fee4638`）

### 2.1 问题（Pro 分析 20 分钟实锤）

Tda LOD50 右臂后侧「破面」= **肩窝明暗分界线**（Kimi 三轮判定 faceting，几何诊断全绿）。根因：`qem.mjs` collapseMesh 收尾的**全局 recomputeNormals()** 把所有存活顶点（含锁定/未触碰）法线重写为邻接面面积加权平均。Tda 肩窝是分层拼块结构（手套/身体/礼服花纹空间重叠拓扑分离），艺术家校准了分裂法线 → 重写后接缝两侧法线夹角 33.6°→85.6°、肩窝 108 个翻转点 → three toon 量化 + 球面高光 → 明暗分界线。XiaoMei 接缝被减面合并所以没爆。

### 2.2 修复（touchedV 方案）

只对「参与过折叠的顶点」重算法线（touchedV 标记 + inputNormals 保留 + 方案 B：排除与原始法线夹角 >60° 的邻接面 NORMAL_FILTER_DEG=60）。

**全部门禁绿**：肩窝 y=12 法线突变 >30° 58→0、接缝夹角 p50 85.4°→37.1°（=输入）、翻转点 108→0、XiaoMei real-model-check ok、指尖尖刺 0、BDD 32/32（新场景「未触碰顶点保留输入法线」）、tsc 干净。

### 2.3 教训（跨模型兼容性）

verify/real-model-check 的 region（FINGERTIP_REGION |x|>7,13<y<16 等）和 BurumaSet 材质检查都硬编码 XiaoMei 坐标/材质 → 换模型全失效（Tda 手在 y9-13、无 BurumaSet → qualityChecksActive=false）。法线「数值单位向量」≠「方向正确」（normalsUnitLength 断言太弱）。

## 3. fix9 — 通用质量断言解耦 + 超尺寸全局上限（`812f796`）

### 3.1 问题（兄弟 11:03 报告 + 几何实锤）

Tda LOD50 左大腿内侧「破面」= **7 个新增跨曲面超尺寸三角形**（#1997 maxL=1.758 @(-1.44,9.07,-0.79)、#1998 1.776、#2001 1.776、#28133 1.623 等）。漏检根因：verify.mjs 的 checkQuality **绑定 BurumaSet 材质**，`materialFaceIndices(orig, 'BurumaSet')` 返回 null → `qualityChecksActive=false` → 所有质量断言被跳过。Tda 无 BurumaSet → 左大腿 4.8× 超尺寸三角漏检。

### 3.2 修复

- verify.mjs：noNewOversizeTriangles / noNonManifoldEdges / noNewHoles **无条件执行**（qualityChecksActive 语义改为「存在 BurumaSet 时材质相关检查激活」；仅 burumaAreaP99Growth / burumaMaxLP90Growth / fingertipProtrudeShape 受门控）
- qem.mjs：`collapseCreatesOversizeTriangle` 新增 globalMaxLP99 上限（新三角 maxL ≤ 输入全局 p99）—— Tda 高曲率礼服局部输入预算过宽（大腿局部 p95 ≈1.5-2.7），2.0× 局部预算放行 1.6~2.2 级跨曲面合并三角；叠加全局 p99 后折叠时即拦截
- 结果：Tda 跨曲面新增 7→0；BDD 33/33；XiaoMei 回归绿；Tda 减面率 11.31%

### 3.3 教训

「无 BurumaSet 全跳过」= 换模型即失守。全局性检查必须与材质解耦。规格目标数学不可达时（Tda 高曲率模型减面率卡 11.3% 地板）不改参数硬压，接受质量优先。

## 4. fix10 — 折叠后补洞（`46186b0`）

### 4.1 问题（兄弟截图实证 2026-08-14 16:18-16:27）

Tda LOD50 两处**真洞**（三角形网格缺失、能看到背景）：① 两腿之间/大腿内侧根部单大三角洞（兄弟截图横 48-52% 纵 28-35%）② 右腋下/肩臂连接处小三角洞（横 68-74% 纵 45-52%）。Kimi 判定网格缺失真洞，非翻面/剔除。

关键澄清（兄弟 2026-08-14 14:55-15:01 + 18:06-18:10）：
- 「破面」= **空洞**（三角形网格缺失），不是大三角/法线异常（fix8/fix9 修的是另两类问题，白干 3 轮教训）
- **LOD100 删 40% 面无洞、LOD50 只多删 5%（45%）却有洞 → 洞不是减面率导致的，是局部折叠 bug**

几何定位：两腿之间 (|x|<1.5, y10-12.5) **7 条新增边界边**（输入无对应）围成洞；洞区三角形 输入 133→输出 105（少 28 个）。旧检测区域只查 y5-10 漏掉，须覆盖 y10-12.5。

### 4.2 修复

**qem.mjs 新增补面逻辑**（折叠循环后、recomputeNormals 前调用）：
- `collectNewBoundaryEdges` / `chainNewBoundaryEdges`：找输出中「输入不存在」的边界边 → 连成环
- `findHoleChains`：判定真洞 = 环 ≥2 边、沟面积 ≥ 阈值×medE²、sagitta/mouth ≥0.5、mouth ≤15×medE、**环质心距输入三角形 <0.6**（区分真洞 vs 开放边界合法回缩，fix5 教训）
- `triangulatePolygon` / `patchHoles`：耳切法三角化，winding 与邻接表面一致，材质取环上相邻三角形，**复用环上现有顶点**（不新增顶点，UV/蒙皮可用），环长 ≤8 才补
- reduce.mjs：补面三角形按材质段合并 + patchedHoles / patchedTriangles 统计

**verify.mjs noNewHoles 全局严格断言**：从「BurumaSet 限定 + 无则跳过」解耦为「任何模型全局严格断言」（findHoleChains 阈值 8×medE²），袜区口径降为补充报告。

### 4.3 验证矩阵

| 检查 | 修复前（RED 基线） | 修复后（GREEN） |
|---|---|---|
| verify noNewHoles（fix9 产物 Tda LOD50） | `false`，holeRings 4 处（两腿间 V 形洞 area=0.319 @(0.41,12.02,1.02)、裙摆深沟 ×2、腋下区 1 处） | `true`，holeRings [] |
| XiaoMei LOD50 现有文件 | noNewHoles true（头部穹顶 0.2 级浅沟在阈值下不误报） | 仍 true |
| BDD | 33 场景 | **34/34**（新增「折叠后新增小洞被补面且合法回缩不误报」） |
| Tda real-model-check（target 0.55） | — | ok: true，patchedHoles 4 / patchedTriangles 4，newHoleEdges 2（浅回缩残留） |
| XiaoMei real-model-check（target 0.5） | — | ok: true，patchedHoles 3（补掉头部穹顶浅沟），全断言 GREEN |
| diag-tda-new-boundary | 22 条新增边界边 | **22→5**（2× 裙摆深沟弦边 + 3× 髋部单边浅回缩） |

### 4.4 重要发现：原版自带洞环 ≠ 减面引入

全模型洞环对比：**输入 669 洞环 vs 输出 661 洞环**（输出比输入还少 8 个）。两腿间最大的洞环（len=140, maxR=5.95 @(0.13,12.86)）和右腋下洞环（len=47, maxR=2.89）**原版模型里就存在** —— Tda 礼服裙摆/结构开口属模型自带开放边界，不在补面范围（补面只补「新增闭合环」，input 已有的开放边界合法保留）。兄弟测试时看到的「V 字洞依然存在」是原版结构，非减面 bug。

## 5. 提交记录

| commit | 内容 |
|---|---|
| `355aca1` | fix7 + fix7.1：指尖尖刺消除（断言覆盖位置 + PROTRUDE_MAX 0.045） |
| `fee4638` | fix8：未触碰顶点保留输入法线（touchedV + NORMAL_FILTER_DEG=60） |
| `812f796` | fix9：通用质量断言解耦 BurumaSet + globalMaxLP99 上限 |
| `46186b0` | fix10：折叠后补洞（findHoleChains/triangulatePolygon/patchHoles）+ noNewHoles 全局断言 + BDD 34/34 |

全部已 push main。BDD 34/34、tsc 0 errors、real-model-check（Tda + XiaoMei）全绿。
