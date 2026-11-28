// Shizuku 文件桥（JS 侧）：Capacitor 插件的封装——游戏目录探测、目录枚举、
// 索引解析与 bundle 分块拉取。桥以 shell uid（=adb 同权）读游戏私有目录，
// 桌面 dev 环境无 Capacitor 宿主，本模块只在 App 内可用。

import { registerPlugin, Capacitor } from "@capacitor/core";
import { crc32 } from "../../scripts/extract/bytes.js";

const native = registerPlugin("ShizukuFile");

// 游戏私有目录候选包名（CN/en/jp 三服），files/ 根含 AssetBundles 与索引文件
const GAME_PACKAGES = [
  "com.bilibili.azurlane", // 国服
  "com.YoStarEN.AzurLane", // en 服
  "com.YoStarJP.AzurLane", // 日服
];

// 单块拉取大小：每块一次桥调用，40MB bundle 约 20 次，进度回调粒度 5%
const READ_CHUNK = 512 * 1024;

const b64ToU8 = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const shizukuStatus = async () => native.status();

export const shizukuRequestAccess = async () =>
  (await native.requestAccess()).granted;

/** 探测游戏 files/ 根：逐候选包名试列 Android/data/<pkg>/files，首个可读者胜出 */
export async function findGameRoot() {
  for (const pkg of GAME_PACKAGES) {
    const root = `/sdcard/Android/data/${pkg}/files`;
    try {
      const entries = await listDir(root);
      return { root, pkg, entries };
    } catch {
      // 目录不存在（未装该服）或 shell 权限被 ROM 收紧，试下一个
    }
  }
  return null;
}

export async function listDir(path) {
  return (await native.listFiles({ path })).entries;
}

export async function readText(path) {
  return (await native.readText({ path })).text;
}

/**
 * bundle 分块拉取。onChunk(bytes, progress) 逐块回调（M4 提取 sink 直连，
 * 不攒整文件）；progress = { offset, total, pct }。返回 { size }。
 */
export async function readBundle(path, { onChunk, chunkSize = READ_CHUNK } = {}) {
  const total = Number((await native.sizeOf({ path })).size);
  let offset = 0;
  for (;;) {
    const { base64, bytesRead } = await native.readChunk({
      path,
      offset,
      length: chunkSize,
    });
    const bytes = b64ToU8(base64);
    offset += bytesRead;
    onChunk?.(bytes, { offset, total, pct: total ? Math.round((100 * offset) / total) : 100 });
    if (bytesRead < chunkSize) break;
  }
  return { size: total };
}

// hashes.csv 的 spinepainting 行（<category>/<name>,<size>,<crc>）-> spine 皮肤名单。
// 与桌面 pull_bundles.js readSpineIndex 同一匹配语义。
function parseSpineIndex(csv) {
  const out = new Map();
  for (const line of csv.split("\n")) {
    const m = line.match(/^spinepainting\/([^,]+),(\d+)/);
    if (m) out.set(m[1], Number(m[2]));
  }
  return out;
}

/** 读设备侧 hashes.csv 解析 spine 名单（_hx 和谐变体沿用管线约定在清单层剔除）。
 * 文件数 MB 级，binder 事务有 ~1MB 缓冲上限，必须走分块 readChunk 拼装，不能用 readText。 */
export async function readSpineIndex(gameRoot) {
  const chunks = [];
  await readBundle(`${gameRoot}/hashes.csv`, {
    onChunk: (bytes) => chunks.push(bytes),
  });
  const parts = chunks.map((c) => new TextDecoder().decode(c));
  return parseSpineIndex(parts.join(""));
}

// ---------------------------------------------------------------- M3 验收探针
// chrome://inspect 控制台经 window.__sirenProbe 执行：列目录、整读 bundle 算
// CRC32 与 adb pull 侧比对、解析 spine 名单。验证通过后随 M4 收编进正式链路。

async function verifyRead(gameRoot, name) {
  const chunks = [];
  const { size } = await readBundle(`${gameRoot}/AssetBundles/live2d/${name}`, {
    onChunk: (bytes) => chunks.push(bytes),
  });
  const whole = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    whole.set(c, at);
    at += c.length;
  }
  return { name, size, crc32: crc32(whole) };
}

export function installProbe() {
  if (!Capacitor.isNativePlatform()) return;
  let cachedRoot = null;
  const probe = {
    status: shizukuStatus,
    requestAccess: shizukuRequestAccess,
    findGameRoot: async () => (cachedRoot ??= await findGameRoot()),
    listBundles: async () => {
      const { root } = await probe.findGameRoot();
      return listDir(`${root}/AssetBundles/live2d`);
    },
    listSpine: async () => {
      const { root } = await probe.findGameRoot();
      return listDir(`${root}/AssetBundles/spinepainting`);
    },
    verifyRead: async (name) => {
      const { root } = await probe.findGameRoot();
      return verifyRead(root, name);
    },
    spineIndex: async () => {
      const { root } = await probe.findGameRoot();
      return [...(await readSpineIndex(root)).entries()];
    },
  };
  window.__sirenProbe = probe;
}
