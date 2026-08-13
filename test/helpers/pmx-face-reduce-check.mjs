// pmx-face-reduce-check.mjs — BDD 辅助：合成 fixture PMX → spawnSync 跑 reduce.mjs + verify.mjs → 收集验收事实 JSON
// 场景覆盖：减半输出/roundtrip 零改动/morph 锁定/无退化/权重与法线/材质-header 一致/原文件字节不变/
//   --target-tri 绝对目标/自动材质保护（min-retention 保底）/--lock-materials 材质级锁定/
//   dropDegenerate 丢弃非法三角形回归
// fixture 设计（solution.md §3）：
//   51 列 × 40 行 = 2040 顶点（W=50 + 1 接缝列，接缝列与第 0 列位置重合、UV.x = 1.0）
//   50 × 39 = 1950 quad = 3900 三角形 + 注入 2 个非法三角形（零面积 + 重复索引，在 mat1 段）→ 3902
//   5 材质 mat0~mat4 = 1400/1202/800/300/200；2 顶点 morph + 1 材质 morph；高度场 0.5*sin(x*0.3)*cos(z*0.3)；法线 [0,1,0] type0 BDEF1
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { MMDParser } = require('three/examples/jsm/libs/mmdparser.module.js');
const parser = new MMDParser.Parser();

// sliver 约束（从被测 qem.mjs import，单一来源）。
// isValidCollapse 修复前后都存在（静态 import 安全）；SLIVER 阈值/判定/边长统计仅修复后导出，
// 因此用动态 import + 防御性 fallback：修复后走 qem.mjs 单一来源；RED 验证时（临时 revert 到修复前
// qem.mjs，无这些导出）降级到本地常量与实现，保证 helper 其余 12 场景仍可运行、仅新增 sliver 断言失败。
import {
    isValidCollapse,
    linkConditionValid,
    collapseCreatesHole,
    collapseFoldOver,
    buildVertexTris,
} from '../../src/tool/pmx-face-reduce/qem.mjs';

let SLIVER_ASPECT_MAX = 20;
let SLIVER_MAXL_MIN = 2.0;
let qemTriEdgeStats = null;
let qemIsSliver = null;
let PROTRUDE_MAX = 0.08;
let FLIP_LOCK_ANGLE = 120;
let FLIP_LOCK_AREA = 1e-3;
let qemCollapseProtrudes = null;
let qemCollectFlip = null;
try {
  const qem = await import('../../src/tool/pmx-face-reduce/qem.mjs');
  if (typeof qem.SLIVER_ASPECT_MAX === 'number') SLIVER_ASPECT_MAX = qem.SLIVER_ASPECT_MAX;
  if (typeof qem.SLIVER_MAXL_MIN === 'number') SLIVER_MAXL_MIN = qem.SLIVER_MAXL_MIN;
  if (typeof qem.triEdgeStats === 'function') qemTriEdgeStats = qem.triEdgeStats;
  if (typeof qem.isSliverTriangle === 'function') qemIsSliver = qem.isSliverTriangle;
  if (typeof qem.PROTRUDE_MAX === 'number') PROTRUDE_MAX = qem.PROTRUDE_MAX;
  if (typeof qem.FLIP_LOCK_ANGLE === 'number') FLIP_LOCK_ANGLE = qem.FLIP_LOCK_ANGLE;
  if (typeof qem.FLIP_LOCK_AREA === 'number') FLIP_LOCK_AREA = qem.FLIP_LOCK_AREA;
  if (typeof qem.collapseProtrudes === 'function') qemCollapseProtrudes = qem.collapseProtrudes;
  if (typeof qem.collectFlipMicroFaceVertices === 'function') qemCollectFlip = qem.collectFlipMicroFaceVertices;
} catch (e) { /* 修复前 qem.mjs：本地常量/实现兜底（值固定为修复引入的 0.08/120/1e-3） */ }

// 突起守卫（优先 qem.mjs；RED 验证时 qem.mjs 被临时 revert 无该导出 → 恒 false 放行 → 断言失败）
function collapseProtrudes(...args) {
  if (qemCollapseProtrudes) return qemCollapseProtrudes(...args);
  return false;
}
// 双面微片锁定（优先 qem.mjs；RED 验证时 → 恒空集 → 断言失败）
function collectFlipMicroFaceVertices(...args) {
  if (qemCollectFlip) return qemCollectFlip(...args);
  return new Set();
}

// 边长统计（优先 qem.mjs；fallback 与 qem.triEdgeStats 实现一致）
function triEdgeStats(p0, p1, p2) {
  if (qemTriEdgeStats) return qemTriEdgeStats(p0, p1, p2);
  const e0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const e1 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
  const e2 = Math.hypot(p0[0] - p2[0], p0[1] - p2[1], p0[2] - p2[2]);
  const maxL = Math.max(e0, e1, e2);
  const minL = Math.min(e0, e1, e2);
  return { maxL, minL, aspect: minL > 1e-12 ? maxL / minL : Infinity };
}

// sliver 判定（优先 qem.mjs；fallback 用阈值常量）
function isSliverTriangle(p0, p1, p2) {
  if (qemIsSliver) return qemIsSliver(p0, p1, p2);
  const s = triEdgeStats(p0, p1, p2);
  return s.aspect >= SLIVER_ASPECT_MAX && s.maxL >= SLIVER_MAXL_MIN;
}

