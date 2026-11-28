// 纯内存提取入口：bundle 字节进，产物经 sink 出，Node CLI 与 WebView 编排层共同消费。
// 本模块平台无关（不 import node:fs）；文件读写由调用方注入：
//   - CLI（scripts/extract.js）：sink 落盘到 models/，pngEncode 走 png.js
//   - 移动端：sink 进内存 FileStore + cacheDir，textureMode "astc" 直通压缩纹理
//
// sink(dir, relPath, bytes)：dir 是产物目录（"fulici/fulici_2" 或 "changeskin/<action>"），
// relPath 相对 dir（如 "textures/texture_00.png"、"motions/idle.motion3.json"）；
// bytes 是 Uint8Array（JSON 一律 UTF-8 编码）。
// 返回 meta：{ type, dir, ...产物摘要 }，dir 供调用方定位输出目录。

import { loadBundleFromBytes, resolveHashBindings, pathID } from "./bundle.js";
import {
  CRC_MOUTH,
  convertClip,
  motion3Json,
  clipEvents,
  clipBoundaryState,
  LOOP_GROUPS,
  clipGroup,
} from "./motion.js";
import { animatorRouting, animatorFades } from "./animator.js";
import { moc3ParamTables } from "./moc3.js";
import { injectPhysicsNormalization } from "./physics.js";
import { bakeL2dFromSources, readTemplateByPainting } from "./lua.js";
import {
  isAstcFormat,
  decodeAstcRgba,
  readAstcRaw,
  packAstcTexture,
} from "./texture.js";
import { isSpineBundle, bakeSpine } from "./spineBake.js";
import { toU8, crc32 } from "./bytes.js";

// 模型 id -> 角色目录名：fulici_2 -> fulici，shengluyisi_2 -> shengluyisi
function charName(modelId) {
  return modelId.replace(/_\d+$/, "");
}

// int64 路径 ID：安全整数落 number，超出的落十进制字符串（JS number 有精度上限，直写会失真）
const jsonReplacer = (k, v) =>
  typeof v === "bigint"
    ? v >= BigInt(Number.MIN_SAFE_INTEGER) &&
      v <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(v)
      : v.toString()
    : v;

const encoder = new TextEncoder();
const jsonBytes = (value, replacer = null, space) =>
  encoder.encode(JSON.stringify(value, replacer, space));

// 贴图产物编码钩子：ASTC 按纹理模式分流（png=解码成 PNG 字节 / astc=原始块直通），
// 非 ASTC 交给 unityfs-js 的导出管线（浏览器兼容）。返回 { name, bytes }。
function makeEmitImage(textureMode, pngEncode) {
  return async (info, bundle) => {
    const tex = info.object;
    if (isAstcFormat(tex.textureFormat)) {
      if (textureMode === "astc") {
        const raw = readAstcRaw(tex, bundle.manager);
        return { name: `${info.name}.astc`, bytes: packAstcTexture(raw) };
      }
      if (!pngEncode)
        throw new Error(
          "textureMode png 需要 pngEncode 编码器（Node CLI 注入）",
        );
      const { width, height, rgba } = await decodeAstcRgba(tex, bundle.manager);
      return {
        name: `${info.name}.png`,
        bytes: pngEncode(rgba, width, height),
      };
    }
    return {
      name: `${info.name}.png`,
      bytes: toU8(
        (await bundle.manager.exportFile(info, { type: "uint8Array" })).data
          .raw,
      ),
    };
  };
}

// spine 皮肤的显示名：模板文本查 painting（bundle 名全小写），查不到回退空串由 bakeSpine 回退 painting 名
function spineDisplayName(templateText, modelId) {
  if (!templateText) return "";
  try {
    return readTemplateByPainting(templateText, modelId).name;
  } catch {
    return "";
  }
}

