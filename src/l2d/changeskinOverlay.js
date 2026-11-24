/**
 * 换装转场覆盖层：changeskin/<action> 烘焙产物（ship_skin_template change_skin.action 指名的
 * 全屏 spine 转场骨架，如 jianwu 的 jianwu3c）。加载后叠在舞台上全屏播放，播到动画半程
 * （色块合拢黑幕）由调用方放行换挂揭幕，播完自拆。与皮肤挂载链完全独立：无交互、无表情层、
 * 无取景 offset；模型换挂会把新模型插到覆盖层之上，播放期逐帧自置顶对冲。
 */
import { Loader } from "pixi.js";
import { Spine } from "@pixi-spine/all-3.8";

/** 游戏 SkeletonDataAsset 的解析 scale（0.01），与 spineMount 同源 */
const SKELETON_SCALE = 0.01;

/** 房间贴图边缘是羽化笔触（半透明），视口须略小于四边形才不透底 */
const SAFE_MARGIN = 1.1;

/** 预热缓存：action -> {spine, variant}（单次消费，播完由调用方回填） */
const warmCache = new Map();

/** 预加载转场骨架到缓存（形态开关首切前调用，消除起播加载停顿） */
export async function warmChangeOverlay(action) {
  try {
    await loadChangeOverlay(action);
  } catch {}
}

/** 加载转场骨架（优先命中预热缓存）。目录不存在（该 action 未烘焙）返回 null。 */
async function loadChangeOverlay(action) {
  if (warmCache.has(action)) return warmCache.get(action);
  let meta;
  try {
    const r = await fetch(`/models/changeskin/${action}/${action}.spine.json`);
    if (!r.ok) return null;
    meta = await r.json();
  } catch {
    return null;
  }
  const variant = meta.variants[0];
  const url = `/models/changeskin/${action}/`;
  try {
    const spine = await new Promise((resolve, reject) => {
      const loader = new Loader();
      loader.add("overlay", url + variant.skeleton, {
        metadata: { spineSkeletonScale: SKELETON_SCALE },
      });
      loader.load((loaderRef, resources) => {
        const res = resources.overlay;
        if (!res?.spineData)
          return reject(
            new Error(res?.error?.message ?? "spine 转场资源解析失败"),
          );
        resolve(new Spine(res.spineData));
      });
      loader.onError.add((err) => reject(err));
    });
    const loaded = { spine, variant };
    warmCache.set(action, loaded);
    return loaded;
  } catch {
    // 资源解析失败（如贴图与 atlas 尺寸不配）也退化为直切链，不硬崩
    return null;
  }
}

/** 选播动画：change_skin.index 与转场骨架动画名 change_N 同源，按序退化到首个 change* / 首个动画 */
function pickAnimation(spineData, index) {
  const names = spineData.animations.map((a) => a.name);
  if (index != null && names.includes(`change_${index}`))
    return `change_${index}`;
  return names.find((n) => n.startsWith("change")) ?? names[0];
}

/** 全屏覆盖取景：用烘焙层算好的镜头安全区（meta.covers[动画名] = 该动画全程主画面
 * 四边形的时间交集矩形，本地 px y-down）做 contain 贴合——视口恒被安全区盖住，
 * 整段动画（含镜头推拉平移）主画面不露边。无安全区回退画布矩形 × 广角基线。 */
function fitOverlay(app, spine, variant, name) {
  const cover = variant.covers?.[name];
  let x, y, w, h;
  if (cover) {
    ({ x, y, w, h } = cover);
  } else {
    const c = variant.canvas;
    w = c.width * SKELETON_SCALE;
    h = c.height * SKELETON_SCALE;
    x = c.x * SKELETON_SCALE;
    y = -c.y * SKELETON_SCALE - h;
  }
  const scale =
    Math.max(app.screen.width / w, app.screen.height / h) * SAFE_MARGIN;
  spine.scale.set(scale);
  spine.position.set(
    app.screen.width / 2 - (x + w / 2) * scale,
    app.screen.height / 2 - (y + h / 2) * scale,
  );
  console.info(
    `[changeskin] 取景 scale=${scale.toFixed(1)} 安全区=${w.toFixed(0)}x${h.toFixed(0)} @(${x.toFixed(1)},${y.toFixed(1)})`,
  );
}