// ---------- 独立字节工具（不依赖被测 writer，避免自证） ----------
const textBuffer = (s) => {
  const b = Buffer.from(s || '', 'utf16le');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(b.length, 0);
  return Buffer.concat([head, b]);
};
const u8 = (n) => { const b = Buffer.alloc(1); b.writeUInt8(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const f32s = (a) => { const b = Buffer.alloc(a.length * 4); a.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
const idxSigned = (v, size) => {
  const b = Buffer.alloc(size);
  if (size === 1) b.writeInt8(v);
  else if (size === 2) b.writeInt16LE(v);
  else b.writeInt32LE(v);
  return b;
};
const idxUnsigned = (v, size) => {
  const b = Buffer.alloc(size);
  if (size === 1) b.writeUInt8(v);
  else if (size === 2) b.writeUInt16LE(v);
  else b.writeUInt32LE(v);
  return b;
};
const bufToAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// ---------- 通用无装饰 PMX 构造（几何测试用：圆管 sliver fixture 等） ----------
function buildRawMeshPmx(positions, triList) {
  const chunks = [];
  chunks.push(Buffer.from('PMX '));
  const ver = Buffer.alloc(4); ver.writeFloatLE(2.0, 0); chunks.push(ver);
  chunks.push(Buffer.from([8, 0, 0, 2, 1, 1, 1, 1, 1]));
  chunks.push(textBuffer('fixture')); chunks.push(textBuffer('')); chunks.push(textBuffer('')); chunks.push(textBuffer(''));
  chunks.push(u32(positions.length));
  for (const p of positions) {
    chunks.push(f32s(p));
    chunks.push(f32s([0, 1, 0]));
    chunks.push(f32s([0, 0]));
    chunks.push(u8(0));
    chunks.push(idxSigned(0, 1));
    chunks.push(f32s([1]));
  }
  chunks.push(u32(triList.length * 3));
  for (const t of triList) for (const v of t) chunks.push(idxUnsigned(v, 2));
  chunks.push(u32(1));
  chunks.push(textBuffer('tex.png'));
  const parts = [
    textBuffer('mat'), textBuffer(''),
    f32s([1, 1, 1, 1]), f32s([0.5, 0.5, 0.5]), f32s([20]), f32s([0.2, 0.2, 0.2]), u8(0xf),
    f32s([0, 0, 0, 1]), f32s([1]),
    idxSigned(-1, 1), idxSigned(-1, 1), u8(0), u8(1), u8(1), textBuffer(''),
    u32(triList.length * 3),
  ];
  chunks.push(u32(1));
  chunks.push(Buffer.concat(parts));
  chunks.push(u32(0)); // bones
  chunks.push(u32(0)); // morphs
  chunks.push(u32(0)); // frames
  chunks.push(u32(0)); // rigidBodies
  chunks.push(u32(0)); // joints
  return Buffer.concat(chunks);
}

// 圆管（手指/肢体类圆柱几何）：seg 段 × (rings+1) 环 = (seg+1)*(rings+1) 顶点 / seg*rings*2 三角形
function buildTubePmx(seg = 24, len = 30, radius = 2, rings = 40) {
  const positions = [];
  const idx = (u, r) => r * (seg + 1) + u;
  for (let r = 0; r <= rings; r++) {
    const y = (r / rings) * len;
    for (let u = 0; u <= seg; u++) {
      const a = (u / seg) * Math.PI * 2;
      positions.push([Math.cos(a) * radius, y, Math.sin(a) * radius]);
    }
  }
  const tris = [];
  for (let r = 0; r < rings; r++) for (let u = 0; u < seg; u++) {
    const a = idx(u, r), b = idx(u + 1, r), d = idx(u, r + 1), e = idx(u + 1, r + 1);
    tris.push([a, b, e], [a, e, d]);
  }
  return buildRawMeshPmx(positions, tris);
}

// 指尖 fixture：细管（手指比例 R=0.3，同 thin tube）+ 半球形指甲盖（4 圈渐缩小三角形 = 近共面微三角团）
// + 2 对双面微片（管壁两侧，共边反向法线微小三角形，面积 < FLIP_LOCK_AREA）。
// 目标：复现「近共面微三角团被 QEM 免费合并成跨曲面大平面 → 顶点戳出邻面」的突起 bug（修复前 RED 基线）。
function buildFingertipPmx() {
  const seg = 16, len = 2, radius = 0.3, rings = 20;
  const positions = [];
  const tris = [];
  const idx = (u, r) => r * (seg + 1) + u;
  for (let r = 0; r <= rings; r++) {
    const y = (r / rings) * len;
    for (let u = 0; u <= seg; u++) {
      const a = (u / seg) * Math.PI * 2;
      positions.push([Math.cos(a) * radius, y, Math.sin(a) * radius]);
    }
  }
  for (let r = 0; r < rings; r++) for (let u = 0; u < seg; u++) {
    const a = idx(u, r), b = idx(u + 1, r), d = idx(u, r + 1), e = idx(u + 1, r + 1);
    tris.push([a, b, e], [a, e, d]);
  }
  // 指甲盖：4 圈渐缩环 + 极点（每环 seg+1 顶点，近共面小三角）
  const cap = [];
  for (const [y, r] of [[2.06, 0.29], [2.12, 0.26], [2.18, 0.20], [2.23, 0.12]]) {
    const ringIdx = [];
    for (let u = 0; u <= seg; u++) {
      const a = (u / seg) * Math.PI * 2;
      ringIdx.push(positions.length);
      positions.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    cap.push(ringIdx);
  }
  const pole = positions.length;
  positions.push([0, 2.25, 0]);
  for (let u = 0; u < seg; u++) {
    const a = idx(u, rings), b = idx(u + 1, rings);
    tris.push([a, b, cap[0][u + 1]], [a, cap[0][u + 1], cap[0][u]]);
  }
  for (let k = 0; k < cap.length - 1; k++) {
    for (let u = 0; u < seg; u++) {
      tris.push([cap[k][u], cap[k][u + 1], cap[k + 1][u + 1]], [cap[k][u], cap[k + 1][u + 1], cap[k + 1][u]]);
    }
  }
  for (let u = 0; u < seg; u++) {
    tris.push([cap[cap.length - 1][u], cap[cap.length - 1][u + 1], pole]);
  }
  // 双面微片：2 个独立双三角薄片（共边 (p0,p1)、法线 ±壁法线、面积 ≈5.9e-4 < FLIP_LOCK_AREA）
  const addMicroPair = (uBase, rBase) => {
    const a = (uBase / seg) * Math.PI * 2;
    const y = (rBase / rings) * len;
    const nx = Math.cos(a), nz = Math.sin(a);
    const p0 = [Math.cos(a) * radius, y, Math.sin(a) * radius];
    const p1 = [Math.cos(a + (Math.PI * 2) / seg) * radius, y, Math.sin(a + (Math.PI * 2) / seg) * radius];
    const mx = (p0[0] + p1[0]) / 2, my = y, mz = (p0[2] + p1[2]) / 2;
    const i0 = positions.length; positions.push(p0);
    const i1 = positions.length; positions.push(p1);
    const i2 = positions.length; positions.push([mx + nx * 0.01, my, mz + nz * 0.01]);
    const i3 = positions.length; positions.push([mx - nx * 0.01, my, mz - nz * 0.01]);
    tris.push([i0, i1, i2], [i0, i1, i3]);
  };
  addMicroPair(4, 18);
  addMicroPair(12, 18);
  return buildRawMeshPmx(positions, tris);
}

// ---------- 突起/翻转统计（复用 scripts/diag-fingertip.mjs 的数学） ----------
function buildEdgeTrisMap(m) {
  const edgeMap = new Map();
  for (let ti = 0; ti < m.faces.length; ti++) {
    const [a, b, c] = m.faces[ti].indices;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = x < y ? `${x}:${y}` : `${y}:${x}`;
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k).push(ti);
    }
  }
  return edgeMap;
}
function triPlaneInfo(m, ti) {
  const [a, b, c] = m.faces[ti].indices;
  const p0 = m.vertices[a].position, p1 = m.vertices[b].position, p2 = m.vertices[c].position;
  const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
  const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
  const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  return { n: [nx / nl, ny / nl, nz / nl], verts: [p0, p1, p2] };
}
// 突起面数：顶点到邻接三角形平面最大距离 > PROTRUDE_MAX 的三角形数（阈值与 qem.mjs 单一来源）
function countProtrudingFaces(m) {
  const edgeMap = buildEdgeTrisMap(m);
  const info = m.faces.map((_, ti) => triPlaneInfo(m, ti));
  let count = 0;
  let worst = 0;
  for (let ti = 0; ti < m.faces.length; ti++) {
    const it = info[ti];
    const [a, b, c] = m.faces[ti].indices;
    const nbs = new Set();
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = x < y ? `${x}:${y}` : `${y}:${x}`;
      for (const tj of edgeMap.get(k) || []) if (tj !== ti) nbs.add(tj);
    }
    let maxP = 0;
    for (const tj of nbs) {
      const nj = info[tj];
      const q = nj.verts[0];
      for (const p of it.verts) {
        const d = Math.abs((p[0] - q[0]) * nj.n[0] + (p[1] - q[1]) * nj.n[1] + (p[2] - q[2]) * nj.n[2]);
        if (d > maxP) maxP = d;
      }
    }
    if (maxP > worst) worst = maxP;
    if (maxP > PROTRUDE_MAX) count++;
  }
  return { count, worst };
}
// 翻转面数：与任一邻居法线夹角 > angleDeg 的三角形数
function countFlipFaces(m, angleDeg = 150) {
  const edgeMap = buildEdgeTrisMap(m);
  const info = m.faces.map((_, ti) => triPlaneInfo(m, ti));
  let count = 0;
  for (let ti = 0; ti < m.faces.length; ti++) {
    const it = info[ti];
    const [a, b, c] = m.faces[ti].indices;
    const nbs = new Set();
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = x < y ? `${x}:${y}` : `${y}:${x}`;
      for (const tj of edgeMap.get(k) || []) if (tj !== ti) nbs.add(tj);
    }
    let maxAng = 0;
    for (const tj of nbs) {
      const nn = info[tj].n;
      const dot = Math.max(-1, Math.min(1, it.n[0] * nn[0] + it.n[1] * nn[1] + it.n[2] * nn[2]));
      const ang = Math.acos(dot) * 180 / Math.PI;
      if (ang > maxAng) maxAng = ang;
    }
    if (maxAng > angleDeg) count++;
  }
  return count;
}

