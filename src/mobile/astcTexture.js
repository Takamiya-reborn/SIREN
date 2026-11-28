// ASTC 压缩纹理直通（引擎侧）：ASTCBIN 容器 -> GPU 压缩纹理上传，跳过逐像素解码
// 与 PNG 编码（P2a）。字节级解析在 astcBin.js（纯逻辑），本模块只管三件事：
//   1) 能力探测：WEBGL_compressed_texture_astc 可用性（提取模式翻转依据，不支持时
//      回退 textureMode png）
//   2) AstcResource：单级 mip 的 compressedTexImage2D 上传（pixi v6 的
//      CompressedTextureResource 对 ASTC 不可用——_formatToExtension 不认 ASTC 格式
//      且块尺寸硬编码 4x4，故自写 Resource 子类）
//   3) 加载链注入：pixi-live2d-display 的贴图经 Texture.fromURL（ImageResource），
//      blob URL 无扩展名，ImageResource 无法解码压缩数据；patched fromURL 按注册表
//      识别 ASTC 产物走压缩纹理构造，其余原样放行
//
// 依赖注入方向：fileStore 在 put/hydrate 时嗅探 ASTCBIN 头并把元数据经 registerAstcUrl
// 传入（resolve 产出 blob URL 时注册），本模块不感知虚拟路径与会话机制。

import { BaseTexture, Resource, Texture } from "pixi.js";
import { parseAstcBin, parseAstcBinHeader } from "./astcBin.js";

// ASTC 块尺寸 -> GL 内部格式（WEBGL_compressed_texture_astc 规定值；RGBA 变体对
// RGB 内容同样成立——ASTC 恒带 alpha 通道编码）。@pixi/constants 无 ASTC 枚举，本地定数。
const ASTC_FORMATS = {
  "4x4": 0x93b0,
  "5x5": 0x93b1,
  "6x6": 0x93b2,
  "8x8": 0x93b3,
  "10x10": 0x93b4,
  "12x12": 0x93b5,
};

let astcSupport;

/** WEBGL_compressed_texture_astc 可用性（探测一次缓存）；不支持时提取回退 png 模式 */
export function detectAstcSupport() {
  if (astcSupport === undefined) {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    astcSupport = !!(gl && gl.getExtension("WEBGL_compressed_texture_astc"));
    if (!astcSupport)
      console.info("[astc] WEBGL_compressed_texture_astc 不可用，贴图走 PNG 路径");
  }
  return astcSupport;
}

// ASTC 产物注册表：blob URL -> 头元数据。fileStore 在产出 blob URL 时登记，
// patched Texture.fromURL 据此分流；会话回收时撤销，防泄漏悬挂键
const astcUrls = new Map();

export const registerAstcUrl = (blobUrl, meta) => astcUrls.set(blobUrl, meta);
export const unregisterAstcUrl = (blobUrl) => astcUrls.delete(blobUrl);

// 块尺寸 -> GL 内部格式；未收录的块尺寸说明容器/枚举失配，抛错早于上传
const astcFormat = (blockWidth, blockHeight) => {
  const format = ASTC_FORMATS[`${blockWidth}x${blockHeight}`];
  if (!format)
    throw new Error(`ASTC 块尺寸未收录: ${blockWidth}x${blockHeight}`);
  return format;
};

// 单级 ASTC 压缩纹理资源：宽高即容器声明尺寸（UV 归一化口径与 PNG 路径一致）。
// GL 规定 compressedTexImage2D 的数据长度按 ceil(dim/block)*block 计，传声明宽高
// 与块数尺寸的数据即合规（与提取端 readAstcRaw 的块数校验同口径）
class AstcResource extends Resource {
  constructor(bytes, width, height, format) {
    super(width, height);
    this.data = bytes;
    this.format = format;
  }

  upload(renderer, _texture, _glTexture) {
    const extension = renderer.context.extensions.astc;
    if (!extension)
      throw new Error(
        "WEBGL_compressed_texture_astc textures are not supported",
      );
    if (!this.data) return true;
    renderer.gl.compressedTexImage2D(
      renderer.gl.TEXTURE_2D,
      0,
      this.format,
      this.width,
      this.height,
      0,
      this.data,
    );
    return true;
  }

  dispose() {
    this.data = null;
    super.dispose();
  }
}

/** 引擎注入：patched Texture.fromURL，ASTC 产物走压缩纹理构造，其余原样放行 */
export function registerAstcTextureSupport() {
  if (registerAstcTextureSupport._patched) return;
  registerAstcTextureSupport._patched = true;
  const original = Texture.fromURL;
  Texture.fromURL = (url, options) => {
    const meta = astcUrls.get(url);
    if (!meta) return original.call(Texture, url, options);
    return buildAstcTexture(url, meta);
  };
}

async function buildAstcTexture(url, meta) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const payload = parseAstcBin(bytes); // 全量校验 + 块数据切片
  const format = astcFormat(payload.blockWidth, payload.blockHeight);
  const baseTexture = new BaseTexture(
    new AstcResource(payload.data, payload.width, payload.height, format),
  );
  const texture = new Texture(baseTexture);
  // 与 Texture.fromURL 原路径同口径：按 URL 入缓存，重复取用免二次构造
  BaseTexture.addToCache(baseTexture, url);
  Texture.addToCache(texture, url);
  return texture;
}
