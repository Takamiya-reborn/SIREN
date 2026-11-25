<script setup>
/** 调试/注入面板壳：工具栏（Toolbar.vue）+ 注入面板（ViewGroup+InjectGroup）+ 调试面板
 * （PlaybackGroup/StateGroup/MachineGroup/MinigameGroup/CalibrationGroup）。分组折叠结构在
 * GroupSection.vue，共享样式在 panel.css（非 scoped 引入一次）。顶层 props/emits 面与原
 * 单文件版一致（L2dStage 的接线零改动）。 */
import Toolbar from './Toolbar.vue'
import ViewGroup from './groups/ViewGroup.vue'
import InjectGroup from './groups/InjectGroup.vue'
import PlaybackGroup from './groups/PlaybackGroup.vue'
import StateGroup from './groups/StateGroup.vue'
import MachineGroup from './groups/MachineGroup.vue'
import MinigameGroup from './groups/MinigameGroup.vue'
import CalibrationGroup from './groups/CalibrationGroup.vue'

defineProps({
  /** 结构化 HUD 读数（l2d/hud 组装）：状态参数、非默认残留、机器读数、标定 */
  hud: { type: Object, default: null },
  showHints: { type: Boolean, default: true },
  showDebug: { type: Boolean, default: false },
  /** 注入面板（参数覆盖层）独立开关：不随调试信息面板收起 */
  showInject: { type: Boolean, default: false },
  /** 触点涟漪（游戏"触点特效"复刻）开关 */
  showRipple: { type: Boolean, default: true },
  /** 誓约戒指开关（l2d/fx/ring.js 写 Paramring 基值，游戏 ship.propose 语义） */
  showRing: { type: Boolean, default: false },
  /** 锁帧开关：开启后 app.ticker 与 Ticker.shared 都锁 60fps（游戏参数机节拍） */
  lockFrame: { type: Boolean, default: false },
  /** 隐藏 dev 功能：收起其余工具按钮与调试/注入面板（给非开发者的测试员/用户留干净界面） */
  hideDev: { type: Boolean, default: false },
  /** FPS 读数（L2dStage 每 0.5s 采样 app.ticker.FPS） */
  fps: { type: Number, default: 0 },
})

const emit = defineEmits(['toggle-hints', 'toggle-debug', 'toggle-ripple', 'toggle-ring', 'toggle-inject', 'toggle-lockframe', 'toggle-hidedev', 'reset'])
</script>

<template>
  <Toolbar :show-hints="showHints" :show-debug="showDebug" :show-inject="showInject" :show-ripple="showRipple"
    :show-ring="showRing" :lock-frame="lockFrame" :hide-dev="hideDev" @toggle-hints="emit('toggle-hints')"
    @toggle-debug="emit('toggle-debug')" @toggle-inject="emit('toggle-inject')"
    @toggle-ripple="emit('toggle-ripple')" @toggle-ring="emit('toggle-ring')"
    @toggle-lockframe="emit('toggle-lockframe')" @toggle-hidedev="emit('toggle-hidedev')"
    @reset="emit('reset')" />

  <div v-if="!hideDev && (showDebug || showInject) && hud" class="debug-stack">
    <!-- 注入面板：独立开关，调试面板收起时仍可用。取景三轴对 spine 皮肤也可用
         （spine 无参数层，hud.override 为 null，面板外壳不按它 gating） -->
    <div v-if="showInject" class="debug-panel">
      <ViewGroup :hud="hud" />
      <InjectGroup :hud="hud" />
    </div>
    <div v-if="showDebug" class="debug-panel">
      <!-- 首行常显：FPS 实时读数（0.5s 窗口计数），不随分组折叠 -->
      <span class="debug-pair">{{ fps }} FPS</span>
      <PlaybackGroup :hud="hud" />
      <StateGroup :hud="hud" />
      <template v-if="hud.machine">
        <MachineGroup :machine="hud.machine" :rings="hud.rings" />
        <MinigameGroup :machine="hud.machine" />
      </template>
      <CalibrationGroup :hud="hud" />
    </div>
  </div>
</template>

<style src="./panel.css"></style>
