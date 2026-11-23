<script setup>
import { computed, ref, watch } from 'vue'
import FormToggle from './components/FormToggle.vue'
import L2dStage from './components/L2dStage.vue'
import PullDialog from './components/PullDialog.vue'
import SkinTab from './components/tabs/SkinTab.vue'
import StateTab from './components/tabs/StateTab.vue'
import { CATALOG, MODELS, TRIGGER_LABELS, TRIGGER_ORDER, campLabel, loadModels } from './utils/models'

const activeId = ref(MODELS[0]?.id ?? '')

/**
 * 形态状态：activeId 恒为目录基底 painting（侧栏高亮锚点），activeForm 决定
 * 挂载哪套资源——'l2d' 挂基底目录，'ani' 挂 altPaintings[0] 的 spine 产物。
 * 不做跨会话记忆：换皮肤/重开一律回 l2d 形态（游戏默认态）。
 */
const activeForm = ref('l2d')
const activeEntry = computed(() => CATALOG.entries.find((e) => e.painting === activeId.value))
const altModel = computed(() => MODELS.find((m) => m.id === activeEntry.value?.altPaintings?.[0]))
const isDual = computed(() =>
  !!(activeEntry.value?.ani && (activeEntry.value?.l2d ?? true) && activeEntry.value?.altPaintings?.length),
)
const activeModel = computed(() =>
  activeForm.value === 'ani' && altModel.value ? altModel.value : MODELS.find((m) => m.id === activeId.value),
)

watch(activeId, () => {
  // 换皮肤一律回到 l2d 形态（游戏默认态；不跨会话记忆形态选择）
  activeForm.value = 'l2d'
})

/** 待拉取确认的皮肤条目（SkinTab 灰色条目/形态开关点击时设置，PullDialog 关闭时清空）；form 标记发起来源（'ani' = 形态开关的 spine 侧按需拉取） */
const pullTarget = ref(null)

/**
 * 形态切换编排（L2D↔ANI 胶囊入口）：先播换出动画（L2D 的 change_out / spine 的 change_out，
 * 播完定格在收尾姿态，引擎不回 idle），换挂前登记换入组（spine 的 login / L2D 的 change_in），
 * 挂载链在揭幕瞬间起播换入动画——换出动画在前收尾，换入动画随揭幕播放，无"弹回原样"与
 * "先露皮肤再补播动画"。两侧组名缺失/被拦都退化为直接换挂。
 */
const switching = ref(false)

async function setForm(next) {
  if (switching.value || next === activeForm.value) return
  const entry = activeEntry.value
  if (!entry) return
  // spine 侧未烘焙：走按需拉取链，烘完 onBaked 接着走形态切换
  if (next === 'ani' && !altModel.value) {
    pullTarget.value = { id: entry.altPaintings[0], label: `${entry.name}（Ani 形态）`, form: 'ani' }
    return
  }
  switching.value = true
  const id = activeId.value
  try {
    await stageRef.value?.playAndWait('change_out')
    stageRef.value?.setEntryGroup?.(next === 'ani' ? 'login' : 'change_in')
    // 过渡播放期间用户可能已切走皮肤：丢弃本次切换，不把形态写到别的皮肤头上
    if (activeId.value !== id) {
      stageRef.value?.setEntryGroup?.(null)
      return
    }
    activeForm.value = next
  } finally {
    switching.value = false
  }
}

/** 烘焙完成：刷新清单拿新皮肤的 url。侧栏发起的按 painting 选中加载；形态开关发起的（form:'ani'）按当前皮肤仍停留在这条 alt 上接着走 L2D→ANI 编排，停留处已换走则只刷新清单不选中 */
async function onBaked(id) {
  await loadModels()
  const fromForm = pullTarget.value?.form === 'ani'
  pullTarget.value = null
  const entry = CATALOG.entries.find((e) => e.painting === activeId.value)
  if (fromForm && entry?.altPaintings?.includes(id)) await setForm('ani')
  else if (!fromForm) activeId.value = id
}

/**
 * 侧栏吃全量目录（catalog 是已烘焙清单的超集）：state 标记资源在盘情况
 * （baked 绿点可点直接加载 / cached 已拉待烘焙 / remote 需从设备拉取），
 * 非 baked 点击走拉取确认。baked 判据以本地清单实时为准（烘焙后 loadModels
 * 刷新即转绿，不等目录重拉）；目录拉取失败回退为只显示已烘焙清单。
 */
const bakedIds = computed(() => new Set(MODELS.map((m) => m.id)))
const tabs = computed(() =>
  CATALOG.entries.length
    ? CATALOG.entries.map((e) => ({
      id: e.painting,
      label: e.name,
      state: bakedIds.value.has(e.painting) ? 'baked' : (e.state ?? 'remote'),
      camp: campLabel(e.camp),
      // 形态标记：ani=有 spine 版本；l2d 缺省真（目录条目缺省来自 live2d 索引）；alt=spine 侧 bundle 名
      ani: e.ani ?? false,
      l2d: e.l2d ?? true,
      alt: e.altPaintings?.[0] ?? null,
    }))
    : MODELS.map((m) => ({ id: m.id, label: m.name, state: 'baked', camp: '其他', ani: false, l2d: true, alt: null })),
)

const stageRef = ref(null)
/** 当前模型的可触发动作组（由舞台加载后上报）与最近一次触发项 */
const triggers = ref([])
const activeTrigger = ref('')
/** 舞台加载完成上报：刷新触发面板。换入动画（change_in/login）不再走挂载后补播——
 * 由挂载链消费 setEntryGroup 登记的换入组，揭幕瞬间起播 */
function onStageMotions(ids) {
  triggers.value = ids
}
/**
 * 状态触发面板展示全量动作组：idle/touch_idle/touch_drag 等常驻与手势组也出
 * 按钮（触发开关不只驱动动作、还驱动语音）；模型里没有可播动作的组点击即
 * no-op。effect 例外——它是 ambient.js 采样叠加的常驻氛围层，既非事件也无
 * 台词，不进面板。按 TRIGGER_ORDER 排列，未收录的排末尾。
 */
const AMBIENT_GROUPS = new Set(['effect'])
const triggerItems = computed(() => {
  const rank = (id) => {
    const i = TRIGGER_ORDER.indexOf(id)
    return i === -1 ? TRIGGER_ORDER.length : i
  }
  return triggers.value
    .filter((id) => !AMBIENT_GROUPS.has(id))
    .map((id) => ({ id, label: TRIGGER_LABELS[id] ?? id }))
    .sort((a, b) => rank(a.id) - rank(b.id)) // Array.sort 稳定，同级保持声明顺序
})

function playTrigger(id) {
  activeTrigger.value = id
  stageRef.value?.play(id)
}
</script>

<template>
  <div class="layout">
    <!-- 舞台永远占满容器，两侧栏作为蒙板浮在上面。key 用基底 id：形态切换只换 url 走原地重挂，不重建舞台 -->
    <L2dStage v-if="activeModel" ref="stageRef" class="stage" :key="activeId" :model-url="activeModel.url"
      @motions="onStageMotions" />
    <FormToggle v-if="isDual && activeModel" :form="activeForm" :switching="switching" @change="setForm" />
    <SkinTab v-model="activeId" :tabs="tabs" title="皮肤列表" @pull-request="pullTarget = $event" />
    <StateTab :items="triggerItems" :active="activeTrigger" title="状态触发" @select="playTrigger" />
    <PullDialog :target="pullTarget" @close="pullTarget = null" @baked="onBaked" />
  </div>
</template>

<style scoped>
.layout {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.stage {
  width: 100%;
  height: 100%;
}
</style>
