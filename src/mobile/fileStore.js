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
import { isAstcBin, parseAstcBinHeader } from "./astcBin.js";
import { registerAstcUrl, unregisterAstcUrl } from "./astcTexture.js";

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
    // sessionId -> { dir, blobs: Map<rel, Blob>, urls: Map<rel, blobUrl>, bundleSize,
    //                astc: Map<rel, 头元数据> }
    this.sessions = new Map();
    this._seq = 0;
  }

  /** 新建会话：dir 是产物目录（"models/<角色>/<皮肤id>"），bundleSize 是缓存失效键 */
  open(dir, bundleSize) {
    const id = `s${++this._seq}`;
    this.sessions.set(id, {
      dir,
      bundleSize,
      blobs: new Map(),
      urls: new Map(),
      astc: new Map(),
    });
    return id;
  }

  // ASTCBIN 头嗅探：命中即记头元数据（resolve 时登记给 astcTexture 的加载注入层）；
  // 非本容器（PNG 等）字节盲直存，格式判别只在引擎侧做一次
  _sniffAstc(sessionId, rel, bytes) {
    if (!isAstcBin(bytes)) return;
    try {
      this.sessions.get(sessionId).astc.set(rel, parseAstcBinHeader(bytes));
    } catch {
      // 头残缺：按普通文件放行，引擎侧解析报错
    }
  }

  /** 提取 sink 直连入口：产物流进内存 Blob（主路径），异步落 cacheDir（加速路径） */
  async put(sessionId, rel, bytes) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`会话不存在: ${sessionId}`);
    s.blobs.set(rel, new Blob([bytes]));
    this._sniffAstc(sessionId, rel, bytes);
    if (isNative()) this.persist(s, rel, bytes); // 异步落盘，不阻塞主路径
  }

  // 写盘串行队列：persist 是 fire-and-forget，并发 writeFile 会让多份 base64 桥拷贝
  // 同时驻留 Java 堆（配额 256MB），排队后单次瞬时占用有界
  _writeQueue = Promise.resolve();

  // 字节 → base64：Capacitor 桥对 Uint8Array 按 JSON 数组逐元素序列化（原生侧
  // org.json 解析逐字节装箱，4MB 贴图 ≈ 百 MB 级 Java 堆），过桥必须 base64 字符串
  static _b64(bytes) {
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  async persist(s, rel, bytes) {
    this._writeQueue = this._writeQueue.then(async () => {
      try {
        await Filesystem.writeFile({
          path: joinSafe(CACHE_BASE, s.dir, rel),
          directory: Directory.Cache,
          data: FileStore._b64(bytes), // encoding 省略即按二进制落盘（base64 输入约定）
          recursive: true,
        });
      } catch (e) {
        console.warn(`[fileStore] 缓存落盘失败（不影响本会话）: ${rel}`, e);
      }
    });
    return this._writeQueue;
  }

  /** 虚拟路径 -> 可 fetch 的 blob URL。虚拟形如 siren://<session>/<dir>/<rel>：
   * 会话 blob 以相对 dir 的裸键存储，解析时剥掉 dir 前缀 */
  resolve(virtualUrl) {
    const rest = virtualUrl.slice("siren://".length);
    const slash = rest.indexOf("/");
    const id = rest.slice(0, slash);
    let rel = rest.slice(slash + 1);
    const s = this.sessions.get(id);
    if (!s) throw new Error(`虚拟路径会话不存在: ${virtualUrl}`);
    if (s.dir && rel.startsWith(`${s.dir}/`)) rel = rel.slice(s.dir.length + 1);
    let url = s.urls.get(rel);
    if (!url) {
      const blob = s.blobs.get(rel);
      if (!blob) throw new Error(`虚拟路径产物不存在: ${virtualUrl}`);
      url = URL.createObjectURL(blob);
      s.urls.set(rel, url);
      const astcMeta = s.astc.get(rel);
      if (astcMeta) registerAstcUrl(url, astcMeta);
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
      // readFile 无 encoding：native 返回 base64 字符串，web 实现返回 Blob——统一
      // 解码回字节入库；头部 20 字节嗅探 ASTCBIN（切头读）。旧引擎无 Blob.arrayBuffer
      // 时跳过嗅探——缓存可挂载性校验（hasAstcTextures）按扩展名兜底
      const bytes =
        data instanceof Blob
          ? new Uint8Array(await data.arrayBuffer())
          : Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes]);
      s.blobs.set(f.rel, blob);
      try {
        const head = new Uint8Array(await blob.slice(0, 20).arrayBuffer());
        this._sniffAstc(id, f.rel, head);
      } catch {
        // 嗅探失败不影响水合主路径
      }
    }
    return s.blobs.size ? id : null;
  }

  /** 写缓存失效元数据（提取完成后调用）：先等写盘队列清空，否则元数据先落、文件后落，
   * 下次水合拿到残缺缓存 */
  async seal(sessionId) {
    if (!isNative()) return;
    const s = this.sessions.get(sessionId);
    try {
      await this._writeQueue;
      await Filesystem.writeFile({
        path: joinSafe(CACHE_BASE, s.dir, CACHE_META),
        directory: Directory.Cache,
        data: JSON.stringify({
          bundleSize: s.bundleSize,
          sealedAt: Date.now(),
        }),
        encoding: Encoding.UTF8,
        recursive: true,
      });
    } catch (e) {
      console.warn("[fileStore] 缓存元数据写失败", e);
    }
  }

  /** 会话里是否含 ASTC 产物（缓存可挂载性校验用：不支持直通的运行时须弃缓存重提取） */
  hasAstcTextures(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    for (const rel of s.blobs.keys()) {
      if (rel.endsWith(".astc")) return true;
    }
    return false;
  }

  /** 会话产物数（缓存完整性诊断用） */
  sessionFileCount(sessionId) {
    return this.sessions.get(sessionId)?.blobs.size ?? 0;
  }

  /** 会话是否产出指定文件（缓存路径的产物形态判别） */
  sessionHasFile(sessionId, rel) {
    return this.sessions.get(sessionId)?.blobs.has(rel) ?? false;
  }

  /** 会话 blob 回收：换挂揭幕完成后调用（所有 blob URL revoke + 表清空） */
  revoke(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    for (const url of s.urls.values()) {
      if (s.astc.size) unregisterAstcUrl(url);
      URL.revokeObjectURL(url);
    }
    s.urls.clear();
    s.blobs.clear();
    this.sessions.delete(sessionId);
  }

  /** 设置页「清除缓存」：只清 Directory.Cache 下的产物目录 */
  async clearCache() {
    if (!isNative()) return;
    try {
      await Filesystem.rmdir({
        path: CACHE_BASE,
        directory: Directory.Cache,
        recursive: true,
      });
    } catch {
      // 目录不存在视为已清
    }
  }
}

export const fileStore = new FileStore();

/** 会话虚拟根：目录基座 URL（assets.js 的 modelDir/metaSibling 都在它之上拼接） */
export const sessionUrl = (sessionId, dir) => `siren://${sessionId}/${dir}/`;
