/**
 * Ani（spine）皮肤挂载：pixi-spine 3.8 运行时加载烘焙产物
 * （<变体>.json + 同名 .atlas + atlas 引用的贴图 PNG，同目录约定由 spineBake.js 保证）。
 * 分层预制体（meta.parts 有序分区，如 aijier 的 B/M/T 三层共享坐标系叠出完整人形）
 * 时按序同时挂全部分区进 Container；单骨架预制体挂默认变体。
 * 起播元数据 startingAnimation（各分区 SkeletonGraphic 的 startingAnimation/startingLoop）。
 * Ani 类皮肤无交互状态机：ctx.runtime/orch/l2dOffset 保持 null，手势层按 ctx.model
 * 无 internalModel 旁路；ctx.model 存 Spine（或分区 Container）供卸载与缩放。
 */
import { Container, Loader } from "pixi.js";
import { Spine, SpineParser } from "@pixi-spine/all-3.8";
import { expressionOverlays } from "./spineExpressions.js";

/** 游戏 SkeletonDataAsset 的解析 scale（0.01），把骨架坐标缩到游戏渲染尺度 */
const SKELETON_SCALE = 0.01;

/** 分位数取景的裁边比例（两侧各弃 2% 附件质心）与框外扩比例 */
const CENTILE = 0.02;
const FRAME_PAD = 0.2;
/** 取景框相对整包围盒的面积占比低于此值才启用（框接近全包围盒 = 内容均匀，保持原取景不动） */
const FRAME_ACTIVE = 0.4;

/** 当前挂载附件的骨架本地包围盒列表（分层预制体逐分区收集）。只统计在挂附件，
 * path/point 等无世界顶点的类型与求值异常项跳过。 */
function attachmentBoxes(model) {
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
function fitSpine(ctx) {
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
    const meta = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`spine 元数据 HTTP ${r.status}`);
        return r.json();
    });
    if (stale()) return;
    ctx._spineMeta = meta;
    ctx._spineUrl = url;
    const base = url.replace(/[^/]*$/, "");

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
            const bones = part.spineData.bones.length;
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
        // 揭幕即换入动画，不再先露 normal 循环
        entryAnim =
            pendingEntry && model.spineData.findAnimation(pendingEntry)
                ? pendingEntry
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
    let texIdx = 0;
    while (ctx._revealHold) {
        if (stale()) {
            model.destroy({ children: true });
            return;
        }
        // 揭幕首帧的 GPU 贴图上传是单帧几十毫秒的大坑：等待期逐帧预上传一张图集页，
        // 摊进换出窗口的加载期，login 揭幕帧平滑起播
        const tex = atlasTextures[texIdx];
        if (tex) app.renderer.texture.updateTexture(tex);
        texIdx++;
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
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
    // 不销毁 children，各分区骨架/贴图数据会随换挂逐次泄漏（L2D 模型无 children，等价裸 destroy）
    ctx.model?.destroy({ children: true });
    ctx.model = model;
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
