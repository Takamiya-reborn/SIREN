// Texture2D 解码（平台无关）：unityfs-js 已路由非 ASTC 格式；ASTC 48-59 用 texture2ddecoder-wasm 自补分支。
// 两条输出路径：
//   - decodeAstcRgba：解码为 RGBA 像素（top-down 行序）；PNG 编码由 Node 侧 png.js 承担
//   - readAstcRaw：不解码像素，ASTC 原始块直出（块行逆序重排等价垂直翻转，与 RGBA 路径行序口径一致），
//     供移动端把压缩纹理直接喂 GPU（WEBGL_compressed_texture_astc），省掉逐像素解码

import Decoder from "texture2ddecoder-wasm";

const ASTC_BLOCKS = {
  ASTC_RGB_4x4: [4, 4],
  ASTC_RGB_5x5: [5, 5],
  ASTC_RGB_6x6: [6, 6],
  ASTC_RGB_8x8: [8, 8],
  ASTC_RGB_10x10: [10, 10],
  ASTC_RGB_12x12: [12, 12],
  ASTC_RGBA_4x4: [4, 4],
  ASTC_RGBA_5x5: [5, 5],
  ASTC_RGBA_6x6: [6, 6],
  ASTC_RGBA_8x8: [8, 8],
  ASTC_RGBA_10x10: [10, 10],
  ASTC_RGBA_12x12: [12, 12],
};

export function isAstcFormat(formatName) {
  return formatName in ASTC_BLOCKS;
}

// 流式贴图数据（bundle 内 .resS 段）就位；已内嵌数据的贴图原样返回
function resolveTextureData(tex, manager) {
  if (tex.data && tex.data.length) return tex.data;
  const s = tex.streamData;
  if (!s) throw new Error(`贴图 ${tex.name} 无图像数据`);
  const resolved = manager.resolveResource(s.path, s.offset, s.size);
  if (!resolved)
    throw new Error(`贴图 ${tex.name} 流式数据解析失败: ${s.path}`);
  return resolved;
}

// ASTC Texture2D -> { width, height, rgba }。
// 默认翻转为标准 top-down 行序（与 PNG 行序约定一致）；flip=false 保留 Unity
// 原始行序（自底向上）仅供特殊采样语义使用
export async function decodeAstcRgba(tex, manager, { flip = true } = {}) {
  const [blockWidth, blockHeight] = ASTC_BLOCKS[tex.textureFormat];
  const data = resolveTextureData(tex, manager);
  const bgra = await Decoder.decode_astc(
    data,
    tex.width,
    tex.height,
    blockWidth,
    blockHeight,
  );
  if (!bgra) throw new Error(`贴图 ${tex.name} ASTC 解码失败`);
  const { width, height } = tex;
  const rgba = new Uint8Array(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = bgra[i + 3];
  }
  // Unity 纹理行序自底向上，top-down 行序按 y 翻转
  const flipped = new Uint8Array(rgba.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const src = flip ? (height - 1 - y) * row : y * row;
    flipped.set(rgba.subarray(src, src + row), y * row);
  }
  return { width, height, rgba: flipped };
}

// ASTC Texture2D -> { width, height, blockWidth, blockHeight, data }（原始块数据直出）。
// flip=true（默认）：块行逆序重排（16 字节/块整块搬运），把 Unity 自底向上的块行序转为
// top-down，与 decodeAstcRgba 的行序口径对齐；flip=false 原样透出。
// 块内 texel 行序与 GPU 上传/采样的整体对齐（是否还需 flipY 标志、块内是否需要额外翻转）
// 属移动端压缩纹理注入的探针验证项（P2a：以 decodeAstcRgba 路径输出为参照 A/B 比对），
// 本函数只负责"不做逐像素解码"这一件事
export function readAstcRaw(tex, manager, { flip = true } = {}) {
  const [blockWidth, blockHeight] = ASTC_BLOCKS[tex.textureFormat];
  const data = resolveTextureData(tex, manager);
  const { width, height } = tex;
  const blocksX = Math.ceil(width / blockWidth);
  const blocksY = Math.ceil(height / blockHeight);
  const BLOCK_BYTES = 16;
  if (data.length !== blocksX * blocksY * BLOCK_BYTES)
    throw new Error(
      `贴图 ${tex.name} ASTC 块数不符: ${data.length} vs ${blocksX * blocksY * BLOCK_BYTES}`,
    );
  const out = new Uint8Array(data.length);
  if (!flip) {
    out.set(data);
    return { width, height, blockWidth, blockHeight, data: out };
  }
  for (let by = 0; by < blocksY; by++) {
    const srcY = blocksY - 1 - by; // 块行逆序
    const src = srcY * blocksX * BLOCK_BYTES;
    out.set(
      data.subarray(src, src + blocksX * BLOCK_BYTES),
      by * blocksX * BLOCK_BYTES,
    );
  }
  return { width, height, blockWidth, blockHeight, data: out };
}

// readAstcRaw 结果 -> 自定义二进制容器（贴图"文件"形态，供 FileStore/缓存落盘与引擎注入层消费）：
//   magic "ASTCBIN" | u32 width | u32 height | u16 blockWidth | u16 blockHeight | 原始块数据
// 全部小端。解析端按 magic 识别（非本容器的贴图文件即 PNG，走常规图片加载）。
export function packAstcTexture(raw) {
  const head = new Uint8Array(18);
  const dv = new DataView(head.buffer);
  new TextEncoder().encodeInto("ASTCBIN", head);
  dv.setUint32(6, raw.width, true);
  dv.setUint32(10, raw.height, true);
  dv.setUint16(14, raw.blockWidth, true);
  dv.setUint16(16, raw.blockHeight, true);
  const out = new Uint8Array(head.length + raw.data.length);
  out.set(head, 0);
  out.set(raw.data, head.length);
  return out;
}
