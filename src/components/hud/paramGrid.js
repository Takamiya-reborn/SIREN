/** HUD 数据整形纯函数：注入备选清单与状态网格的分组/过滤/注入（消费方 InjectGroup/StateGroup）。 */

/** 按"去尾数字"正则分组 + 组内自然排序（数字段按数值比较，jjxt/jjxt2/.../jjxt10 顺下去而不是字典序 jjxt10 排 jjxt2 前） */
function groupById(pairs) {
  const groups = []
  const byName = new Map()
  for (const item of pairs) {
    const id = item.id ?? item[0]
    const value = item.value ?? item[1]
    const name = String(id).replace(/\d+$/, '') || id
    let g = byName.get(name)
    if (!g) {
      g = { name, items: [] }
      byName.set(name, g)
      groups.push(g)
    }
    g.items.push({ id, value })
  }
  for (const g of groups)
    g.items.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  return groups
}

/** 注入备选清单分组（对象形态 {id, value, def, min, max}）：onlyOff 过滤掉仍在默认值的参数（排查"哪些在被驱动"） */
export function groupedParams(hud, onlyOff = false) {
  const all = hud?.paramList ?? []
  return groupById(onlyOff ? all.filter((p) => Math.abs(p.value - p.def) > 1e-4) : all)
}

/** 状态分区读数（hud.zones）：开关参数非 0 即在亮，"只看亮着"过滤熄灭行（排查当前哪个分区在生效） */
export function litZones(hud) {
  return (hud?.zones ?? []).filter(([, v]) => Math.abs(v) > 1e-4)
}

/** 状态读数分组（[id, value] 对数组形态），与注入清单同法 */
export function groupedPairs(pairs) {
  return groupById(pairs)
}

/** 点格注入：备选格点进覆盖层，初值取当前值 */
export function pickParam(hud, p) {
  if (!hud?.override) return
  if (!hud.override.list.some((e) => e.id === p.id)) hud.override.set(p.id, p.value)
}
