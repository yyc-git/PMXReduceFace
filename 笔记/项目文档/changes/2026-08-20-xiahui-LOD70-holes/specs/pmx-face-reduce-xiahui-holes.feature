# language: zh-CN
# Delta Spec: XiaHui LOD_70 减面后右臂/胸部无新增洞
# 用途: Phase B Step 2 实现依据 + BDD/集成测试
# 关联: fix (根因 = qem.mjs collapseCreatesHole 漏判 preU===1 && preV===1 && post<2)

@pmx-face-reduce-xiahui-holes
功能: XiaHui 模型在 LOD_70 减面后无新增洞

  背景:
    给定 输入模型 "demo/assets/XiaHui/TDA Utage CORAL COAST.pmx"
    并且 减面目标 ratio 为 0.7
    并且 锁定 morph 引用顶点
    并且 锁定接缝顶点
    并且 开启小材质锁定
    并且 开启双面微片锁定
    并且 开启曲率感知尺寸守卫

  场景: XiaHui LOD_70 右臂 V 形洞修复
    当 执行 collapseMesh 到 LOD_70
    那么 verify 断言 noNewHoles 为 true
    并且 verify 断言 newHoleEdges 为 0
    并且 输出模型右手上臂区域 (y 约 14-18, x 约 3-6) 无新增边界边

  场景: XiaHui LOD_70 胸部长条形洞修复
    当 执行 collapseMesh 到 LOD_70
    那么 verify 断言 noNewHoles 为 true
    并且 verify 断言 newHoleEdges 为 0
    并且 输出模型胸部区域 (y 约 15-18, x 约 -2 到 2) 无新增边界边

  场景: collapseCreatesHole 捕获边界边清除型洞 (单元级回归)
    给定 三角形网格 [(0,1,2), (0,2,3)] 且 边 (0,2) 为边界边
    并且 边 (1,2) 为边界边 (preU=1, preV=1)
    当 折叠边 (1,2) 时唯一三角形 (0,1,2) 被移除
    那么 collapseCreatesHole 返回 true (检测到洞)

  场景: 修复后 XiaoMei 模型回归 (LOD_50)
    给定 输入模型 "demo/assets/XiaoMei/XiaoMei.pmx"
    并且 减面目标 ratio 为 0.5
    当 执行 collapseMesh 到 LOD_50
    那么 verify 断言 noNewHoles 为 true
    并且 verify 所有 35 个 BDD 场景仍全绿

  场景: 修复后 Xiaye1 模型回归 (LOD_50)
    给定 输入模型 "demo/assets/Xiaye1/Xiaye1.pmx"
    并且 减面目标 ratio 为 0.5
    当 执行 collapseMesh 到 LOD_50
    那么 verify 断言 noNewHoles 为 true