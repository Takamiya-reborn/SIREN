<script setup>
import { ChevronRight } from 'lucide-vue-next'
import { open, toggleGroup } from './panelGroups.js'

/** 通用折叠组壳：吸收原 HudPanel 的 group/inject-head/group-head/tri/group-body 结构。
 * 开合状态走 panelGroups 的模块级 reactive（localStorage 持久化契约见 panelGroups.js）。 */
defineProps({
  /** 组名（"取景"/"注入"/"机器"…） */
  title: { type: String, required: true },
  /** panelGroups.open 的分组键 */
  groupKey: { type: String, required: true },
  /** 面板末组特例：无底边框（原 .open-last） */
  openLast: { type: Boolean, default: false },
  /** group-body 附加类（如 gates-body 纵向排列） */
  bodyClass: { type: String, default: '' },
})
</script>

<template>
  <div class="group" :class="{ 'open-last': openLast, open: open[groupKey] }">
    <!-- head-extra 在场时组头行用 inject-head 布局（开合钮 flex:1 + 右侧附加控件同排） -->
    <div v-if="$slots['head-extra']" class="inject-head">
      <button class="group-head" type="button" @click="toggleGroup(groupKey)">
        <ChevronRight class="tri" :class="{ open: open[groupKey] }" :size="12" />{{ title }}
        <span v-if="!open[groupKey]" class="dim"><slot name="summary" /></span>
      </button>
      <slot name="head-extra" />
    </div>
    <button v-else class="group-head" type="button" @click="toggleGroup(groupKey)">
      <ChevronRight class="tri" :class="{ open: open[groupKey] }" :size="12" />{{ title }}
      <span v-if="!open[groupKey]" class="dim"><slot name="summary" /></span>
    </button>
    <div class="group-body" :class="bodyClass">
      <slot />
    </div>
  </div>
</template>
