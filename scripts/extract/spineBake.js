// Ani（spine）皮肤烘焙（平台无关）：spinepainting/<painting> 主 bundle（SkeletonGraphic 预制体）
// + <painting>_res（SkeletonDataAsset / SpineAtlasAsset / .skel / .atlas / Texture2D）
// -> <皮肤>.spine.json 元数据 + 各骨架变体 <变体>.json
//（spine 3.8 JSON，spineSkel.toSpine38Json 转换）+ <变体>.atlas + 贴图。
// 产物经 sink(relPath, bytes) 收集（CLI 落盘 / 移动端进内存 FileStore），贴图编码由
// emitImage 钩子注入（CLI 解码出 PNG 字节，移动端 ASTC 原始块直通）。
//
// 注意：.skel/.atlas 的 TextAsset 必须经 info.object.data 取原始字节，
// typetree 的 m_Script 经 UTF-8 解码已毁二进制段（详见 spineSkel.js 头注）。

import { parseSkel, toSpine38Json } from "./spineSkel.js";

/** 主 bundle 是否 spine（MonoScript 表里有 SkeletonGraphic 而非 Cubism 全家桶）。 */
export function isSpineBundle(bundle) {
  return bundle
    .byClass("MonoScript")
    .some((i) => bundle.readTypetree(i).m_ClassName === "SkeletonGraphic");
}

/** 解析主 bundle 预制体的分区组装：根 GameObject 的 Transform 子层级按序挂多个
 * SkeletonGraphic（各自独立骨架、同一坐标系原点、各自 startingAnimation），
 * 游戏按子节点次序叠出完整人形。返回有序分区表；无分层结构的预制体返回 null。 */
function resolveComposition(mainBundle) {
  const graphics = [];
  for (const info of mainBundle.byClass("MonoBehaviour")) {
    const tree = mainBundle.readTypetree(info);
    if (tree.skeletonDataAsset) {
      graphics.push({ go: String(tree.m_GameObject?.m_PathID), tree });
    }
  }
  if (!graphics.length) return null;
  // 根 = prefabItem 容器所属 GameObject；子序 = 其 RectTransform.m_Children
  let rootPid = null;
  for (const info of mainBundle.byClass("MonoBehaviour")) {
    const tree = mainBundle.readTypetree(info);
    if (Array.isArray(tree.prefabItem) && tree.prefabItem.length) {
      rootPid = String(tree.m_GameObject?.m_PathID);
      break;
    }
  }
  if (!rootPid) return null;
  let childPids = [];
  // 子节点引用是子 Transform（RectTransform）的 pathID，要经 transform -> GameObject 映射回 GO
  const goByTransform = new Map();
  for (const info of mainBundle.byClass("RectTransform")) {
    const tree = mainBundle.readTypetree(info);
    if (String(tree.m_GameObject?.m_PathID) === rootPid) {
      childPids = (tree.m_Children ?? []).map((c) => String(c.m_PathID));
    }
    goByTransform.set(String(info.pathID), String(tree.m_GameObject?.m_PathID));
  }
  if (!childPids.length) return null;
  const parts = [];
  for (const pid of childPids) {
    const go = goByTransform.get(pid);
    const g = graphics.find((x) => x.go === go);
    if (g) {
      parts.push({
        skeletonDataPathId: g.tree.skeletonDataAsset.m_PathID,
        startingAnimation: g.tree.startingAnimation || null,
        startingLoop: g.tree.startingLoop === 1,
        initialSkin: g.tree.initialSkinName || null,
      });
    }
  }
  return parts.length ? parts : null;
}

/** 单骨架预制体的回退路由：prefabItem[0] -> SkeletonGraphic -> skeletonDataAsset。 */
function resolveDefaultVariant(mainBundle) {
  const graphics = [];
  for (const info of mainBundle.byClass("MonoBehaviour")) {
    const tree = mainBundle.readTypetree(info);
    if (tree.skeletonDataAsset) graphics.push(tree);
  }
  if (!graphics.length) return null;
  // prefabItem[0] 的 GameObject 挂着默认展示变体的 SkeletonGraphic
  let goPathId = null;
  for (const info of mainBundle.byClass("MonoBehaviour")) {
    const tree = mainBundle.readTypetree(info);
    if (Array.isArray(tree.prefabItem) && tree.prefabItem.length) {
      goPathId = tree.prefabItem[0].m_PathID;
      break;
    }
  }
  const chosen = goPathId
    ? (graphics.find((g) => g.m_GameObject?.m_PathID === goPathId) ??
      graphics[0])
    : graphics[0];
  return {
    skeletonDataPathId: chosen.skeletonDataAsset.m_PathID,
    startingAnimation: chosen.startingAnimation || null,
    startingLoop: chosen.startingLoop === 1,
    initialSkin: chosen.initialSkinName || null,
    scale: null,
  };
}

