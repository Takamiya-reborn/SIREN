<script setup>
import { computed, ref, watch } from 'vue'
import FormToggle from './components/FormToggle.vue'
import L2dStage from './components/stage/L2dStage.vue'
import PullDialog from './components/PullDialog.vue'
import SkinTab from './components/sidebar/SkinTab.vue'
import StateTab from './components/sidebar/StateTab.vue'
import { CATALOG, MODELS, TRIGGER_LABELS, TRIGGER_ORDER, campLabel, loadModels } from './catalog'

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
 * 形态切换编排（L2D↔ANI 胶囊入口）：置揭幕闸门后换挂提前开跑，目标形态的加载与换出
 * 动画（L2D 的 change_out / spine 的 change_out）全程并行；换出播完 releaseReveal 放行，
 * 挂载链收旧换新并在揭幕瞬间起播换入组（spine 的 login / L2D 的 change_in）——换出动画
 * 在前收尾，换入动画随揭幕播放，两段之间无"加载模型中"空窗。换出期间旧模型定格在收尾
 * 姿态（_holdPose 窗口保持到闸门放行），引擎不回 idle。两侧组名缺失/被拦都退化为直接换挂
 * （playAndWait 立即返回，闸门照常放行）。
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
    stageRef.value?.holdReveal()
    try {
      // 换装转场覆盖层（change_skin.action 指名，如 jianwu 的 jianwu3c）：全屏 cutscene，
      // 骨架事件 action=黑幕换挂时机、finish=换入动画时机；未烘焙退化为模型自身
      // change_out 单发链。方向序取目标形态 painting 的配置——游戏 ChangeSkinMgr.play
      // 传目标皮肤 id（切进谁的房间就放谁的 index，change_N 与之同源）
      const targetPainting = next === 'ani' ? entry.altPaintings[0] : entry.painting
      const cs = entry.changeSkins?.[targetPainting]
      const fromPainting = activeForm.value === 'ani' ? entry.altPaintings[0] : entry.painting
      const overlay = cs ? await stageRef.value?.playChangeSkin(cs.action, cs.index) : null
      if (overlay) {
        // 游戏语义（ChangeSkinMgr 事件驱动）：`action` 事件=黑幕换挂时机，`finish` 事件=
        // 放换入动画（change_in 缺失回落 login），覆盖层在 finish 后再留一拍才拆。
        // 揭幕即 login 会和转场后半段叠着播，故换入动画压在 finish 之后
        activeForm.value = next
        await overlay.swap
        stageRef.value?.releaseReveal()
        await overlay.finished
        if (activeId.value === id) {
          stageRef.value?.playChangeIn('change_in')
          // 回填预热缓存：下次切换走反方向，预热来时形态的转场配置
          const back = entry.changeSkins?.[fromPainting]
          if (back) stageRef.value?.warmChangeSkin(back.action)
        }
      } else {
        // playAndWait 捕获换出钩子须先于挂载链清钩子（mount 置空 _spineTransition 等），
        // 所以先取 promise 再置 activeForm 开挂；watcher 是微任务，挂载同步段消费 _entryGroup
        // 之前 setEntryGroup 一定已登记
        const outDone = stageRef.value?.playAndWait('change_out')
        stageRef.value?.setEntryGroup?.(next === 'ani' ? 'login' : 'change_in')
        activeForm.value = next
        await outDone
      }
    } finally {
      stageRef.value?.releaseReveal()
    }
    // 过渡播放期间用户可能已切走皮肤：丢弃本次切换（本挂载已被换肤挂载按序号令牌
    // 压过，闸门放行后自行销毁），不把形态写到别的皮肤头上
    if (activeId.value !== id) return
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
  // 双形态皮肤预热换装转场覆盖层：首切零停顿（无预热时覆盖层加载有数百毫秒空窗）。
  // 预热目标 = 切换方向的目标形态（反方向侧）的转场配置。形态切换进行中不预热——
  // 挂载完成恰逢转场播放中，此刻重新解析骨架会把转场卡出可见顿帧
  const entry = CATALOG.entries.find((e) => e.painting === activeId.value)
  const targetPainting = activeForm.value === 'ani' ? activeId.value : entry?.altPaintings?.[0]
  const cs = entry?.changeSkins?.[targetPainting]
  if (cs && !switching.value) stageRef.value?.warmChangeSkin(cs.action)
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
