// 提取编排：加载一个皮肤 = 缓存命中（秒级水合）或实时提取（Shizuku 读 bundle ->
// 内存提取 -> 产物进 FileStore）。blob 字节在提取完成即释放，全程只驻留会话产物。
//
// 桥无关：bundle 字节经 readBundle 流式回调拼接，上游换成内嵌 adb 桥时本模块不动。

import { extractSkin } from "../../scripts/extract/api.js";
import { readBundle } from "./shizuku.js";
import { pngEncode } from "./pngEncode.js";
import { fileStore, sessionUrl } from "./fileStore.js";
import { loadLuaSources } from "./lua.js";

// 模型 id -> 角色目录名（与 api.js 同规则）
const charName = (id) => id.replace(/_\d+$/, "");

const readWhole = async (path, onProgress) => {
  const chunks = [];
  let size = 0;
  await readBundle(path, {
    onChunk: (bytes, p) => {
      chunks.push(bytes);
      size = p.total;
      onProgress?.(p);
    },
  });
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};

/**
 * 确保一个皮肤的产物就绪并返回挂载入口。
 * @param {string} id 皮肤 bundle 名（changeskin 转场即 action 名）
 * @param {object} ctx 设备侧资源上下文（manifest.js 提供）：{ gameRoot, bundles: Map<名, {size, dir}> }
 * @param {fn} onProgress (pct, label) 进度回调
 * @returns { sessionId, virtualRoot, meta } virtualRoot 供挂载层作 model URL 基座
 */
export async function ensureSkin(id, { gameRoot, bundles }, onProgress) {
  const dir = id.startsWith("changeskin")
    ? id
    : `${charName(id)}/${id}`;
  const entry = bundles.get(id);
  const bundleSize = entry?.size ?? 0;

  // 1) cacheDir 命中：直接水合（跳过提取，消除冷启动卡顿）
  const hit = await fileStore.hydrate(dir, bundleSize);
  if (hit) return { sessionId: hit, virtualRoot: sessionUrl(hit, dir), cached: true };

  // 2) 实时提取：bundle 字节 -> 内存 -> 释放
  const resEntry = bundles.get(`${id}_res`);
  onProgress?.(2, "读取 bundle");
  const mainBundleBytes = await readWhole(`${gameRoot}/${entry.dir}/${id}`);
  const resBundleBytes = resEntry
    ? await readWhole(`${gameRoot}/${resEntry.dir}/${id}_res`)
    : null;
  const lua = resEntry ? null : await loadLuaSources();

  const sessionId = fileStore.open(dir, bundleSize);
  const sink = (d, rel, bytes) => fileStore.put(sessionId, rel, bytes);
  const progress = (pct, label) => onProgress?.(pct, label);
  const meta = await extractSkin({
    id,
    mainBundleBytes,
    resBundleBytes,
    // ASTC 直通（"astc"）需 P2a 引擎注入（CompressedTextureResource parse 插件）先行，
    // 注入落地前贴图走浏览器解码（pngEncode = OffscreenCanvas 编码）保证挂载可用
    textureMode: "png",
    lua,
    includeInventory: false,
    pngEncode,
    bundlePath: `${gameRoot}/${entry.dir}/${id}`,
    sink,
    onProgress: progress,
    warn: (msg) => console.warn(`[extract] ${msg}`),
    info: (msg) => console.info(`[extract] ${msg}`),
  });
  // bundle 字节在函数返回后由 GC 回收（产物已入 Blob，无需显式释放手段）
  await fileStore.seal(sessionId);
  return { sessionId, virtualRoot: sessionUrl(sessionId, dir), meta };
}

/** 旧会话回收（换挂揭幕完成后调用）：只动 blob，不动引擎对象 */
export const releaseSession = (sessionId) => fileStore.revoke(sessionId);