// 长条 sliver 计数（aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN，阈值与 qem.mjs 单一来源）
function countLongSlivers(m) {
  const v = m.vertices;
  let count = 0;
  let worst = { aspect: 0, maxL: 0 };
  for (const f of m.faces) {
    const [a, b, c] = f.indices;
    const s = triEdgeStats(v[a].position, v[b].position, v[c].position);
    if (s.aspect >= SLIVER_ASPECT_MAX && s.maxL >= SLIVER_MAXL_MIN) {
      count++;
      if (s.aspect > worst.aspect) worst = { aspect: s.aspect, maxL: s.maxL };
    }
  }
  return { count, worst };
}

// 边共享数统计：返回 { boundary, nonManifold }（边界边=共享1，非流形边=共享>2）。
// 用于洞回归（P0）断言：减面输出不得产生非流形边、边界边集合不得扩大。
function edgeManifoldStats(m) {
  const cnt = new Map();
  const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (const f of m.faces) {
    const [a, b, c] = f.indices;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = key(x, y);
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const [, c] of cnt) { if (c === 1) boundary++; else if (c > 2) nonManifold++; }
  return { boundary, nonManifold };
}

// ---------- 合成 fixture PMX（PMX 2.0，UTF-16LE，vertexIndexSize=2 其余 1） ----------
// 网格：列数 = W+1 = 51（第 50 列与第 0 列位置重合、UV.x=1.0 的接缝列），行数 = H = 40
const GRID_W = 50, GRID_H = 40, GRID_COLS = GRID_W + 1;
const GRID_VERT_COUNT = GRID_COLS * GRID_H; // 51 × 40 = 2040
// 材质 faceCount（三角形数）：mat0~mat2 大（>500），mat3/mat4 小（≤500）
// mat1 注入 2 个非法三角形（零面积 + 重复索引）→ 1200 + 2 = 1202
const MAT_TRI = [1400, 1202, 800, 300, 200];
const TOTAL_TRI = MAT_TRI.reduce((s, c) => s + c, 0); // 1400+1202+800+300+200 = 3902
const vertexIdx = (col, row) => row * GRID_COLS + col;

function gridPosition(col, row) {
  // 接缝列（col=50）与第 0 列空间重合 → xcoord = col % GRID_W
  const x = col % GRID_W;
  // 轻微高度场（确定性），给 QEM 真实代价，避免全平面塌缩不稳定
  return [x, 0.5 * Math.sin(x * 0.3) * Math.cos(row * 0.3), row];
}

// morph：2 顶点位移型（锁顶点 0 / 51）+ 1 材质型（type=8，验证 lock-set/verify 跳过材质索引）
const FIXTURE_MORPHS = [
  { name: 'morph_eye', type: 1, elements: [{ index: vertexIdx(0, 0), position: [0.1, 0.2, 0.3] }] },
  { name: 'morph_mouth', type: 1, elements: [{ index: vertexIdx(0, 1), position: [0, 0.2, 0] }] },
  { name: 'mat_morph', type: 8, elements: [{ index: 0, type: 0, diffuse: [1, 0, 0, 1], specular: [0, 0, 0], shininess: 0, ambient: [0, 0, 0], edgeColor: [0, 0, 0, 1], edgeSize: 0, textureColor: [0, 0, 0, 0], sphereTextureColor: [0, 0, 0, 0], toonColor: [0, 0, 0, 0] }] },
];