/** 根容器的 hitArea 子节点（触区容器）RectTransform -> 内容取景区（UGUI y-up，中心点 + 尺寸）。
 * 这是游戏作者在预制体里手写的展示区域，查看器按它取景；无 hitArea 子节点（纯展示预制体）返回 null。 */
function resolveHitAreaRect(mainBundle) {
  // 根 = prefabItem 容器所属 GameObject（与 resolveComposition 同判定）
  let rootPid = null;
  for (const info of mainBundle.byClass("MonoBehaviour")) {
    const tree = mainBundle.readTypetree(info);
    if (Array.isArray(tree.prefabItem) && tree.prefabItem.length) {
      rootPid = String(tree.m_GameObject?.m_PathID);
      break;
    }
  }
  if (!rootPid) return null;
  const nameByGo = new Map();
  const rtByGo = new Map();
  const goByTransform = new Map();
  for (const info of mainBundle.byClass("GameObject")) {
    nameByGo.set(String(info.pathID), mainBundle.readTypetree(info).m_Name);
  }
  for (const info of mainBundle.byClass("RectTransform")) {
    const tree = mainBundle.readTypetree(info);
    const go = String(tree.m_GameObject?.m_PathID);
    goByTransform.set(String(info.pathID), go);
    rtByGo.set(go, tree);
  }
  const rootRt = rtByGo.get(rootPid);
  if (!rootRt) return null;
  for (const child of rootRt.m_Children ?? []) {
    const go = goByTransform.get(String(child.m_PathID));
    if (nameByGo.get(go) !== "hitArea") continue;
    const rt = rtByGo.get(go);
    if (!rt) continue;
    // anchoredPosition 是锚框参考点位移；按 pivot 还原矩形中心（锚框/轴心缺省按中心处理）
    const size = rt.m_SizeDelta;
    const pos = rt.m_AnchoredPosition;
    const pivot = rt.m_Pivot ?? { x: 0.5, y: 0.5 };
    return {
      cx: pos.x + (0.5 - pivot.x) * size.x,
      cy: pos.y + (0.5 - pivot.y) * size.y,
      width: size.x,
      height: size.y,
    };
  }
  return null;
}

/**
 * 烘焙 spine 皮肤。mainBundle 是主 bundle（已加载），resBundle 是
 * <painting>_res bundle（已加载；changeskin 转场类无 _res 依赖对时传 mainBundle 本身）。
 * sink(relPath, bytes)：relPath 相对皮肤输出目录；emitImage(info, res) 返回 { name, bytes }
 * （name 含扩展名，同时是 atlas 页名映射的落盘名）；onProgress(pct, label) 同 CLI 进度语义。
 * 返回 spine.json 元数据对象。
 */
