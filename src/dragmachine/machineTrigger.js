/** 触发链路（游戏 isActionTriggerAble / checkClickAction / onEventCallback EVENT_ACTION_APPLY / onListenerEvent / checkActionInExtendFlag）：自由函数风格，首参 m = DragMachine 实例（委托接线见 machine.js）。 */
import * as machinePointer from "./machinePointer.js";

/** 触发冷却与单触发互斥（游戏 isActionTriggerAble） */
export function triggerAble(m, dt) {
  if (!m.actionTrigger?.type) return false;
  if (m.nextTriggerTime > 0) {
    m.nextTriggerTime = Math.max(0, m.nextTriggerTime - dt);
    return false;
  }
  return !m.isTriggerAtion;
}

/** type 2/6/9/11 点击触发：checkClickAction 判定成功后由 step 调到（clickTriggerTime 到期窗口内）。播放 action（白名单检查在编排器 playAction 里）并应用 activeData；无 action 的机器只做 target 切换。
 * type 9 在触发前先查他参是否贴近 num（±0.05，游戏 EVENT_GET_PARAMETER 回调），不贴近则白点。
 * type 11 同读他参现值但按区间放行（DD:1028-1043：num[0] ≤ 值 < num[1] 才触发）；num 缺省回落 action_list 当前项（与 type 1 同款的 updateTrigger 前置取值）。 */
export async function applyClickTrigger(m) {
  m.clickTriggerTime = null;
  m.orch.pressLock(`点击确认 ${m.drawAbleName}`, false);
  const at = m.actionTrigger;
  if (at?.type === 9) {
    const v = m.orch.readParameter(at.parameter ?? m.parameterName);
    if (v == null || Math.abs((at.num ?? 0) - v) > 0.05) {
      m.orch.debug?.(
        `${m.parameterName} type9 他参 ${at.parameter}=${v?.toFixed?.(2) ?? v} 未贴近 ${at.num}，不触发`,
      );
      return;
    }
  }
  if (at?.type === 11) {
    const item = Array.isArray(at.action_list)
      ? at.action_list[
          Math.min(Math.max(m.actionListIndex, 1), at.action_list.length) - 1
        ]
      : null;
    const num = at.num ?? item?.num;
    const v = m.orch.readParameter(at.parameter ?? m.parameterName);
    if (num == null || v == null || !(num[0] <= v && v < num[1])) {
      m.orch.debug?.(
        `${m.parameterName} type11 他参 ${at.parameter}=${v?.toFixed?.(2) ?? v} 不在区间 [${num?.[0]},${num?.[1]})，不触发`,
      );
      return;
    }
  }
  if (at?.type === 15) {
    // 下棋点击（DD:1248-1258）：EVENT_GAME_XIAQI 交控制层裁决——空格落子/角色应手/终局判定都在 orchestrator.xiaqiClick。
    // 原文此分支不调 triggerAction（本机无冷却，限频是控制层的全局 1s）、不发 DRAG_CLICK 通知
    m.orch.xiaqiClick(m);
    return;
  }
  const applied = await m.applyTrigger();
  // DRAG_CLICK 通知（DD:1022-1042/1130-1136）：type 2/9/11 的 apply 回调包 onEventNotice(ON_ACTION_DRAG_CLICK)，
  // 载荷由 onEventNotice 自造（getCommonNoticeData，恒非 nil）；type 6 不传回调不发（DD:1105-1109）。
  // slot17 对播放结果无守卫（播不出去也发）；重复 idle 豁免在回调打包前 return，被豁免的触发不发
  if (applied && m.actionTrigger?.type !== 6)
    m.orch.notice(2, { draw_able_name: m.drawAbleName });
}

/** 游戏按住期间的收尾豁免（isApplyStopDrag DD:543）：仅 type 14（DRAG_MOVE_DOWN_UP）为 false，本型未移植，恒可收尾 */
export function isApplyStopDrag(m) {
  return m.actionTrigger?.type !== 14;
}

/** 游戏触发收尾（apply 块三分支的 slot11，DD:424-428/443-484）：按压中触发即松开拖拽——单 action 触发、action_list 回绕、无 action 触发三处调用；action_list 非回绕推进不调。未按压 no-op（游戏 stopDrag 整体被 _active 包裹，DD:257）。
 * 尾部对齐游戏 stopDrag（DD:256-280）：回弹倒计时、type3+last 清冷却（checkResetTriggerTime）、拖拽基准落账、档位吸附、存档；不动按压锁——游戏靠下一帧 updateTrigger 松手分支解锁（DD:1074-1076）。 */
