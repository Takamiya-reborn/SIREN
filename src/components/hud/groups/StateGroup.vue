<script setup>
import { ref } from 'vue'
import GroupSection from '../GroupSection.vue'
import { groupedPairs, litZones } from '../paramGrid.js'

/** 状态 + 交互点两组：状态分区参数与摆位残留网格、提示层逐分区读数 */
defineProps({
  hud: { type: Object, required: true },
})

// 只看亮着：熄灭行滤掉（排查当前哪个分区在生效）
const onlyLit = ref(false)
</script>

<template>
  <!-- 状态：状态分区参数 + 摆位残留，按注入清单的分组网格平铺；
       分区亮着才有排查价值（暖色值），残留必离默认值（恒暖色），收起时头部留残留计数 -->
  <GroupSection v-if="hud.zones.length || hud.carried.length" title="状态" group-key="state">
    <template #summary>{{ hud.carried.length }} 残留</template>
    <template #head-extra>
      <label class="debug-pair inject-only"><input v-model="onlyLit" type="checkbox">只看亮着</label>
      <span class="debug-pair dim">{{ litZones(hud).length }}/{{ hud.zones.length }}</span>
    </template>
    <div class="param-list">
      <template v-for="g in groupedPairs(onlyLit ? litZones(hud) : hud.zones)" :key="'sz' + g.name">
        <span class="param-group-head">{{ g.name }} ×{{ g.items.length }}</span>
        <div class="param-grid">
          <span v-for="p in g.items" :key="'sp' + p.id" class="param-cell" :class="{ off: Math.abs(p.value) > 1e-4 }">
            <span class="cell-id">{{ p.id }}</span><span class="cell-val">{{ p.value.toFixed(2) }}</span>
          </span>
        </div>
      </template>
      <template v-if="hud.carried.length">
        <span class="param-group-head">残留 ×{{ hud.carried.length }}</span>
        <div class="param-grid">
          <span v-for="([id, value], i) in hud.carried" :key="'sc' + i" class="param-cell off">
            <span class="cell-id">{{ id }}</span><span class="cell-val">{{ value.toFixed(2) }}</span>
          </span>
        </div>
      </template>
    </div>
  </GroupSection>

  <!-- 交互点：提示层逐分区读数（点 / 框无点 + 原因 / 被挡 / 出画 / 网格隐藏），bad = 入画却没点/被挡，门控排查重点 -->
  <GroupSection v-if="hud.dots?.length" title="交互点" group-key="hints">
    <template #summary>
      {{ hud.dots.filter((d) => d.status === '点' || d.status === '点:质心').length }}点<template
        v-if="hud.dots.some((d) => d.bad)">·{{ hud.dots.filter((d) => d.bad).length }}异常</template>
    </template>
    <span v-for="(d, i) in hud.dots" :key="'d' + i" class="debug-pair"
      :class="{ warn: d.bad, dim: !d.bad && (d.status === '网格隐藏' || d.status === '挡:出画' || d.status === '无点:出画') }">
      {{ d.name }}:{{ d.status }}
    </span>
  </GroupSection>
</template>
