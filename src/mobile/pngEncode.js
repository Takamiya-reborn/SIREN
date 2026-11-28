// 浏览器侧 PNG 编码：OffscreenCanvas 像素直写 + convertToBlob（引擎自带的 PNG 编码器，
// 零依赖）。像素保真，字节级编码与 Node png.js 不同（压缩字典差异）——仅用于移动端
// ASTC 不支持设备的 wasm 解码降级路径，桌面 CLI 仍走 png.js（产物逐字节回归基线）。

export async function pngEncode(rgba, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height),
    0,
    0,
  );
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}