export function stopDragIfApply(m) {
  if (!isApplyStopDrag(m) || !m._active) return;
  m._active = false;
  if (m.revert > 0) {
    m.parameterToStart = m.revert;
    m.parameterSmoothTime = m.smoothRevert;
  }
  if (m.actionTrigger?.type === 3 && m.actionTrigger.last)
    m.nextTriggerTime = 0;
  machinePointer.commitDragBase(m);
  machinePointer.updatePartsSnap(m);
  m.saveData();
}

/** 游戏触发入口（onEventCallback EVENT_ACTION_APPLY 的 action 分支）。触发冷却/连点下标的推进都按游戏 apply 块的分支顺序落账：先取本次 action 与 activeData（type 6 从 action_list 按 actionListIndex 取并推进下标），再过重复 idle 豁免，最后才是 circle/target 与播放（async：等待引擎真实播放结果后才应用 activeData） */
export async function applyTrigger(m) {
  const at = m.actionTrigger;
  if (!at) return false;
  let activeData = m.actionTriggerActive;
  let action = null;
  if (Array.isArray(at.action_list) && at.action_list.length) {
    // 连点循环（type 6）：本次播 action_list[actionListIndex]，随后下标推进、末位回卷（回卷即一轮连点完成，游戏在此收尾拖拽）；下标推进发生在重复 idle 豁免之前——被豁免跳过的触发同样消耗一次下标
    const idx = Math.min(Math.max(m.actionListIndex, 1), at.action_list.length);
    action = m.filterAction(at.action_list[idx - 1]?.action);
    const activeList = activeData?.active_list;
    if (Array.isArray(activeList) && idx <= activeList.length)
      activeData = activeList[idx - 1] ?? null;
    m.actionListIndex = idx === at.action_list.length ? 1 : idx + 1;
    // revert_action_index：下标一推进，参数立刻回起始值（游戏 updateStateData 的 lastActionIndex != actionListIndex 分支，隔帧生效这里就地生效）
    if (m.revertActionIndex) m.setTargetValue(m.startValue);
    if (action) m.triggerAction();
    // 回绕即一轮完成：slot11 收尾松开拖拽（DD:461-467，非回绕推进不调）
    if (idx === at.action_list.length) stopDragIfApply(m);
  } else if (at.action != null) {
    // action 分支（可为随机数组）；空串动作走编排器的"空触发"路径
    action = m.filterAction(at.action);
    m.triggerAction();
    stopDragIfApply(m);
  } else {
    // 无 action 无 action_list（circle/target 纯开关机）：游戏同样过一遍 triggerAction，但立即清掉单触发标记（isTriggerAtion 不滞留）
    m.triggerAction();
    m.isTriggerAtion = false;
    stopDragIfApply(m);
  }
  // 重复 idle 豁免：目标 idle 与当前相同且未开 repeat_flag 时整个触发跳过（菜单已摊开时再点摊开区无效，游戏 onEventCallback 的前置检查）；返回 false 告知点击层豁免（游戏在回调打包前 return，DRAG_CLICK 通知一并消失）
  if (activeData?.idle != null) {
    const idle = activeData.idle;
    const same =
      typeof idle === "number"
        ? idle === m.orch.idleIndex
        : Array.isArray(idle) &&
          idle.length === 1 &&
          idle[0] === m.orch.idleIndex;
    if (same && !activeData.repeat_flag) {
      // debug 读数：触发链关键步，debugHook 接线见 l2d/mount/index.js
      m.orch.debug?.(
        `${m.parameterName} 重复idle豁免(目标${idle}==当前${m.orch.idleIndex})触发跳过`,
      );
      return false;
    }
  }
  // circle + target：点击把参数设到 target；已在 target 则回 startValue（0↔1 图层切换的机制）
  let target = at.target ?? null;
  if (at.circle != null && target != null && target === m.parameterTargetValue) {
    target = m.startValue;
  }
  if (target != null) {
    m.setTargetValue(target);
    if (at.target_focus === 1) m.setParameterValue(target); // 跳变，不过平滑
  }
  if (at.focus === 1) m.isTriggerAtion = false;
  // 播放与否决定 activeData 是否应用（游戏 playAction 失败即不应用）
  await m.orch.onActionApply(m, action, activeData);
  return true;
}

export function filterAction(m, action) {
  return Array.isArray(action)
    ? action[Math.floor(Math.random() * action.length)]
    : action;
}

