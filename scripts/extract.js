// 碧蓝航线 Live2D 皮肤提取器 CLI：UnityFS bundle -> 标准 Cubism 4 模型。
// 提取核心在 extract/api.js（纯内存，平台无关），本文件只做文件 I/O 与命令行参数。
//
// 用法:
//     node scripts/extract.js <skin_id>
//     node scripts/extract.js <painting 名>
//     node scripts/extract.js <bundle_path> <out_dir>   # 皮肤产物平铺进 out_dir（changeskin 仍归 models/changeskin/）
//
// 可选: --server CN（Lua 快照服务器目录）  --painting <名>  --no-lua（跳过 l2d.json 烘焙）
//
// 产物 (out_dir) —— 一次提取即完整模型资源，逆向无需再回头 dump:
//
//     <id>.moc3 / <id>.model3.json / <id>.physics3.json / <id>.char.json
//     <id>.interaction.json   （clips 交互状态数据 + animator 动作编号路由表）
//     <id>.fades.json         Animator 转场时长表（逐 clip 交叉渐变秒数）
//     <id>.defaults.json      参数默认值/min/max（解析自 moc3 二进制）
//     <id>.inventory.json     bundle 全量参考：GameObject 表、全部组件 typetree（CubismMoc._bytes 除外）、AnimationClip 事件与绑定
//     <id>.l2d.json           ship_l2d 交互配置（Lua 快照烘焙，快照缺失时跳过）
//     textures/texture_XX.png
//     motions/<clip_name>.motion3.json
//
// 原理 (见 docs/azurlane.md):
//     - CubismMoc._bytes 直接是 moc3 二进制
//     - 贴图 Texture2D（ASTC 走 texture2ddecoder-wasm 自补分支）-> PNG
//     - TextAsset *.physics3 为 JSON 原文，但包内这份缺每条设置的 Input.Normalization（游戏运行时物理用
//       CubismPhysicsController._rig 序列化数据，不经这份 JSON）——落盘时按 _rig.SubRigs[i].Normalization
//       逐条注入补齐；非 UTF-8 的 TextAsset 落 .bin 原始字节
//     - Unity AnimationClip (streamed+constant 曲线, CRC32 哈希绑定) -> motion3.json
//     - moc3 默认值：头部 0x40 起是节偏移表，表[51/52/53]=max/min/defaults（详见 extract/moc3.js）

import { mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { extractSkin } from "./extract/api.js";
import { encodePng } from "./extract/png.js";
import { loadLuaSources } from "./extract/node-io.js";
import { toU8 } from "./extract/bytes.js";

// 固定路径约定：bundle 由 pull_bundles.js 拉到 .tmp/bundles/<skin_id>，产物按 models/<角色>/<skin_id>/ 归档（scan_models.mjs 按此路径生成清单）
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_DIR = resolve(ROOT, ".tmp", "bundles");
const MODEL_ROOT = resolve(ROOT, "models");

const warn = (msg) => console.log(`[warn] ${msg}`);
const info = (msg) => console.log(msg);
// 管线进度里程碑：stdout 输出 [progress] <0-100> <阶段>，dev server 解析成 job.progress 透传前端进度条
const progress = (pct, label) => info(`[progress] ${pct} ${label}`);

function parseArgs(argv) {
  const args = {
    source: null,
    outDir: null,
    server: "CN",
    painting: null,
    noLua: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--server":
        args.server = argv[++i];
        break;
      case "--painting":
        args.painting = argv[++i];
        break;
      case "--no-lua":
        args.noLua = true;
        break;
      default:
        rest.push(a);
    }
  }
  if (!rest.length || rest.length > 2) {
    console.error(
      "用法: node scripts/extract.js <skin_id|painting|bundle路径> [out_dir] [--server CN] [--painting 名] [--no-lua]",
    );
    process.exit(1);
  }
  args.source = rest[0];
  args.outDir = rest[1] ?? null;
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 只传 skin_id/painting 时 bundle 与输出目录按固定约定推导；传完整路径则沿用旧用法。
  let bundlePath = args.source;
  if (!existsFile(bundlePath)) bundlePath = join(BUNDLE_DIR, args.source);
  if (!existsFile(bundlePath)) {
    console.error(`bundle 不存在: ${bundlePath}`);
    process.exit(1);
  }
  const modelId = basename(bundlePath).replace(/\.[^.]+$/, ""); // 如 fulici_2
  // 产物根：显式 out_dir 则皮肤产物平铺进该目录，缺省归 models/<角色>/<skin_id>/。
  // changeskin 转场始终归全局共享目录 models/changeskin/<action>/
  const argOutDir = args.outDir ? resolve(args.outDir) : null;
  const outDir = argOutDir ?? join(MODEL_ROOT, charName(modelId), modelId);
  mkdirSync(outDir, { recursive: true });

  const lua = args.noLua ? null : loadLuaSources(ROOT, args.server);
  if (!args.noLua && !lua)
    warn(`Lua 快照不存在，跳过 l2d.json（服务器: ${args.server}）`);

  const relBundle = bundlePath.startsWith(ROOT)
    ? bundlePath.slice(ROOT.length + 1).replaceAll("\\", "/")
    : bundlePath;

  const resPath = join(BUNDLE_DIR, `${modelId}_res`);
  await extractSkin({
    id: modelId,
    mainBundleBytes: toU8(readFileSync(bundlePath)),
    resBundleBytes: existsFile(resPath) ? toU8(readFileSync(resPath)) : null,
    textureMode: "png",
    lua,
    skinRef: args.painting ?? (isFilePath(args.source) ? modelId : args.source),
    pngEncode: encodePng,
    bundlePath: relBundle,
    sink: (dir, rel, bytes) => {
      // 显式 out_dir：皮肤产物平铺进该目录（旧用法语义）；changeskin 转场始终落
      // models/changeskin/<action>（全局共享目录，不随 out_dir 变）
      const dest =
        argOutDir && !dir.startsWith("changeskin/")
          ? join(argOutDir, rel)
          : join(MODEL_ROOT, dir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
    },
    onProgress: progress,
    warn,
    info,
  });
}

// 模型 id -> 角色目录名：fulici_2 -> fulici，shengluyisi_2 -> shengluyisi
function charName(modelId) {
  return modelId.replace(/_\d+$/, "");
}

function existsFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isFilePath(p) {
  return existsFile(p);
}

function basename(p) {
  const norm = p.replaceAll("\\", "/");
  return norm.slice(norm.lastIndexOf("/") + 1);
}

main();
