/** 提示标签：分区 -> 驱动参数解析与紧凑记法（消费方 hints/index.js）。纯函数。 */

/** 分区名（hitArea Name，如 touch_drag23）-> 驱动参数名（如 touch_drag25）。
 * 归一化规则与 DragOrchestrator.machineByZone 一致（剔大小写与分隔符）；无机器覆盖时返回 null，调用方回落到网格名 */
export function zoneParams(orch, zoneName) {
  if (!orch?.machines?.length) return null;
  const key = String(zoneName)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const found = [];
  for (const m of orch.machines) {
    if (String(m.drawAbleName).toLowerCase().replace(/[^a-z0-9]/g, "") !== key)
      continue;
    // mode 2 联动机本机 parameter 为空串（动的是 relation 参数），不进标签，否则拼出 "touch_drag1++empty2" 这样的空档
    if (!m.parameterName) continue;
    if (!found.includes(m.parameterName)) found.push(m.parameterName);
  }
  return found.length ? found.join("+") : null;
}

/** 紧凑标签：完整名太长（touch_idle1 区三台机器拼 40+ 字符）。
 * 规则：剥 touch_/Param 前缀；参数与分区同族（同前缀纯数字编号，如 touch_drag14 区的 touch_drag21）只写数字差，跨族参数保留剥前缀全名。
 * 例：touch_drag1 -> "drag1"、TouchDrag14 -> "drag14:21"、TouchIdle1 -> "idle1:drag12+drag15+drag18"（跨族参数保留族名）、TouchDrag16(ParamLegLStretch+ParamCrusLStretch) -> "drag16:LegLStretch+CrusLStretch"。
 * 短名在模型内唯一（原名唯一且变换无损可逆），按短名即可对回 l2d.json 条目 */
export function hintText(zone, params) {
  const short = (s) =>
    String(s)
      .replace(/^touch_/, "")
      .replace(/^Param/, "");
  if (!params || params === zone) return short(zone);
  const family = /^(touch_[a-z]+?)(\d+)$/.exec(zone);
  const items = params.split("+").map((p) => {
    if (family) {
      const m = new RegExp(`^${family[1]}(\\d+)$`).exec(p);
      if (m) return m[1];
    }
    return short(p);
  });
  return `${short(zone)}:${items.join("+")}`;
}