/** 联动层（游戏 live2ddrag.lua onListenerEvent）：编排器把事件扇给全部机器，这里分两段——
 * ① 冷却副作用（onListenerTrigger DD:205-215）：DRAG_CLICK 时 click_cd 名单含被点分区者自封 limitTime 冷却；PLAY 的 min(limitTime,0.2) 塌缩在编排器 noteMotionStart 统一收口（覆盖非机器路径），不在此重复。DOWN/XY_TRIGGER/DRAG_TRIGGER 无 click_cd 分支。
 * ② listenerType 匹配的机器才继续：change 名单按事件类型取校验名（PLAY=动作名 / DRAG_CLICK=被点分区名 getCommonNoticeData().draw_able_name / CHANGE_IDLE=变体号，区分大小写与数字/字符串）做 contains 命中 → kind 1 相对增量（target += value）、kind 2 绝对赋值（target = value；数据定案：kind1 全是 ±Δ 计数/充能条，kind2 是分区→档位阶梯与置位/清零对），过 fixTarget 钳制；命中即复位连点下标（第 4 元缺省 1——配置从未写过第 4 元，缺省复位是真实副作用）。
 * change_focus=false 的暂存分支配置零使用，未移植。
 * ③ apply 段（kind 1 全库仅 20703701 用）：target 落进区间 [low,high) → 整包 {idle, activeData} 交编排器 applyActiveData（游戏 EVENT_CHANGE_IDLE_INDEX 处理器），idle_enable/idle_ignore 按该变体取名单后再切 idle。多区间命中取最后一条、目标 idle 与当前变体相同时整个事件不发（enable/ignore 一并跳过，DD:183-193）。
 */
export function onListenerEvent(m, type, data) {
  if (
    type === 2 &&
    Array.isArray(m.actionTrigger?.click_cd) &&
    m.actionTrigger.click_cd.includes(data.draw_able_name)
  ) {
    m.nextTriggerTime = m.limitTime;
  }
  const ld = m.listenerData;
  if (!ld || ld.type !== type) return;
  const checkName =
    type === 1
      ? data.action
      : type === 2
        ? data.draw_able_name
        : type === 3
          ? data.idle
          : undefined;
  if (checkName == null) return;
  let changed = false;
  for (const ch of ld.change ?? []) {
    if (!Array.isArray(ch?.[1]) || !ch[1].includes(checkName)) continue;
    m.setTargetValue(
      m.fixTarget(ch[0] === 1 ? m.parameterTargetValue + ch[2] : ch[2]),
    );
    changed = true;
    const listIndex = ch.length >= 4 ? ch[3] : 1;
    if (listIndex > 0) m.actionListIndex = listIndex;
    // debug 读数：触发链关键步，debugHook 接线见 l2d/mount/index.js
    m.orch.debug?.(
      `${m.parameterName} 联动 type${type} 命中[${checkName}] kind${ch[0]} ${ch[2]} → target ${m.parameterTargetValue}`,
    );
  }
  if (!changed) return;
  const apply = ld.apply;
  if (!Array.isArray(apply) || apply[0] !== 1) return;
  // 多区间命中取最后一条（DD:187-191 循环覆写不 break）；目标 idle 与当前变体相同时整个 EVENT_CHANGE_IDLE_INDEX 不发——enable/ignore 落账一并跳过（DD:193 守卫），不是"切了没效果"而是"根本没切"
  let hit = null;
  for (const range of apply[1] ?? []) {
    const [low, high, idle] = range;
    if (m.parameterTargetValue >= low && m.parameterTargetValue < high)
      hit = idle;
  }
  if (hit != null && hit !== m.orch.idleIndex) {
    m.orch.debug?.(`${m.parameterName} 联动 apply 命中 → idle ${hit}`);
    m.orch.applyActiveData(m.id, m.actionTriggerActive, true, hit);
  }
}

/** 触发冷却启动（游戏 triggerAction） */
export function triggerAction(m) {
  m.nextTriggerTime = m.limitTime;
  m.isTriggerAtion = true;
}

/** type 12 扩展门裁决（游戏 checkActionInExtendFlag DD:1281-1314，由控制层 checkEnablePlay CT:176-188 在白/黑名单之前查询）：返回 'block' 拦截 / 'pass' 直通（越过白/黑名单与按压锁——锁以白名单实现，直通同样越过）/ null 不表态。
 * 参数值按名查他机 parameterValue（EVENT_GET_DRAG_PARAMETER CT:347-358：后注册者胜出、缺省 0；不是模型实时值也不是 targetValue）；区间左开右闭 (num[0], num[1]]。
 * 名单取本机 actionTriggerActive.ignore/.enable（bake 空表 {} 经 Array.isArray 判假即不含动作），同命中时 ignore 优先（CT:181-185 if/elseif 顺序）。 */
export function checkActionInExtend(m, actionName) {
  if (!m.extendActionFlag) return null;
  const num = m.actionTrigger.num;
  if (!Array.isArray(num) || num.length < 2) return null;
  const v = m.orch.readDragParameter(m.actionTrigger.parameter);
  if (!(num[0] < v && v <= num[1])) return null;
  const ad = m.actionTriggerActive;
  if (Array.isArray(ad?.ignore) && ad.ignore.includes(actionName))
    return "block";
  if (Array.isArray(ad?.enable) && ad.enable.includes(actionName))
    return "pass";
  return null;
}
