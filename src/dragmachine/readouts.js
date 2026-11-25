/** HUD 读数聚合（gateInfo/hudInfo，展示层排版）：自由函数风格，首参 o = DragOrchestrator 实例（委托接线见 orchestrator.js）。纯查询，不改状态。 */

/** type 11 判定门读数：同分区同参数的多台机器归并为一道门，区间段按 num 排列并附目标动作；判定读的是模型实时值（applyClickTrigger 同源），不是机器记账值 */
export function gateInfo(o) {
  const gates = [];
  for (const m of o.machines) {
    const at = m.actionTrigger;
    if (at?.type !== 11) continue;
    const param = at.parameter ?? m.parameterName;
    let gate = gates.find(
      (g) => g.zone === m.drawAbleName && g.param === param,
    );
    if (!gate) {
      gate = {
        zone: m.drawAbleName,
        param,
        value: null,
        lo: Infinity,
        hi: -Infinity,
        bands: [],
      };
      gates.push(gate);
    }
    const item = Array.isArray(at.action_list)
      ? at.action_list[
          Math.min(Math.max(m.actionListIndex, 1), at.action_list.length) - 1
        ]
      : null;
    const num = at.num ?? item?.num;
    if (!num) continue;
    gate.lo = Math.min(gate.lo, num[0]);
    gate.hi = Math.max(gate.hi, num[1]);
    gate.bands.push({
      lo: num[0],
      hi: num[1],
      action: at.action ?? item?.action ?? "",
    });
  }
  for (const g of gates) {
    g.bands.sort((a, b) => a.lo - b.lo);
    g.value = o.readParameter(g.param);
  }
  return gates;
}

/** HUD 读数：idle 变体号、白名单规模、按住中的机器、各机器参数实时值、relation 联动参数实时值。返回结构化数据（键值对组），展示层负责排版 */
export function hudInfo(o) {
  const active = o.machines.find((m) => m._active);
  const machines = o.machines
    .filter((m) => m.parameterName) // mode 2 联动机本机参数为空，走"联动"行
    .map((m) => [m.parameterName, Number(m.parameterValue.toFixed(2))]);
  const relations = [];
  for (const m of o.machines) {
    for (const r of m.relations) {
      if (!relations.some(([name]) => name === r.name)) {
        relations.push([r.name, Number(r.value.toFixed(2))]);
      }
    }
  }
  // 下棋组（无格子机输出 null）：9 格现值 + 轮次/结果元信息（格子值也在 machines 行，本组补元信息）
  const cells = o.xiaqiCells();
  let xiaqi = null;
  if (cells.length) {
    let p = 0;
    let a = 0;
    for (const c of cells) {
      if (c.parameterTargetValue > 0) p++;
      else if (c.parameterTargetValue < 0) a++;
    }
    xiaqi = {
      cells: cells.map((c) => [
        c.actionTrigger.index,
        c.parameterTargetValue,
      ]),
      p,
      a,
      turn: p <= a ? "player" : "ai",
      result: o.xiaqiResult,
      limit:
        o.xiaqiLimitTime != null
          ? Math.max(0, 1 - (performance.now() / 1000 - o.xiaqiLimitTime))
          : 0,
      delayPending: o.xiaqiResultDelay != null,
    };
  }
  // type 13 从动轮组：外参采样基线/本体目标值/邻域闩锁
  const move13 = o.machines
    .filter((m) => m.actionTrigger?.type === 13)
    .map((m) => [
      m.parameterName,
      {
        ext: m.parameterMove,
        target: m.parameterTargetValue,
        latched: m.parameterMoveTrigger,
      },
    ]);
  return {
    xiaqi,
    move13,
    idle: o.idleIndex,
    whitelist: o.enablePlayActions.length,
    // 名单里的 touch_idle 子集（紧凑记法 t17+t19）：唯一识别落账机器——#16 的名单是 17+19，#19 收尾后是 2+4，收尾机空名单显示 空
    wlIdle: o.enablePlayActions
      .filter((c) => /^touch_idle/.test(c))
      .map((c) => c.slice("touch_idle".length))
      .join("+"),
    // 最近一次写入白名单的机器 key 尾号（0 = 尚无落账）
    actor: o.activeOwner ?? 0,
    able: o.machineAble,
    // 反应动作播放中标记：ignore_action 机器在播放中拒按、点击判定同样放行不了，isPlaying 若在动作结束后仍滞留真值即锁死
    playing: o.isPlaying,
    playName: o.playActionName,
    active: active ? active.drawAbleName : null,
    machines,
    relations,
    gates: gateInfo(o),
    // 触发链最近读数（副本：ticker 每帧调 hudInfo，避免展示层持同引用）
    tap: (o.tapLog ?? []).slice(-6),
  };
}
