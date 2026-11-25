/**
 * 模型挂载总入口：按 url 分流 L2D（l2dMount.js）与 Ani spine（spineMount.js）两条挂载链。
 * 复位缓动登记、Breath 移除、trackMotionStart 补账等装配语义见各链内注释；写回
 * ctx.model / ctx.runtime / ctx.orch / ctx.l2dOffset / ctx.fades。
 */

/**
 * @param ctx 舞台上下文（见 stage/L2dStage.vue）：要求 ctx.camera（camera.js）、
 *   ctx.actions（actions.js）、ctx.hintsCtl（hints 提示层控制器）已就位
 * @param {string} url 模型 model3.json 地址
 */
export async function mountModel(ctx, url) {
  // Ani（spine）皮肤走独立挂载链（无交互状态机，pixi-spine 3.8 渲染）；动态 import
  // 使 pixi-spine 不进舞台主包
  if (url.endsWith(".spine.json")) {
    const { mountSpineModel } = await import("./spineMount.js");
    return mountSpineModel(ctx, url);
  }
  const { mountL2dModel } = await import("./l2dMount.js");
  ctx._mounting = true;
  try {
    await mountL2dModel(ctx, url);
  } catch (err) {
    // 挂载失败不静默——任何一步出错都显式上报；带 url 便于区分是哪个皮肤
    console.error("[l2d] 模型挂载失败", url, err);
    ctx.status.value = `加载失败:${err?.message ?? err}（${url}）`;
  } finally {
    ctx._mounting = false;
  }
}
