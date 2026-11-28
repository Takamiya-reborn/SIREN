// l2d.json 烘焙数据源：三层取数——随包基线（public/lua/，build_apk.mjs 构建期从本地
// .tmp/lua/CN 快照或社区仓库复制，运行时零网络可用）→ IndexedDB 缓存（网络刷新层）→
// 社区明文仓库双源（jsdelivr 优先——国内命中率，GitHub raw 兜底）。
// 纯文本配置（社区发布物，非游戏资产）。策略：IDB 命中立即返回 + TTL 静默刷新；
// 随包缺失才走网络；全链失败返回 null 走降级（无 l2d.json，基础交互可用）。

const REPO = "AzurLaneTools/AzurLaneLuaScripts";
const REF = "main";

const FILES = [
  ["shipL2d", "lua/ship_l2d.lua", "sharecfg/ship_l2d.lua"],
  ["shipSkinTemplate", "lua/ship_skin_template.lua", "sharecfgdata/ship_skin_template.lua"],
  ["mainuiShift", "lua/ship_skin_newmainui_shift.lua", "sharecfg/ship_skin_newmainui_shift.lua"],
];

const DB_NAME = "siren-lua";
const STORE = "files";
const REFRESH_TTL = 6 * 60 * 60 * 1000; // 后台刷新节流：6 小时内的缓存不触发刷新

// ---------------------------------------------------------------- IndexedDB 微封装

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req?.result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

const idbGet = (key) => withStore("readonly", (s) => s.get(key));
const idbPut = (key, value) => withStore("readwrite", (s) => s.put(value, key));

// ---------------------------------------------------------------- 拉取

async function fetchFile(relPath) {
  const urls = [
    `https://cdn.jsdelivr.net/gh/${REPO}@${REF}/${relPath}`,
    `https://raw.githubusercontent.com/${REPO}/${REF}/${relPath}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.text();
    } catch {
      // 网络失败试下一源
    }
  }
  throw new Error(`拉取失败（双源均不可达）: ${relPath}`);
}

// 随包基线：public/ 静态资产（dev 由 vite 伺服，App 内打包进 android assets）
async function fetchBundled(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`随包缺失: ${path}`);
  return r.text();
}

/**
 * 返回 extractSkin 的 lua 参数形态：{ shipL2d, shipSkinTemplate, mainuiShift } 文本；
 * null = 全链失败（调用方走降级）。
 */
export async function loadLuaSources() {
  const [shipL2d, shipSkinTemplate, mainuiShift] = await Promise.all(
    FILES.map(async ([key, bundledPath, relPath]) => {
      const cached = await idbGet(key).catch(() => null);
      if (cached) {
        maybeRefresh(key, cached, relPath);
        return cached.text;
      }
      try {
        return await fetchBundled(bundledPath);
      } catch {
        // 随包缺失（旧包/未构建）：现场拉网络并进 IDB
      }
      try {
        const text = await fetchFile(relPath);
        idbPut(key, { text, fetchedAt: Date.now() }).catch(() => {});
        return text;
      } catch (e) {
        console.warn(`[lua] ${key} 随包与网络均失败，l2d.json 走降级`, e);
        return null;
      }
    }),
  );
  if (!shipL2d || !shipSkinTemplate) return null;
  return { shipL2d, shipSkinTemplate, mainuiShift };
}

/** 缓存命中后的后台静默刷新：TTL 节流，失败静默保留旧值 */
function maybeRefresh(key, cached, relPath) {
  if (Date.now() - cached.fetchedAt < REFRESH_TTL) return;
  fetchFile(relPath)
    .then((text) => idbPut(key, { text, fetchedAt: Date.now() }).catch(() => {}))
    .catch(() => {}); // 静默：离线/网络差时继续用旧缓存
}
