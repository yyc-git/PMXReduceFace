Feature: pmx-face-reduce — PMX 减面（QEM 约束边折叠）

  # N/A（新功能，无关联 bug）
  # fixture：合成 51×40 网格 + 接缝列 = 2040 顶点 / 3902 三角形 / 5 材质 mat0~mat4（1400/1202/800/300/200，mat1 含 2 个非法三角形）
  Scenario: 减面输出文件存在且可重新解析
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 输出 pmx 文件存在且非空
    And 输出文件可被 MMDParser.parsePmx 重新解析成功

  # N/A（新功能，无关联 bug）
  Scenario: 面数至少减少 50%
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 输出三角形数不超过原始三角形数的一半（向上取整）
    And 输出顶点数小于原始顶点数
    # 目标：ceil(3902 * 0.5) = 1951 个三角形

  # N/A（新功能，无关联 bug）
  Scenario: morph 引用顶点全锁定且位置不变
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 全部 morph 引用顶点在输出中存在且位置误差小于 1e-6
    And 全部 morph 元素索引有效且小于新顶点数

  # N/A（新功能，无关联 bug）
  Scenario: 输出网格无退化三角形且权重归一化
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 输出无退化三角形（面积大于 1e-9）
    And 输出无重复三角形
    And 输出全部顶点 skinWeights 归一化（Σ≈1）

  # N/A（新功能，无关联 bug）
  Scenario: 材质与 header 计数一致
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 材质 faceCount 总和等于新 faces 长度
    And 输出 header 记录的 vertexCount 与实际一致

  # N/A（新功能，无关联 bug）
  Scenario: 原始 pmx 文件字节不变
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 记录原始文件 hash
    And 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 操作后原始文件 hash 与操作前一致

  # N/A（新功能，无关联 bug）
  Scenario: roundtrip 零改动重写数据一致
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 1.0）
    Then 输出顶点数与原始一致
    And 输出三角形数与原始一致
    And 输出首个材质面数与原始一致

  # M 阶段法线 bug：折叠法线 lerp 后未归一化 → 长度衰减 → MMD 破面（回归防线）
  Scenario: verify 断言输出全部顶点法线单位长度
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then verify 输出 checks.normalsUnitLength 为 true
    And verify 输出最小/最大法线长度均在 1 误差 1e-3 内

  # N/A（新功能，无关联 bug）
  Scenario: 用 --target-tri 指定绝对目标三角形数
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 用 reduce.mjs 生成减面 pmx（--target-tri 1600）
    Then 输出三角形数不超过 1600
    And 验证脚本 --target-tri 1600 全绿

  # 自动材质保护（pmx-face-reduce 带材质白块修复）：不带 --lock-materials，仅 --min-retention 0.3
  # 保底 = 小材质 100%（300+200=500）+ 大材质下限（floor(1400×0.3)+floor(1202×0.3)+floor(800×0.3)=420+360+240=1020）= 1520
  Scenario: 自动材质保护下小材质全保留且大材质保留率达标
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 用 reduce.mjs 生成减面 pmx（--min-retention 0.3，--target-tri 1600，不带 --lock-materials）
    Then mat3/mat4（原始面数 ≤500）保留率等于 100%
    And mat0/mat1/mat2（原始面数 >500）保留率不低于 30%
    And 输出三角形数不超过 1600
    And 验证脚本 --min-retention 0.3 全绿（含材质保留率断言）
    And 绝对目标 1000（低于保底 1520）时输出被保底阻断：实际三角形数未达 1000 且不低于保底
    # 实测 greedy 在 1521 处被阻断（mat2 余 241 > 下限 240），非 1000；保底 1520 语义成立

  # ★ 材质级锁定（--lock-materials）：关闭动态/小材质保护后隔离材质锁定
  Scenario: --lock-materials 材质级锁定保留率达标
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形）
    When 用 reduce.mjs 生成减面 pmx（--lock-materials "0"，--min-retention 0，--lock-small-materials false，target-ratio 0.5）
    Then 锁定材质 mat0 保留率不低于 90%
    And 输出三角形数不超过 1951 且验证脚本全绿

  # ★ dropDegenerate 回归：丢弃零面积 + 重复索引退化三角形（真实模型验证发现的关键修复路径）
  Scenario: 减面丢弃输入中的零面积与重复索引退化三角形
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形，含 2 个非法三角形）
    When 用 reduce.mjs 生成减面 pmx（--target-ratio 0.999 --target-tri 3900）
    Then 输出三角形数为 3900（2 个非法三角形被丢弃）
    And 输出无退化三角形（面积大于 1e-9）且无重复索引三角形