function encodeMorphElement(mtype, e) {
  if (mtype === 0) return Buffer.concat([idxSigned(e.index, 1), f32s([e.ratio])]);
  if (mtype === 1) return Buffer.concat([idxUnsigned(e.index, 2), f32s(e.position)]);
  if (mtype === 2) return Buffer.concat([idxSigned(e.index, 1), f32s(e.position), f32s(e.rotation)]);
  if (mtype === 3) return Buffer.concat([idxUnsigned(e.index, 2), f32s(e.uv)]);
  if (mtype === 8) {
    return Buffer.concat([
      idxSigned(e.index, 1), u8(e.type),
      f32s(e.diffuse), f32s(e.specular), f32s([e.shininess]), f32s(e.ambient),
      f32s(e.edgeColor), f32s([e.edgeSize]), f32s(e.textureColor), f32s(e.sphereTextureColor), f32s(e.toonColor),
    ]);
  }
  throw new Error('bad morph type ' + mtype);
}

function encodeMorph(m) {
  const parts = [textBuffer(m.name), textBuffer(m.englishName || ''), u8(m.panel || 0), u8(m.type), u32(m.elements.length)];
  for (const e of m.elements) parts.push(encodeMorphElement(m.type, e));
  return Buffer.concat(parts);
}

function buildHeader() {
  const chunks = [];
  chunks.push(Buffer.from('PMX '));
  const ver = Buffer.alloc(4); ver.writeFloatLE(2.0, 0); chunks.push(ver);
  // headerSize=8, encoding=0(UTF16), additionalUvNum=0, [vertex=2, texture=1, material=1, bone=1, morph=1, rigid=1]
  chunks.push(Buffer.from([8, 0, 0, 2, 1, 1, 1, 1, 1]));
  chunks.push(textBuffer('fixture')); chunks.push(textBuffer('')); chunks.push(textBuffer('')); chunks.push(textBuffer(''));
  return Buffer.concat(chunks);
}

function encodeMaterial(name, params, faceCount) {
  const parts = [
    textBuffer(name), textBuffer(params.englishName || ''),
    f32s(params.diffuse), f32s(params.specular), f32s([params.shininess]), f32s(params.ambient), u8(params.flag),
    f32s(params.edgeColor), f32s([params.edgeSize]),
    idxSigned(params.textureIndex, 1), idxSigned(params.envTextureIndex, 1), u8(params.envFlag),
    u8(params.toonFlag),
  ];
  if (params.toonFlag === 0) parts.push(idxSigned(params.toonIndex, 1));
  else if (params.toonFlag === 1) parts.push(u8(params.toonIndex));
  else throw new Error('bad toonFlag ' + params.toonFlag);
  parts.push(textBuffer(params.comment || ''));
  parts.push(u32(faceCount * 3)); // faceCount 字节 = 三角形数 × 3
  return Buffer.concat(parts);
}

function buildFixturePmx() {
  const chunks = [];
  chunks.push(buildHeader());
  // vertices：GRID_VERT_COUNT 个 BDEF1（type0）
  chunks.push(u32(GRID_VERT_COUNT));
  for (let row = 0; row < GRID_H; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const p = gridPosition(col, row);
      chunks.push(f32s(p));                          // position
      chunks.push(f32s([0, 1, 0]));                  // normal
      chunks.push(f32s([col / GRID_W, row / (GRID_H - 1)])); // uv（接缝列 uv.x=1.0）
      chunks.push(u8(0));                            // type 0 BDEF1
      chunks.push(idxSigned(0, 1));                  // boneIndex
      chunks.push(f32s([1]));                        // edgeRatio
    }
  }
  // faces：按材质连续段顺序。每 quad 2 tri：[a,b,c] + [a,c,d]
  const triList = [];
  for (let row = 0; row < GRID_H - 1; row++) {
    for (let col = 0; col < GRID_W; col++) {
      const a = vertexIdx(col, row), b = vertexIdx(col + 1, row), c = vertexIdx(col + 1, row + 1), d = vertexIdx(col, row + 1);
      triList.push([a, b, c], [a, c, d]);
    }
  }
  // 注入 2 个非法三角形到 mat1 段首（mat1 是 >500 大材质，不影响小材质 100% 断言）：
  //   1) 零面积：接缝重合点对 (col0,row1)/(col50,row1) + (col1,row1) → 面积 = 0
  //   2) 重复索引：[v,v,w]（a === b）
  triList.splice(MAT_TRI[0], 0,
    [vertexIdx(0, 1), vertexIdx(GRID_W, 1), vertexIdx(1, 1)],
    [vertexIdx(5, 5), vertexIdx(5, 5), vertexIdx(6, 5)]
  );
  chunks.push(u32(triList.length * 3));
  for (const t of triList) for (const v of t) chunks.push(idxUnsigned(v, 2));
  // textures：1 个
  chunks.push(u32(1));
  chunks.push(textBuffer('tex.png'));
  // materials：5 个（同参，仅 faceCount 不同；mat0 用纹理）
  const sharedParams = {
    englishName: '', diffuse: [1, 1, 1, 1], specular: [0.5, 0.5, 0.5], shininess: 20,
    ambient: [0.2, 0.2, 0.2], flag: 0xf, edgeColor: [0, 0, 0, 1], edgeSize: 1,
    textureIndex: 0, envTextureIndex: -1, envFlag: 0, toonFlag: 1, toonIndex: 1, comment: '',
  };
  const otherParams = {
    ...sharedParams, textureIndex: -1,
  };
  chunks.push(u32(MAT_TRI.length));
  chunks.push(encodeMaterial('mat0', sharedParams, MAT_TRI[0]));
  for (let mi = 1; mi < MAT_TRI.length; mi++) chunks.push(encodeMaterial('mat' + mi, otherParams, MAT_TRI[mi]));
  // bones：1 个（flag=0）
  chunks.push(u32(1));
  chunks.push(textBuffer('bone')); chunks.push(textBuffer(''));
  chunks.push(f32s([0, 0, 0]));
  chunks.push(idxSigned(-1, 1));
  chunks.push(u32(0));
  chunks.push(u16(0));
  chunks.push(f32s([0, 0, 0]));
  // morphs：3 个
  chunks.push(u32(FIXTURE_MORPHS.length));
  for (const mo of FIXTURE_MORPHS) chunks.push(encodeMorph(mo));
  // frames：0 个；rigidBodies / joints：0 个
  chunks.push(u32(0));
  chunks.push(u32(0));
  chunks.push(u32(0));
  return Buffer.concat(chunks);
}

