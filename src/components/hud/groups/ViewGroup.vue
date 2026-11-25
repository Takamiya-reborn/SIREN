<script setup>
import { RotateCcw } from 'lucide-vue-next'
import GroupSection from '../GroupSection.vue'

/** 取景三轴组（L2D/spine 通用）：整体缩放乘在相机适配系数上，两轴偏移按视口宽/高比例平移，set 即走 camera.fitModel 重适配 */
defineProps({
  hud: { type: Object, required: true },
})
</script>

<template>
  <GroupSection v-if="hud.view" title="取景" group-key="view" open-last>
    <template #summary>缩放/偏移</template>
    <template #head-extra>
      <button class="reset-btn" type="button" title="复位取景三轴" @click="hud.view.set({ zoom: 1, offX: 0, offY: 0 })">
        <RotateCcw :size="14" />
      </button>
    </template>
    <div class="inject-item">
      <span class="debug-pair">整体缩放</span>
      <input class="inject-range" type="range" min="0.2" max="3" step="0.01" :value="hud.view.zoom"
        @input="hud.view.set({ zoom: +$event.target.value })">
      <span class="debug-pair">×{{ hud.view.zoom.toFixed(2) }}</span>
      <span class="debug-pair clickable reset-btn" title="复位缩放" @click="hud.view.set({ zoom: 1 })">
        <RotateCcw :size="14" />
      </span>
    </div>
    <div class="inject-item">
      <span class="debug-pair">横向偏移</span>
      <input class="inject-range" type="range" min="-0.5" max="0.5" step="0.005" :value="hud.view.offX"
        @input="hud.view.set({ offX: +$event.target.value })">
      <span class="debug-pair">{{ (hud.view.offX * 100).toFixed(1) }}%</span>
      <span class="debug-pair clickable reset-btn" title="复位横向偏移" @click="hud.view.set({ offX: 0 })">
        <RotateCcw :size="14" />
      </span>
    </div>
    <div class="inject-item">
      <span class="debug-pair">纵向偏移</span>
      <input class="inject-range" type="range" min="-0.5" max="0.5" step="0.005" :value="hud.view.offY"
        @input="hud.view.set({ offY: +$event.target.value })">
      <span class="debug-pair">{{ (hud.view.offY * 100).toFixed(1) }}%</span>
      <span class="debug-pair clickable reset-btn" title="复位纵向偏移" @click="hud.view.set({ offY: 0 })">
        <RotateCcw :size="14" />
      </span>
    </div>
  </GroupSection>
</template>
