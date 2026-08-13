// pmx-loader.mjs — 共享 PMX 加载/解析工具：读文件 → ArrayBuffer → MMDParser 解析
// 消除各脚本重复的 loadPmx 实现与 buf.buffer.slice 模式
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { MMDParser } = require('three/examples/jsm/libs/mmdparser.module.js');

export const parser = new MMDParser.Parser();

// Buffer → ArrayBuffer（只取 Buffer 实际占用的字节区间，不复制底层 ArrayBuffer 的多余部分）
export function bufToAB(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// 读 pmx 文件并解析；leftToRight 语义与 mmdparser parsePmx 第二参一致
export function loadPmx(path, leftToRight = true) {
  return parser.parsePmx(bufToAB(fs.readFileSync(path)), leftToRight);
}
