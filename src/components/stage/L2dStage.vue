<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { installMotionPatches } from '../../l2d/motion/patches'
import { createCamera } from '../../l2d/camera'
import { createActions } from '../../l2d/motion/actions'
import { createGestures } from '../../l2d/gestures'
import { mountModel } from '../../l2d/mount/index.js'
import HudPanel from '../hud/HudPanel.vue'
import { createStageContext } from './stageContext.js'
import { createStageLifecycle } from './stageLifecycle.js'
import { usePersistedFlag } from './usePersistedFlag.js'

const props = defineProps({
  modelUrl: { type: String, required: true },
  /** 内容适配系数：1 = 撑满较短轴，<1 留边，>1 允许少量裁切 */
  fill: { type: Number, default: 1 },
})

const emit = defineEmits(['motions'])

const canvasHost = ref(null)
const status = ref('正在初始化舞台…')
const currentMotion = ref('')
// 交互点提示（interaction/ 的 hints 覆盖层）开关
const showHints = ref(true)
// 触点涟漪（游戏"触点特效"的复刻，l2d/fx/clickEffect.js）开关；
// 与游戏 SHOW_TOUCH_EFFECT 同语义（默认开），localStorage 持久化
const showRipple = usePersistedFlag('l2d.showClickRipple', true)
// 誓约戒指（游戏 ship.propose 的外置开关，l2d/fx/ring.js 逐帧写 Paramring）开关，localStorage 持久化
const showRing = usePersistedFlag('l2d.showOathRing', false)
// 调试信息（状态机 拖拽参数机 HUD 读数）独立于交互点开关；hud 为结构化数据；默认关闭，调试时再开
const showDebug = ref(false)
// 注入面板独立于调试信息开关；默认关闭
const showInject = ref(false)
const hud = ref(null)
// 锁帧开关：默认高帧率（显示器刷新率），拖拽手感异常等问题出现时手动锁 60fps
// 复刻游戏节拍；localStorage 持久化。模型 autoUpdate 挂在 Ticker.shared，锁帧要两个 ticker 一起盖
const lockFrame = usePersistedFlag('l2d.lockFrame', false)
// 隐藏 dev 功能：收起工具栏 dev 按钮与调试/注入面板（非开发者的测试员/用户用）；交互点供测试者使用，不随之隐藏
const hideDev = usePersistedFlag('l2d.hideDev', false)
// HUD 的 FPS 读数（0.5s 窗口帧计数，避免逐帧触发响应式重渲）
const fps = ref(0)

/** 舞台上下文：各 l2d/ 模块共享的可变状态（契约注释见 stageContext.js） */
const ctx = createStageContext({
  status,
  currentMotion,
  hud,
  fill: () => props.fill,
  emit,
})

// 动作库补丁（渐变归零 / Meta.Loop / idle 确定性选支）：安装一次，读 ctx
installMotionPatches(ctx)
// 取景适配与动作播放 API
ctx.camera = createCamera(ctx)
const actions = createActions(ctx)
ctx.actions = actions
const gestures = createGestures(ctx)

// 舞台生命周期（pixi app/指针监听/ticker 装配/销毁），锁帧 watch 在此之后接线
const lifecycle = createStageLifecycle({
  ctx,
  canvasHost,
  gestures,
  showHints,
  showRipple,
  showRing,
  lockFrame,
  fps,
  modelUrl: () => props.modelUrl,
})
watch(lockFrame, () => lifecycle.applyFrameLock())

onMounted(() => lifecycle.mount())
onBeforeUnmount(() => lifecycle.unmount())

watch(() => props.modelUrl, (url) => url && mountModel(ctx, url))

/** 供外部（状态触发面板）直接播放指定动作组；spine 侧走 _spineTrigger 分派
 * （变体名重挂切换、动画名就地单发播完回落 starting 循环）。
 * playAndWait 等过渡动画播完再续（形态切换）：spine 侧走 _spineTransition（change_out 单发），
 * L2D 侧走 actions.playTransition；两侧组名缺失都返回 false（调用方退化直切）。
 * setEntryGroup 登记换入组（change_in/login）：下一次挂载消费，揭幕瞬间起播换入动画。 */
defineExpose({
  play: (group) => (ctx._spineTrigger ? ctx._spineTrigger(group) : ctx.actions.playMotion(group)),
  playAndWait: (group) =>
    ctx.model?.state && ctx._spineTransition
      ? ctx._spineTransition(group)
      : ctx.actions.playTransition(group),
  /** 换装转场覆盖层（change_skin.action）：changeskin/<action> 烘焙产物全屏播放，
   * 返回 {swap, finished, destroy}；未烘焙返回 null，调用方退化直切链。
   * 动态 import 与 spineMount 同策略：pixi-spine 不进舞台主包 */
  playChangeSkin: (action, index) =>
    import('../../l2d/spine/changeskin.js').then((m) => m.playChangeOverlay(ctx, action, index)),
  /** 预热转场覆盖层（后台加载进缓存，不播） */
  warmChangeSkin: (action) =>
    import('../../l2d/spine/changeskin.js').then((m) => m.warmChangeOverlay(action)),
  /** 换入动画（finish 事件时机由 App 编排）：游戏两级 fallback——change_in 存在放
   * change_in，缺失回落 login（mainlive2dpainting/mainspinepainting 同语义） */
  playChangeIn: (group) => {
    const model = ctx.model
    if (!model) return
    if (model.state && ctx._spineTrigger) {
      const has = !!model.spineData.findAnimation(group)
      ctx._spineTrigger(has ? group : 'login')
    } else {
      const has = !!(model.internalModel?.settings?.motions?.[group]?.length)
      ctx.actions.playMotion(has ? group : 'login')
    }
  },
  setEntryGroup: (group) => {
    ctx._entryGroup = group ?? null
  },
  /** 形态切换并行加载的揭幕闸门（消费方见 mount/l2dMount.js 与 mount/spineMount.js）：
   * 置位后挂载链装配完成不立即揭幕（也不叠加载文字），等 releaseReveal 放行再收旧换新并起播换入组。
   * App 侧编排在换出动画起播前置位、播完放行，换出与目标形态加载全程并行 */
  holdReveal: () => {
    ctx._revealHold = true
  },
  releaseReveal: () => {
    ctx._revealHold = false
  },
})
</script>

<template>
  <div class="stage">
    <div ref="canvasHost" class="canvas-host" />
    <HudPanel :hud="hud" :show-hints="showHints" :show-debug="showDebug" :show-inject="showInject"
      :show-ripple="showRipple" :show-ring="showRing" :lock-frame="lockFrame" :hide-dev="hideDev" :fps="fps"
      @toggle-hints="showHints = !showHints" @toggle-debug="showDebug = !showDebug"
      @toggle-inject="showInject = !showInject" @toggle-ripple="showRipple = !showRipple"
      @toggle-ring="showRing = !showRing" @toggle-lockframe="lockFrame = !lockFrame"
      @toggle-hidedev="hideDev = !hideDev" @reset="actions.resetInteraction()" />
    <p v-if="status" class="status">{{ status }}</p>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
}

.canvas-host {
  width: 100%;
  height: 100%;
}

.canvas-host :deep(canvas) {
  display: block;
  touch-action: none;
  /* 按住拖拽属于交互语义，屏蔽浏览器默认手势 */
}

.status {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #8a8a93;
  font: 14px/1.6 system-ui, sans-serif;
  user-select: none;
}
</style>
