// pmx-writer.mjs — PMX 字节级分段重写（roundtrip 精确）
// 原则：只重写数据变化的段（header 计数 / vertices / faces / materials.faceCount / morphs 顶点索引重映射），
// 其余段（textures / bones / frames / rigidBodies / joints 以及材质/骨骼/morph 其他字段）字节原样复制。
//
// 复用 ../lib/pmx-lib.mjs 的 PmxWalker + encode 工具。
// ⚠️ 与 mmdparser parseXxx 字节读取严格对齐（索引大小从 header meta 读取）。

import { PmxWalker, encodeIndex, encodeF32s, encodeTextBuffer } from '../lib/pmx-lib.mjs';
import { VERTEX_MORPH_TYPES } from './lock-set.mjs';

// ⚠️ pmx-lib.encodeIndex 用有符号 writeInt16LE（骨骼索引够用）；顶点索引可达 64400+
// 必须无符号编码（mmdparser getIndex(type, true) → getUint16/getUint32）。
function encodeIndexUnsigned(value, size) {
    const b = Buffer.alloc(size);
    if (size === 1) b.writeUInt8(value);
    else if (size === 2) b.writeUInt16LE(value);
    else if (size === 4) b.writeUInt32LE(value);
    else throw new Error('unsupported index size ' + size);
    return b;
}

/* ------------------------------------------------------------------ *
 * 段定位
 * ------------------------------------------------------------------ */

/**
 * 按 mmdparser 读取顺序行走原文件，记录各段字节偏移 + 需 patch 的字段 offset。
 * @param {Buffer} buf
 * @param {Object} meta mmdparser 解析结果 metadata
 * @returns {{
 *   verticesStart, facesStart, texturesStart, materialsStart, bonesStart, morphsStart,
 *   framesStart, rigidBodiesStart, jointsStart: number,
 *   materialFaceCountOffsets: number[]   // 每材质 faceCount u32 的绝对字节偏移
 * }}
 */
