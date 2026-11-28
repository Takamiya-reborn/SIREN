// 清单三态（App 内）：设备 bundle 列表（Shizuku 桥）+ APK 内 catalog.json（纯名字元数据，
// 随包分发不触资产红线）-> 填充 src/catalog.js 的同一组 reactive 结构，侧栏零改动。
// 三态映射对齐桌面语义：
//   ready  = 产物就绪（缓存水合/本会话已提取）-> 进 MODELS，侧栏转绿可加载
//   cached = 设备有 bundle 未提取 -> 点击触发提取（M5 接线）
//   remote = 设备无资源 -> 不可用
// _hx 和谐变体沿用管线约定：设备侧整层剔除。

import { Capacitor } from "@capacitor/core";
import { CATALOG, MODELS } from "../catalog.js";
import { findGameRoot, listDir, readSpineIndex } from "./shizuku.js";

/** 设备侧资源上下文（提取编排消费）：{ gameRoot, bundles: Map<名, {size, dir}>, spineIndex: Map } */
let deviceCtx = null;

export function getDeviceContext() {
  return deviceCtx;
}

/**
 * 初始化设备清单：探测游戏目录 + 列 bundle + 解析 spine 名单，合并 catalog.json
 * 填充 CATALOG.entries（state: cached/remote）。失败时 entries 为空（侧栏空渲染）。
 */
export async function initManifest() {
  if (!Capacitor.isNativePlatform()) return;
  const root = await findGameRoot();
  if (!root) {
    console.warn("[manifest] 游戏目录不可达（未装游戏 / Shizuku 未授权 / ROM 收紧）");
    return;
  }
  // 设备侧 bundle 双目录：L2D 在 AssetBundles/live2d/、spine 在 AssetBundles/spinepainting/
  //（含 <painting>_res 依赖对）。bundles: Map<名字, {size, dir}>，提取编排按 dir 拼路径
  const bundles = new Map();
  for (const [dir, entries] of [
    ["AssetBundles/live2d", await listDir(`${root.root}/AssetBundles/live2d`)],
    ["AssetBundles/spinepainting", await listDir(`${root.root}/AssetBundles/spinepainting`)],
  ]) {
    for (const e of entries) {
      if (e.isFile && !e.name.endsWith("_hx"))
        bundles.set(e.name, { size: e.size, dir });
    }
  }
  let spineIndex = new Map();
  try {
    spineIndex = await readSpineIndex(root.root);
  } catch (e) {
    console.warn("[manifest] hashes.csv 读取失败（spine 名单缺失）", e);
  }
  deviceCtx = { gameRoot: root.root, bundles, spineIndex };

  // catalog.json 随 APK 分发（vite build 把 public/ 拷进 web assets，origin 根可取）
  const catalog = await fetch("catalog.json")
    .then((r) => (r.ok ? r.json() : { entries: [] }))
    .catch(() => ({ entries: [] }));
  CATALOG.version = catalog.version ?? "";
  // MODELS 清空重填（App 内无 dev server manifest，就绪条目由 markReady 注入）
  MODELS.splice(0, MODELS.length);
  CATALOG.entries = catalog.entries.map((e) => ({
    ...e,
    state: bundles.has(e.painting) ? "cached" : "remote",
  }));
  console.info(
    `[manifest] 设备 bundle ${bundles.size} 个（spine 名单 ${spineIndex.size}），目录 ${CATALOG.entries.length} 条`,
  );
}

/** 产物就绪登记：提取/水合完成后把条目转入 MODELS（侧栏转绿可加载） */
export function markReady(id, name, url) {
  const i = MODELS.findIndex((m) => m.id === id);
  if (i >= 0) MODELS.splice(i, 1, { id, name, url });
  else MODELS.push({ id, name, url });
}