// ---------- 收集事实 ----------
const facts = {};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REDUCE = path.join(ROOT, 'src', 'tool', 'pmx-face-reduce', 'reduce.mjs');
const VERIFY = path.join(ROOT, 'src', 'tool', 'pmx-face-reduce', 'verify.mjs');

const fixtureBuf = buildFixturePmx();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmx-reduce-'));
const inputPath = path.join(tmpDir, 'fixture.pmx');
const rand = Math.random().toString(36).slice(2);
const outPath = (tag) => path.join(tmpDir, 'out-' + tag + '-' + rand + '.pmx');

fs.writeFileSync(inputPath, fixtureBuf);
facts.inputExists = fs.existsSync(inputPath);

// 自检：fixture 本身可解析，且几何/材质/morph 计数与设计一致（防 fixture 写错误判全流程）
const fixtureModel = parser.parsePmx(bufToAB(fixtureBuf), false);
const fixtureSelfCheck = {
  vertexCount: fixtureModel.metadata.vertexCount === GRID_VERT_COUNT,
  faceCount: fixtureModel.faces.length === TOTAL_TRI,
  materialCount: fixtureModel.materials.length === MAT_TRI.length,
  materialFaceCounts: MAT_TRI.every((c, i) => fixtureModel.materials[i].faceCount === c),
  morphCount: fixtureModel.morphs.length === FIXTURE_MORPHS.length,
  seamLockedVerts: (() => {
    // 接缝：第 0 列与第 50 列逐行位置重合 → 每行一个 2 顶点簇 → 40 簇 × 2 = 80 顶点
    const seen = new Set();
    let clusters = 0;
    for (let row = 0; row < GRID_H; row++) {
      const a = vertexIdx(0, row), b = vertexIdx(GRID_W, row);
      if (a in seen || b in seen) return false;
      const pa = fixtureModel.vertices[a].position, pb = fixtureModel.vertices[b].position;
      if (pa[0] !== pb[0] || pa[1] !== pb[1] || pa[2] !== pb[2]) return false;
      seen.add(a); seen.add(b);
      clusters++;
    }
    return clusters === GRID_H;
  })(),
};
facts.fixtureSelfCheck = fixtureSelfCheck;
if (!Object.values(fixtureSelfCheck).every(Boolean)) {
  throw new Error('fixture self-check failed: ' + JSON.stringify(fixtureSelfCheck));
}
facts.originalVertices = fixtureModel.metadata.vertexCount;
facts.originalTriangles = fixtureModel.faces.length;
facts.originalMaterials = fixtureModel.materials.length;
facts.originalMaterialFaceCounts = fixtureModel.materials.map((m) => m.faceCount);

// ---------- sliver 回归（A 单元级）：直接调用 qem.mjs 的 isValidCollapse ----------
// A1：构造「折叠后新三角形为细长条（aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN）」的折叠候选。
// 三角 [u=0, B=1, C=2]，仅含端点 u（v=3 不在三角形内，折叠后该三角形变成 [newPos, B, C]）。
// newPos=(20,0.01,0) 使新三角形三边 ≈20/20/0.01 → aspect≈2000 且 maxL=20 → 必为 sliver。
// 修复前（isValidCollapse 只查退化/翻转）→ 返回 true → 本断言 RED；修复后 → 返回 false → GREEN。
{
  const positions = [
    [0, 0.5, 0],  // 0 = u（折叠端点）
    [0, 0, 0],    // 1 = B
    [0.01, 0, 0], // 2 = C
    [0, 0, 0],    // 3 = v（折叠端点，不在三角形内）
  ];
  const newPos = [20, 0.01, 0];
  const s = triEdgeStats(newPos, positions[1], positions[2]);
  facts.unitSliverCollapse = {
    rejected: isValidCollapse(positions, [0, 1, 2], 0, 3, newPos) === false,
    resultIsSliver: isSliverTriangle(newPos, positions[1], positions[2]) === true,
    aspect: s.aspect,
    maxL: s.maxL,
  };
}
// A2：正常折叠（新三角形 maxL<2，aspect 低）必须返回 true，防止 sliver 约束误杀。
{
  const positions = [
    [0, 0, 0], // 0 = u
    [1, 0, 0], // 1 = B
    [0, 1, 0], // 2 = C
    [0, 0, 0], // 3 = v
  ];
  const newPos = [0.3, 0.3, 0];
  const s = triEdgeStats(newPos, positions[1], positions[2]);
  facts.unitNormalCollapse = {
    accepted: isValidCollapse(positions, [0, 1, 2], 0, 3, newPos) === true,
    resultNotSliver: isSliverTriangle(newPos, positions[1], positions[2]) === false,
    aspect: s.aspect,
    maxL: s.maxL,
  };
}
// A3：手指级窄条（第三轮回归）—— 折叠后新三角形 maxL ∈ [0.5, 1.0) 且 aspect≥SLIVER_ASPECT_MAX。
// 手部实测的 8 个窄条 aspect=11、maxL=0.51~0.56（< 1.0）：SLIVER_MAXL_MIN=1.0 时守卫放行它们。
// 本候选 newPos=[0,0.05,0] 使新三角形三边 ≈0.602/0.6/0.05 → aspect≈12 且 maxL≈0.602。
// 收紧到 0.5 后：isValidCollapse 必须拒绝（返回 false）；若把 SLIVER_MAXL_MIN 改回 1.0，本候选
// maxL 0.602 < 1.0 → 守卫放行（返回 true）→ 本断言 RED（精确抓到「门槛太松」这一 bug）。
{
  const positions = [
    [0, 0, 0],       // 0 = u（折叠端点）
    [0.6, 0, 0],     // 1 = B
    [0.6, 0.05, 0],  // 2 = C（B-C 边 = 0.05，窄条宽度）
    [0, 0, 0],       // 3 = v（折叠端点，不在三角形内）
  ];
  const newPos = [0, 0.05, 0];
  const s = triEdgeStats(newPos, positions[1], positions[2]);
  facts.unitSliverBand = {
    rejected: isValidCollapse(positions, [0, 1, 2], 0, 3, newPos) === false,
    resultIsSliver: isSliverTriangle(newPos, positions[1], positions[2]) === true,
    aspect: s.aspect,
    maxL: s.maxL,
  };
}

