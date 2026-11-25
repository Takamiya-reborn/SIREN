/**
 * 舞台上下文工厂：各 l2d/ 模块共享的可变状态（单舞台实例，直接可变对象）。
 * - 引用型字段（app/model/runtime/orch/l2dOffset/hintsCtl/actions/camera）
 *   由 motionPatches/camera/mount/gestures/hud 各模块读写；
 * - dragScale（拖拽标定，camera 写）与 lastGesture（手势判定，gestures 写）
 *   是跨模块传值；
 * - status/currentMotion/hud/showHints 是响应式桥（l2d/ 只透传
 *   .value，不 import vue）；fill/emit 回传组件侧的 props 与事件。
 */
export function createStageContext({ status, currentMotion, hud, fill, emit }) {
  return {
    app: null,
    view: null,
    model: null,
    runtime: null,
    orch: null,
    l2dOffset: null,
    mainuiShift: null,
    painting: null,
    hintsCtl: null,
    actions: null,
    camera: null,
    oathRing: null,
    // 取景微调（HUD 注入面板三轴，L2D 与 spine 都吃）：zoom 乘在相机适配系数上，
    // offX/offY 是视口宽/高比例的平移量；camera.fitModel 消费，set 后重适配
    userView: { zoom: 1, offX: 0, offY: 0 },
    dragScale: 1,
    lastGesture: 'tap',
    status,
    currentMotion,
    hud,
    fill,
    emit,
  }
}
