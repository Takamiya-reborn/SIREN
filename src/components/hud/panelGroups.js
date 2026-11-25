/** HUD 分组开合：模块级状态，组件重挂载（模型切换/HMR）不丢；localStorage 仅页面加载时恢复一次。键名是 localStorage 契约，改名会丢用户的分组开合档。 */
import { reactive, watch } from 'vue'

const GROUP_KEY = 'l2d-hud-groups'
const DEFAULT_OPEN = {
  motion: true,
  diff: false,
  state: false,
  machine: true,
  tap: false,
  params: false,
  relations: false,
  gates: false,
  xiaqi: false,
  move13: false,
  hints: false,
  palette: true,
  scale: true,
  view: true,
  inject: false,
}

function readSavedGroups() {
  try {
    return JSON.parse(localStorage.getItem(GROUP_KEY) ?? '{}') ?? {}
  } catch {
    return {} // 存档损坏即回默认
  }
}

export const open = reactive({ ...DEFAULT_OPEN })
for (const [k, v] of Object.entries(readSavedGroups())) {
  if (k in DEFAULT_OPEN) open[k] = !!v
}
watch(open, (v) => {
  try {
    localStorage.setItem(GROUP_KEY, JSON.stringify(v))
  } catch {
    // 隐私模式下写入失败不影响使用
  }
})

export function toggleGroup(key) {
  open[key] = !open[key]
}
