/** 舞台生命周期：pixi Application 创建/销毁、DPR 监听、原生指针监听挂摘、ticker 装配
 * （提示层/涟漪/誓约戒指/HUD 每帧回调/FPS 采样）、ResizeObserver 重取景。
 * 消费方 L2dStage.vue（onMounted 调 mount、onBeforeUnmount 调 unmount）。 */
import { Application, Ticker } from 'pixi.js'
import { createInteractionHints } from '../../interaction'
import { createClickEffect } from '../../l2d/fx/clickEffect'
import { createOathRing } from '../../l2d/fx/ring'
import { createTickerCallback } from '../../l2d/hud/index.js'
import { mountModel } from '../../l2d/mount/index.js'

/**
 * @param deps ctx 舞台上下文、canvasHost 模板 ref、gestures 手势处理器（createGestures 产物）、
 *   showHints/showRipple/showRing 开关 ref、lockFrame 锁帧 ref、fps 读数 ref、
 *   modelUrl () => string 当前模型地址取值器
 */
export function createStageLifecycle(deps) {
  const { ctx, canvasHost, gestures, showHints, showRipple, showRing, lockFrame, fps } = deps
  let app = null
  let view = null
  let rippleCtl = null
  let resizeObserver = null
  let dprQuery = null
  let fpsTimer = null

  /** 应用锁帧：maxFPS=0 表示不锁。跳帧时 ticker 的 deltaMS 仍为真实流逝时间，机器 step 的 dt 语义不变 */
  function applyFrameLock() {
    const max = lockFrame.value ? 60 : 0
    app.ticker.maxFPS = max
    Ticker.shared.maxFPS = max
  }

  /** 查询当前设备像素比并应用到渲染器（贴图为 4096，无需封顶）。 */
  function applyResolution() {
    const dpr = window.devicePixelRatio || 1
    if (!app || app.renderer.resolution === dpr) return
    app.renderer.resolution = dpr
    app.resize() // 让 resizeTo 按 CSS 尺寸以新分辨率重建缓冲
  }

  /** DPR 变化只会改变 matchMedia 的匹配结果，用一次性查询实现持续监听。 */
  function watchDpr() {
    dprQuery?.removeEventListener('change', onDprChange)
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    dprQuery.addEventListener('change', onDprChange)
  }

  function onDprChange() {
    applyResolution()
    watchDpr() // 重新挂到新的 DPR 值上
  }

  async function mount() {
    // resolution 按设备像素比渲染，否则高分屏上 canvas 被拉伸导致模糊；
    // autoDensity 让 canvas 的 CSS 尺寸仍等于容器尺寸，只是内部像素更密
    app = new Application({
      backgroundAlpha: 0,
      resizeTo: canvasHost.value,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: true,
    })
    ctx.app = app
    ctx.view = app.view
    // 读档锁帧开关：保存过锁帧档则开局即锁 60fps（applyFrameLock 读 lockFrame）
    applyFrameLock()
    watchDpr()
    view = app.view
    canvasHost.value.appendChild(view)
    // 调试/探针句柄：外部脚本从 DOM 取舞台实例的唯一契约（消费方见 scripts/tests/probe/pixi_events.mjs）
    canvasHost.value.__pixiApp = app
    // 指针交互走原生 DOM 事件（pixi v6 事件管线在本项目里不触发，见
    // scripts/tests/probe/pixi_events.mjs；原生路径只依赖 canvas 本身，语义
    // 与 Unity 端一致：按住跟随、松手判定）
    view.addEventListener('pointerdown', gestures.onPointerDown)
    view.addEventListener('pointermove', gestures.onPointerMove)
    view.addEventListener('pointerup', gestures.onPointerUp)
    view.addEventListener('pointercancel', gestures.onPointerCancel)
    view.addEventListener('pointerleave', gestures.onPointerCancel)
    // 交互点提示逐帧跟随模型（顶点/透明度/门控状态都在变），HUD 取其返回读数；
    // 末参取编排器：提示标签按 l2d.json 显示分区驱动的参数（网格名与反应
    // 编号在部分皮肤是错位的，如 shengluyisi_5 的 TouchDrag23 -> touch_drag25）
    ctx.hintsCtl = createInteractionHints(app, () => ctx.runtime, () => showHints.value, () => ctx.orch)
    // 触点涟漪：独立于模型，只依赖 canvas 指针事件；update 走同一 ticker
    rippleCtl = createClickEffect(app, view, () => showRipple.value)
    app.ticker.add(() => rippleCtl.update(app.ticker.deltaMS / 1000))
    // 誓约戒指控制层：开关状态读取器传响应式 ref，换挂载时 attach 即按当前状态补账
    ctx.oathRing = createOathRing(() => showRing.value)
    app.ticker.add(createTickerCallback(ctx))
    // FPS 用 0.5s 窗口帧计数：ticker.FPS 读的 elapsedMS 在节流跳帧期间仍每 rAF 重算，采样会落中
    // 跳帧周期的短读数（锁帧时显示 100+）；ticker 监听器只在帧真正执行的 tick 触发，计数即真实帧率
    let fpsFrames = 0
    app.ticker.add(() => {
      fpsFrames++
    })
    fpsTimer = setInterval(() => {
      fps.value = fpsFrames * 2
      fpsFrames = 0
    }, 500)
    // ResizeObserver 兼顾窗口变化与容器变化（如侧栏收起/展开）
    resizeObserver = new ResizeObserver(() => ctx.camera.fitModel())
    resizeObserver.observe(canvasHost.value)
    await mountModel(ctx, deps.modelUrl())
  }

  function unmount() {
    view?.removeEventListener('pointerdown', gestures.onPointerDown)
    view?.removeEventListener('pointermove', gestures.onPointerMove)
    view?.removeEventListener('pointerup', gestures.onPointerUp)
    view?.removeEventListener('pointercancel', gestures.onPointerCancel)
    view?.removeEventListener('pointerleave', gestures.onPointerCancel)
    view = null
    dprQuery?.removeEventListener('change', onDprChange)
    dprQuery = null
    resizeObserver?.disconnect()
    resizeObserver = null
    clearInterval(fpsTimer)
    fpsTimer = null
    rippleCtl?.destroy()
    rippleCtl = null
    try { ctx.hintsCtl?.destroy() } catch (e) { console.error('[stage] hints 销毁失败', e) }
    // 换装转场覆盖层与皮肤挂载链独立，舞台卸载须随 ctx 一并拆。
    // 各销毁步骤包 try：任一步抛错都不许跳过下面的 app.destroy——pixi-spine 的 destroy
    // 走完才摘离父节点，半销毁对象滞留舞台会被本 app ticker 逐帧渲染整帧崩死
    try { ctx._changeOverlay?.destroy() } catch (e) { console.error('[stage] 转场层销毁失败', e) }
    ctx._changeOverlay = null
    // children:true 收掉 spine 分层壳的全部分区（pixi v6 裸 destroy 只摘离不销毁 children）。
    // 先摘离再销毁：destroy 中途抛错不许把半销毁对象留在渲染树里
    if (ctx.model && ctx.app) ctx.app.stage.removeChild(ctx.model)
    try { ctx.model?.destroy({ children: true }) } catch (e) { console.error('[stage] 模型销毁失败', e) }
    ctx.model = null
    canvasHost.value.__pixiApp = null
    try { app?.destroy(true) } catch (e) { console.error('[stage] app 销毁失败', e) }
    ctx.app = null
    ctx.view = null
  }

  return { applyFrameLock, mount, unmount }
}