// ---------- 拓扑守卫单元测试（P0 洞：link condition + 洞检测） ----------
// B1：菱形（diamond）—— u/v 公共邻居 {a,b,w} 多于边(u,v) 对立顶点 {a,b} → link condition 违反。
// 折叠会把两条边界边缝合成内部边 / 制造非流形，linkConditionValid 必须返回 false。
{
  const tris = [[0, 1, 2], [0, 1, 3], [0, 4, 5], [1, 4, 6]];
  const aliveT = new Uint8Array(tris.length).fill(1);
  const vTris = buildVertexTris(7, tris, aliveT);
  facts.unitLinkViolated = {
    rejected: linkConditionValid(tris, aliveT, vTris, 0, 1) === false,
  };
}
// B2：rim-corner —— 内部边 (0,1) 一端（顶点1）落在边界上，折叠后 (0,2) 由内部变边界 = 洞。
// linkConditionValid 仍为 true（公共邻居恰好等于对立顶点），但 collapseCreatesHole 必须返回 true。
{
  const tris = [[0, 1, 2], [0, 1, 3], [0, 2, 4], [0, 3, 5]];
  const aliveT = new Uint8Array(tris.length).fill(1);
  const vTris = buildVertexTris(6, tris, aliveT);
  facts.unitHoleCreated = {
    rejected: collapseCreatesHole(tris, aliveT, vTris, 0, 1) === true,
    linkPasses: linkConditionValid(tris, aliveT, vTris, 0, 1) === true,
  };
}
// B3：5×5 网格中心边折叠 —— 正常折叠不误杀（link=true / hole=false / fold=false）。
{
  const N = 5;
  const positions = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) positions.push([c, r, 0]);
  const idx = (c, r) => r * N + c;
  const tris = [];
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {
    const a = idx(c, r), b = idx(c + 1, r), d = idx(c, r + 1), e = idx(c + 1, r + 1);
    tris.push([a, b, e], [a, e, d]);
  }
  const aliveT = new Uint8Array(tris.length).fill(1);
  const vTris = buildVertexTris(positions.length, tris, aliveT);
  facts.unitTopologyNormal = {
    linkAccepted: linkConditionValid(tris, aliveT, vTris, 12, 13) === true,
    holeAccepted: collapseCreatesHole(tris, aliveT, vTris, 12, 13) === false,
    foldAccepted: collapseFoldOver(positions, tris, aliveT, vTris, 12, 13, [2.5, 2, 0]) === false,
  };
}

// ---------- 折叠翻转守卫单元测试（P2 fold-over） ----------
// C1：T1=(0,2,3) 与 T2=(2,4,3) 共边 (2,3)，法线均 +z。折叠 u=0 → (0.5,-1,0) 把 T1 翻到 -y 侧
// → T1 新法线 -z 与 T2 夹角 180°（> FOLD_ANGLE_MAX_DEG 且原始夹角 0° 正常）→ collapseFoldOver 必须 true。
// C2：折叠到原位附近（不翻转）→ false。
{
  const positions = [[0.5, 1, 0], [10, 10, 10], [0, 0, 0], [1, 0, 0], [0.5, -1, 0]];
  const tris = [[0, 2, 3], [2, 4, 3]];
  const aliveT = new Uint8Array(tris.length).fill(1);
  const vTris = buildVertexTris(5, tris, aliveT);
  facts.unitFoldOver = {
    rejected: collapseFoldOver(positions, tris, aliveT, vTris, 0, 1, [0.5, -1, 0]) === true,
    normalAccepted: collapseFoldOver(positions, tris, aliveT, vTris, 0, 1, [0.5, 1, 0.0001]) === false,
  };
}

// ---------- 突起守卫单元测试（P3 protrude） ----------
// D1：平面条带（全 z=0），折叠 (0,1) 到 [0.5,0,1]（戳出平面 1.0 >> PROTRUDE_MAX）→ 受影响三角形
//     顶点（如 3/4/5）距邻面平面 > PROTRUDE_MAX → collapseProtrudes 必须返回 true（拒绝）。
// D2：折叠到原位附近 [0.5,0,0]（平面内）→ 返回 false（不误杀）。
{
  const positions = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0]];
  const tris = [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]];
  const aliveT = new Uint8Array(tris.length).fill(1);
  const vTris = buildVertexTris(6, tris, aliveT);
  facts.unitProtrudeCollapse = {
    rejected: collapseProtrudes(positions, tris, aliveT, vTris, 0, 1, [0.5, 0, 1]) === true,
    normalAccepted: collapseProtrudes(positions, tris, aliveT, vTris, 0, 1, [0.5, 0, 0]) === false,
    protrudeMax: PROTRUDE_MAX,
  };
}

// ---------- 双面微片锁定单元测试（P3 flip lock） ----------
// E1：一对共边、法线相反的微三角形（面积 ≈5e-7 < FLIP_LOCK_AREA，夹角 180° > FLIP_LOCK_ANGLE）
//     → collectFlipMicroFaceVertices 必须锁定全部 3 顶点。
// E2：一对共边、法线一致、面积正常（> FLIP_LOCK_AREA）的三角形 → 不触发锁定（不误锁）。
{
  const microPos = [[0, 0, 0], [0.001, 0, 0], [0, 0, 0.001], [0, 0, -0.001]];
  const microTris = [[0, 1, 2], [0, 1, 3]];
  const locked = collectFlipMicroFaceVertices(microPos, microTris);
  facts.unitFlipLock = {
    lockedMicro: [0, 1, 2, 3].every((vi) => locked.has(vi)),
    lockCount: locked.size,
    notMislock: collectFlipMicroFaceVertices(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 0.5]],
      [[0, 1, 2], [0, 1, 3]]
    ).size === 0,
  };
}

// 原文件字节不变
const hashOf = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
facts.originalHashBefore = hashOf(inputPath);

// ---------- spawnSync 运行器 ----------
function runReduce(args) {
  const res = spawnSync(process.execPath, [REDUCE, ...args], { encoding: 'utf-8', timeout: 600000 });
  let stats = null;
  try {
    stats = JSON.parse(res.stdout.trim());
  } catch (e) {
    stats = { stdoutTail: String(res.stdout || '').slice(-500), stderrTail: String(res.stderr || '').slice(-500) };
  }
  return { exit: res.status, stats, stderr: String(res.stderr || '') };
}
function runVerify(args) {
  const res = spawnSync(process.execPath, [VERIFY, ...args], { encoding: 'utf-8', timeout: 600000 });
  let report = null;
  try {
    report = JSON.parse(res.stdout.trim());
  } catch (e) {
    report = { ok: false, stdoutTail: String(res.stdout || '').slice(-500), stderrTail: String(res.stderr || '').slice(-500) };
  }
  return { exit: res.status, report };
}
function parseOutput(p) {
  if (!fs.existsSync(p)) return null;
  try {
    const m = parser.parsePmx(bufToAB(fs.readFileSync(p)), false);
    return m;
  } catch (e) {
    return { parseError: String(e && e.message ? e.message : e) };
  }
}

