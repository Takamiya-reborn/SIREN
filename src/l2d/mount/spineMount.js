/**
 * Ani（spine）皮肤挂载：pixi-spine 3.8 运行时加载烘焙产物
 * （<变体>.json + 同名 .atlas + atlas 引用的贴图 PNG，同目录约定由 spineBake.js 保证）。
 * 分层预制体（meta.parts 有序分区，如 aijier 的 B/M/T 三层共享坐标系叠出完整人形）
 * 时按序同时挂全部分区进 Container；单骨架预制体挂默认变体。
 * 起播元数据 startingAnimation（各分区 SkeletonGraphic 的 startingAnimation/startingLoop）。
 * Ani 类皮肤无交互状态机：ctx.runtime/orch/l2dOffset 保持 null，手势层按 ctx.model
 * 无 internalModel 旁路；ctx.model 存 Spine（或分区 Container）供卸载与缩放。
 * 取景几何在 spineFit.js，揭幕闸门在 reveal.js。
 */
import { Container, Loader } from "pixi.js";
import { Spine, SpineParser } from "@pixi-spine/all-3.8";
import { fetchJsonStrict, modelDir } from "../../platform/assets.js";
import { expressionOverlays } from "../spine/expressions.js";
import { fitSpine, SKELETON_SCALE } from "./spineFit.js";
import { waitRevealGate } from "./reveal.js";

export async function mountSpineModel(ctx, url, variantOverride) {
  ctx._mounting = true;
  try {
    await mountSpineInner(ctx, url, variantOverride);
  } catch (err) {
    console.error("[spine] 模型挂载失败", err);
    ctx.status.value = `加载失败:${err?.message ?? err}`;
  } finally {
    ctx._mounting = false;
  }
}

