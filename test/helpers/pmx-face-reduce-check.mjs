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

// 原文件字节不变（操作后）
facts.originalHashAfter = hashOf(inputPath);
facts.originalHashUnchanged = facts.originalHashBefore === facts.originalHashAfter;

// 清理临时目录
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

console.log(JSON.stringify(facts));
