// PNG 编码（Node 专用）：RGBA8 -> PNG 字节流（IHDR/IDAT/IEND，filter 0 逐行直写，zlib deflate）。
// 平台无关内核不 import 本模块；WebView 侧贴图走 ASTC 原始块直通或 OffscreenCanvas，不产 PNG。

import { deflateSync, crc32 as zlibCrc32 } from "node:zlib";

export function encodePng(rgba, width, height) {
  const chunk = (type, body) => {
    const buf = Buffer.alloc(12 + body.length);
    buf.writeUInt32BE(body.length, 0);
    buf.write(type, 4, "latin1");
    Buffer.from(body).copy(buf, 8);
    buf.writeUInt32BE(
      zlibCrc32(buf.subarray(4, 8 + body.length)) >>> 0,
      8 + body.length,
    );
    return buf;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression/filter/interlace 全 0
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * stride + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
