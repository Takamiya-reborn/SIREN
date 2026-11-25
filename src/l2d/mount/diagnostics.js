/** 挂载链内嵌诊断（常驻静默，条件触发）：锚点元凶自动取证与帧探针。 */
import { Ticker } from "pixi.js";
import { anchorCulpritSweep } from "../../interaction/hints/anchorSweep.js";

/** 点消失类问题的自动取证（l2dMount 的 motionStart 处理器一行调用）：起播 3s 后若过半
 * 交互点出画，跑一次元凶扫描（逐参数写 moc 默认看锚点是否归位，点名失控参数；单参全败
 * 再跑全量还原测试，切开"多参数耦合"与"参数系外损坏"）。条件触发、每模型至多一次，
 * 常态静默；逐点状态与参数值榜的常规读数在 HUD 交互点/状态组，console 不再定时倾倒。
 * @param ctx 舞台上下文（读 ctx.hud.value?.dots / ctx.runtime / ctx._anchorSwept）
 * @param stale () => boolean 挂载时序令牌过期判定
 */
export function maybeAnchorSweep(ctx, stale) {
  if (ctx._anchorSwept) return;
  setTimeout(() => {
    if (stale() || !ctx.runtime || ctx._anchorSwept) return;
    const dots = ctx.hud.value?.dots ?? [];
    const gone = dots.filter((d2) => /出画/.test(d2.status)).length;
    if (!dots.length || gone <= dots.length / 2) return;
    ctx._anchorSwept = true;
    const { culprits, fixAll, probe } = anchorCulpritSweep(
      ctx.model,
      dots.find((d2) => d2.mx != null)?.name ?? "touch_drag1",
    );
    console.log(
      "[l2d:culprit] 单参可归位 ×" +
        culprits.length +
        " | 全量还原:" +
        (fixAll ? "锚点回位(多参数耦合错值)" : "仍不回位(参数系外损坏)") +
        " | 读数核对:" +
        JSON.stringify(probe) +
        "\n" +
        culprits
          .map((c) => `  ${c.id} 当前${c.cur.toFixed(2)} → moc默认${c.def.toFixed(2)} 即归位`)
          .join("\n"),
    );
  }, 3000);
}

/** 临时诊断：挂载后 60 帧内观察更新链。探针挂在 app.ticker（NORMAL 优先级、晚于既有回调），读数判读：
 *   - 探针静默 -> app.ticker 某个回调每帧抛异常，整帧（含渲染）被杀
 *   - 打印但 model.deltaTime≈0 -> Ticker.shared 没在给模型送 tick（autoUpdate 注册/摘除链断），模型停在首帧姿态
 *   - 打印且 deltaTime≈16.7 -> 更新链正常，问题在更深处（motionManager 等） */
export function installFrameProbe(app, model) {
  let probeFrames = 0;
  const probe = () => {
    if (++probeFrames > 60) {
      app.ticker.remove(probe);
      return;
    }
    if (probeFrames % 30 === 0) {
      console.log(
        `[l2d] 帧探针 ${probeFrames}: deltaTime=${model.deltaTime.toFixed(1)}` +
          ` Ticker.shared=${Ticker.shared.count}个监听(started=${Ticker.shared.started})` +
          ` autoUpdate=${model.autoUpdate}`,
      );
    }
  };
  app.ticker.add(probe);
}
