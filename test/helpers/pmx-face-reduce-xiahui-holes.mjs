// 薄封装：直接在 node 进程内调用 qem.mjs 的真实导出函数（非模拟、非绕过）。
// 因 jest(CJS 运行时)无法直接 import .mjs ESM 模块，沿用本仓库既有约定
// （steps.ts 通过 execSync 调 node 跑真实源），在此聚合 5 个场景的守卫结果。
import {
    collapseCreatesHole,
    collapseCreatesHoleNarrow,
} from '../../src/tool/pmx-face-reduce/qem.mjs';

function buildMesh(tris) {
    const n = Math.max(...tris.flat()) + 1;
    const aliveT = new Uint8Array(tris.length).fill(1);
    const vTris = Array.from({ length: n }, () => []);
    tris.forEach((t, i) => t.forEach((w) => vTris[w].push(i)));
    return { aliveT, vTris };
}

function defaultPositions(tris) {
    const n = Math.max(...tris.flat()) + 1;
    const pos = [];
    for (let i = 0; i < n; i++) pos.push([i * 1.0, (i % 2) * 0.7, (i % 3) * 0.3]);
    return pos;
}

const out = {};

// 场景1: 边界边清除型洞
{
    const tris = [[0, 1, 2], [3, 4, 5]];
    const { aliveT, vTris } = buildMesh(tris);
    out.s1 = collapseCreatesHole(tris, aliveT, vTris, 0, 1, new Set());
}

// 场景2: 内部边变边界
{
    const tris = [[0, 1, 2], [0, 2, 3]];
    const { aliveT, vTris } = buildMesh(tris);
    out.s2 = collapseCreatesHole(tris, aliveT, vTris, 1, 2, new Set());
}

// 场景3: 内部边变悬空（interior->0）
{
    const tris = [[0, 1, 2], [0, 1, 3]];
    const { aliveT, vTris } = buildMesh(tris);
    out.s3 = collapseCreatesHole(tris, aliveT, vTris, 0, 1, new Set());
}

// 场景4: 正常内部边折叠（允许，不误杀）
{
    const tris = [[0, 1, 2], [0, 1, 3]];
    const { aliveT, vTris } = buildMesh(tris);
    out.s4 = collapseCreatesHole(tris, aliveT, vTris, 2, 3, new Set());
}

// 场景5: 经窄化守卫 collapseCreatesHoleNarrow（实际折叠路径）
{
    const tris = [[0, 1, 2], [3, 4, 5]];
    const { aliveT, vTris } = buildMesh(tris);
    out.s5 = collapseCreatesHoleNarrow(tris, aliveT, vTris, 0, 1, defaultPositions(tris));
}

process.stdout.write(JSON.stringify(out));
