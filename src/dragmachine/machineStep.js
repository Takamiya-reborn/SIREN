/** 每帧步进与查询（游戏 stepParameter / updateRelationValue / updateStateData / saveData）：自由函数风格，首参 m = DragMachine 实例（委托接线见 machine.js）。 */
import { TRIGGER_HANDLERS } from "./triggers.js";
import { CLICK_CONFIRM, VALUE_EPS, SMOOTH_RATE, smoothDamp } from "./math.js";

/** 每帧步进（游戏 stepParameter 的 updateParameterValue + checkReset + 触发调度） */
export function step(m, dt, now, playing, playActionName) {
  m.l2dIsPlaying = playing;
  m.l2dPlayActionName = playActionName;
  if (m.isTriggerAtion && !playing) m.isTriggerAtion = false;
  const able = m.triggerAble(dt);
  // 点击确认窗口：到期且不在冷却中才触发，过窗（>0.1s）作废（游戏里 checkClickAction 在 updateTrigger 内、受 isActionTriggerAble 前置过滤）
  if (m.clickTriggerTime != null && now >= m.clickTriggerTime) {
    if (able && now - m.clickTriggerTime <= CLICK_CONFIRM)
      m.applyClickTrigger();
    else {
      m.clickTriggerTime = null;
      m.orch.pressLock(`确认窗作废 ${m.parameterName}`, false);
      // debug 读数：触发链关键步，debugHook 接线见 l2d/mount/index.js
      m.orch.debug?.(
        `${m.parameterName} 确认窗口作废(${able ? "过窗" : `冷却中${m.nextTriggerTime.toFixed(2)}s`})`,
      );
    }
  }
  if (able && m.actionTrigger) {
    const handler = TRIGGER_HANDLERS[m.actionTrigger.type];
    if (handler) handler(m, now, dt);
    else if (
      !m.warned &&
      m.actionTrigger.type !== 2 &&
      m.actionTrigger.type !== 6 &&
      m.actionTrigger.type !== 9 &&
      m.actionTrigger.type !== 11 &&
      // 15 下棋：点击型，入口在 applyClickTrigger（棋局控制在 orchestrator.xiaqiClick）——无 step 处理器是设计使然，不告警
      m.actionTrigger.type !== 15
    ) {
      m.warned = true;
      console.warn(
        `[l2d] ship_l2d ${m.id}（${m.drawAbleName}）触发类型 ${m.actionTrigger.type} 未实现，已忽略`,
      );
    }
  }
  // 回弹倒计时：归零回 startValue 并复位拖拽基准（游戏 checkReset）
  if (m.parameterToStart != null && !m._active) {
    m.parameterToStart -= dt;
    if (m.parameterToStart <= 0) {
      m.parameterToStart = null;
      m.setTargetValue(m.startValue);
      m.offsetDragX = m.offsetDragTargetX = m.startValue;
      m.offsetDragY = m.offsetDragTargetY = m.startValue;
    }
  }
  // 拖拽落 target（游戏 updateDrag DD:688）：按住期间每 tick 用当前拖动量重设目标并重启平滑进度——位置不变也重启（start 与 target 重合，参数一步贴合）；Y 优先（原文 slot1 先后被 offsetX/Y 赋值，后者胜）
  if (m._active && (m.offsetX || m.offsetY)) {
    if (m.offsetY) m.setTargetValue(m.fixTarget(m.offsetDragY));
    else m.setTargetValue(m.fixTarget(m.offsetDragX));
  }
  // 落子延迟闸（游戏 updateParameterValue DD:804-813）：delayTargetTime 期间冻结参数平滑——先减后判，到期当帧恢复平滑；回弹/拖拽落 target/联动照常
  let delayFrozen = false;
  if (m.delayTargetTime != null) {
    m.delayTargetTime -= dt;
    if (m.delayTargetTime <= 0) m.delayTargetTime = null;
    else delayFrozen = true;
  }
  // 平滑趋近目标（游戏 updateParameterValue + Live2DExtend.CustomSmoothValue）：进度按 SMOOTH_RATE×dt 推进，复刻 fixedDeltaTime×30Hz 的 1.67× 时长拉伸
  if (!delayFrozen && m.parameterValue !== m.parameterTargetValue) {
    if (Math.abs(m.parameterValue - m.parameterTargetValue) < VALUE_EPS) {
      m.setParameterValue(m.parameterTargetValue);
    } else if (m.parameterSmoothTime > 0) {
      m.parameterSmooth = Math.min(
        m.parameterSmooth + SMOOTH_RATE * dt,
        m.parameterSmoothTime,
      );
      m.setParameterValue(
        m.parameterStartValue +
          (m.parameterTargetValue - m.parameterStartValue) *
            (m.parameterSmooth / m.parameterSmoothTime),
      );
    } else {
      m.setParameterValue(m.parameterTargetValue);
    }
  }
  updateRelations(m, dt);
}

/** relation 联动参数逐帧求值（游戏 updateRelationValue）：type 101/102 跟随拖动量 offsetDragX/Y（按下拖动才有新值，松手后保持最后落点）、103 跟随连点下标查 relation_value、其余类型跟随机器参数目标值但恒不可写。
 * 目标值经 relation 自带修正项（缺省回落机器）钳制：有 target 直写；贴近（±0.01）直接吸附；否则 SmoothDamp 平滑（smooth 缺省回落机器 smooth）。 */
