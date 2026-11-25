<script setup>
import GroupSection from '../GroupSection.vue'

/** 下棋 + 从动轮两组：type 15/16 九宫格与 type 13 外参从动读数 */
defineProps({
  /** hud.machine（hudInfo 组装；无编排器时为 null，本组件整体不渲染） */
  machine: { type: Object, required: true },
})

// 下棋九宫格（hud.machine.xiaqi）：格子值 0=空 / +1=玩家子 / -1=AI 子，按 actionTrigger.index 1..9 排格
function xiaqiCell(x, i) {
  const c = x.cells.find(([idx]) => idx === i)
  return c ? (c[1] > 0 ? '我' : c[1] < 0 ? 'AI' : '·') : '·'
}
function xiaqiCls(x, i) {
  const c = x.cells.find(([idx]) => idx === i)
  return c ? (c[1] > 0 ? 'me' : c[1] < 0 ? 'ai' : '') : ''
}
</script>

<template>
  <!-- 下棋：九宫格现值 + 轮次/结果元信息（suweiaitongmeng_3；限频剩余/延迟暂存是排查点击无响应的元信息） -->
  <GroupSection v-if="machine.xiaqi" title="下棋" group-key="xiaqi">
    <template #summary>
      轮:{{ machine.xiaqi.turn }} p{{ machine.xiaqi.p }}/a{{ machine.xiaqi.a }}{{
        machine.xiaqi.result != null ? (machine.xiaqi.result ? ' 胜' : ' 负') : ''
      }}
    </template>
    <div class="xiaqi-grid">
      <span v-for="i in 9" :key="'x' + i" class="xiaqi-cell" :class="xiaqiCls(machine.xiaqi, i)">
        {{ xiaqiCell(machine.xiaqi, i) }}
      </span>
    </div>
    <span class="debug-pair">轮:{{ machine.xiaqi.turn }} p{{ machine.xiaqi.p }}/a{{ machine.xiaqi.a }}</span>
    <span v-if="machine.xiaqi.result != null" class="debug-pair" :class="{ warn: !machine.xiaqi.result }">
      {{ machine.xiaqi.result ? '胜/平' : '负' }}
    </span>
    <span v-if="machine.xiaqi.limit > 0" class="debug-pair dim">限频{{ machine.xiaqi.limit.toFixed(2) }}s</span>
    <span v-if="machine.xiaqi.delayPending" class="debug-pair dim">终局延迟中</span>
  </GroupSection>

  <!-- 从动轮：type 13 外参采样基线/本体目标值/邻域闩锁（qiye_10 拖 A 部位 B 跟随） -->
  <GroupSection v-if="machine.move13?.length" title="从动轮" group-key="move13">
    <template #summary>{{ machine.move13.length }} 台</template>
    <span v-for="([k, s], i) in machine.move13" :key="'mv' + i" class="debug-pair" :class="{ warn: s.latched }">
      {{ k }}:外{{ s.ext == null ? '—' : s.ext.toFixed(2) }} 目{{ s.target.toFixed(2) }}{{ s.latched ? ' 闩' : '' }}
    </span>
  </GroupSection>
</template>
