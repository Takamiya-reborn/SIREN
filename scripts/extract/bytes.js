// 平台无关二进制工具：Uint8Array/ArrayBuffer 归一、CRC32（zlib.crc32 值域）、DataView 读写。
// 内核模块（moc3/motion/spineSkel/texture）经此层访问二进制，不依赖 node:zlib / node:fs。

// 归一为独立 Uint8Array：Array/ArrayBuffer/带池偏移的视图都拷出精确大小
export function toU8(v) {
  if (v instanceof Uint8Array) {
    if (v.byteOffset === 0 && v.byteLength === v.buffer.byteLength) return v;
    return new Uint8Array(v); // 视图拷贝
  }
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return new Uint8Array(v); // Array<number> 或其它可迭代
}

// CRC-32（IEEE 802.3 反射多项式 0xEDB88320），返回无符号数，与 node:zlib crc32 >>> 0 一致
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data) {
  const u8 =
    typeof data === "string" ? new TextEncoder().encode(data) : toU8(data);
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++)
    c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 整段字节的十六进制串（诊断消息用），等价 Buffer.toString("hex")
export function toHex(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
  return s;
}

// 任意偏移的二进制只读视图：包一层 DataView，宿主 Uint8Array 允许带 byteOffset
export class ByteReader {
  constructor(bytes) {
    this.bytes = toU8(bytes);
    this.dv = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset,
      this.bytes.byteLength,
    );
  }

  u32LE(off) {
    return this.dv.getUint32(off, true);
  }

  i32LE(off) {
    return this.dv.getInt32(off, true);
  }

  f32LE(off) {
    return this.dv.getFloat32(off, true);
  }

  f32BE(off) {
    return this.dv.getFloat32(off, false);
  }

  i32BE(off) {
    return this.dv.getInt32(off, false);
  }
}
