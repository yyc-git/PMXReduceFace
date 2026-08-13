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

  # ★ sliver 回归（A 单元级）：isValidCollapse 必须拒绝「折叠后产生细长条三角形」的折叠候选
  # RED 能力：把 qem.mjs 的 sliver 约束 revert（isValidCollapse 退化为只查退化/翻转）后，本场景立即失败
  Scenario: isValidCollapse 拒绝会产生细长条（sliver）三角形的折叠
    Given 构造折叠后新三角形 aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN 的折叠候选（u=0 折叠到 [20,0.01,0]）
    When 对该候选直接调用 qem.mjs 的 isValidCollapse
    Then 返回 false（该折叠被拒绝）
    And 折叠结果三角形确实被 isSliverTriangle 判定为 sliver（候选构造正确，aspect 与 maxL 均达标）
    And 正常折叠（新三角形 aspect<20）返回 true（sliver 约束不误杀）
    And 正常折叠结果三角形不被 isSliverTriangle 判定为 sliver

  # ★ sliver 回归（A2 单元级，第三轮收紧）：isValidCollapse 必须拒绝 maxL∈[0.5,1.0) 的手指级窄条折叠
  # 手部实测窄条 maxL=0.51~0.56（<1.0）：SLIVER_MAXL_MIN=1.0 时守卫放行 → 手指多余面。
  # RED 能力：把 SLIVER_MAXL_MIN 临时改回 1.0 后，本候选 maxL≈0.602<1.0 → 守卫放行（返回 true）→ 本断言立即失败
  Scenario: isValidCollapse 拒绝 maxL 在 0.5~1.0 区间的手指级窄条折叠
    Given 构造折叠后新三角形 maxL∈[0.5,1.0) 且 aspect≥SLIVER_ASPECT_MAX 的折叠候选（u=0 折叠到 [0,0.05,0]）
    When 对该候选直接调用 qem.mjs 的 isValidCollapse
    Then 返回 false（该折叠被拒绝，收紧到 0.5 生效）
    And 折叠结果三角形确实被 isSliverTriangle 判定为 sliver（maxL 在 0.5~1.0 区间）

  # ★ sliver 回归（B 集成级）：合成管状 fixture 减面输出无长条 sliver（输出守卫）
  # 圆管（手指/肢体类圆柱几何）seg=24 len=30 R=2 rings=40 → 1025 顶点 / 1920 三角形，输入无 sliver；
  # RED 能力：revert qem.mjs 后 target-ratio 0.5 输出实测 101 个 sliver（最差 aspect≈46 maxL≈24）→ 本断言失败；修复后输出 0 → 通过
  Scenario: 减面输出不存在长条 sliver 三角形（合成管状 fixture）
    Given 合成管状 fixture PMX 已生成（1025 顶点 / 1920 三角形，输入无 sliver）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 输出中不存在 aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN 的三角形（阈值 import 自 qem.mjs）
    And 输出文件可解析且 reduce 退出码为 0
    And 输入 fixture 自身无长条 sliver（断言前提成立）

  # ★ sliver 回归（C 集成级，第三轮收紧）：细管 fixture 模拟手指减面输出无手指级窄条
  # 手指直径约 0.3-0.5、长度约 2，用 R=0.3 管径 + 16 段 × 20 环（高 2）贴近手指比例且网格够密；
  # 输入无 sliver（aspect≈1.5）。收紧后（SLIVER_MAXL_MIN=0.5）target-ratio 0.5 输出 0 窄条。
  # RED 能力：禁用守卫（isValidCollapse 去掉 sliver 检查）后细管减面在管壁产生跨长度窄条（实测 96 个、最差 aspect≈20 maxL≈2.0）→ 本断言失败
  Scenario: 减面输出不存在手指级窄条 sliver 三角形（细管 fixture）
    Given 合成细管 fixture PMX 已生成（R=0.3 管径 / 16 段 × 20 环，输入无 sliver）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 输出中不存在 aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN 的三角形（阈值 import 自 qem.mjs）
    And 输出文件可解析且 reduce 退出码为 0
    And 输入 fixture 自身无长条 sliver（断言前提成立）

  # ★ 洞回归（P0 单元级）：link condition + 洞检测拒绝破坏流形性的折叠
  # RED 能力：把 qem.mjs 的 linkConditionValid/collapseCreatesHole 退化为恒 true/false 后，本场景立即失败
  Scenario: 拓扑守卫拒绝会产生洞或非流形边的折叠
    Given 构造 link condition 违反的折叠候选（菱形，u/v 公共邻居多于对立顶点）
    When 直接调用 qem.mjs 的 linkConditionValid
    Then 返回 false（该折叠被拒绝，防非流形/缝合）
    And 构造内部边变边界的折叠候选（rim corner，一端落在边界上）
    And 直接调用 collapseCreatesHole 返回 true（洞被拒绝）
    And linkConditionValid 对该候选仍返回 true（证明洞检测是 link condition 的必要补充）
    And 5×5 网格中心边折叠（正常折叠）link/hole/fold 守卫均不误杀

  # ★ 折叠翻转回归（P2 单元级）：折叠后新三角形与邻接法线夹角突变 → 拒绝
  # RED 能力：把 qem.mjs 的 collapseFoldOver 退化为恒 false 后，本场景立即失败
  Scenario: 折叠翻转守卫拒绝 fold-over 折叠
    Given 构造折叠后新三角形相对邻接三角形法线翻转的折叠候选（共边三角形翻到对侧）
    When 直接调用 qem.mjs 的 collapseFoldOver
    Then 返回 true（该折叠被拒绝）
    And 折叠到原位附近（不翻转）返回 false（fold-over 守卫不误杀）

  # ★ 洞回归（P0 集成级）：薄壳管状 fixture 减面输出无非流形边、边界不扩大
  # 圆管是开放薄壳（接缝 + 上下环为边界），类比袜子/内裤开放薄壳；守卫应保证边界边只减不增、无非流形
  Scenario: 减面输出不存在非流形边且边界边集合不扩大（合成管状 fixture）
    Given 合成管状 fixture PMX 已生成（1025 顶点 / 1920 三角形，输入无 sliver）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 输出无共享数大于 2 的非流形边
    And 输出边界边数量不超过输入边界边数量

  # ★ 突起回归（P3 单元级）：折叠后受影响三角形顶点戳出邻面 → 拒绝
  # 指尖/指甲区的近共面微三角团被 QEM 免费合并成跨曲面大平面 → 顶点从邻面戳出（「突出的面」根因）
  # RED 能力：把 qem.mjs 的 collapseProtrudes 退化为恒 false 后，本场景立即失败
  Scenario: 突起守卫拒绝会产生凸起面的折叠
    Given 构造平面条带折叠候选（全 z=0，折叠 (0,1) 到 [0.5,0,1] 戳出平面 1.0 >> PROTRUDE_MAX）
    When 直接调用 qem.mjs 的 collapseProtrudes
    Then 返回 true（该折叠被拒绝，制造凸起）
    And 折叠到原位附近（[0.5,0,0] 平面内）返回 false（突起守卫不误杀）

  # ★ 双面微片锁定回归（P3 单元级）：指甲双面薄片顶点全锁，杜绝折叠放大/恶化
  # 指甲/指缝双面薄片（两三角共边、法线相反、面积 ≤5e-4）是合法几何，不能删/合并，只能锁定
  # RED 能力：把 qem.mjs 的 collectFlipMicroFaceVertices 退化为恒空后，本场景立即失败
  Scenario: 双面微片锁定守卫锁定共边反向法线微三角顶点
    Given 构造一对共边、法线相反的微三角形（面积 < FLIP_LOCK_AREA）
    When 直接调用 qem.mjs 的 collectFlipMicroFaceVertices
    Then 返回的锁定集包含该对三角形的全部 3 顶点
    And 一对法线一致、面积正常的三角形不触发锁定（不误锁）

  # ★ 突起回归（P3 集成级）：指尖 fixture 减面输出无新增凸起面/翻转面
  # 细管（手指比例）+ 半球形指甲盖（近共面微三角团）+ 2 对双面微片；阈值 import 自 qem.mjs 单一来源
  # RED 能力：revert 两个守卫（collapseProtrudes 恒 false + collectFlipMicroFaceVertices 恒空）后，
  # 指甲盖微三角团被 QEM 免费合并成跨曲面大平面 → 输出突起面数暴增 → 本断言失败；恢复后 ≤ 输入基线 → 通过
  Scenario: 减面输出不新增凸起面与翻转面（指尖 fixture）
    Given 合成指尖 fixture PMX 已生成（细管 + 半球形指甲盖 + 2 对双面微片）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 输出中顶点到邻接平面距离 > PROTRUDE_MAX 的三角形数不超过输入该数量
    And 输出中法线夹角 >150° 的翻转面数不超过输入该数量
    And 输出文件可解析且 reduce 退出码为 0

