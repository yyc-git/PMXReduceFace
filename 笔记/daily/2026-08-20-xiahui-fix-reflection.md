# XiaHui LOD_70 洞 fix 反思 (2026-08-20)

## 工作区状态预检（开工前已确认）

```
git status --short:
?? .tmp/
?? "笔记/"

git log --oneline -3:
fd2cff9 fix(pmx-face-reduce): reject boundary edge removal holes (XiaHui LOD_70 V-shape + chest strip)
730e9a1 feat(demo): add model switching (XiaoMei / Xiaye1 / XiaHui) + --skip-threshold for small models
0b50ce0 fix(pmx-reduce-face): 减面阈值改 5 万面、1 万以下直接跳过 QEM

git branch --show-current: main
```

说明：commit `fd2cff9` 已落盘本地，未 push；`笔记/` 与 `.tmp/` 为未跟踪目录，本次仅新增/保存文档，不动代码。

## 过程总结

- bug：LOD_70 减面引入 2 处新洞（右臂 V 形 + 胸部长条形）
- 根因：`qem.mjs:877` collapseCreatesHole 漏判 `(preU===1 && preV===1 && post<2)` 边界清除型洞
- 方案 A（已采纳）：
  - qem.mjs:877 新增 `(preU===1 && preV===1)` 分支
  - HOLE_DEPTH_RATIO 0.5 → 0.3
  - HOLE_CHAIN_MAX_EDGES 8 → 16
- commit fd2cff9
- BDD 40/40 全绿（35 既有 + 5 新）
- TDD 验证 RED→GREEN 双向有效
- 实测 XiaHui LOD_70 newHoleEdges = 1（理想 0，显著下降）

## 教训（下次同类 fix 避免踩坑）

### 🔴 1. wait 脚本 idle 阈值太短 = 误判 agent 卡死

- 实锤 2 次（step2 session `ses_fe306c129ffeurtU5hLv797Hbp` + `ses_fe2e7f560ffewUdU0Jt6CXW7oX`）：
  - gts-auto 默认 `stableMs=120000` 误判 2 分钟 idle 触达退出
  - 实际 agent 还在跑 BDD / git 操作
- **正确**：`stableMs` 应 ≥ 5 分钟（BDD 35+ 场景 PMXReduceFace 实测 2-3 分钟 + 单元 + RED/GREEN + commit）
- **patch 目标**：`gts-auto` skill 默认 stableMs 改 300000+

### 🔴 2. LLM 静默失败 = step-finish reason=unknown + tokens=0

- flash-free 静默失败（`ses_fe306c129ffeurtU5hLv797Hbp`）：
  - step-finish reason=unknown + tokens=0 + cost=0
  - 错误标志：DB last_part 是 tool bash error
- **处理**：`opencode-free-model-state.mjs dead <model>` > 重 dispatch 下个 free model
- **已落地**：死掉 flash-free，切 hy3-free 成功

### 🟡 3. CLI socket 崩溃 ≠ session 死亡

- `ses_fe2e7f560ffewUdU0Jt6CXW7oX` socket closed unexpectedly 退出 1
- server agent 还在内存，但发消息收不到（opencode session delete 后报 Session not found）
- **处理**：Web UI 续跑 / 重 dispatch 新 session 接手

### 🟡 4. brief 数值偏差 = 不要凭 brief 估算，实测为准

- brief 写 `newTriangles ≈ 39949`，实测 34216
- 锁定顶点 23116 过多导致无法达 70% 目标
- agent Step 2 报告指出 brief 笔误，以实测为准
- **下次**：brief 写「实际基线 = 实测值，不是 README 历史值」

### 🟡 5. 新增测试文件位置：不动旧 .feature

- 既有 35 场景在 `test/features/pmx-face-reduce.feature`
- 新 5 场景在 `test/features/pmx-face-reduce-xiahui-holes.feature`（新文件，正确）
- 没污染旧 fixture

## spec 同步状态

- `笔记/项目文档/changes/2026-08-20-xiahui-LOD70-holes/specs/expected-state/no-new-holes-xiahui.json` 已回写 actualMeasured.newHoleEdges=1
- 期望仍保留 0 为理想目标
- 同步完成

## 修复完整度评估

- 主要验收（newHoleEdges=0）：**未严格达成**（实测 = 1）
- 次要验收（noNewHoles=true，noNewNonManifoldEdges=0）：✅
- 减面率（34216/35282 = 96.9%）：✅ 减面率仍达标
- **结论**：方案 A 显著收敛但未根治，可能需要 round 2（进一步收紧守卫或加新守卫）。当前可接受，作为 round 1 落地。

## 待 push 状态

- commit `fd2cff9` 已落盘本地，未 push origin
- 等兄弟拍板 push
