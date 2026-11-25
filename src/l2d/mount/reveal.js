/** 揭幕时序（形态切换闸门 + 揭幕序列）：L2D 与 spine 两条挂载链共用。 */

/**
 * 形态切换的揭幕闸门（App 经 stage.holdReveal 置位）：目标形态在换出动画播放期间
 * 并行装配，装配完成后在此等换出播完（App releaseReveal 放行）再起播换入组与揭幕，
 * 换入动画揭幕瞬间起播，两段动画之间无加载空窗。等待期旧模型照常逐帧渲染。
 * 等待期逐帧预上传一张 GPU 贴图（4096 级纹理逐张 texImage2D，揭幕首帧全量上传是单帧
 * 几十毫秒的大坑）：摊进换出窗口的加载期，change_in 揭幕帧平滑起播。
 * @param opts getTex (model) => 待预上传纹理数组（L2D 默认 model.textures，spine 传图集页收集数组）；
 *   discard (model) => void 挂载过期的丢弃方式（spine 分层壳须 children:true）
 * @returns false = 等待期挂载过期（调用方直接退出，模型已销毁）
 */
export async function waitRevealGate(
  ctx,
  app,
  model,
  stale,
  { getTex = (m) => m.textures, discard = (m) => m.destroy() } = {},
) {
  let texIdx = 0;
  while (ctx._revealHold) {
    if (stale()) {
      discard(model);
      return false;
    }
    const tex = getTex(model)[texIdx];
    if (tex) app.renderer.texture.updateTexture(tex.baseTexture ?? tex);
    texIdx++;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return true;
}

/**
 * 揭幕序列（两帧后执行）：首帧重适配（drawable 顶点首帧后才由核心算出）、
 * 等复位缓动窗闭合（3 秒硬上限防门控卡死成永久黑屏）、收走旧模型、显出新模型。
 * @param opts entryIdle 入口 idle 的 clip 名（揭幕窗口取它的转场时长用）；
 *   entryMotion 入口硬切的缓存 motion 句柄（揭幕时恢复表值转场时长，可为 null）；
 *   entryReveal 换入组已起播（揭幕不等复位缓动窗）
 */
export function scheduleReveal(
  ctx,
  app,
  model,
  oldModel,
  stale,
  { entryIdle, entryMotion, entryReveal },
) {
  const revealStart = performance.now();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      // 挂载过期时本模型可能已上台，须自行收走，避免滞留舞台
      const discard = () => {
        if (ctx.model === model) {
          ctx.model = null;
          app.stage.removeChild(model);
          model.destroy();
        }
      };
      if (stale()) {
        discard();
        return;
      }
      ctx.camera.fitModel();
      const reveal = () => {
        if (stale()) {
          discard();
          return;
        }
        // 换入组起播的揭幕不等复位缓动窗：change_in 的渐入与复位同窗，等窗闭合会让
        // 用户看到的是 change_in 播完后的姿态而非动画全程
        const pending = entryReveal ? false : ctx.runtime?.resetPending;
        if (pending && performance.now() - revealStart < 3000) {
          requestAnimationFrame(reveal);
          return;
        }
        if (pending)
          console.warn("[l2d] 揭幕超时: 复位缓动窗口未闭合,强制显示");
        // 入口硬切只作用于起播一瞬，缓存 motion 的转场时长恢复表值，后续变体切换照常渐入
        entryMotion?.setFadeInTime(
          ctx.fades?.transitions?.[entryIdle] ?? ctx.fades?.default ?? 0.3,
        );
        ctx._entryHardCutClip = null;
        // 揭幕即收走旧模型：挂载期间旧模型保持可见，重置/切肤全程无黑屏空窗。
        // children:true 是给 spine 分层壳（Container）的：pixi v6 裸 destroy 只摘离不销毁
        // children，各分区骨架/贴图数据会随形态切换逐次泄漏（L2D 模型无 children，等价裸 destroy）
        if (oldModel && !oldModel.destroyed) {
          // 先摘离后销毁；销毁推迟一帧（GPU 释放开销大），转场覆盖层播放中不卡帧
          app.stage.removeChild(oldModel);
          requestAnimationFrame(() => {
            try {
              if (!oldModel.destroyed) oldModel.destroy({ children: true });
            } catch (e) {
              console.error("[l2d] 旧模型销毁失败", e);
            }
          });
        }
        if (ctx.model) ctx.model.visible = true;
        ctx.status.value = "";
      };
      reveal();
    }),
  );
}
