<script setup>
import GroupSection from '../GroupSection.vue'

/** 机器 + 触发链 + 参数 + 联动 + 判定五组：拖拽参数机的核心读数 */
defineProps({
  /** hud.machine（hudInfo 组装；无编排器时为 null，本组件整体不渲染） */
  machine: { type: Object, required: true },
  /** 判定引导环逐门读数（hints rings） */
  rings: { type: Array, default: () => [] },
})

// 判定门刻度：区间端点映射到 [lo,hi] 全程的百分比
function spanPct(gate, v) {
  const span = gate.hi - gate.lo
  return span > 0 ? ((v - gate.lo) / span) * 100 : 0
}

// 判定门实时值（模型实时读数，可能为 0）
function fmtValue(v) {
  return typeof v === 'number' ? v.toFixed(2) : '—'
}

// 判定引导环逐门读数（judgeRings reads）：在画 = α 与锚点坐标，未画 = 原因
function ringText(gate, ringReads) {
  const r = (ringReads ?? []).find((e) => e.zone === gate.zone)
  if (!r) return '环:无读数'
  if (r.why) return '环:' + r.why
  return `环:画 a=${r.a.toFixed(2)} @(${Math.round(r.x)},${Math.round(r.y)})`
}
</script>

<template>
  <!-- 机器：idle 变体 / 白名单 / 落账 / 按压锁 / 播放中滞留（收起时头部仍保 Warn） -->
  <GroupSection title="机器" group-key="machine">
    <template #summary>
      idle={{ machine.idle }}
      <span v-if="machine.playing" class="warn">播放中:{{ machine.playName }}</span>
    </template>
    <span class="debug-pair">idle={{ machine.idle }}</span>
    <span class="debug-pair">白名单={{ machine.whitelist }}<template v-if="machine.wlIdle">(t{{
      machine.wlIdle }})</template></span>
    <span v-if="machine.actor" class="debug-pair">落账=#{{ String(machine.actor).slice(-2) }}</span>
    <span v-if="machine.able" class="debug-pair">按压锁</span>
    <span v-if="machine.active" class="debug-pair">按住:{{ machine.active }}</span>
    <!-- 播放中滞留是"交互一次就锁死"的头号嫌疑：反应动作播完仍显示即中招 -->
    <span v-if="machine.playing" class="debug-pair warn">
      播放中:{{ machine.playName }}
    </span>
  </GroupSection>

  <!-- 触发链：最近调度日志 -->
  <GroupSection v-if="machine.tap?.length" title="触发链" group-key="tap">
    <template #summary>{{ machine.tap.length }} 条</template>
    <span v-for="(e, i) in machine.tap" :key="'t' + i" class="debug-pair dim">
      {{ e.t.toFixed(1) }} {{ e.line }}
    </span>
  </GroupSection>

  <!-- 参数：各机器参数实时值 -->
  <GroupSection v-if="machine.machines.length" title="参数" group-key="params">
    <template #summary>{{ machine.machines.length }} 项</template>
    <span v-for="([k, v], i) in machine.machines" :key="'m' + i" class="debug-pair">{{ k }}={{ v }}</span>
  </GroupSection>

  <!-- 联动：relation 参数实时值 -->
  <GroupSection v-if="machine.relations.length" title="联动" group-key="relations">
    <template #summary>{{ machine.relations.length }} 项</template>
    <span v-for="([k, v], i) in machine.relations" :key="'r' + i" class="debug-pair">{{ k }}={{ v }}</span>
  </GroupSection>

  <!-- 判定：type 11 区间机的门刻度条（body 纵向排列，gates-body 见 panel.css） -->
  <GroupSection v-if="machine.gates.length" title="判定" group-key="gates" body-class="gates-body">
    <template #summary>{{ machine.gates.length }} 门</template>
    <div v-for="g in machine.gates" :key="'g' + g.zone + g.param" class="gate">
      <span class="gate-head">{{ g.zone }} {{ g.param }}={{ fmtValue(g.value) }}（{{ ringText(g, rings) }}）</span>
      <span class="gate-track">
        <span v-for="(b, i) in g.bands" :key="i" class="gate-band"
          :class="{ hit: g.value >= b.lo && g.value < b.hi }"
          :style="{ left: spanPct(g, b.lo) + '%', width: spanPct(g, b.hi) - spanPct(g, b.lo) + '%' }">
          {{ b.action }}
        </span>
      </span>
    </div>
  </GroupSection>
</template>
