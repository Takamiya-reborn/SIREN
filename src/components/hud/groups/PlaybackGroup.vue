<script setup>
import { ref } from 'vue'
import GroupSection from '../GroupSection.vue'

/** 动作 + 差分两组：挂起动作/idle循环/fallback 路由与强播下拉，在播曲线应值 vs 模型实值 */
defineProps({
  /** 结构化 HUD 读数（l2d/hud 组装） */
  hud: { type: Object, required: true },
})

// 强播下拉选中值（跨分组开合保持）
const playSel = ref('')
</script>

<template>
  <!-- 动作：挂起动作 / idle循环 / fallback 路由 -->
  <GroupSection v-if="hud.motion" title="动作" group-key="motion">
    <template #summary>{{ hud.motion.name ?? '（无挂起）' }}</template>
    <span class="debug-pair">{{ hud.motion.name ?? '（无挂起）' }}</span>
    <span v-if="hud.motion.idle" class="debug-pair dim">idle循环</span>
    <span v-if="hud.motion.fallback" class="debug-pair dim">
      {{ hud.motion.fallback.source }}:{{ hud.motion.fallback.clip }}[{{ hud.motion.fallback.index }}]<template
        v-if="hud.motion.fallback.degraded">退化</template>
    </span>
    <!-- 强播（诊断）：任意变体/特殊动作直接起播，用于跨变体姿态对照 -->
    <div v-if="hud.play" class="debug-row">
      <select v-model="playSel" class="debug-select">
        <option value="" disabled>选动作</option>
        <option v-for="c in hud.play.clips" :key="c" :value="c">{{ c }}</option>
      </select>
      <button class="hint-toggle" type="button" @click="playSel && hud.play.run(playSel)">强播</button>
    </div>
  </GroupSection>

  <!-- 差分：在播动作曲线应值 vs 模型实值（参数被哪一层压低在此现形；混合期权重<1 时偏差属预期） -->
  <GroupSection v-if="hud.motionDiff" title="差分" group-key="diff">
    <template #summary>
      {{ hud.motionDiff.count ? hud.motionDiff.count + ' 条' : '吻合' }}
    </template>
    <span class="debug-pair dim">
      {{ hud.motionDiff.clip }} t={{ hud.motionDiff.t.toFixed(2) }}/{{ hud.motionDiff.duration.toFixed(2) }}s
      权重{{ hud.motionDiff.weight.toFixed(2) }}
    </span>
    <span v-for="r in hud.motionDiff.rows" :key="r.id" class="debug-pair">
      {{ r.id }} {{ r.want.toFixed(1) }}→{{ r.mid == null ? "?" : r.mid.toFixed(1) }}→{{ r.got.toFixed(1) }}
    </span>
    <span v-if="!hud.motionDiff.count" class="debug-pair dim">全部吻合</span>
  </GroupSection>
</template>
