// l2d.json 烘焙数据源：App 内没有 .tmp/lua 快照，运行时从社区明文仓库拉 3 个 Lua 文本，
// 经 extract/lua.js 的 bakeL2dFromSources 烘焙。双源（jsdelivr 优先——国内命中率，
// GitHub raw 兜底），IndexedDB 缓存纯文本配置（非游戏产物，不触碰资产红线）。
// 策略：命中缓存立即返回 + 后台静默刷新（失败用旧缓存）；无缓存现场拉；全链失败
// 返回 null 走降级（无 l2d.json，基础交互可用）。

const REPO = "AzurLaneTools/AzurLaneLuaScripts";
const REF = "main";

const FILES = [
  ["shipL2d", "sharecfg/ship_l2d.lua"],
  ["shipSkinTemplate", "sharecfgdata/ship_skin_template.lua"],
  ["mainuiShift", "sharecfg/ship_skin_newmainui_shift.lua"],
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

/**
 * 返回 extractSkin 的 lua 参数形态：{ shipL2d, shipSkinTemplate, mainuiShift } 文本；
 * null = 无缓存且全链失败（调用方走降级）。
 */
export async function loadLuaSources() {
  const [shipL2d, shipSkinTemplate, mainuiShift] = await Promise.all(
    FILES.map(async ([key]) => {
      const cached = await idbGet(key).catch(() => null);
      if (cached) {
        maybeRefresh(key, cached);
        return cached.text;
      }
      try {
        const text = await fetchFile(
          FILES.find(([k]) => k === key)[1],
        );
        idbPut(key, { text, fetchedAt: Date.now() }).catch(() => {});
        return text;
      } catch (e) {
        console.warn(`[lua] ${key} 拉取与缓存均失败，l2d.json 走降级`, e);
        return null;
      }
    }),
  );
  if (!shipL2d || !shipSkinTemplate) return null;
  return { shipL2d, shipSkinTemplate, mainuiShift };
}

/** 缓存命中后的后台静默刷新：TTL 节流，失败静默保留旧值 */
function maybeRefresh(key, cached) {
  if (Date.now() - cached.fetchedAt < REFRESH_TTL) return;
  const relPath = FILES.find(([k]) => k === key)[1];
  fetchFile(relPath)
    .then((text) => idbPut(key, { text, fetchedAt: Date.now() }).catch(() => {}))
    .catch(() => {}); // 静默：离线/网络差时继续用旧缓存
}
