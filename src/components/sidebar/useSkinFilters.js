/** 侧栏皮肤清单筛选状态（消费方 SkinTab.vue）：搜索关键字 + 状态/形态/阵营三层档位叠加。 */
import { computed, ref } from 'vue'
import { CAMP_ORDER } from '../../catalog.js'

/**
 * @param tabs SkinTab 条目数组（[{ id, label, state, camp, ani, l2d }]）
 */
export function useSkinFilters(tabs) {
  /** 按显示名或皮肤代号（id）子串过滤（不区分大小写），叠加类型/状态/阵营档；全量目录下代号也能定位 */
  const query = ref('')
  const filtered = computed(() => {
    let list = tabs.value
    if (stateFilter.value !== 'all') {
      list = list.filter((tab) => (tab.state ?? 'baked') === stateFilter.value)
    }
    if (typeFilter.value !== null) {
      // 形态过滤：Live2D=有 l2d 版本可加载，Ani=有 spine 版本；两栖皮肤两个档都命中
      list = list.filter((tab) =>
        typeFilter.value === 'ani' ? (tab.ani ?? false) : (tab.l2d ?? true),
      )
    }
    if (campFilter.value) {
      list = list.filter((tab) => tab.camp === campFilter.value)
    }
    const q = query.value.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (tab) =>
          String(tab.label ?? '').toLowerCase().includes(q) ||
          String(tab.id ?? '').toLowerCase().includes(q),
      )
    }
    return list
  })

  /** 状态筛选：chips 兼作圆点图例，计数为 0 的档位隐藏（全部恒显） */
  const STATE_FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'baked', label: '已烘焙' },
    { key: 'cached', label: '已缓存' },
    { key: 'remote', label: '未拉取' },
  ]
  const stateFilter = ref('all')
  const counts = computed(() => {
    const c = { all: tabs.value.length, baked: 0, cached: 0, remote: 0 }
    for (const tab of tabs.value) c[tab.state ?? 'baked']++
    return c
  })

  /** 阵营筛选：null=全阵营；chips 按游戏内阵营序排列，只渲染有条目的阵营 */
  const campFilter = ref(null)
  const campChips = computed(() => {
    const present = new Map()
    for (const tab of tabs.value) present.set(tab.camp ?? '其他', (present.get(tab.camp ?? '其他') ?? 0) + 1)
    const known = CAMP_ORDER.filter((label) => present.has(label))
    const extra = [...present.keys()].filter((label) => !CAMP_ORDER.includes(label))
    return [null, ...known, ...extra].map((key) => ({
      key,
      label: key ?? '全阵营',
      count: key === null ? tabs.value.length : present.get(key),
    }))
  })

  /** 状态到卡片 title 提示语的映射 */
  const STATE_HINTS = {
    baked: '已烘焙 · 点击加载',
    cached: 'bundle 已缓存 · 点击解包烘焙',
    remote: '未拉取 · 点击从设备拉取',
  }

  /** 类型筛选：null=全类型；ani 标记来自目录条目（游戏模板 spine_use_live2d） */
  const TYPE_FILTERS = [
    { key: null, label: '全类型' },
    { key: 'live2d', label: 'Live2D' },
    { key: 'ani', label: 'Ani' },
  ]
  const typeFilter = ref(null)
  const typeChips = computed(() =>
    TYPE_FILTERS.map((f) => ({
      ...f,
      count: f.key === null
        ? tabs.value.length
        : tabs.value.filter((tab) =>
          f.key === 'ani' ? (tab.ani ?? false) : (tab.l2d ?? true),
        ).length,
    })),
  )

  /** 筛选行（类型 + 状态 + 阵营 chips）默认收起，搜索栏右侧按钮展开；有档位生效时按钮保持高亮 */
  const showFilters = ref(false)
  const filterActive = computed(
    () => stateFilter.value !== 'all' || typeFilter.value !== null || campFilter.value !== null,
  )

  return {
    query,
    filtered,
    STATE_FILTERS,
    stateFilter,
    counts,
    campFilter,
    campChips,
    STATE_HINTS,
    TYPE_FILTERS,
    typeFilter,
    typeChips,
    showFilters,
    filterActive,
  }
}
