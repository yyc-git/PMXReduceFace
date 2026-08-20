import { defineFeature, loadFeature } from 'jest-cucumber';
import { execSync } from 'child_process';
import * as path from 'path';

const feature = loadFeature('test/features/pmx-face-reduce-xiahui-holes.feature');

interface GuardResults {
    s1: boolean;
    s2: boolean;
    s3: boolean;
    s4: boolean;
    s5: boolean;
}

// 直接在 node 进程内调用 qem.mjs 真实导出函数（非模拟）。
// jest(CJS 运行时)无法 import .mjs ESM，沿用本仓库既有约定：execSync 调 node 跑真实源。
function runGuards(): GuardResults {
    const helper = path.resolve(__dirname, '..', 'helpers', 'pmx-face-reduce-xiahui-holes.mjs');
    const out = execSync(`node "${helper}"`, { encoding: 'utf-8', cwd: path.resolve(__dirname, '../..'), timeout: 60000 });
    return JSON.parse(out.trim());
}

let results: GuardResults | null = null;

defineFeature(feature, (test) => {
    test('边界边清除型洞应被 collapseCreatesHole 拒绝', ({ given, when, then }) => {
        given(/^合成网格 "(.+)" 且边 \(0,1\) 为边界边$/, () => {
            results = runGuards();
        });
        when(/^折叠边 \(0,1\)$/, () => {
            // 已在 runGuards 中直接计算
        });
        then(/^collapseCreatesHole 返回 true（检测到洞，拒绝）$/, () => {
            expect(results!.s1).toBe(true);
        });
    });

    test('内部边变边界应被拒绝（已有守卫保持有效）', ({ given, when, then }) => {
        given(/^合成网格 "(.+)" 且折叠边 \(1,2\) 使内部边 \(0,2\) 变边界$/, () => {
            results = runGuards();
        });
        when(/^折叠边 \(1,2\)$/, () => {
            // 已在 runGuards 中直接计算
        });
        then(/^collapseCreatesHole 返回 true（检测到洞，拒绝）$/, () => {
            expect(results!.s2).toBe(true);
        });
    });

    test('内部边变悬空（interior→0 triangles）应被拒绝', ({ given, when, then }) => {
        given(/^合成网格 "(.+)" 且边 \(0,1\) 为内部边$/, () => {
            results = runGuards();
        });
        when(/^折叠边 \(0,1\) 使两三角形退化移除$/, () => {
            // 已在 runGuards 中直接计算
        });
        then(/^collapseCreatesHole 返回 true（检测到洞，拒绝）$/, () => {
            expect(results!.s3).toBe(true);
        });
    });

    test('正常内部边折叠应被允许（守卫不误杀）', ({ given, when, then }) => {
        given(/^合成网格 "(.+)" 且边 \(2,3\) 为自由角边$/, () => {
            results = runGuards();
        });
        when(/^折叠边 \(2,3\)$/, () => {
            // 已在 runGuards 中直接计算
        });
        then(/^collapseCreatesHole 返回 false（合法折叠，允许）$/, () => {
            expect(results!.s4).toBe(false);
        });
    });

    test('修复后边界清除型洞经窄化守卫 collapseCreatesHoleNarrow 仍被拒绝（集成实际折叠路径）', ({ given, when, then }) => {
        given(/^合成网格 "(.+)" 且边 \(0,1\) 为边界边（非近退化）$/, () => {
            results = runGuards();
        });
        when(/^经 collapseCreatesHoleNarrow 折叠边 \(0,1\)$/, () => {
            // 已在 runGuards 中直接计算
        });
        then(/^collapseCreatesHoleNarrow 返回 true（检测到洞，拒绝）$/, () => {
            expect(results!.s5).toBe(true);
        });
    });
});