export function locateSections(buf, meta) {
    const w = new PmxWalker(buf, { v: 0 });
    const { boneIndexSize, additionalUvNum, vertexIndexSize, textureIndexSize, materialIndexSize } = meta;

    // header：magic/version/headerSize/encoding/additionalUvNum/6 sizes/4 texts
    w.f32s(2); // magic 'PMX ' + version
    w.u8(); // headerSize
    w.u8(); // encoding
    w.u8(); // additionalUvNum
    w.u8(); // vertexIndexSize
    w.u8(); // textureIndexSize
    w.u8(); // materialIndexSize
    w.u8(); // boneIndexSize
    w.u8(); // morphIndexSize
    w.u8(); // rigidBodyIndexSize
    w.text(); w.text(); w.text(); w.text(); // modelName / englishModelName / comment / englishComment

    // vertices 段
    const verticesStart = w.o.v;
    const vCount = w.u32();
    for (let i = 0; i < vCount; i++) {
        w.f32s(3); w.f32s(3); w.f32s(2);
        for (let a = 0; a < additionalUvNum; a++) w.f32s(4);
        const type = w.u8();
        if (type === 0) w.skipIndexArr(boneIndexSize, 1);
        else if (type === 1) { w.skipIndexArr(boneIndexSize, 2); w.f32(); }
        else if (type === 2) { w.skipIndexArr(boneIndexSize, 4); w.f32s(4); }
        else if (type === 3) { w.skipIndexArr(boneIndexSize, 2); w.f32(); w.f32s(3); w.f32s(3); w.f32s(3); }
        else throw new Error('unsupported vertex type ' + type);
        w.f32(); // edgeRatio
    }

    // faces 段
    const facesStart = w.o.v;
    const faceIndexCount = w.u32();
    w.skipIndexArr(vertexIndexSize, faceIndexCount);

    // textures 段（原样复制）
    const texturesStart = w.o.v;
    const texCount = w.u32();
    for (let i = 0; i < texCount; i++) w.text();

    // materials 段：记录每材质 faceCount 字段 offset
    const materialsStart = w.o.v;
    const materialFaceCountOffsets = [];
    const matCount = w.u32();
    for (let i = 0; i < matCount; i++) {
        w.text(); w.text();
        w.f32s(4); w.f32s(3); w.f32(); w.f32s(3); w.u8();
        w.f32s(4); w.f32();
        w.skipIndex(textureIndexSize);
        w.skipIndex(textureIndexSize);
        w.u8(); // envFlag
        const toonFlag = w.u8();
        if (toonFlag === 0) w.skipIndex(textureIndexSize);
        else if (toonFlag === 1) w.u8();
        else throw new Error('unknown toon flag ' + toonFlag);
        w.text(); // comment
        materialFaceCountOffsets.push(w.o.v);
        w.u32(); // faceCount
    }

    // bones 段（原样复制）
    const bonesStart = w.o.v;
    const boneCount = w.u32();
    for (let i = 0; i < boneCount; i++) {
        w.text(); w.text();
        w.f32s(3);
        w.skipIndex(boneIndexSize);
        w.u32();
        const flag = w.u16();
        if (flag & 0x1) w.skipIndex(boneIndexSize);
        else w.f32s(3);
        if (flag & 0x100 || flag & 0x200) { w.skipIndex(boneIndexSize); w.f32(); }
        if (flag & 0x400) w.f32s(3);
        if (flag & 0x800) { w.f32s(3); w.f32s(3); }
        if (flag & 0x2000) w.u32();
        if (flag & 0x20) {
            w.skipIndex(boneIndexSize);
            w.u32();
            w.f32();
            const linkCount = w.u32();
            for (let l = 0; l < linkCount; l++) {
                w.skipIndex(boneIndexSize);
                const angleLim = w.u8();
                if (angleLim === 1) { w.f32s(3); w.f32s(3); }
            }
        }
    }

    // morphs 段：顶点索引型元素（type 1/3/4/5/6/7）的 index 字段 offset 已不需要
    //（buildDecimatedPmx 现整段重写 morphs，见 rebuildMorphsSection）
    const morphsStart = w.o.v;
    const morphCount = w.u32();
    for (let i = 0; i < morphCount; i++) {
        w.text(); w.text();
        w.u8(); // panel
        const mtype = w.u8();
        const elemCount = w.u32();
        for (let e = 0; e < elemCount; e++) {
            if (mtype === 0) { w.skipIndex(meta.morphIndexSize); w.f32(); }
            else if (mtype === 1) { w.skipIndex(vertexIndexSize); w.f32s(3); }
            else if (mtype === 2) { w.skipIndex(boneIndexSize); w.f32s(3); w.f32s(4); }
            else if (mtype === 3 || mtype === 4 || mtype === 5 || mtype === 6 || mtype === 7) {
                w.skipIndex(vertexIndexSize);
                w.f32s(4);
            } else if (mtype === 8) {
                w.skipIndex(materialIndexSize); w.u8();
                w.f32s(4); w.f32s(3); w.f32(); w.f32s(3); w.f32s(4); w.f32(); w.f32s(4); w.f32s(4); w.f32s(4);
            } else throw new Error('unsupported morph type ' + mtype);
        }
    }

    // frames 段
    const framesStart = w.o.v;
    const frameCount = w.u32();
    for (let i = 0; i < frameCount; i++) {
        w.text(); w.text();
        w.u8();
        const elemCount = w.u32();
        for (let e = 0; e < elemCount; e++) {
            const target = w.u8();
            w.skipIndex(target === 0 ? boneIndexSize : meta.morphIndexSize);
        }
    }

    const rigidBodiesStart = w.o.v;
    const rigidBodyCount = w.u32();
    for (let i = 0; i < rigidBodyCount; i++) {
        // mmdparser parseRigidBody: text×2 / boneIndex / groupIndex u8 / groupTarget u16 /
        // shapeType u8 / width+height+depth(3) / position(3) / rotation(3) /
        // weight+positionDamping+rotationDamping+restitution+friction(5) / type u8
        w.text(); w.text();
        w.skipIndex(boneIndexSize);
        w.u8();
        w.u16();
        w.u8();
        w.f32s(3);
        w.f32s(3);
        w.f32s(3);
        w.f32s(5);
        w.u8();
    }

    const jointsStart = w.o.v;
    const jointCount = w.u32();
    for (let i = 0; i < jointCount; i++) {
        // mmdparser parseConstraint: text×2 / type u8 / rigidBodyIndex1 / rigidBodyIndex2 /
        // position(3) / rotation(3) / translationLimitation1(3) / translationLimitation2(3) /
        // rotationLimitation1(3) / rotationLimitation2(3) / springPosition(3) / springRotation(3)
        w.text(); w.text();
        w.u8();
        w.skipIndex(meta.rigidBodyIndexSize);
        w.skipIndex(meta.rigidBodyIndexSize);
        w.f32s(3);
        w.f32s(3);
        w.f32s(3);
        w.f32s(3);
        w.f32s(3);
        w.f32s(3);
        w.f32s(3);
        w.f32s(3);
    }

    return {
        verticesStart,
        facesStart,
        texturesStart,
        materialsStart,
        bonesStart,
        morphsStart,
        framesStart,
        rigidBodiesStart,
        jointsStart,
        materialFaceCountOffsets,
    };
}