async function mountSpineInner(ctx, url, variantOverride) {
  const seq = (ctx._mountSeq = (ctx._mountSeq ?? 0) + 1);
  const app = ctx.app;
  // 令牌过期含舞台销毁：快速切皮肤会重建舞台组件（旧 app.destroy 置空 stage），
  // 旧挂载的 await 醒来必须随之丢弃，否则往已销毁的 app 上 addChild 崩帧
  const stale = () => seq !== ctx._mountSeq || ctx.app !== app;
  // 形态切换的换入组（App 换挂前经 stage.setEntryGroup 登记）：本挂载独占消费一次
  const pendingEntry = ctx._entryGroup;
  ctx._entryGroup = null;
  // 形态切换并行加载期（_revealHold）旧模型仍在台上播换出动画，不叠"加载模型…"文字
  if (!ctx._revealHold) ctx.status.value = "加载模型…";
  ctx.hintsCtl.destroy();
  ctx._spineCanvas = null;
  ctx._spineExprName = null;
  // 换出动画并行加载期（_revealHold）旧模型的 change_out 还在播，定格窗口保持到闸门放行
  if (!ctx._revealHold) ctx._holdPose = null;

  // 元数据：分区表（parts，分层预制体组装序）与骨架变体表（spineBake.js 产物）
  const meta = await fetchJsonStrict(url);
  if (stale()) return;
  ctx._spineMeta = meta;
  ctx._spineUrl = url;
  const base = modelDir(url);

  // pixi-spine 的 ESM 在 import 时自动把解析中间件注册进 Loader 全局插件表
  //（all-3.8.es.js 尾部的 registerLoaderPlugin），此处不再手动挂载——重复注册会让
  // 同一资源跑两遍中间件，第二次 add 同名 atlas 资源时抛 "already exists" 打断加载链
  // 加载期收集全部图集页 baseTexture：揭幕闸门等待期逐帧预上传 GPU（见闸门循环）
  const atlasTextures = [];
  const loadVariant = async (variant, resName) => {
    const skeletonUrl = base + variant.skeleton;
    // 加载耗时埋点：含骨架 JSON 解析+全部图集页下载与解码（切换慢时对照此行定位）
    const t0 = performance.now();
    const model = await new Promise((resolve, reject) => {
      const loader = new Loader();
      loader.add(resName, skeletonUrl, { metadata: { spineSkeletonScale: SKELETON_SCALE } });
      loader.load((loaderRef, resources) => {
        const res = resources[resName];
        if (!res?.spineData) return reject(new Error(res?.error?.message ?? "spine 资源解析失败"));
        for (const page of res.spineAtlas?.pages ?? []) {
          if (page.baseTexture) atlasTextures.push(page.baseTexture);
        }
        resolve(new Spine(res.spineData));
      });
      loader.onError.add((err) => reject(err));
    });
    console.info(
      `[perf] spine 加载 ${variant.variant} ${Math.round(performance.now() - t0)}ms`,
    );
    return model;
  };
  // 皮肤激活：prefab 的 initialSkinName（spine-unity 语义：空串 = 只挂 default 皮肤）。
  // 游戏资产里人物部件普遍放在非 default 皮肤（aluomangshi 的 '1'/'2' 是常规/誓约两套着装），
  // 空值且骨架有多套皮肤时回落第一套非 default，否则人物身体不可见；换皮肤须 setSlotsToSetupPose
  // 让各槽位按新皮肤表重解 setup 附件。
  const applySkin = (model, variant) => {
    const skins = model.spineData.skins;
    const name = variant.initialSkin;
    const skin = (name && model.spineData.findSkin(name)) ?? (skins.length > 1 ? skins[1] : null);
    if (skin) {
      model.skeleton.setSkin(skin);
      model.skeleton.setSlotsToSetupPose();
    }
  };
  // 起播：该分区 SkeletonGraphic 的 startingAnimation（缺省 'normal' 循环）
  const startPart = (model, variant) => {
    const startName = variant.startingAnimation ?? "normal";
    if (model.spineData.findAnimation(startName)) {
      model.state.setAnimation(0, startName, variant.startingLoop ?? true);
    } else if (model.spineData.animations.length) {
      model.state.setAnimation(0, model.spineData.animations[0].name, true);
    }
    return startName;
  };

  let model;
  let firstStart = "";
  // 换入组（login 单发后接 starting 循环）：单骨架分支登记，揭幕闸门放行后起播
  let entryAnim = null;
  if (Array.isArray(meta.parts) && meta.parts.length > 1) {
    // 分层预制体：按 parts 序同时挂全部分区叠出完整人形（各分区共享坐标系原点，
    // 起播动画各取 SkeletonGraphic 的 startingAnimation）
    model = new Container();
    for (const name of meta.parts) {
      const variant = meta.variants.find((v) => v.variant === name);
      if (!variant) continue;
      const part = await loadVariant(variant, name);
      if (stale()) {
        model.destroy({ children: true });
        return;
      }
      model.addChild(part);
      part.autoUpdate = true;
      applySkin(part, variant);
      // 每层都按自身 startingAnimation 起播（state 各自独立），firstStart 只作状态栏报值
      const startName = startPart(part, variant);
      const expr = expressionOverlays(part.spineData)[0];
      if (expr) part.state.setAnimation(1, expr, true);
      if (!firstStart) firstStart = startName;
    }
    ctx._spineCanvas = null;
  } else {
    const variant =
      meta.variants.find((v) => v.variant === variantOverride) ??
      meta.variants.find((v) => v.variant === meta.default) ??
      meta.variants[0];
    model = await loadVariant(variant, "spine");
    if (stale()) {
      model.destroy();
      return;
    }
    ctx._spineCanvas = variant.canvas ?? null;
    applySkin(model, variant);
    firstStart = startPart(model, variant);
    // 换入组登记（起播推迟到揭幕闸门放行后，见下）：login 单发后接 starting 循环，
    // 揭幕即换入动画，不再先露 normal 循环。登记组缺失时回落 login（游戏
    // PlayChangeSkinActionIn 的两级 fallback：change_in -> login）；未登记（普通换肤）
    // 不播换入组，走 startingAnimation
    entryAnim = pendingEntry
      ? model.spineData.findAnimation(pendingEntry)
        ? pendingEntry
        : model.spineData.findAnimation("login")
          ? "login"
          : null
      : null;
    const overlays = expressionOverlays(model.spineData);
    if (overlays.length) {
      model.state.setAnimation(1, overlays[0], true);
      ctx._spineExprName = overlays[0];
    }
  }

  // 形态切换的揭幕闸门（App 经 stage.holdReveal 置位）：目标形态在换出动画播放期间
  // 并行加载，加载完成后在此等换出播完（App releaseReveal 放行）再收旧换新；
  // 等待期旧模型照常逐帧渲染（change_out 仍在上台模型上播）
  if (
    !(await waitRevealGate(ctx, app, model, stale, {
      getTex: () => atlasTextures,
      discard: (m) => m.destroy({ children: true }),
    }))
  )
    return;
  ctx._holdPose = null;
  // 换入组起播：login 单发后接 starting 循环，收旧换新同帧揭幕即播
  if (entryAnim) {
    model.state.setAnimation(0, entryAnim, false);
    model.state.addAnimation(0, firstStart, true, 0);
  }
  // 换挂载点收旧模型与旧交互状态：必须与 destroy 同帧（L2D 的揭幕语义在此简化：
  // spine 加载即上台）。旧 L2D 模型在加载等待期仍逐帧 tick，其 beforeMotionUpdate
  // 监听器闭包读 ctx.runtime——提前置 null 会让整个 ticker 帧（含渲染）每帧被
  // TypeError 杀死（黑屏），故置空推迟到这里。
  ctx.runtime = null;
  ctx.orch = null;
  ctx.l2dOffset = null;
  // children:true 收掉分层壳（Container）下的全部分区：pixi v6 裸 destroy 只摘离
  // 不销毁 children，各分区骨架/贴图数据会随换挂逐次泄漏（L2D 模型无 children，等价裸 destroy）。
  // 必须先摘离再销毁：pixi-spine 的 destroy 走到最后才摘离父节点，中途抛错（如网格/贴图
  // 释放失败）会把半销毁对象滞留舞台，被本 app ticker 逐帧渲染整帧崩死
  const oldModel = ctx.model;
  ctx.model = model;
  if (oldModel) {
    // 先摘离后销毁；销毁（GPU 资源释放有几十毫秒开销）推迟一帧——转场覆盖层播放中
    // 的换挂若同步销毁，旧 L2D 模型的释放会把转场卡出可见顿帧
    app.stage.removeChild(oldModel);
    requestAnimationFrame(() => {
      try {
        if (!oldModel.destroyed) oldModel.destroy({ children: true });
      } catch (err) {
        console.error("[spine] 旧模型销毁失败", err);
      }
    });
  }
  app.stage.addChild(model);

  ctx.status.value = "";
  // 首次取景推迟一帧：pixi-spine 的 mesh 顶点缓冲在首次 update 前是全零数组，
  // 立即测 bounds 得到空盒会静默跳过取景
  requestAnimationFrame(() => {
    if (stale()) return;
    fitSpine(ctx);
  });
  ctx.currentMotion.value = firstStart;
  // 尺寸变化重取景：走 camera.fitModel 的 spine 分支（见 camera.js）
  ctx._spineFit = () => fitSpine(ctx);
  // 形态切换过渡 API（仅单骨架；分层无 state，缺省 undefined 由调用方退化直切）：
  // _spineTransition = 单发动画播完即续（spine 侧切出 change_out），播完停在收尾姿态，
  // 15s 兜底防事件丢失。换入动画（login）由挂载链消费 setEntryGroup 登记的换入组，不走此钩子。
  if (model.state) {
    // 本构建的 TrackEntry 无 addListener，监听须挂 AnimationState；表情层 track 1 的
    // 零时长循环动画每帧都排 complete，state 级监听必须按 entry 身份过滤再结算。
    ctx._spineTransition = (name) => {
      if (ctx.model !== model) return Promise.resolve(false);
      if (!model.skeleton.data.findAnimation(name)) return Promise.resolve(false);
      return new Promise((resolve) => {
        const entry = model.state.setAnimation(0, name, false);
        // 单发动作自带整脸 attachment 时间轴，track 1 的默认表情须停挂让位
        if (ctx._spineExprName) model.state.clearTrack(1);
        let settled = false;
        const listener = {
          complete: (e) => {
            if (e === entry) finish();
          },
          end: (e) => {
            if (e === entry) finish();
          },
        };
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          model.state.removeListener(listener);
          resolve(true);
        };
        const timer = setTimeout(finish, 15000);
        model.state.addListener(listener);
      });
    };
  }
  // 变体切换接口（多层分区与多套着装的皮肤走重挂）；分层皮肤无变体可切，重挂即复位
  ctx._spinePlay = (name) => mountSpineModel(ctx, url, name);
  // 触发面板分派：变体名走重挂切换，其余按动画名就地单发（播完回落 starting 循环并重挂
  // 默认表情层——单发动作自带整脸 attachment 时间轴，播挂期间 track 1 必须停挂让位）。
  // 表情覆盖层（track 1 常挂用）不进面板。
  const isLayered = Array.isArray(meta.parts) && meta.parts.length > 1;
  const variantNames = isLayered ? [] : meta.variants.map((v) => v.variant);
  const overlayNames = new Set(isLayered ? [] : expressionOverlays(model.spineData));
  const animNames = isLayered
    ? []
    : model.spineData.animations.map((a) => a.name).filter((n) => !overlayNames.has(n));
  ctx._spineTrigger = (name) => {
    if (ctx.model !== model) return;
    if (variantNames.includes(name) && meta.variants.length > 1) return ctx._spinePlay(name);
    if (isLayered || !model.spineData.findAnimation(name)) return;
    if (ctx._spineExprName) model.state.clearTrack(1);
    const entry = model.state.setAnimation(0, name, false);
    // 播完（complete）回落 starting 循环并重挂默认表情层；被打断（end，后续触发接管
    // track 0）只回收监听器，回落由接管者自己的 complete 负责
    const listener = {
      complete: (e) => {
        if (e !== entry) return;
        model.state.removeListener(listener);
        model.state.setAnimation(0, firstStart, true);
        if (ctx._spineExprName) model.state.setAnimation(1, ctx._spineExprName, true);
      },
      end: (e) => {
        if (e === entry) model.state.removeListener(listener);
      },
    };
    model.state.addListener(listener);
  };
  ctx.emit("motions", [...variantNames, ...animNames]);
}
