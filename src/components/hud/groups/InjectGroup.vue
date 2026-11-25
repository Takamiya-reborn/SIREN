<script setup>
import { ref } from 'vue'
import GroupSection from '../GroupSection.vue'
import { groupedParams, pickParam } from '../paramGrid.js'

/** 注入组：参数覆盖层（beforeModelUpdate 钉值，赢过动作/物理/机器/视线全部层）+ 备选清单网格。
 * 注意 moc3 v5 分支吸附：参数值变一次，绑定网格可能永久切入另一关键形态分支，复位不解吸 */
defineProps({
  hud: { type: Object, required: true },
})

// 只看变化中：仍在默认值的备选参数滤掉
const onlyOff = ref(false)
</script>

<template>
  <GroupSection v-if="hud.override" title="注入" group-key="inject" open-last>
    <template #summary>{{ hud.override.list.length }} 项</template>
    <template #head-extra>
      <label class="debug-pair inject-only"><input v-model="onlyOff" type="checkbox">只看变化中</label>
      <span class="debug-pair dim">{{ groupedParams(hud, onlyOff).length }}/{{ (hud.paramList ?? []).length }}</span>
    </template>
    <div v-for="e in hud.override.list" :key="'i' + e.id" class="inject-item">
      <span class="debug-pair" :class="{ dim: !e.on }">{{ e.id }}</span>
      <input class="inject-range" type="range" :min="e.min ?? 0" :max="e.max ?? 1" :step="0.01" :value="e.value"
        :disabled="!e.on" @input="hud.override.set(e.id, +$event.target.value)">
      <span class="debug-pair" :class="{ warn: e.missing }">{{ e.missing ? '无此参数' : e.value.toFixed(2) }}</span>
      <span v-if="!e.missing" class="debug-pair dim">实{{ e.live.toFixed(2) }}</span>
      <input class="inject-check" type="checkbox" :checked="e.on"
        @change="hud.override.toggle(e.id, $event.target.checked)">
      <span class="debug-pair clickable" title="移除覆盖" @click="hud.override.remove(e.id)">×</span>
    </div>
    <!-- 备选清单：模型真实存在的参数，按去尾数字的正则分组、组内网格平铺，点格注入省去手敲 ID。
         格内常显实值（离默认值即暖色），变化一目了然；量程收进悬浮提示 -->
    <div class="param-list">
      <template v-for="g in groupedParams(hud, onlyOff)" :key="'g' + g.name">
        <span class="param-group-head">{{ g.name }} ×{{ g.items.length }}</span>
        <div class="param-grid">
          <span v-for="p in g.items" :key="'p' + p.id" class="param-cell"
            :class="{ picked: hud.override.list.some((e) => e.id === p.id), off: Math.abs(p.value - p.def) > 1e-4 }"
            :title="`${p.id}\n实值 ${p.value.toFixed(2)} 量程 [${p.min}, ${p.max}] 默认 ${p.def}\n点击注入`"
            @click="pickParam(hud, p)">
            <span class="cell-id">{{ p.id }}</span><span class="cell-val">{{ p.value.toFixed(2) }}</span>
          </span>
        </div>
      </template>
    </div>
  </GroupSection>
</template>
