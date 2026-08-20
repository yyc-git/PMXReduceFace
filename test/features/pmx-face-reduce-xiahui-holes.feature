# Phase B Step 2 — XiaHui LOD_70 减面后新增洞修复 (方案 A: 修复 collapseCreatesHole 边界清除型漏判)
# 5 个场景全部直接调用 qem.mjs 导出函数（无模拟、无绕过），验证修复前后的守卫行为。
# 关联根因: qem.mjs:877 漏判 preU===1 && preV===1 && post<2（边界边清除型洞）。
# 注: 本仓库 jest-cucumber 用英文 step 关键词 (Given/When/Then) + 中文文本。

@pmx-face-reduce-xiahui-holes
Feature: XiaHui LOD_70 减面后无新增洞 — collapseCreatesHole 边界清除型漏判修复

  Scenario: 边界边清除型洞应被 collapseCreatesHole 拒绝
    Given 合成网格 "[[0,1,2],[3,4,5]]" 且边 (0,1) 为边界边
    When 折叠边 (0,1)
    Then collapseCreatesHole 返回 true（检测到洞，拒绝）

  Scenario: 内部边变边界应被拒绝（已有守卫保持有效）
    Given 合成网格 "[[0,1,2],[0,2,3]]" 且折叠边 (1,2) 使内部边 (0,2) 变边界
    When 折叠边 (1,2)
    Then collapseCreatesHole 返回 true（检测到洞，拒绝）

  Scenario: 内部边变悬空（interior→0 triangles）应被拒绝
    Given 合成网格 "[[0,1,2],[0,1,3]]" 且边 (0,1) 为内部边
    When 折叠边 (0,1) 使两三角形退化移除
    Then collapseCreatesHole 返回 true（检测到洞，拒绝）

  Scenario: 正常内部边折叠应被允许（守卫不误杀）
    Given 合成网格 "[[0,1,2],[0,1,3]]" 且边 (2,3) 为自由角边
    When 折叠边 (2,3)
    Then collapseCreatesHole 返回 false（合法折叠，允许）

  Scenario: 修复后边界清除型洞经窄化守卫 collapseCreatesHoleNarrow 仍被拒绝（集成实际折叠路径）
    Given 合成网格 "[[0,1,2],[3,4,5]]" 且边 (0,1) 为边界边（非近退化）
    When 经 collapseCreatesHoleNarrow 折叠边 (0,1)
    Then collapseCreatesHoleNarrow 返回 true（检测到洞，拒绝）
