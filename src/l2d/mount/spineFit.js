/** Ani（spine）皮肤取景几何：hitArea 优先的取景链。消费方 spineMount.js（挂载时取景与重取景钩子）与 camera.js 的 spine 分支（经 ctx._spineFit）。 */

/** 游戏 SkeletonDataAsset 的解析 scale（0.01），把骨架坐标缩到游戏渲染尺度 */
export const SKELETON_SCALE = 0.01;

/** 分位数取景的裁边比例（两侧各弃 2% 附件质心）与框外扩比例 */
const CENTILE = 0.02;
const FRAME_PAD = 0.2;
/** 取景框相对整包围盒的面积占比低于此值才启用（框接近全包围盒 = 内容均匀，保持原取景不动） */
const FRAME_ACTIVE = 0.4;

/** 当前挂载附件的骨架本地包围盒列表（分层预制体逐分区收集）。只统计在挂附件，
 * path/point 等无世界顶点的类型与求值异常项跳过。 */
export function attachmentBoxes(model) {
  const skeletons = model.skeleton
    ? [model.skeleton]
    : (model.children ?? []).filter((c) => c.skeleton).map((c) => c.skeleton);
  const boxes = [];
  for (const sk of skeletons) {
    for (const slot of sk.slots) {
      const att = slot.getAttachment();
      if (!att) continue;
      try {
        let verts;
        if (att.worldVerticesLength === undefined) {
          verts = new Float32Array(8);
          att.computeWorldVertices(slot.bone, verts, 0, 2);
        } else {
          verts = new Float32Array(att.worldVerticesLength);
          att.computeWorldVertices(slot, 0, att.worldVerticesLength, verts, 0, 2);
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < verts.length; i += 2) {
          const x = verts[i], y = verts[i + 1];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
        if (x1 > x0 && y1 > y0) boxes.push({ x0, y0, x1, y1 });
      } catch { /* 个别类型无世界顶点，跳过 */ }
    }
  }
  return boxes;
}

/**
 * 内容取景框：附件质心的 p5..p95 分位数框外扩 FRAME_PAD。少数巨大背景件
 * （全幅黑底/泊位姿态簇）不主宰框——它们质心落在密集簇内，只有边缘越界；
 * 框面积达到整包围盒 FRAME_ACTIVE 倍以上（内容均匀的正常皮肤）返回 null 保持原取景。
 * @returns {{x, y, width, height} | null} 骨架本地坐标系
 */
function contentFrame(model, bounds) {
  const boxes = attachmentBoxes(model);
  if (boxes.length < 8) return null;
  const xs = boxes.map((b) => (b.x0 + b.x1) / 2).sort((a, b) => a - b);
  const ys = boxes.map((b) => (b.y0 + b.y1) / 2).sort((a, b) => a - b);
  const pick = (arr) => arr[Math.floor((arr.length - 1) * CENTILE)];
  const pickHi = (arr) => arr[Math.floor((arr.length - 1) * (1 - CENTILE))];
  const x0 = pick(xs), x1 = pickHi(xs), y0 = pick(ys), y1 = pickHi(ys);
  const padX = (x1 - x0) * FRAME_PAD * 0.5 + 1;
  const padY = (y1 - y0) * FRAME_PAD * 0.5 + 1;
  const frame = { x: x0 - padX, y: y0 - padY, width: x1 - x0 + padX * 2, height: y1 - y0 + padY * 2 };
  if (frame.width * frame.height > FRAME_ACTIVE * bounds.width * bounds.height) return null;
  return frame;
}

/** 预制体 hitArea 矩形 -> 骨架本地取景框（UGUI y-up ×解析 scale 并翻 y 轴）。
 * 与实际渲染包围盒无交集时返回 null（陈旧/异构预制体退化启发式取景）。 */
function hitAreaFrame(ctx, local) {
  const ha = ctx._spineMeta?.hitArea;
  if (!ha || !ha.width || !ha.height) return null;
  const frame = {
    x: (ha.cx - ha.width / 2) * SKELETON_SCALE,
    y: (-ha.cy - ha.height / 2) * SKELETON_SCALE,
    width: ha.width * SKELETON_SCALE,
    height: ha.height * SKELETON_SCALE,
  };
  const intersects =
    frame.x < local.x + local.width &&
    frame.x + frame.width > local.x &&
    frame.y < local.y + local.height &&
    frame.y + frame.height > local.y;
  return intersects ? frame : null;
}

/** 舞台取景：优先按预制体 hitArea（游戏作者手写的展示区域），退化按内容取景框，
 * 再退化按全包围盒。画布头是导出器估算值且可能停留在泊位姿态（与真实网格存在
 * Y 镜像/偏移），不可作取景依据。 */
export function fitSpine(ctx) {
  const model = ctx.model;
  const app = ctx.app;
  if (!model || !app) return;
  model.scale.set(1);
  // 先测世界包围盒（pixi 空间，已含 pixi-spine 的内部翻转），换算回本地系供取景框比对
  const bounds = model.getBounds();
  if (!bounds.width || !bounds.height) return;
  const local = {
    x: bounds.x - model.position.x,
    y: bounds.y - model.position.y,
    width: bounds.width / Math.max(model.scale.x, 1e-9),
    height: bounds.height / Math.max(model.scale.y, 1e-9),
  };
  const frame = hitAreaFrame(ctx, local) ?? contentFrame(model, local) ?? local;
  const stageW = app.screen.width;
  const stageH = app.screen.height;
  // 取景微调（HUD 注入面板）与 camera.fitModel 同语义：zoom 乘系数、偏移按视口比例平移
  const scale =
    Math.min(stageW / frame.width, stageH / frame.height) *
    ctx.fill() *
    (ctx.userView?.zoom ?? 1);
  model.scale.set(scale);
  model.position.set(
    stageW / 2 - (frame.x + frame.width / 2) * scale + (ctx.userView?.offX ?? 0) * stageW,
    stageH / 2 - (frame.y + frame.height / 2) * scale + (ctx.userView?.offY ?? 0) * stageH,
  );
}
