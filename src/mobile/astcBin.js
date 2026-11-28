// ASTCBIN 容器解析（平台无关纯逻辑）：packAstcTexture（scripts/extract/texture.js）的读取端。
// 布局（全小端）：magic "ASTCBIN" 7 字节 + 1 字节补齐 | u32 width | u32 height |
// u16 blockWidth | u16 blockHeight | 原始 ASTC 块数据。头 20 字节。
//
// 平台分工：本模块只做字节级容器解析；引擎侧构造（CompressedTextureResource）在
// astcTexture.js，能力探测与加载链注入不进这里，保证 Node 单测零依赖。

export const ASTCBIN_MAGIC = "ASTCBIN";
export const ASTCBIN_HEADER_SIZE = 20;

// 魔数嗅探：只看前缀，不校验头完整性（截断文件也返回 true，交给 parseAstcBin 报错）
export function isAstcBin(bytes) {
  if (!bytes || bytes.length < ASTCBIN_MAGIC.length) return false;
  for (let i = 0; i < ASTCBIN_MAGIC.length; i++) {
    if (bytes[i] !== ASTCBIN_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

// 头部解析（前 20 字节）→ { width, height, blockWidth, blockHeight }
export function parseAstcBinHeader(bytes) {
  if (!isAstcBin(bytes)) throw new Error("ASTCBIN 魔数不符");
  if (bytes.length < ASTCBIN_HEADER_SIZE)
    throw new Error(
      `ASTCBIN 头不完整: ${bytes.length} < ${ASTCBIN_HEADER_SIZE}`,
    );
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: dv.getUint32(8, true),
    height: dv.getUint32(12, true),
    blockWidth: dv.getUint16(16, true),
    blockHeight: dv.getUint16(18, true),
  };
}

// 全量解析：头 + 块数校验 + 块数据切片（入参字节的视图，不拷贝）
export function parseAstcBin(bytes) {
  const header = parseAstcBinHeader(bytes);
  const { width, height, blockWidth, blockHeight } = header;
  const blocksX = Math.ceil(width / blockWidth);
  const blocksY = Math.ceil(height / blockHeight);
  const BLOCK_BYTES = 16;
  const expected = ASTCBIN_HEADER_SIZE + blocksX * blocksY * BLOCK_BYTES;
  if (bytes.length !== expected)
    throw new Error(`ASTCBIN 块数不符: ${bytes.length} vs ${expected}`);
  return {
    ...header,
    data: bytes.subarray(ASTCBIN_HEADER_SIZE),
  };
}