/**
 * 提取一个皮肤（L2D / ani spine / changeskin 转场三类自动分流）。
 * @param {object} opts
 *   id                皮肤 bundle 名（如 fulici_2；changeskin 转场即 action 名如 jianwu3c）
 *   mainBundleBytes   主 bundle 字节（精确大小 Uint8Array）
 *   resBundleBytes    spine 皮肤的 <id>_res 字节；无则按 changeskin 判定分支或抛缺资源对
 *   textureMode       "png"（默认，CLI，ASTC 解码成 PNG）| "astc"（移动端，原始块直通）
 *   lua               { shipL2d, shipSkinTemplate, mainuiShift } 文本；null 跳过 l2d.json（基础模型不受影响）
 *   skinRef           l2d.json 烘焙的皮肤引用（id 或 painting 名，缺省用 id）
 *   includeInventory  是否产出 <id>.inventory.json（逆向参考，移动端传 false）
 *   bundlePath        inventory.json 的 bundle 标注（来源路径记录，CLI 传相对路径）
 *   pngEncode         (rgba, width, height) => Uint8Array，textureMode png 时必填（Node 注入）
 *   sink              (dir, relPath, bytes) => void|Promise，dir 为产物目录、relPath 相对 dir
 *   onProgress        (pct: 0-100, label: string) => void
 *   warn / info       告警与摘要日志（CLI 注入 console 封装）
 * @returns meta { type: "l2d"|"spine"|"changeskin", dir, ...产物摘要 }
 */
