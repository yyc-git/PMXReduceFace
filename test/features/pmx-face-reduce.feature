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

  # ★ 洞守卫收窄回归（第五轮 Scenario A，单元级）：removesSlit 豁免收窄——只豁免「共点边分离成边界」
  # 构造：内部边 (0,1) 一端落边界 + 被移除三角形 [0,1,2] 含共点边（5e-5 < NEAR_DEGENERATE_EDGE）。
  # RED 能力：把 collapseCreatesHole 的 ignoreEdges 豁免退化（reject-all）→ coincidentExempted 变 true → 红
  Scenario: 洞守卫收窄只豁免共点边分离仍拒绝其它洞
    Given 构造内部边变边界 + 被移除三角形含共点边（<NEAR_DEGENERATE_EDGE）的折叠候选（u=0/v=1/w=2，边 (0,2) 近退化）
    When 直接调用 qem.mjs 的 collapseCreatesHole（带/不带 ignoreEdges）与 collapseCreatesHoleNarrow
    Then 无 ignoreEdges 时洞被拒绝（collapseCreatesHole 返回 true）
    And 传入非共点 ignoreEdges（"0:4"）仍被拒绝（只有共点边本身被豁免）
    And 传入共点边 ignoreEdges（"0:2"）被豁免（返回 false，不误杀）
    And collapseCreatesHoleNarrow 自动收集共点边并豁免（近退化清理放行）
    And 无近退化边的洞候选 collapseCreatesHoleNarrow 仍返回 true（洞被拒绝）

  # ★ 预算 cap 回归（第五轮 Scenario C，单元级）：预算 0.098 放行 0.088 级突起，cap 0.078 拒绝
  # 平面 3×3 网格折叠 (4,5)→[0.5,1,d]：突起 P 随 d 平滑（d=0.044 → P≈0.088，介于 cap 与预算之间）。
  # RED 能力：把 cap 参数退化成不封顶（allowance=max(protrudeMax,budget)）→ capRejects 变 false → 红
  Scenario: 突起预算加 cap 后拒绝 0.088 级突起且不误杀正常折叠
    Given 构造平面 3×3 网格 + 折叠 (4,5) 到 [0.5,1,0.044] 的候选（突起 P≈0.088，collapseProtrudeMax 实测）
    When 直接调用 qem.mjs 的 collapseProtrudes（预算数组 0.098，cap 0.078 / 不封顶）
    Then 实测 P 落在 (cap=0.078, 预算=0.098) 带内（候选构造有效）
    And 无 cap（Infinity）时 0.088 级突起被 0.098 预算放行（返回 false）
    And 有 cap（0.078）时该突起被拒绝（返回 true，cap 生效）
    And 小突起折叠（d=0.02，P≈0.04 < cap）仍放行（cap 不误杀正常高曲率折叠）

  # ★ 洞回归（第五轮 Scenario B，集成级）：混合 fixture（细管 + 近共面微三角簇 + 共点近退化微片）
  # 输出边界边空间必须 ⊆ 输入边界边（countSpatiallyNewBoundaryEdges === 0）+ 无非流形 + stats.newHoleEdges===0。
  # RED 能力：把洞守卫退化（collapseCreatesHoleNarrow 恒 false / collapseCreatesHole 恒 false）→
  # 细管内部边变边界 → 空间新增边界边 > 0 → 断言失败；恢复守卫 → 0 → 绿
  Scenario: 混合 fixture 减面输出边界边空间包含于输入且无非流形
    Given 合成混合 fixture PMX 已生成（细管 R0.3/16×20 + 管壁中段近共面微三角簇 + 1 处共点近退化微片）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 输出边界边空间 ⊆ 输入边界边（countSpatiallyNewBoundaryEdges 为 0）
    And 输出无共享数大于 2 的非流形边
    And 减面统计 newHoleEdges 为 0（collapseMesh 内部洞校验兜底）

  # ★ 突起回归（第五轮 Scenario D，集成级加强）：指尖 fixture 输出最大突起 ≤ 输入最大突起
  # 输入含高突起 spike（≈0.10）校准；输出（守卫开启）≤ 输入 → 绿。
  # RED 能力：revert 突起守卫（collapseProtrudes 恒 false）→ 指甲盖微三角团合并成大平面 → 输出最大突起超输入 → 红
  Scenario: 指尖 fixture 输出最大突起不超过输入最大突起
    Given 合成指尖 fixture PMX 已生成（细管 + 半球形指甲盖 + 2 对双面微片 + 高突起 spike）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 输出最大突起（fingerTipOutProtrudeWorst）不超过输入最大突起（fingerTipInProtrudeWorst）
    And 输出文件可解析且 reduce 退出码为 0

  # ★ 曲率感知尺寸守卫（第六轮 Scenario E，P0 单元级）：collapseCreatesOversizeTriangle 拒绝跨局部尺寸的折叠
  # 折叠候选：u=0 折叠到 [0,0,0]，受影响三角形 [0,2,3] → post 三角形 maxL/面积 = 1.4× 预算（预算 0.5/0.05，
  # 随 qem 系数动态构造）。阈值 import 自 qem.mjs。
  # RED 能力：把守卫退化为恒 false → highCurvOversizeRejected 变 false → 立即失败
  Scenario: 曲率感知尺寸守卫拒绝高曲率区超尺寸折叠且不误杀平坦区
    Given 构造高曲率（40°≥CURV_MIN_DEG）超尺寸折叠候选（post 三角形 maxL/面积 = 1.4× 预算 0.5/0.05，随 qem 系数动态构造）
    When 直接调用 qem.mjs 的 collapseCreatesOversizeTriangle
    Then 返回 true（该折叠被拒绝，post 三角形超 max(系数 × 预算) 上限）
    And 同一尺寸但平坦（曲率 0° < CURV_MIN_DEG）的候选返回 false（曲率门控不误杀平坦区）
    And 高曲率但尺寸内（预算放大到 0.9/0.1）的候选返回 false（不误杀正常高曲率折叠）

  # ★ 突起守卫大鼓包（第六轮 Scenario E2，P1 单元级）：突起超基础阈值且面积超局部预算 → 拒绝
  # 复用 Scenario C 的平面 3×3 网格折叠候选（突起 P≈0.088 介于 PROTRUDE_MAX 0.066 与预算 0.098 之间），
  # 传 sizeA 预算 0.01 → 受影响三角形面积≈0.5 > 1.3×0.01=0.013 → 大鼓包拒绝（大 + 鼓 = 圆锥体）。
  # RED 能力：把新增大鼓包条件删掉（或传 sizeA=null 断言应拒绝）→ bigBumpRejected 变 false → 红
  Scenario: 突起守卫拒绝突起超基础阈值的大鼓包三角形
    Given 构造平面 3×3 网格 + 折叠 (4,5) 到 [0.5,1,0.044] 的候选（突起 P≈0.088，collapseProtrudeMax 实测）
    When 直接调用 qem.mjs 的 collapseProtrudes（预算 0.098，sizeA 预算 0.01）
    Then 面积超局部预算时返回 true（大鼓包被拒绝）
    And 传 sizeA=null（旧调用兼容）返回 false（证明是新增条件在起作用）

  # ★ 突起守卫尖刺回归（fix7 Scenario G，P3 单元级）：0.06 级指尖尖刺折叠必须被拒
  # 小手指指尖尖刺（demo 实测 tri#15189 等 protrude 0.060~0.066，输入该处局部突起预算低 ≤0.04）
  # 被 fix6 的 PROTRUDE_MAX=0.066 放行（allowance=0.066 > 0.060）。平面 3×3 网格（近共面微三角团）
  # 折叠 (4,5)→[0.5,1,0.030]（突起 P≈0.060）+ 预算 0.04 → allowance=max(PROTRUDE_MAX,0.04)。
  # RED 能力：把 qem.mjs 的 PROTRUDE_MAX 改回 0.066（或更高）→ allowance=0.066>0.060 → 放行 → 本断言红
  Scenario: 突起守卫拒绝指尖尖刺折叠且不误杀正常折叠
    Given 构造平面 3×3 网格 + 折叠 (4,5) 到 [0.5,1,0.030] 的候选（突起 P≈0.060，介于预算 0.04 与阈值之间）
    When 直接调用 qem.mjs 的 collapseProtrudes（预算数组 0.04）
    Then 尖刺候选被拒绝（返回 true，0.06 级突起超 allowance）
    And 小突起折叠（d=0.02，P≈0.04 ≤ allowance）仍放行（不误杀）

  # ★ 全指尖区域新增尖刺检测（fix7.1 Scenario H，单元级）：verify.countNewFingertipProtrusions
  # fix7 外带断言漏检内带尖刺（demo 实测 13 个残留新增：外带 9 + 内带 4，内带 x≈±8.67~8.89 y≈14.2~14.5
  # z≈-0.8~-0.7 在指尖内侧/掌侧）。新口径 = 全指尖区域 |x|>7, 13<y<16 内「输出 protrude>0.05 且距输入
  # protrude>0.045 突起质心 >0.25 的三角形数」；输入自比恒 0（查询集 ⊆ 参考集，距自己质心 0）。
  # 本场景构造两块指尖区域 3×3 网格簇（簇 A 在 x∈[7.5,8.5]、簇 B 在 x∈[9.5,10.5]，各中心戳 0.06）：
  # 输入=簇 A，输出=簇 A+簇 B → 簇 B 全三角形远离输入突起 → 必判为新增（RED 能力：删除该导出→恒 0→红）。
  Scenario: 全指尖区域新增尖刺检测能抓到远离输入突起的输出三角形
    Given 构造指尖区域（|x|>7, 13<y<16）两块 3×3 网格簇（各中心戳出 0.06，protrude>0.05），输入=簇 A、输出=簇 A+簇 B
    When 直接调用 verify.mjs 的 countNewFingertipProtrusions
    Then 输入自比新增 0（inSelf=0，查询集 ⊆ 参考集）
    And 输出与输入相同时新增 0（outSame=0，无误报）
    And 输出含远离输入突起的簇 B 时新增 ≥1（outNew≥1，内带尖刺形态必被抓）

  # ★ fix8 法线 touchedV 过滤（单元级）：recomputeNormals 只重算参与过折叠的顶点，
  # 锁定/未触碰顶点保留输入法线（Tda 接缝分裂法线语义不因全局重写破坏）
  # 5×5 平面网格（z=0，25 顶点 / 32 三角形），边界环锁定（16 顶点，锁定顶点永不参与折叠），
  # 锁定顶点输入法线 [1,0,0] 与平面邻面面积加权平均 [0,0,1] 正交 → 无过滤时被改写（RED）、有过滤保留（GREEN）。
  # RED 能力：把 recomputeNormals 的 touchedV 过滤去掉（全局重写）→ lockedPreserved 变 false → 红
  Scenario: 未触碰顶点保留输入法线（touchedV 法线重写过滤）
    Given 构造 5×5 平面网格（边界环锁定，输入法线 [1,0,0] 与邻面平均 [0,0,1] 正交）
    When 直接调用 qem.mjs 的 collapseMesh（targetTriangles=8）
    Then 确实发生了折叠（stats.collapses > 0，断言前提成立）
    And 输入法线均为单位长度（前置，redCapable 区分「保留/重写」）
    And 所有锁定（未触碰）顶点输出法线 === 输入法线（保留）
    And 全部输出顶点法线单位长度（折叠顶点重算后仍归一化）

  # ★ 曲率感知尺寸守卫（第六轮 Scenario F，P0 集成级）：球面 fixture 减面输出无跨曲面超尺寸三角形
  # R=1 经纬球 seg=8/rings=8 → 128 输入三角形，每顶点曲率最低 20.8° > CURV_MIN_DEG(20°) → 门控全表面生效；
  # 输入无 sliver/无洞。target-ratio 0.5 下守卫开启 → 输出每个三角形 maxL/面积 ≤ max(floor, 系数 × 每顶点预算上限)
  # （阈值 import 自 qem.mjs，预算运行时实测）。
  # RED 能力（实录）：禁守卫后 QEM 跨球面合并出面积 0.295 > 上限 0.194 → sphereOutWithinSize 变 false → 红
  Scenario: 球面 fixture 减面输出无跨曲面超尺寸三角形
    Given 合成球面 fixture PMX 已生成（R=1，seg=8×rings=8，128 输入三角形，曲率全表面 > CURV_MIN_DEG）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then 输出中每个三角形 maxL 与面积均不超过 max(floor, 系数 × 顶点局部预算上限)（阈值 import 自 qem.mjs）
    And 输出文件可解析且 reduce 退出码为 0

  # ★ 质量断言解耦 BurumaSet（fix9，单元 2 集成级）：无 BurumaSet 材质模型仍执行全局质量检查
  # Tda 无 BurumaSet → 旧实现 qualityChecksActive=false 直接跳过全部质量断言（noNewOversizeTriangles /
  # noNonManifoldEdges / noNewHoles 全部不跑）→ 左大腿内侧 7 个新增跨曲面超尺寸三角形漏检。
  # fix9 后全局性检查无条件执行；仅材质相关检查（BurumaSet 分位/指尖）受 qualityChecksActive 门控。
  # 本场景复用合成 fixture（材质 mat0~mat4，无 BurumaSet 命名）验证：qualityChecksActive=false 但
  # 全局检查照跑（quality.active=true 且三个全局断言项全绿）。
  # RED 能力：把 verify.mjs 的 checkQuality 改回「无 BurumaSet 全跳」（quality.active 保持 false）→
  # qualityActive 变 false → 红；恢复 fix9 通用化 → 绿。
  Scenario: 无 BurumaSet 材质模型仍执行全局质量检查
    Given 合成 fixture PMX 已生成（2040 顶点 / 3902 三角形，无 BurumaSet 材质）
    When 用 reduce.mjs 生成减面 pmx（target-ratio 0.5）
    Then verify 输出 qualityChecksActive 为 false（无 BurumaSet → 材质相关检查跳过）
    And verify 输出 quality.active 为 true（全局质量检查已执行）
    And verify 输出 noNewOversizeTriangles 为 true（跨曲面新增超尺寸全局断言仍跑）
    And verify 输出 noNonManifoldEdges 为 true（非流形边全局断言仍跑）
    And verify 输出 noNewHoles 为 true（新增洞全局断言仍跑）

