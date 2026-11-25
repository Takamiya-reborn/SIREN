<script setup>
/** 舞台右下角工具排（开关转发给 L2dStage 的 refs；交互点/誓约戒指是测试者功能，不随 dev 隐藏收起） */
defineProps({
  showHints: { type: Boolean, default: true },
  showDebug: { type: Boolean, default: false },
  showInject: { type: Boolean, default: false },
  showRipple: { type: Boolean, default: true },
  showRing: { type: Boolean, default: false },
  lockFrame: { type: Boolean, default: false },
  hideDev: { type: Boolean, default: false },
})
defineEmits(['toggle-hints', 'toggle-debug', 'toggle-inject', 'toggle-ripple', 'toggle-ring', 'toggle-lockframe', 'toggle-hidedev', 'reset'])
</script>

<template>
  <div class="stage-toolbar">
    <button v-if="!hideDev" class="hint-toggle" type="button" :class="{ on: showDebug }" @click="$emit('toggle-debug')">
      调试信息
    </button>
    <button v-if="!hideDev" class="hint-toggle" type="button" :class="{ on: showInject }" @click="$emit('toggle-inject')">
      注入
    </button>
    <button v-if="!hideDev" class="hint-toggle" type="button" :class="{ on: showRipple }" @click="$emit('toggle-ripple')">
      触点涟漪
    </button>
    <button v-if="!hideDev" class="hint-toggle" type="button" :class="{ on: lockFrame }" @click="$emit('toggle-lockframe')">
      锁帧 60
    </button>
    <button class="hint-toggle" type="button" @click="$emit('toggle-hidedev')">
      {{ hideDev ? '显示dev功能' : '隐藏dev功能' }}
    </button>
    <button class="hint-toggle" type="button" :class="{ on: showRing }" @click="$emit('toggle-ring')">
      誓约戒指
    </button>
    <button class="hint-toggle" type="button" :class="{ on: showHints }" @click="$emit('toggle-hints')">
      交互点
    </button>
    <button class="hint-toggle" type="button" @click="$emit('reset')">
      重置交互
    </button>
  </div>
</template>