export async function bakeSpine(
  modelId,
  mainBundle,
  resBundle,
  displayName,
  { sink, emitImage, onProgress = () => {}, warn = console.warn },
) {
  const res = resBundle;

  // --- 变体表：res 内全部 SkeletonDataAsset，skeletonJSON -> TextAsset(.skel)、atlasAssets -> .atlas
  const resTrees = new Map();
  for (const info of res.byClass("MonoBehaviour")) {
    resTrees.set(info.pathID, res.readTypetree(info));
  }
  const textAssets = new Map(); // path_id -> { pathId, name, data }
  for (const info of res.byClass("TextAsset")) {
    textAssets.set(info.pathID, {
      pathId: String(info.pathID),
      name: info.name,
      data: info.object.data,
    });
  }
  const monoByPath = (pathId) => resTrees.get(pathId);
  const textByName = (name) => {
    for (const [, v] of textAssets) if (v.name === name) return v;
    return null;
  };

  // 分区组装优先；单骨架预制体回退单分区路由
  const composition =
    resolveComposition(mainBundle) ??
    (() => {
      const route = resolveDefaultVariant(mainBundle);
      return route ? [route] : null;
    })();
  const variants = [];
  for (const info of res.byClass("MonoBehaviour")) {
    const tree = resTrees.get(info.pathID);
    if (!Array.isArray(tree.atlasAssets)) continue; // SkeletonDataAsset 才有该字段
    const skeletonName = tree.m_Name ?? "";
    const variant = skeletonName.replace(/_SkeletonData$/, "");
    const skel = textAssets.get(BigInt(tree.skeletonJSON.m_PathID));
    if (!skel) {
      warn(`${variant}: skeletonJSON 引用落空，跳过`);
      continue;
    }
    const atlasRef = tree.atlasAssets[0];
    const atlasTree = atlasRef ? monoByPath(BigInt(atlasRef.m_PathID)) : null;
    // SpineAtlasAsset.atlasFile 指向 _res 内的 .atlas TextAsset（不是 MonoBehaviour）
    const atlasText = atlasTree
      ? (textAssets.get(BigInt(atlasTree.atlasFile.m_PathID)) ?? null)
      : null;
    // 分区身份与起播元数据来自该骨架自己的 SkeletonGraphic（每个分区各有一份）
    const partIndex = composition
      ? composition.findIndex(
          (p) => BigInt(p.skeletonDataPathId) === info.pathID,
        )
      : -1;
    const route = partIndex >= 0 ? composition[partIndex] : null;
    variants.push({
      variant,
      skeleton: skel.name,
      atlas: atlasText?.name ?? null,
      atlasPathId: atlasText ? atlasText.pathId : null,
      startingAnimation: route?.startingAnimation ?? null,
      startingLoop: route?.startingLoop ?? null,
      initialSkin: route?.initialSkin ?? null,
      default: partIndex === 0,
      __partIndex: partIndex,
    });
  }
  if (!variants.length)
    throw new Error("未找到 SkeletonDataAsset（_res bundle）");

  // --- 骨架解析 + spine 3.8 JSON 落盘（原始 .skel 一并归档，字节与包内 TextAsset 一致）
  let canvas = null;
  const encoder = new TextEncoder();
  for (const [index, v] of variants.entries()) {
    const raw = textByName(v.skeleton)?.data;
    if (!raw) throw new Error(`骨架文件缺失: ${v.skeleton}`);
    const parsed = parseSkel(raw);
    v.canvas = {
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
    };
    // 转场镜头安全区（按动画归档）：挂载层 contain 贴合，整段动画主画面恒覆盖视口
    const covers = cameraCoverRects(parsed);
    if (covers) v.covers = covers;
    if (v.default || !canvas) canvas = v.canvas;
    v.skeleton = `${v.variant}.json`;
    v.raw = `${v.variant}.skel`;
    sink(v.skeleton, encoder.encode(JSON.stringify(toSpine38Json(parsed))));
    sink(v.raw, raw);
    onProgress(
      10 + Math.round((30 * (index + 1)) / variants.length),
      `骨架 ${v.variant}`,
    );
  }

  // --- atlas 文本落盘（.atlas 引用页名，贴图按原始名落盘即直接对上）
  // 页面声明尺寸与实际贴图尺寸不一致时（美术 2x 导出 atlas、贴图减半导入，spine-unity 吃
  // 归一化 UV 不受影响），按比例缩写该页全部区域坐标到贴图实际像素——pixi-spine 的
  // region frame 按像素裁剪，坐标越出贴图即抛 "frame does not fit"
  const texDims = new Map(
    res
      .byClass("Texture2D")
      .map((info) => [
        `${info.name}.png`,
        { w: info.object.width, h: info.object.height },
      ]),
  );
  for (const v of variants) {
    if (!v.atlas) throw new Error(`变体 ${v.variant} 的 atlas 引用落空`);
    const atlasText = textAssets.get(BigInt(v.atlasPathId));
    // 贴图是预乘 alpha（spine PMA 导出，游戏材质按 PMA 混合）；spine-unity 的 PMA 标志
    // 在材质 shader 上，TextAsset 原文没有该行，写入后 pixi-spine 把页面标为
    // ALPHA_MODES.PMA，上传时不再做二次预乘（否则羽化边缘发黑）。
    const text = scaleAtlasPages(
      new TextDecoder().decode(atlasText.data),
      texDims,
    ).replace(/^repeat:.+$/gm, (line) => `${line}\npma: true`);
    sink(v.atlas, encoder.encode(text));
  }
  for (const v of variants) delete v.atlasPathId;
  const textures = res.byClass("Texture2D");
  for (const [index, info] of textures.entries()) {
    // 贴图编码由 emitImage 钩子注入（CLI 解码 top-down PNG，移动端 ASTC 原始块直通）；
    // atlas 页名与落盘名的对应关系由 name 承载，非 PNG 形态时页名改写属注入层职责
    const { name, bytes } = await emitImage(info, res);
    sink(name, bytes);
    onProgress(
      40 + Math.round((40 * (index + 1)) / textures.length),
      `贴图 ${index + 1}/${textures.length}`,
    );
  }

  onProgress(90, "写元数据");
  const meta = {
    type: "spine",
    painting: modelId,
    name: displayName || modelId,
    default: variants.find((v) => v.default)?.variant ?? variants[0].variant,
    variants,
  };
  const hitArea = resolveHitAreaRect(mainBundle);
  if (hitArea) meta.hitArea = hitArea;
  if (composition) {
    // 有序分区表：挂载层按此序同时挂全部分区叠出完整人形（分层预制体语义）
    meta.parts = variants
      .filter((v) => v.__partIndex >= 0)
      .sort((a, b) => a.__partIndex - b.__partIndex)
      .map((v) => v.variant);
    for (const v of variants) delete v.__partIndex;
  }
  sink(`${modelId}.spine.json`, encoder.encode(JSON.stringify(meta, null, 2)));
  return meta;
}

