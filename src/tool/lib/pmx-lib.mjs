// pmx-lib.mjs — PMX 2.0 字节编码工具 + 段行走器（PmxWalker）
// 文本缓冲区：uint32 字节长度 + UTF-16LE 字节（mmdparser getTextBuffer / getUnicodeStrings 语义）
export function encodeTextBuffer(str) {
  const body = Buffer.from(str || '', 'utf16le');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

export function encodeIndex(value, size) {
  const b = Buffer.alloc(size);
  if (size === 1) b.writeInt8(value);
  else if (size === 2) b.writeInt16LE(value);
  else if (size === 4) b.writeInt32LE(value);
  else throw new Error('unsupported index size ' + size);
  return b;
}

export function encodeF32s(arr) {
  const b = Buffer.alloc(arr.length * 4);
  arr.forEach((v, i) => b.writeFloatLE(v, i * 4));
  return b;
}

// 读取 UTF-16LE 字符串（带 uint32 长度前缀）
function readText(buf, offset) {
  const size = buf.readUInt32LE(offset);
  const str = buf.toString('utf16le', offset + 4, offset + 4 + size);
  return { str, next: offset + 4 + size };
}

// 字节流读取器：与 mmdparser 各 parseXxx 的读取顺序严格对应（pmx-writer 等模块复用）
export class PmxWalker {
  constructor(buf, o) {
    this.buf = buf;
    this.o = o;
  }
  u8() { return this.buf.readUInt8(this.o.v++); }
  u16() { const v = this.buf.readUInt16LE(this.o.v); this.o.v += 2; return v; }
  u32() { const v = this.buf.readUInt32LE(this.o.v); this.o.v += 4; return v; }
  f32() { const v = this.buf.readFloatLE(this.o.v); this.o.v += 4; return v; }
  f32s(n) { const a = []; for (let i = 0; i < n; i++) a.push(this.f32()); return a; }
  skipIndex(size) { this.o.v += size; }
  skipIndexArr(size, n) { this.o.v += size * n; }
  text() { const t = readText(this.buf, this.o.v); this.o.v = t.next; return t.str; }
}