/**
 * 播放换装转场。并发互斥：新转场起播前拆掉在播的旧转场。
 * 时序与游戏 ChangeSkinMgr 对齐（mgr/changeskinmgr.lua）：骨架事件驱动——`action` 事件=
 * 换挂时机（调用方放行揭幕闸门），`finish` 事件=动画收尾，之后 finish_delay（缺省 0.5s）
 * 才拆覆盖层；事件缺失退化为半程换挂/播完收尾。其余事件是音效标记（event:/ui/<名>），
 * 音频在游戏语音包内，查看器不实现。
 * @returns {{swap: Promise<void>, finished: Promise<void>, destroy(): void} | null}
 *   未烘焙返回 null。destroy 提前拆除时两个 promise 一并放行（调用方自行判断皮肤是否已换走）。
 */
export async function playChangeOverlay(ctx, action, index) {
  ctx._changeOverlay?.destroy();
  ctx._changeOverlay = null;
  const loaded = await loadChangeOverlay(action);
  warmCache.delete(action); // 缓存实例单次消费（播完即毁），由调用方回填
  const app = ctx.app;
  if (!loaded || !app) return null;
  const { spine, variant } = loaded;
  const name = pickAnimation(spine.spineData, index);
  const anim = spine.spineData.findAnimation(name);
  if (!anim) return null;
  let destroyed = false;
  let swapDone = false;
  let finishDone = false;
  let swapResolve;
  let finishedResolve;
  const swap = new Promise((resolve) => (swapResolve = resolve));
  const finished = new Promise((resolve) => (finishedResolve = resolve));
  const settleSwap = () => {
    if (!swapDone) {
      swapDone = true;
      swapResolve();
    }
  };
  const settleFinish = () => {
    if (!finishDone) {
      finishDone = true;
      finishedResolve();
    }
  };
  spine.autoUpdate = true;
  app.stage.addChild(spine);
  // 取景纯数值换算（镜头安全区），挂载即落定；动画同帧起播
  fitOverlay(app, spine, variant, name);
  const entry = spine.state.setAnimation(0, name, false);
  console.info(
    `[changeskin] ${action} 动画=${name} 时长=${anim.duration.toFixed(2)}s`,
  );
  // 模型换挂（含本次转场服务的揭幕换挂）会把新模型插到覆盖层之上，播放期逐帧自置顶
  const ticker = () => {
    if (destroyed) return;
    app.stage.addChild(spine);
  };
  app.ticker.add(ticker);
  let finishTimer = null;

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(finishTimer);
    settleSwap();
    settleFinish();
    app.ticker.remove(ticker);
    app.stage.removeChild(spine);
    spine.destroy({ children: true });
    if (ctx._changeOverlay === handle) ctx._changeOverlay = null;
  };
  // 事件驱动（SpineAnimUI.SetActionCallBack 同语义）：action=换挂，finish=收尾+延迟拆层。
  // 注意 pixi-spine 的 event 回调是 (entry, event) 双参——单参会把 TrackEntry 当事件对象，
  // 事件名永远匹配不上（曾致换挂/换入全部退化为兜底时点，时序整体后移）
  spine.state.addListener({
    event: (track, ev) => {
      if (track !== entry) return;
      const n = ev?.data?.name;
      if (!n) return;
      console.info(`[changeskin] 事件 ${n} @${spine.state.tracks[0]?.animationTime?.toFixed(2) ?? "?"}s`);
      if (n === "action") settleSwap();
      else if (n === "finish") {
        settleFinish();
        // finish_delay 缺省 0.5s（ChangeSkinMgr.finish），覆盖层多留一拍再拆
        finishTimer = setTimeout(destroy, 500);
      }
    },
    complete: (e) => {
      if (e !== entry) return;
      settleSwap();
      // finish 事件已收尾的不重复拆层计时（complete 在动画尾帧才到，重挂会多留一拍）
      if (!finishDone) {
        settleFinish();
        finishTimer = setTimeout(destroy, 500);
      }
    },
    end: (e) => e === entry && destroy(),
  });
  // action 事件缺失时的换挂兜底：退化为半程（色块合拢区间）
  setTimeout(settleSwap, (anim.duration / 2) * 1000);
  // 15s 失速兜底：事件与 complete 全丢时强拆（与 spineMount._spineTransition 同语义）
  setTimeout(destroy, 15000);
  const handle = { swap, finished, destroy };
  ctx._changeOverlay = handle;
  return handle;
}
