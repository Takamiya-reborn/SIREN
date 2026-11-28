// 资产会话库：虚拟路径空间 -> blob URL 的内存层 + cacheDir 持久层（两层设计）。
//
// 服务机制只有一套（blob URL）：App 产物不在磁盘静态目录里，原生 shouldInterceptRequest
// 方案要求产物落盘且跨桥拷贝；blob 与 Capacitor 默认 origin（https://localhost）同源，
// fetch/XHR/引擎加载全部可用。硬约束：blob 不能做相对解析基座，相对拼接必须在
// 虚拟路径空间完成（src/platform/assets.js 的 modelDir/metaSibling 均是字符串拼接，
// 天然兼容），只有取数边界（resolve）翻译成 blob URL。
//
// 持久层是透明加速器：提取产物同步进内存 Blob（主路径），异步写 Android cacheDir
// （系统管理的缓存区——卸载/清除数据即净）；下次加载同皮肤命中缓存则直接水合，
// 跳过提取。失效键 = 皮肤 id + bundle 大小。

import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";

// 持久层根目录（Directory.Cache 下）：与桌面 models/ 布局同构
const CACHE_BASE = "models";
// 提取会话失效元数据文件名：记录 dir -> { id, bundleSize }，bundle 变了即重提取
const CACHE_META = "_cache.json";

const isNative = () => Capacitor.isNativePlatform();

// cacheDir 内递归列文件（@capacitor/filesystem readdir 不递归）
async function walkDir(base, rel = "") {
  const out = [];
  const { files } = await Filesystem.readdir({
    path: joinSafe(base, rel),
    directory: Directory.Cache,
  });
  for (const f of files) {
    const child = rel ? `${rel}/${f.name}` : f.name;
    if (f.type === "directory") out.push(...(await walkDir(base, child)));
    else out.push({ rel: child, size: f.size });
  }
  return out;
}

function joinSafe(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

class FileStore {
  constructor() {
    // sessionId -> { dir, blobs: Map<rel, Blob>, urls: Map<rel, blobUrl>, bundleSize }
    this.sessions = new Map();
    this._seq = 0;
  }

  /** 新建会话：dir 是产物目录（"models/<角色>/<皮肤id>"），bundleSize 是缓存失效键 */
  open(dir, bundleSize) {
    const id = `s${++this._seq}`;
    this.sessions.set(id, { dir, bundleSize, blobs: new Map(), urls: new Map() });
    return id;
  }

  /** 提取 sink 直连入口：产物流进内存 Blob（主路径），异步落 cacheDir（加速路径） */
  async put(sessionId, rel, bytes) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`会话不存在: ${sessionId}`);
    s.blobs.set(rel, new Blob([bytes]));
    if (isNative()) this.persist(s, rel, bytes); // 异步落盘，不阻塞主路径
  }

  async persist(s, rel, bytes) {
    try {
      const path = joinSafe(CACHE_BASE, s.dir, rel);
      await Filesystem.writeFile({
        path,
        directory: Directory.Cache,
        data: bytes,
        // 二进制写法：data 传 Blob/ArrayBuffer 时 encoding 省略即按二进制落盘
        recursive: true,
      });
    } catch (e) {
      console.warn(`[fileStore] 缓存落盘失败（不影响本会话）: ${rel}`, e);
    }
  }

  /** 虚拟路径 -> 可 fetch 的 blob URL。虚拟形如 siren://<session>/<dir>/<rel> */
  resolve(virtualUrl) {
    const rest = virtualUrl.slice("siren://".length);
    const slash = rest.indexOf("/");
    const id = rest.slice(0, slash);
    const rel = rest.slice(slash + 1);
    const s = this.sessions.get(id);
    if (!s) throw new Error(`虚拟路径会话不存在: ${virtualUrl}`);
    let url = s.urls.get(rel);
    if (!url) {
      const blob = s.blobs.get(rel);
      if (!blob) throw new Error(`虚拟路径产物不存在: ${virtualUrl}`);
      url = URL.createObjectURL(blob);
      s.urls.set(rel, url);
    }
    return url;
  }

  /**
   * 缓存命中水合：cacheDir 里该皮肤目录的文件全部读回内存，返回会话 id；
   * 未命中 / bundle 大小不符（版本变了）返回 null（调用方走提取）。
   */
  async hydrate(dir, bundleSize) {
    if (!isNative()) return null;
    const metaPath = joinSafe(CACHE_BASE, dir, CACHE_META);
    try {
      const { data } = await Filesystem.readFile({
        path: metaPath,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      const meta = JSON.parse(data);
      if (meta.bundleSize !== bundleSize) return null; // 设备侧 bundle 更新过
    } catch {
      return null; // 无缓存
    }
    const id = this.open(dir, bundleSize);
    const s = this.sessions.get(id);
    const files = await walkDir(joinSafe(CACHE_BASE, dir));
    for (const f of files) {
      if (f.rel === CACHE_META) continue;
      const { data } = await Filesystem.readFile({
        path: joinSafe(CACHE_BASE, dir, f.rel),
        directory: Directory.Cache,
      });
      // readFile 无 encoding 返回 Blob（@capacitor/filesystem v6+），直接入库
      s.blobs.set(f.rel, data instanceof Blob ? data : new Blob([data]));
    }
    return s.blobs.size ? id : null;
  }

  /** 写缓存失效元数据（提取完成后调用） */
  async seal(sessionId) {
    if (!isNative()) return;
    const s = this.sessions.get(sessionId);
    try {
      await Filesystem.writeFile({
        path: joinSafe(CACHE_BASE, s.dir, CACHE_META),
        directory: Directory.Cache,
        data: JSON.stringify({ bundleSize: s.bundleSize, sealedAt: Date.now() }),
        encoding: Encoding.UTF8,
        recursive: true,
      });
    } catch (e) {
      console.warn("[fileStore] 缓存元数据写失败", e);
    }
  }

  /** 会话 blob 回收：换挂揭幕完成后调用（所有 blob URL revoke + 表清空） */
  revoke(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    for (const url of s.urls.values()) URL.revokeObjectURL(url);
    s.urls.clear();
    s.blobs.clear();
    this.sessions.delete(sessionId);
  }

  /** 设置页「清除缓存」：只清 Directory.Cache 下的产物目录 */
  async clearCache() {
    if (!isNative()) return;
    try {
      await Filesystem.rmdir({ path: CACHE_BASE, directory: Directory.Cache, recursive: true });
    } catch {
      // 目录不存在视为已清
    }
  }
}

export const fileStore = new FileStore();

/** 会话虚拟根：目录基座 URL（assets.js 的 modelDir/metaSibling 都在它之上拼接） */
export const sessionUrl = (sessionId, dir) => `siren://${sessionId}/${dir}/`;
