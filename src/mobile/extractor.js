// 提取编排：加载一个皮肤 = 缓存命中（秒级水合）或实时提取（Shizuku 读 bundle ->
// 内存提取 -> 产物进 FileStore）。blob 字节在提取完成即释放，全程只驻留会话产物。
//
// 桥无关：bundle 字节经 readBundle 流式回调拼接，上游换成内嵌 adb 桥时本模块不动。

import { extractSkin } from "../../scripts/extract/api.js";
import { readBundle, sizeOf } from "./shizuku.js";
import { pngEncode } from "./pngEncode.js";
import { fileStore, sessionUrl } from "./fileStore.js";
import { loadLuaSources } from "./lua.js";
import { detectAstcSupport } from "./astcTexture.js";

// 模型 id -> 角色目录名（与 api.js 同规则）
const charName = (id) => id.replace(/_\d+$/, "");

// bundle 整读：sizeOf 先行，预分配单缓冲直填（分块数组+整拼会双倍占用峰值内存，
// 40MB 级 spine bundle 在 WebView 里就是 OOM 距离）
const readWhole = async (path, onProgress) => {
  const size = await sizeOf(path);
  const out = new Uint8Array(size);
  await readBundle(path, {
    onChunk: (bytes, p) => {
      out.set(bytes, p.offset - bytes.length);
      onProgress?.(p);
    },
  });
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
  const dir = id.startsWith("changeskin") ? id : `${charName(id)}/${id}`;
  const entry = bundles.get(id);
  const bundleSize = entry?.size ?? 0;
  // ASTC 直通按运行时能力翻转（P2a）：支持则贴图不解码直接喂 GPU，提取零 wasm；
  // 不支持（模拟器等）回退 png 模式。pngEncode 恒传：spine 分支贴图固定 png
  // （atlas 页名由 .png 键承载），ASTC 页需它解码
  const textureMode = detectAstcSupport() ? "astc" : "png";

  // 1) cacheDir 命中：直接水合（跳过提取，消除冷启动卡顿）。
  //    缓存可挂载性：astc 产物仅在支持直通的运行时可挂，不支持则弃缓存重提取
  //    （png 产物恒可挂——两条路径共用 mount 层，只是贴图资源形态不同）
  const hit = await fileStore.hydrate(dir, bundleSize);
  if (hit) {
    if (textureMode === "astc" || !fileStore.hasAstcTextures(hit)) {
      console.info(`[extract] 缓存命中 ${dir}（${fileStore.sessionFileCount(hit)} 个产物）`);
      // meta 形态与实时提取路径对齐（App.vue 读 meta.type 选入口文件）：缓存路径
      // 无提取 meta，按产物文件名判别（spine 皮肤的入口是 <id>.spine.json）
      return {
        sessionId: hit,
        virtualRoot: sessionUrl(hit, dir),
        cached: true,
        meta: {
          type: fileStore.sessionHasFile(hit, `${id}.spine.json`)
            ? "spine"
            : "l2d",
        },
      };
    }
    console.info(`[extract] 弃缓存 ${dir}（astc 产物遇不支持运行时）`);
    fileStore.revoke(hit);
  }

  // 2) 实时提取：bundle 字节 -> 内存 -> 释放
  const resEntry = bundles.get(`${id}_res`);
  onProgress?.(2, "读取 bundle");
  console.info(
    `[extract] 开始 ${id}（主 bundle ${Math.round(bundleSize / 1024 / 1024)}MB，textureMode ${textureMode}）`,
  );
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
    textureMode,
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