/** 转场镜头安全区：主画面四边形（最大附件，经其骨骼祖先链 setup 变换 + 链上动画
 * 缩放/平移）在各动画全程的时间交集矩形——视口 contain 贴合此矩形即保证整段动画
 * 主画面恒覆盖（镜头骨推拉平移不露边）。按动画名归档，坐标为挂载本地 px（×解析
 * scale，y-down）。pixi-spine 的 yDown 只在根骨骼取负 scaleY。 */
function cameraCoverRects(parsed) {
  // 主画面槽位 = 附件面积最大者（region/mesh 的 width×height）
  let best = null;
  for (const skin of parsed.skins) {
    for (const att of skin.attachments) {
      const area = (att.width ?? 0) * (att.height ?? 0);
      if (!best || area > best.area) best = { area, slot: att.slot, att };
    }
  }
  if (!best) return null;
  const boneByName = new Map(parsed.bones.map((b, i) => [b.name, i]));
  const chain = [];
  let bi = boneByName.get(parsed.slots[best.slot]?.bone) ?? -1;
  while (bi >= 0) {
    chain.unshift(bi);
    bi = boneByName.get(parsed.bones[bi].parent) ?? -1;
  }
  if (!chain.length) return null;

  // 链上各骨骼对链上动画时间轴的引用（name -> {scale, translate}），无动画的骨骼缺省
  const animTls = new Map();
  for (const anim of parsed.animations) {
    const tls = { scale: [], translate: [], times: new Set() };
    for (const tl of anim.bones) {
      if (!chain.includes(tl.boneIndex)) continue;
      const boneName = parsed.bones[tl.boneIndex].name;
      if (tl.type === 2) tls.scale.push({ bone: boneName, frames: tl.frames });
      if (tl.type === 1)
        tls.translate.push({ bone: boneName, frames: tl.frames });
      for (const f of tl.frames) tls.times.add(f.time);
    }
    animTls.set(anim.name, tls);
  }

  // setup 仿射累积：M = Π translate(b.x,b.y)·rotate(b.rotation)·scale(b.scaleX, b.scaleY×(根骨骼 -1))
  // 返回 {a,b,c,d,tx,ty}（x' = a·x + c·y + tx, y' = b·x + d·y + ty）
  const compose = (M, bone, sxMul, syMul) => {
    const rad = (bone.rotation * Math.PI) / 180;
    const cos = Math.cos(rad),
      sin = Math.sin(rad);
    const sx = bone.scaleX * sxMul,
      sy = bone.scaleY * syMul;
    const a = sx * cos,
      b = sx * sin,
      c = -sy * sin,
      d = sy * cos;
    return {
      a: M.a * a + M.c * b,
      b: M.b * a + M.d * b,
      c: M.a * c + M.c * d,
      d: M.b * c + M.d * d,
      tx: M.a * bone.x + M.c * bone.y + M.tx,
      ty: M.b * bone.x + M.d * bone.y + M.ty,
    };
  };
  const IDENT = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const setupM = (() => {
    let M = IDENT;
    chain.forEach((bi, i) => {
      M = compose(M, parsed.bones[bi], 1, i === 0 ? -1 : 1);
    });
    return M;
  })();
  // 附件四边形四角（槽位骨骼局部系）
  const att = best.att;
  const hw = ((att.width ?? 0) * (att.scaleX ?? 1)) / 2;
  const hh = ((att.height ?? 0) * (att.scaleY ?? 1)) / 2;
  const rad = ((att.rotation ?? 0) * Math.PI) / 180;
  const quad = [
    [
      att.x - hw * Math.cos(rad) + hh * Math.sin(rad),
      att.y - hw * Math.sin(rad) - hh * Math.cos(rad),
    ],
    [
      att.x + hw * Math.cos(rad) + hh * Math.sin(rad),
      att.y + hw * Math.sin(rad) - hh * Math.cos(rad),
    ],
    [
      att.x + hw * Math.cos(rad) - hh * Math.sin(rad),
      att.y + hw * Math.sin(rad) + hh * Math.cos(rad),
    ],
    [
      att.x - hw * Math.cos(rad) - hh * Math.sin(rad),
      att.y - hw * Math.sin(rad) + hh * Math.cos(rad),
    ],
  ];
  const localToWorld = (M, pt) => ({
    x: M.a * pt[0] + M.c * pt[1] + M.tx,
    y: M.b * pt[0] + M.d * pt[1] + M.ty,
  });
  const rectOf = (corners) => {
    const xs = corners.map((p) => p.x),
      ys = corners.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  };

  const S = 0.01; // 解析 scale，与挂载层一致
  const covers = {};
  for (const anim of parsed.animations) {
    const tls = animTls.get(anim.name);
    const times = [...tls.times].sort((a, b) => a - b);
    let inter = null;
    const sample = (t) => {
      // 链上动画增量：scale 乘局部缩放，translate 加局部位置（帧值为 setup 的偏移）
      let M = IDENT;
      chain.forEach((bi, i) => {
        const bone = { ...parsed.bones[bi] };
        const boneName = parsed.bones[bi].name;
        const sTl = tls.scale.find((s) => s.bone === boneName);
        const tTl = tls.translate.find((s) => s.bone === boneName);
        if (sTl) {
          bone.scaleX *= sampleAt(sTl.frames, t, "x");
          bone.scaleY *= sampleAt(sTl.frames, t, "y");
        }
        if (tTl) {
          bone.x += sampleAt(tTl.frames, t, "x");
          bone.y += sampleAt(tTl.frames, t, "y");
        }
        M = compose(M, bone, 1, i === 0 ? -1 : 1);
      });
      return rectOf(quad.map((p) => localToWorld(M, p)));
    };
    // 采样点 = 时间轴帧时间（角点位置分段线性，极值必在端点）
    for (const t of times.length ? times : [0]) {
      const r = sample(t);
      if (!r) continue;
      const scaled = { x: r.x * S, y: r.y * S, w: r.w * S, h: r.h * S };
      if (!inter) inter = { ...scaled };
      else {
        const l = Math.max(inter.x, scaled.x),
          t2 = Math.max(inter.y, scaled.y);
        const r2 = Math.min(inter.x + inter.w, scaled.x + scaled.w);
        const b2 = Math.min(inter.y + inter.h, scaled.y + scaled.h);
        inter = { x: l, y: t2, w: r2 - l, h: b2 - t2 };
      }
    }
    if (inter && inter.w > 0 && inter.h > 0) covers[anim.name] = inter;
  }
  return Object.keys(covers).length ? covers : null;
}