/**
 * 将 morph 元素索引经 indexMap 重映射为输出顶点索引。
 * 旧索引在 indexMap 范围内则查表；否则原样保留；返回 -1 表示顶点已被折叠移除
 * （调用方应据此丢弃该 morph 元素）。
 * @param {number} oldIdx 旧顶点索引
 * @param {ArrayLike<number>} indexMap 旧索引 → 新索引（-1=移除）
 * @returns {number} 新索引（-1=顶点已删）
 */
export function remapMorphIndex(oldIdx, indexMap) {
    return oldIdx >= 0 && oldIdx < indexMap.length ? indexMap[oldIdx] : oldIdx;
}

/* ------------------------------------------------------------------ *
 * 顶点序列化
 * ------------------------------------------------------------------ */

/**
 * 序列化单个顶点（严格对齐 mmdparser parseVertex）。
 * 支持 type 0/1/2；type=3（SDEF）mmdparser 已降级 type1，遇之 throw。
 * @param {Object} v 顶点对象
 * @param {Object} meta
 * @returns {Buffer}
 */
export function serializeVertex(v, meta) {
    const { boneIndexSize, additionalUvNum } = meta;
    const parts = [
        encodeF32s(v.position),
        encodeF32s(v.normal),
        encodeF32s(v.uv),
    ];
    if (additionalUvNum > 0) {
        for (let a = 0; a < additionalUvNum; a++) {
            parts.push(encodeF32s(v.auvs && v.auvs[a] ? v.auvs[a] : [0, 0, 0, 0]));
        }
    }
    parts.push(Buffer.from([v.type]));
    const idx = v.skinIndices || [];
    const w = v.skinWeights || [];
    if (v.type === 0) {
        // BDEF1：1 boneIndex，无权重字节
        parts.push(encodeIndex(idx[0] || 0, boneIndexSize));
    } else if (v.type === 1) {
        // BDEF2：2 boneIndex + 1 f32（weight[0]，weight[1]=1-w0 隐含）
        parts.push(encodeIndex(idx[0] || 0, boneIndexSize));
        parts.push(encodeIndex(idx[1] || 0, boneIndexSize));
        parts.push(encodeF32s([w[0] !== undefined ? w[0] : 1.0]));
    } else if (v.type === 2) {
        // BDEF4：4 boneIndex + 4 f32
        for (let i = 0; i < 4; i++) parts.push(encodeIndex(idx[i] || 0, boneIndexSize));
        parts.push(encodeF32s([w[0] || 0, w[1] || 0, w[2] || 0, w[3] || 0]));
    } else {
        throw new Error('cannot serialize vertex type ' + v.type);
    }
    parts.push(encodeF32s([v.edgeRatio !== undefined ? v.edgeRatio : 1]));
    return Buffer.concat(parts);
}

/**
 * 序列化 vertices 段：u32 count + 各顶点字节。
 */
export function serializeVerticesSection(vertices, meta) {
    const parts = [encodeIndex(vertices.length, 4)];
    for (const v of vertices) parts.push(serializeVertex(v, meta));
    return Buffer.concat(parts);
}

/**
 * 序列化 faces 段：u32 faceVertexIndexCount（= 三角形数 × 3）+ 各三角形 3 个索引。
 * 顶点索引用无符号编码（可达 64400+）。
 * @param {number[][]} triangles
 */
export function serializeFacesSection(triangles, meta) {
    const parts = [encodeIndexUnsigned(triangles.length * 3, 4)];
    for (const t of triangles) {
        for (let k = 0; k < 3; k++) parts.push(encodeIndexUnsigned(t[k], meta.vertexIndexSize));
    }
    return Buffer.concat(parts);
}

/* ------------------------------------------------------------------ *
 * morphs 段重写（顶点索引重映射 + 丢弃引用已删顶点的元素）
 * ------------------------------------------------------------------ */

// 每类型 morph 元素的字节大小（严格对齐 mmdparser parseMorph 元素读取）
function morphElemSize(mtype, meta) {
    switch (mtype) {
        case 0: return meta.morphIndexSize + 4;
        case 1: return meta.vertexIndexSize + 12;
        case 2: return meta.boneIndexSize + 12 + 16;
        case 3: case 4: case 5: case 6: case 7: return meta.vertexIndexSize + 16;
        case 8: return meta.materialIndexSize + 1 + 16 + 12 + 4 + 12 + 16 + 4 + 16 + 16 + 16;
        default: throw new Error('unsupported morph type ' + mtype);
    }
}

