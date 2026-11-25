/** localStorage 持久化布尔开关（消费方 L2dStage.vue：showRipple/showRing/lockFrame/hideDev）。
 * @param key localStorage 键名（查看器持久化契约，改名丢用户开关档）
 * @param defaultVal 缺档/键值非 '1' 时的初值（存 '1' 为真，'0' 为假） */
import { ref, watch } from 'vue'

export function usePersistedFlag(key, defaultVal = false) {
  const v = ref(localStorage.getItem(key) === '1' || (localStorage.getItem(key) === null && defaultVal))
  watch(v, (nv) => localStorage.setItem(key, nv ? '1' : '0'))
  return v
}