function sampleAt(frames, t, key) {
  if (t <= frames[0].time) return frames[0][key];
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i],
      b = frames[i + 1];
    if (t >= a.time && t <= b.time) {
      const k = (t - a.time) / (b.time - a.time || 1);
      return a[key] + (b[key] - a[key]) * k;
    }
  }
  return frames[frames.length - 1][key];
}

/** 按贴图实际尺寸缩写 atlas 页面坐标。页名 = 紧邻根级 size: 行上方的根级名行；
 * 页内区域坐标（xy/size/orig/offset/bounds/pad）随页尺寸等比缩放，UV 占比不变。
 * 尺寸一致的页原样返回。 */
function scaleAtlasPages(text, texDims) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^size:\s*(\d+),\s*(\d+)/);
    if (!m) continue;
    let nameLine = i - 1;
    while (nameLine >= 0 && !lines[nameLine].trim()) nameLine--;
    const tex = texDims.get(lines[nameLine]?.trim());
    if (!tex) continue;
    const dw = parseInt(m[1]),
      dh = parseInt(m[2]);
    if (dw === tex.w && dh === tex.h) continue;
    const sx = tex.w / dw,
      sy = tex.h / dh;
    lines[i] = `size: ${tex.w},${tex.h}`;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^size:\s*\d+,\s*\d+/.test(lines[j])) break; // 下一页的页面 size（页名隔在中间）
      const mm = lines[j].match(
        /^(\s*)(xy|size|orig|offset|bounds|pad):\s*(-?\d+),\s*(-?\d+)/,
      );
      if (mm)
        lines[j] =
          `${mm[1]}${mm[2]}: ${Math.round(parseInt(mm[3]) * sx)},${Math.round(parseInt(mm[4]) * sy)}`;
    }
  }
  return lines.join("\n");
}