/**
 * 重写 morphs 段：顶点索引型元素（type 1/3/4/5/6/7）的 index 经 indexMap 重映射；
 * 映射为 -1（顶点被折叠移除）的元素直接丢弃（不抛错），全部元素被丢则 morph 保留为空数组。
 * 非顶点索引型 morph（type 0/2/8）元素原样复制（索引字段不重映射）。
 * @param {Buffer} buf
 * @param {Object} sections locateSections 结果
 * @param {Object} meta
 * @param {Int32Array} indexMap
 * @returns {Buffer}
 */
function rebuildMorphsSection(buf, sections, meta, indexMap) {
    const { morphsStart } = sections;
    const { vertexIndexSize } = meta;
    const w = new PmxWalker(buf, { v: morphsStart });
    const morphCount = w.u32();
    const outMorphs = [];
    for (let mi = 0; mi < morphCount; mi++) {
        const name = w.text();
        const englishName = w.text();
        const panel = w.u8();
        const mtype = w.u8();
        const elemCount = w.u32();
        const isVertexType = VERTEX_MORPH_TYPES.has(mtype);
        const keptElems = [];
        let kept = 0;
        for (let e = 0; e < elemCount; e++) {
            const elemStart = w.o.v;
            const size = morphElemSize(mtype, meta);
            w.o.v += size;
            if (isVertexType) {
                const oldIdx = vertexIndexSize === 2 ? buf.readUInt16LE(elemStart) : buf.readUInt32LE(elemStart);
                const newIdx = remapMorphIndex(oldIdx, indexMap);
                if (newIdx < 0) continue; // 顶点已删 → 丢弃该 morph 元素
                const elem = Buffer.from(buf.subarray(elemStart, elemStart + size));
                if (vertexIndexSize === 2) elem.writeUInt16LE(newIdx, 0);
                else elem.writeUInt32LE(newIdx, 0);
                keptElems.push(elem);
            } else {
                keptElems.push(Buffer.from(buf.subarray(elemStart, elemStart + size)));
            }
            kept++;
        }
        outMorphs.push(Buffer.concat([
            encodeTextBuffer(name),
            encodeTextBuffer(englishName),
            Buffer.from([panel]),
            Buffer.from([mtype]),
            encodeIndexUnsigned(kept, 4),
            ...keptElems,
        ]));
    }
    return Buffer.concat([encodeIndexUnsigned(morphCount, 4), ...outMorphs]);
}

/**
 * 组装减面后的 PMX 文件字节。
 * @param {Buffer} buf 原文件
 * @param {Object} sections locateSections 结果
 * @param {Object} meta
 * @param {{
 *   vertices: Object[],
 *   triangles: number[][],
 *   materialTriCounts: number[],   // 每材质新三角形数
 *   indexMap: Int32Array            // 旧顶点索引 → 新顶点索引（-1=移除）
 * }} payload
 * @returns {Buffer}
 */
export function buildDecimatedPmx(buf, sections, meta, { vertices, triangles, materialTriCounts, indexMap }) {
    // header 字节原样（[0, verticesStart)），vertexCount 由新 vertices 段携带
    const header = buf.subarray(0, sections.verticesStart);
    const verts = serializeVerticesSection(vertices, meta);
    const faces = serializeFacesSection(triangles, meta);
    const textures = buf.subarray(sections.texturesStart, sections.materialsStart);
    const bones = buf.subarray(sections.bonesStart, sections.morphsStart);
    const frames = buf.subarray(sections.framesStart, sections.rigidBodiesStart);
    const rigidBodies = buf.subarray(sections.rigidBodiesStart, sections.jointsStart);
    const joints = buf.subarray(sections.jointsStart, buf.length);

    // materials 段：复制原字节，patch 每材质 faceCount = 新三角形数 × 3
    const materials = Buffer.from(buf.subarray(sections.materialsStart, sections.bonesStart));
    if (materialTriCounts) {
        for (let i = 0; i < sections.materialFaceCountOffsets.length; i++) {
            const off = sections.materialFaceCountOffsets[i] - sections.materialsStart;
            const cnt = materialTriCounts[i] !== undefined ? materialTriCounts[i] * 3 : 0;
            materials.writeUInt32LE(cnt >>> 0, off);
        }
    }

    // morphs 段：整段重写（顶点索引重映射 + 丢弃引用已删顶点的元素）；无 indexMap 时原样复制
    const morphs = indexMap
        ? rebuildMorphsSection(buf, sections, meta, indexMap)
        : buf.subarray(sections.morphsStart, sections.framesStart);

    return Buffer.concat([header, verts, faces, textures, materials, bones, morphs, frames, rigidBodies, joints]);
}
