// Node 文件 I/O 边界：内核模块不 import node:fs，落盘/读盘都收敛在本模块与 CLI 壳。

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { load } from "unityfs-js";
import { Bundle } from "./bundle.js";

export async function loadBundle(path) {
  // new Uint8Array(buffer) 拷出精确大小的 ArrayBuffer：readFileSync 的小文件走 8KB Buffer 池，
  // 直接传 Buffer 时 unityfs-js 取 source.buffer 会带上池内偏移，解析出 undefined
  const manager = await load(new Uint8Array(readFileSync(path)));
  return new Bundle(manager);
}

// 读本地 Lua 快照文本（l2d.json 烘焙数据源）。快照缺失返回 null（调用方走降级）。
export function loadLuaSources(root, server) {
  const luaRoot = resolve(root, ".tmp", "lua", server);
  const luaPath = join(luaRoot, "sharecfg", "ship_l2d.lua");
  const templatePath = join(luaRoot, "sharecfgdata", "ship_skin_template.lua");
  const shiftPath = join(luaRoot, "sharecfg", "ship_skin_newmainui_shift.lua");
  if (!existsSync(luaPath) || !existsSync(templatePath)) return null;
  return {
    shipL2d: readFileSync(luaPath, "utf8"),
    shipSkinTemplate: readFileSync(templatePath, "utf8"),
    mainuiShift: existsSync(shiftPath) ? readFileSync(shiftPath, "utf8") : null,
  };
}