// 主场景（场景 1-8）：--target-ratio 0.5
{
  const out = outPath('05');
  facts.outputPath05 = out;
  const r = runReduce(['--input', inputPath, '--output', out, '--target-ratio', '0.5']);
  facts.reduce05Exit = r.exit;
  facts.reduce05Stats = r.stats;
  facts.reduce05Stderr = r.stderr;
  facts.outputExists = fs.existsSync(out);
  facts.outputNonEmpty = facts.outputExists && fs.statSync(out).size > 0;
  facts.targetTriangles = Math.ceil(facts.originalTriangles * 0.5);
  const v = runVerify([inputPath, out, '--target-ratio', '0.5']);
  facts.verify05Exit = v.exit;
  facts.verify05 = v.report;
  const outModel = parseOutput(out);
  facts.outParseable = !!(outModel && !outModel.parseError);
  if (outModel && !outModel.parseError) {
    facts.outVertexCount = outModel.metadata.vertexCount;
    facts.outTriCount = outModel.faces.length;
  }
}

// roundtrip（场景 7）：--target-ratio 1.0
{
  const out = outPath('10');
  const r = runReduce(['--input', inputPath, '--output', out, '--target-ratio', '1.0']);
  facts.reduce10Exit = r.exit;
  const m = parseOutput(out);
  facts.roundtripParseable = !!(m && !m.parseError);
  if (m && !m.parseError) {
    facts.roundtripVertexCount = m.metadata.vertexCount;
    facts.roundtripTriCount = m.faces.length;
    facts.roundtripFirstMaterialFaceCount = m.materials[0].faceCount;
  }
  facts.roundtripFirstMaterialOrigFaceCount = fixtureModel.materials[0].faceCount;
}

// 绝对目标（场景 9）：--target-tri 1600
{
  const out = outPath('tri');
  const r = runReduce(['--input', inputPath, '--output', out, '--target-tri', '1600']);
  facts.reduceTriExit = r.exit;
  facts.reduceTriStats = r.stats;
  const v = runVerify([inputPath, out, '--target-tri', '1600']);
  facts.verifyTriExit = v.exit;
  facts.verifyTri = v.report;
}

// 自动材质保护（场景 10）：
//   run A：--min-retention 0.3 --target-tri 1600（可达，校验材质保留率）
//   run B：--min-retention 0.3 --target-tri 1000（< 保底 1520，触发 retention 阻断）
{
  const outA = outPath('autoA');
  const rA = runReduce(['--input', inputPath, '--output', outA, '--min-retention', '0.3', '--target-tri', '1600']);
  facts.reduceAutoExit = rA.exit;
  facts.reduceAutoStats = rA.stats;
  const vA = runVerify([inputPath, outA, '--min-retention', '0.3', '--target-tri', '1600']);
  facts.verifyAutoExit = vA.exit;
  facts.verifyAuto = vA.report;

  const outB = outPath('autoB');
  const rB = runReduce(['--input', inputPath, '--output', outB, '--min-retention', '0.3', '--target-tri', '1000']);
  facts.reduceAutoBExit = rB.exit;
  facts.reduceAutoBStats = rB.stats;
  // 保底 = 小材质 100%（300+200=500）+ 大材质 min-retention 0.3 下限（floor(1400×0.3)+floor(1202×0.3)+floor(800×0.3)=420+360+240=1020）= 1520
  facts.floorTriangles = 500 + 1020;
}

// 材质级锁定（场景 11）：--lock-materials "0" --min-retention 0 --lock-small-materials false --target-ratio 0.5
{
  const out = outPath('lock');
  const r = runReduce(['--input', inputPath, '--output', out, '--lock-materials', '0', '--min-retention', '0', '--lock-small-materials', 'false', '--target-ratio', '0.5']);
  facts.reduceLockExit = r.exit;
  facts.reduceLockStats = r.stats;
  const v = runVerify([inputPath, out, '--lock-materials', '0', '--min-retention', '0', '--lock-small-materials', 'false', '--target-ratio', '0.5']);
  facts.verifyLockExit = v.exit;
  facts.verifyLock = v.report;
}

// 退化三角形丢弃（场景 12）：--target-ratio 0.999 --target-tri 3900 → dropDegenerate=true（0.999<1.0）
// 输入 3902（含 2 个非法三角形），drop 后 3900，target=3900 → 0 折叠，输出应为 3900 且无退化/重复
{
  const out = outPath('degen');
  const r = runReduce(['--input', inputPath, '--output', out, '--target-ratio', '0.999', '--target-tri', '3900']);
  facts.reduceDegenExit = r.exit;
  facts.reduceDegenStats = r.stats;
  const m = parseOutput(out);
  facts.degenParseable = !!(m && !m.parseError);
  if (m && !m.parseError) {
    facts.degenTriCount = m.faces.length;
    let allValid = true;
    const seen = new Set();
    for (const f of m.faces) {
      const [a, b, c] = f.indices;
      if (a === b || b === c || a === c) { allValid = false; continue; }
      const p0 = m.vertices[a].position, p1 = m.vertices[b].position, p2 = m.vertices[c].position;
      const abx = p1[0] - p0[0], aby = p1[1] - p0[1], abz = p1[2] - p0[2];
      const acx = p2[0] - p0[0], acy = p2[1] - p0[1], acz = p2[2] - p0[2];
      const area = 0.5 * Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
      if (area <= 1e-9) allValid = false;
      const key = [a, b, c].sort((x, y) => x - y).join(',');
      if (seen.has(key)) allValid = false;
      seen.add(key);
    }
    facts.degenNoDegenerate = allValid;
  }
}

