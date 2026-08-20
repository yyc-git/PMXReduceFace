# Known Issue: XiaHui/Xiaye1 LOD_70 减面后空洞

> 记录时间: 2026-08-20
> 状态: 未解决 (known issue)
> 严重度: 中 (视觉缺陷，不影响功能)

## 问题描述

XiaHui 和 Xiaye1 模型在 LOD_70 减面后，多个材质内部出现可见空洞：
- **XiaHui**: jacket1（右 upper 手臂正面）和胸部区域
- **Xiaye1**: 左大腿内侧

## 当前代码行为

```
reduce 输出: newHoleEdges=1, patchedHoles=5, holeRejects=5241
verify 输出: noNewHoles=true, holeRings=[]
```

- `patchHoles` 检测到 5 个**闭合环洞**并补面
- 但 `newHoleEdges=1` 表示还有 1 条**非闭合边界边**未被处理
- verify 的 `noNewHoles` 只检测闭合环，非闭合链漏检
- 视觉上仍有空洞

## 根因分析

### 1. `collapseCreatesHole` 漏检
- 函数检查 `preU/preV/post` 判断折叠是否造洞
- 漏检 case: `preU===0 && preV===1`（边界边从 v 移到 u）
- 但简单补上这个条件会破坏管状 fixture 测试（纯边界网格无法减面）

### 2. `findHoleChains` 检测盲区
- 只检测**闭合环**（≥3 条边界边组成的链）
- 非闭合链 / 孤立边界边 / 材质内部单点空洞全部漏检
- 过滤条件（depthRatio/minArea/maxMouth/solidDist）可能跳过真实空洞

### 3. `patchHoles` 补面局限
- 只补 `findHoleChains` 检测到的闭合洞
- 补面的法线/UV/材质分配可能不正确（视觉上仍有洞）

## 修复尝试记录

| 轮次 | 方案 | 结果 | 问题 |
|------|------|------|------|
| 1-2 | agent 加检测函数/诊断日志 | 检测增强但算法未改 | OOM（日志过多） |
| 3 | `(preU===0 && preV===1)` 加入条件 | XiaHui/Xiaye1 newHoleEdges=0 ✅ | 管状 fixture 37/40 BDD 失败 |
| 4 | agent 试图精炼条件 | 无法找到同时满足两者的条件 | 测试超时/socket 断开 |
| 5 | 回滚到原始代码 | 确认原始算法本身有此问题 | — |

### 失败的 BDD 测试（轮3）
- `减面输出不存在长条 sliver 三角形（合成管状 fixture）`: newTriangles = inputTriangles（无法减面）
- `减面输出不存在手指级窄条 sliver 三角形（细管 fixture）`: 同上
- `洞守卫收窄只豁免共点边分离仍拒绝其它洞`: 共点边豁免失效

## 当前策略

**接受空洞作为 known issue**，改为：
- 整体减面目标 ≤5 万面（≤5 万面不减面）
- 使用最保守减面参数
- 质量优先：宁可不减面都不引入空洞

## 后续修复方向

1. **`findHoleChains` 支持非闭合链检测**：追踪开放边界链，检测材质内部的三角面缺失区域
2. **`collapseCreatesHole` 精确条件**：区分「边界边正常移动」和「真正造洞」——需要检查目标顶点 u 处是否已有三角形含 w
3. **`patchHoles` 增强**：支持补非闭合洞 + 验证补面几何正确性
4. **可视化调试工具**：在 demo 中高亮显示边界边和补面区域，便于定位空洞