export function updateRelations(m, dt) {
  for (const r of m.relations) {
    let raw;
    let enable;
    if (r.type === 101) {
      raw = m.offsetDragX ?? r.start ?? m.startValue;
      enable = true;
    } else if (r.type === 102) {
      raw = m.offsetDragY ?? r.start ?? m.startValue;
      enable = true;
    } else if (r.type === 103) {
      // 游戏是 Lua 1-based 表 relation_value[actionListIndex]（live2ddrag.lua updateRelationValue），JS 数组要 -1 对齐，否则初始就取到第二档、开关整体反相（shengluyisi_5 的 touch_drag20/21 图层开关）
      raw = r.relationValue?.[m.actionListIndex - 1] ?? 0;
      enable = true;
    } else {
      raw = m.parameterTargetValue;
      enable = false;
      if (!r.warned) {
        r.warned = true;
        console.warn(
          `[l2d] ship_l2d ${m.id}（${m.drawAbleName}）relation 类型 ${r.type} 未实现，已忽略`,
        );
      }
    }
    r.enable = enable;
    if (!enable) continue;
    const fixed = m.fixRelation(r, raw);
    if (r.target != null) {
      r.value = r.target;
      r.velocity = 0;
    } else if (Math.abs(fixed - r.value) <= 0.01) {
      r.value = fixed;
      r.velocity = 0;
    } else {
      [r.value, r.velocity] = smoothDamp(
        r.value,
        fixed,
        r.velocity,
        r.smooth ?? m.smooth,
        dt,
      );
    }
  }
}

/** idle 变体切换回调（编排器 changeIdleIndex 里广播）：变体切到 revert_idle_index 名单内时参数与拖拽基准整体复位（游戏 updateStateData 的 revertIdleIndex 分支） */
export function onIdleChanged(m, n) {
  const r = m.revertIdleIndex;
  if (!(r === true || (Array.isArray(r) && r.includes(n)))) return;
  m.setTargetValue(m.startValue);
  m.offsetDragX = m.offsetDragTargetX = m.startValue;
  m.offsetDragY = m.offsetDragTargetY = m.startValue;
}

/** 持久化（游戏 saveData：revert=-1 且未禁用时存目标值；type 6 另存连点下标） */
export function saveData(m) {
  if (m.revert === -1 && m.saveParameterFlag) {
    m.orch.saveValue(String(m.id), m.parameterTargetValue);
  }
  if (m.actionTrigger?.type === 6) {
    m.orch.saveValue(`${m.id}__listIndex`, m.actionListIndex);
  }
}

/** HUD 读数用：当前状态下命中本分区是否会有响应。纯查询（不推进冷却、不改状态），供交互点提示按真实路由着色——机器分区不走 interaction.json 的参数门控，红绿必须按机器自己的触发条件判定。
 * 返回 true 可交互 / false 被冷却·单触发·播放中·重复 idle 豁免·点参档位挡下 / null 触发类型未实现。 */
export function interactable(m) {
  const at = m.actionTrigger;
  if (!at?.type) return true; // 纯拖拽机：按住即响应
  // 按住型（1 拖拽邻域计时 / 3 长按播表 / 4 双轴邻域 / 8 充能）：不冷却不单触发滞留即可响应——type 1 的邻域门槛靠拖拽达成，按压本身恒可发起
  if (at.type === 1 || at.type === 3 || at.type === 4 || at.type === 8) {
    return !(m.nextTriggerTime > 0 || m.isTriggerAtion);
  }
  if (
    at.type !== 2 &&
    at.type !== 6 &&
    at.type !== 9 &&
    at.type !== 11 &&
    at.type !== 15
  ) {
    // type 10 动作链是纯自动触发（idle 变体过点联动播），不构成用户可点判定——按"被挡"参与分区聚合，不当未实现计橙
    if (at.type === 10) return false;
    return null;
  }
  // 15 下棋格属点击型（本机无 action，占用态着色由编排器限频/回合元信息补充，最小版不做）
  if (m.nextTriggerTime > 0 || m.isTriggerAtion) return false;
  // 反应播放中仅 focus=1 且播的正是本机动作时可点（checkClickAction 语义，数组 action 与游戏一致按不等处理）
  if (
    m.orch.isPlaying &&
    !(at.focus === 1 && m.orch.playActionName === at.action)
  ) {
    return false;
  }
  // type 9 点参：他参不贴近 num（±0.05）时白点（与 applyClickTrigger 同判据，读模型实时值）
  if (at.type === 9) {
    const v = m.orch.readParameter(at.parameter ?? m.parameterName);
    if (v == null || Math.abs((at.num ?? 0) - v) > 0.05) return false;
  }
  // type 11 点区间：他参现值不在 num 区间时白点（与 applyClickTrigger 同判据）
  if (at.type === 11) {
    const item = Array.isArray(at.action_list)
      ? at.action_list[
          Math.min(Math.max(m.actionListIndex, 1), at.action_list.length) - 1
        ]
      : null;
    const num = at.num ?? item?.num;
    const v = m.orch.readParameter(at.parameter ?? m.parameterName);
    if (num == null || v == null || !(num[0] <= v && v < num[1]))
      return false;
  }
  // 重复 idle 豁免：目标 idle 与当前相同且未开 repeat_flag 时整个触发跳过
  const idle = m.actionTriggerActive?.idle;
  if (idle != null) {
    const same =
      typeof idle === "number"
        ? idle === m.orch.idleIndex
        : Array.isArray(idle) &&
          idle.length === 1 &&
          idle[0] === m.orch.idleIndex;
    if (same && !m.actionTriggerActive.repeat_flag) return false;
  }
  return true;
}