// sliver 回归（B 集成级）：合成管状 fixture（手指/肢体类圆柱几何）减面输出守卫。
// 圆管 seg=24 len=30 R=2 rings=40 → 25×41=1025 顶点 / 24×40×2=1920 三角形，输入无 sliver。
// target-ratio 0.5 时修复前的 QEM 在管壁产生「细且长」跨周长 sliver（实测 101 个、最差 aspect≈46 maxL≈24），
// 修复后为 0 → 断言「输出无长条 sliver」具备真实 RED 能力。
{
  const tubeBuf = buildTubePmx();
  const tubeInput = path.join(tmpDir, 'sliver-tube.pmx');
  const tubeOut = outPath('sliver-tube');
  fs.writeFileSync(tubeInput, tubeBuf);
  const tubeIn = parser.parsePmx(bufToAB(tubeBuf), false);
  facts.sliverTubeInputTri = tubeIn.faces.length;
  facts.sliverTubeInSliverCount = countLongSlivers(tubeIn).count;
  const tubeInManifold = edgeManifoldStats(tubeIn);
  facts.sliverTubeInBoundary = tubeInManifold.boundary;
  facts.sliverTubeInNonManifold = tubeInManifold.nonManifold;
  const r = runReduce(['--input', tubeInput, '--output', tubeOut, '--target-ratio', '0.5', '--lock-morph', 'false', '--lock-seams', 'false', '--min-retention', '0', '--lock-small-materials', 'false']);
  facts.sliverTubeExit = r.exit;
  facts.sliverTubeStats = r.stats;
  const tubeOutModel = parseOutput(tubeOut);
  facts.sliverTubeParseable = !!(tubeOutModel && !tubeOutModel.parseError);
  facts.sliverTubeOutSliverCount = -1;
  facts.sliverTubeOutWorst = { aspect: 0, maxL: 0 };
  facts.sliverTubeOutTri = 0;
  facts.sliverTubeOutBoundary = -1;
  facts.sliverTubeOutNonManifold = -1;
  if (tubeOutModel && !tubeOutModel.parseError) {
    const c = countLongSlivers(tubeOutModel);
    facts.sliverTubeOutSliverCount = c.count;
    facts.sliverTubeOutWorst = c.worst;
    facts.sliverTubeOutTri = tubeOutModel.faces.length;
    const om = edgeManifoldStats(tubeOutModel);
    facts.sliverTubeOutBoundary = om.boundary;
    facts.sliverTubeOutNonManifold = om.nonManifold;
  }
}

// sliver 回归（C 集成级）：细管 fixture 模拟手指（第三轮）。手指直径约 0.3-0.5、长度约 2，
// 用 R=0.3 管径 + seg=16 段 + rings=20 环（高 2）贴近手指比例且网格够密。
// 输入无 sliver（aspect≈1.5）。target-ratio 0.5 收紧后（SLIVER_MAXL_MIN=0.5）输出 0 个
// aspect≥SLIVER_ASPECT_MAX 且 maxL≥SLIVER_MAXL_MIN 的窄条。
// RED 能力：禁用守卫（isValidCollapse 去掉 sliver 检查）后，细管减面会在管壁产生跨长度窄条
// （实测 96 个、最差 aspect≈20 maxL≈2.0），本断言失败 → 恢复守卫后全绿。
{
  const thinBuf = buildTubePmx(16, 2, 0.3, 20);
  const thinInput = path.join(tmpDir, 'thin-tube.pmx');
  const thinOut = outPath('thin-tube');
  fs.writeFileSync(thinInput, thinBuf);
  const thinIn = parser.parsePmx(bufToAB(thinBuf), false);
  facts.thinTubeInputTri = thinIn.faces.length;
  facts.thinTubeInSliverCount = countLongSlivers(thinIn).count;
  const r = runReduce(['--input', thinInput, '--output', thinOut, '--target-ratio', '0.5', '--lock-morph', 'false', '--lock-seams', 'false', '--min-retention', '0', '--lock-small-materials', 'false']);
  facts.thinTubeExit = r.exit;
  facts.thinTubeStats = r.stats;
  const thinOutModel = parseOutput(thinOut);
  facts.thinTubeParseable = !!(thinOutModel && !thinOutModel.parseError);
  facts.thinTubeOutSliverCount = -1;
  facts.thinTubeOutWorst = { aspect: 0, maxL: 0 };
  facts.thinTubeOutTri = 0;
  if (thinOutModel && !thinOutModel.parseError) {
    const c = countLongSlivers(thinOutModel);
    facts.thinTubeOutSliverCount = c.count;
    facts.thinTubeOutWorst = c.worst;
    facts.thinTubeOutTri = thinOutModel.faces.length;
  }
}

// ---------- 突起守卫集成测试（P3）：指尖 fixture ----------
// 细管（手指比例）+ 半球形指甲盖（近共面微三角团）+ 2 对双面微片。
// target-ratio 0.5 时守卫开启 → 输出突起面数 ≤ 输入基线、翻转面数 ≤ 输入基线。
// RED 能力：revert collapseProtrudes（恒 false）+ collectFlipMicroFaceVertices（恒空）后，
// 指甲盖微三角团被 QEM 免费合并成跨曲面大平面 → 输出突起面数暴增 → 断言失败。
{
  const tipBuf = buildFingertipPmx();
  const tipInput = path.join(tmpDir, 'fingertip.pmx');
  const tipOut = outPath('fingertip');
  fs.writeFileSync(tipInput, tipBuf);
  const tipIn = parser.parsePmx(bufToAB(tipBuf), false);
  const inProt = countProtrudingFaces(tipIn);
  facts.fingerTipInputTri = tipIn.faces.length;
  facts.fingerTipInProtrude = inProt.count;
  facts.fingerTipInProtrudeWorst = inProt.worst;
  facts.fingerTipInFlips = countFlipFaces(tipIn, 150);
  const r = runReduce(['--input', tipInput, '--output', tipOut, '--target-ratio', '0.5', '--lock-morph', 'false', '--lock-seams', 'false', '--min-retention', '0', '--lock-small-materials', 'false']);
  facts.fingerTipExit = r.exit;
  facts.fingerTipStats = r.stats;
  const tipOutModel = parseOutput(tipOut);
  facts.fingerTipParseable = !!(tipOutModel && !tipOutModel.parseError);
  facts.fingerTipOutProtrude = -1;
  facts.fingerTipOutProtrudeWorst = 0;
  facts.fingerTipOutFlips = -1;
  facts.fingerTipOutTri = 0;
  if (tipOutModel && !tipOutModel.parseError) {
    const op = countProtrudingFaces(tipOutModel);
    facts.fingerTipOutProtrude = op.count;
    facts.fingerTipOutProtrudeWorst = op.worst;
    facts.fingerTipOutFlips = countFlipFaces(tipOutModel, 150);
    facts.fingerTipOutTri = tipOutModel.faces.length;
  }
}

// 原文件字节不变（操作后）
facts.originalHashAfter = hashOf(inputPath);
facts.originalHashUnchanged = facts.originalHashBefore === facts.originalHashAfter;

// 清理临时目录
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

console.log(JSON.stringify(facts));
