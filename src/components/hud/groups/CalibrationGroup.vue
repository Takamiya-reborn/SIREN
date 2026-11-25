<script setup>
import GroupSection from '../GroupSection.vue'

/** 调色板 + 标定两组：keyform 色轴控制与拖拽标定读数 */
defineProps({
  hud: { type: Object, required: true },
})
</script>

<template>
  <!-- 调色板：面板开合（BANZI）+ 色轴实时值，可点击循环/复位 -->
  <GroupSection v-if="hud.palette" title="调色板" group-key="palette">
    <template #summary>{{ hud.palette.axes.length }} 轴</template>
    <span v-if="hud.palette.open" class="debug-pair dim">面板开</span>
    <span v-for="([id, v], i) in hud.palette.axes" :key="'p' + i" class="debug-pair clickable"
      title="点击循环 0 → 1 → -1" @click="hud.palette.cycle(id)">
      {{ id }}={{ v }}
    </span>
    <span class="debug-pair dim clickable" title="全部色轴归零（默认方案）" @click="hud.palette.reset()">复位</span>
  </GroupSection>

  <!-- 标定：全局缩放 -->
  <GroupSection title="标定" group-key="scale">
    <template #summary>×{{ hud.scale.toFixed(2) }}</template>
    <span class="debug-pair">×{{ hud.scale.toFixed(2) }}</span>
  </GroupSection>
</template>