export async function extractSkin(opts) {
  const {
    id,
    mainBundleBytes,
    resBundleBytes = null,
    textureMode = "png",
    lua = null,
    skinRef = id,
    includeInventory = true,
    bundlePath = null,
    pngEncode = null,
    sink,
    onProgress = () => {},
    warn = () => {},
    info = () => {},
  } = opts;

  const bundle = await loadBundleFromBytes(mainBundleBytes);
  const emitImage = makeEmitImage(textureMode, pngEncode);

  // --- Ani（spine）皮肤分支：主 bundle 只有 SkeletonGraphic 预制体，骨架数据在 <painting>_res
  if (isSpineBundle(bundle)) {
    // changeskin 换装转场 prefab（ship_skin_template 的 change_skin.action 指名，如 jianwu3c）：
    // 骨架/图集/贴图全部内嵌主 bundle，无 _res 依赖对。烘到全局共享目录 changeskin/<action>/
    if (!resBundleBytes) {
      if (!bundle.byClass("TextAsset").some((t) => t.name.endsWith(".skel"))) {
        throw new Error(`缺少 ${id}_res（spine 骨架资源对）`);
      }
      const dir = `changeskin/${id}`;
      const meta = await bakeSpine(id, bundle, bundle, id, {
        sink: (rel, bytes) => sink(dir, rel, bytes),
        emitImage,
        onProgress,
      });
      onProgress(100, "完成");
      info(
        `换装转场烘焙完成: ${id}（${meta.variants.length} 个骨架变体）-> ${dir}`,
      );
      return { type: "changeskin", dir, meta };
    }
    const dir = `${charName(id)}/${id}`;
    const resBundle = await loadBundleFromBytes(resBundleBytes);
    const meta = await bakeSpine(
      id,
      bundle,
      resBundle,
      spineDisplayName(lua?.shipSkinTemplate, id),
      {
        sink: (rel, bytes) => sink(dir, rel, bytes),
        emitImage,
        onProgress,
      },
    );
    onProgress(100, "完成");
    info(
      `spine 皮肤烘焙完成: ${meta.name}（${meta.variants.length} 个骨架变体）-> ${dir}`,
    );
    return { type: "spine", dir, meta };
  }

  // --- L2D 分支
  const dir = `${charName(id)}/${id}`;
  const emit = (rel, bytes) => sink(dir, rel, bytes);
  const { scripts, pathHash } = resolveHashBindings(bundle, crc32);

  const goNames = new Map(); // path_id -> 名（inventory gameobjects 表 + 组件反查 GameObject 名）
  for (const info of bundle.byClass("GameObject")) {
    goNames.set(info.pathID, bundle.readTypetree(info).m_Name);
  }
  onProgress(5, "bundle 解析");

  // --- moc3 / 贴图 / physics / Live2dChar（同时收集全量 inventory 记录）
  const textureNames = [];
  const textureJobs = []; // ASTC 解码是异步的，先记任务再统一执行（保持 objects 枚举次序）
  const textAssets = new Map(); // 名 -> 原始字节（落盘时按可否严格解码决定 .json/.bin，保证无损）
  const monoRecords = []; // inventory: 全部 MonoBehaviour (path_id, 脚本类名, typetree)
  let mocBytes = null;
  let live2dChar = null;
  let physicsRig = null; // CubismPhysicsController._rig：物理归一化区间的权威来源（包内 physics3.json 缺这块）
  const raycastables = [];
  const paramsUi = new Map(); // CubismParameter _unmanagedIndex -> 参数 id（GO 名即参数 id）
  let mouthCtrl = null; // CubismMouthController typetree（根对象，动作可动画其 MouthOpening 字段）
  const mouthParams = []; // CubismMouthParameter 标记的参数 id（口控制器 Destinations，即 MouthOpening 的实际写入口）

  for (const info of bundle.infos) {
    const tname = info.className;
    if (tname === "Texture2D") {
      textureNames.push(info.name);
      textureJobs.push({ info, name: info.name });
    } else if (tname === "TextAsset") {
      textAssets.set(info.name, info.object.data);
    } else if (tname === "MonoBehaviour") {
      let tree;
      try {
        tree = bundle.readTypetree(info);
      } catch (e) {
        // typetree 缺失/解析失败，inventory 记录原因
        monoRecords.push({
          path_id: info.pathID,
          error: String(e.message ?? e),
        });
        continue;
      }
      const cls = scripts.get(pathID(tree.m_Script?.m_PathID ?? 0));
      monoRecords.push({ path_id: info.pathID, script: cls, tree });
      if (cls === "CubismMoc" && mocBytes === null) {
        mocBytes = toU8(tree._bytes);
      } else if (cls === "Live2dChar" && live2dChar === null) {
        live2dChar = Object.fromEntries(
          Object.entries(tree).filter(([k]) => !k.startsWith("m_")),
        );
      } else if (cls === "CubismPhysicsController" && physicsRig === null) {
        physicsRig = tree._rig;
      } else if (cls === "CubismRaycastable") {
        const gid = pathID(tree.m_GameObject.m_PathID);
        raycastables.push(goNames.get(gid) ?? `mesh_${info.pathID}`);
      } else if (cls === "CubismMouthController" && mouthCtrl === null) {
        mouthCtrl = tree;
      } else if (cls === "CubismMouthParameter") {
        const pid = goNames.get(pathID(tree.m_GameObject.m_PathID));
        if (pid !== undefined) mouthParams.push(pid);
      } else if (cls === "CubismParameter") {
        const pid = goNames.get(pathID(tree.m_GameObject.m_PathID));
        if (pid !== undefined) paramsUi.set(tree._unmanagedIndex, pid);
      }
    }
  }

  if (
    !mocBytes ||
    !(
      mocBytes[0] === 0x4d &&
      mocBytes[1] === 0x4f &&
      mocBytes[2] === 0x43 &&
      mocBytes[3] === 0x33
    )
  ) {
    throw new Error("未找到 CubismMoc 数据");
  }
  emit(`${id}.moc3`, mocBytes);

  // --- 贴图落盘（ASTC 走纹理模式分流，其余交给 unityfs-js 解码管线）
  for (const [index, { info }] of textureJobs.entries()) {
    const { name, bytes } = await emitImage(info, bundle);
    emit(`textures/${name}`, bytes);
    onProgress(
      textureJobs.length
        ? 5 + Math.round((45 * (index + 1)) / textureJobs.length)
        : 50,
      `贴图 ${index + 1}/${textureJobs.length}`,
    );
  }

  // --- moc3 参数默认值/min/max（逆向状态机的初始态 = 默认态）
  let paramRanges = null;
  if (paramsUi.size) {
    const tables = moc3ParamTables(mocBytes, Math.max(...paramsUi.keys()) + 1);
    if (tables) {
      const { maxs, mins, defs } = tables;
      const defaults = {};
      for (const i of [...paramsUi.keys()].sort((a, b) => a - b)) {
        defaults[paramsUi.get(i)] = {
          default: defs[i],
          min: mins[i],
          max: maxs[i],
        };
      }
      emit(`${id}.defaults.json`, jsonBytes(defaults, null, 2));
      paramRanges = new Map(Object.entries(defaults));
    } else {
      warn("moc3 参数表(min/max/defaults)解析失败，跳过 defaults.json");
    }
  }

  // 根对象 MouthOpening 曲线迁移目标：CubismMouthParameter 标记的参数（游戏 LateUpdate 按 BlendMode 覆写口参数）
  // BlendMode 只有 Override(0) 能表达为参数曲线（直接覆写），Additive/Multiply 与动作混合语义无法在 motion3 落笔，不迁移
  const rootTargets = new Map();
  if (mouthCtrl && mouthParams.length) {
    if ((mouthCtrl.BlendMode ?? 0) !== 0) {
      warn(
        "CubismMouthController.BlendMode 非 Override，MouthOpening 曲线不迁移",
      );
    } else {
      if (mouthParams.length > 1)
        warn(`口参数标记多个(${mouthParams.join(",")})，只迁移第一个`);
      rootTargets.set(CRC_MOUTH, [mouthParams[0], "Parameter"]);
    }
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const [name, raw] of textAssets) {
    let text;
    try {
      text = decoder.decode(raw);
    } catch {
      emit(`${name}.bin`, toU8(raw)); // 非 UTF-8 资产存原始字节
      continue;
    }
    if (name === `${id}.physics3` && physicsRig) {
      // 包内 physics3.json 缺 Input.Normalization（游戏运行时用 _rig 不用这份），按 _rig 逐条注入补齐
      text = injectPhysicsNormalization(text, physicsRig, warn);
    }
    emit(`${name}.json`, encoder.encode(text));
  }

  if (live2dChar) {
    emit(
      `${id}.char.json`,
      encoder.encode(JSON.stringify(live2dChar, jsonReplacer, 2)),
    );
  }

  // --- 动画
  const motionGroups = {};
  const interactionClips = {};
  const invClips = []; // inventory: 每个 AnimationClip 的事件与原始绑定
  const clips = [...bundle.byClass("AnimationClip")];
  onProgress(55, "动作转换");
  for (const [index, info] of clips.entries()) {
    const clip = bundle.readTypetree(info);
    const bindings = clip.m_ClipBindingConstant.genericBindings;
    const { curves, duration } = convertClip(
      clip.m_MuscleClip.m_Clip.data,
      clip.m_MuscleClip,
      bindings,
      pathHash,
      clip.m_Name,
      warn,
      rootTargets,
    );
    // 交互状态机数据：AnimationEvent + 开关型/连续型参数的首末值（见 motion.js 注释）
    const events = clipEvents(clip);
    const { state: boundary, carry } = clipBoundaryState(
      clip.m_MuscleClip.m_Clip.data,
      bindings,
      pathHash,
      paramRanges,
    );
    invClips.push({
      name: clip.m_Name,
      events,
      bindings: bindings.map((b) => ({
        path: b.path,
        attribute: b.attribute,
        typeID: b.typeID,
      })),
    });
    if (
      Object.keys(boundary).length ||
      Object.keys(carry).length ||
      events.length
    ) {
      interactionClips[clip.m_Name] = {
        duration: Number(duration.toFixed(3)),
        events,
        state: boundary,
        carry,
      };
    }
    if (!curves.length) {
      warn(`${clip.m_Name}: 无可解析曲线`);
      continue;
    }
    const group = clipGroup(clip.m_Name);
    const loop = LOOP_GROUPS.has(group);
    emit(
      `motions/${clip.m_Name}.motion3.json`,
      jsonBytes(motion3Json(curves, duration, loop)),
    );
    if (!motionGroups[group]) motionGroups[group] = [];
    motionGroups[group].push({ File: `motions/${clip.m_Name}.motion3.json` });
    onProgress(
      clips.length ? 55 + Math.round((35 * (index + 1)) / clips.length) : 90,
      `动作 ${index + 1}/${clips.length}`,
    );
  }

  // --- model3.json
  // Raycastable 网格名即原版点击分区 (TouchHead/TouchBody/TouchIdle3/...)，加下划线、保留序号后作为命中区名 = 对应动作文件名 (TouchIdle3 -> touch_idle3)。
  // 分区与动作一一对应，点哪个部位播哪支；不能剥掉序号归组，否则同名命中区在 pixi-live2d-display 里会互相覆盖，且无法定位到具体动作。
  const hitAreaName = (mesh) => {
    const name = mesh.toLowerCase();
    return name.startsWith("touch") ? `touch_${name.slice(5)}` : name;
  };
  const hitAreas = raycastables.map((mesh) => ({
    Id: mesh,
    Name: hitAreaName(mesh),
  }));

  const fileRefs = {
    Moc: `${id}.moc3`,
    Textures: textureNames
      .slice()
      .sort()
      .map((n) => `textures/${textureFileBase(textureMode, n)}`),
  };
  if (textAssets.has(`${id}.physics3`))
    fileRefs.Physics = `${id}.physics3.json`;
  fileRefs.Motions = motionGroups;
  const model3 = { Version: 3, FileReferences: fileRefs, HitAreas: hitAreas };
  emit(`${id}.model3.json`, jsonBytes(model3, null, 2));

  // --- 交互状态机数据（本项目扩展文件，标准运行时忽略）
  // clips: 每支动作的 AnimationEvent（OnAnimEvent/OnFinishAnim 状态编号）与开关型参数的首/末值（[起, 止]，跨动作持续的菜单/道具开关）。
  // animator: AnimatorController 状态路由表（状态 -> 动作编号 -> clip），OnFinishAnim(N) 即结束时回写的动作编号。
  // 运行时据此实现：点击门控（仅菜单摊开时可点菜单分支）、跨动作保留状态参数、动作结束上报状态编号。
  const interactionData = { clips: interactionClips };
  const ctrlInfo = bundle.byClass("AnimatorController")[0];
  if (ctrlInfo) {
    const ctrl = bundle.readTypetree(ctrlInfo);
    const clipNames = new Map(
      bundle.byClass("AnimationClip").map((i) => [i.pathID, i.name]),
    );
    interactionData.animator = animatorRouting(ctrl, clipNames, warn);
  } else {
    warn("未找到 AnimatorController，跳过路由表");
  }
  emit(`${id}.interaction.json`, jsonBytes(interactionData, null, 2));

  // --- 逐 clip 转场时长表（fades.json）
  if (ctrlInfo) {
    const ctrl = bundle.readTypetree(ctrlInfo);
    const clipNames = new Map(
      bundle.byClass("AnimationClip").map((i) => [i.pathID, i.name]),
    );
    const fades = animatorFades(ctrl, clipNames, warn);
    if (fades) {
      emit(`${id}.fades.json`, jsonBytes(fades, null, 1));
    } else {
      warn("未找到 AnimatorController 转场时长，跳过 fades.json");
    }
  } else {
    warn("未找到 AnimatorController 转场时长，跳过 fades.json");
  }

  // --- bundle 全量参考数据（逆向用；CubismMoc._bytes 已是 .moc3 文件，剔除避免重复）
  if (includeInventory) {
    for (const rec of monoRecords) {
      if (rec.script === "CubismMoc") {
        rec.tree = Object.fromEntries(
          Object.entries(rec.tree).filter(([k]) => k !== "_bytes"),
        );
      }
    }
    const objects = {};
    for (const t of [...new Set(bundle.infos.map((i) => i.className))].sort()) {
      objects[t] = bundle.byClass(t).length;
    }
    const gameobjects = {};
    for (const [pid, name] of goNames) gameobjects[pid.toString()] = name;
    const inventory = {
      bundle: bundlePath ?? dir,
      objects,
      gameobjects,
      monobehaviours: monoRecords,
      animationclips: invClips
        .slice()
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    };
    emit(
      `${id}.inventory.json`,
      encoder.encode(JSON.stringify(inventory, jsonReplacer)),
    );
  }
  onProgress(95, "交互配置与清单");

  // --- l2d.json（Lua 快照烘焙；lua=null 走降级，基础模型不受影响）
  let l2dProduct = null;
  if (lua) {
    onProgress(97, "l2d 交互配置");
    try {
      l2dProduct = bakeL2dFromSources(lua, skinRef, interactionData, {
        info,
        warn,
      });
      emit(`${id}.l2d.json`, jsonBytes(l2dProduct, null, 2));
      info(
        `  l2d: ${dir}/${id}.l2d.json（${l2dProduct.entries.length} 台机器）`,
      );
    } catch (e) {
      warn(`l2d.json 烘焙失败，基础模型已完成: ${e.message}`);
    }
  }
  onProgress(100, "完成");

  info(`完成: ${id}`);
  info(
    `  贴图 ${textureNames.length}, 动作组 ${JSON.stringify(Object.fromEntries(Object.entries(motionGroups).map(([k, v]) => [k, v.length])))}`,
  );
  info(`  Live2dChar: ${JSON.stringify(live2dChar).slice(0, 200)}`);
  return {
    type: "l2d",
    dir,
    textures: textureNames.length,
    motionGroups,
    live2dChar,
    l2d: l2dProduct,
  };
}

// 贴图产物文件名：astc 模式下 model3.json 的 Texture 引用指向 .astc 容器文件
function textureFileBase(textureMode, name) {
  return textureMode === "astc" ? `${name}.astc` : `${name}.png`;
}
