/** 动作播放路由（游戏 applyActiveData / changeIdleIndex / 播放状态回报）：自由函数风格，首参 o = DragOrchestrator 实例（委托接线见 orchestrator.js）。 */

/** action='idle' 的变体选支（游戏 applyActiveData idle 段同款规则，live2d.lua CT:1166-1182）：数字直取（负数视为未配置）、数组按 repeat_flag 剔除当前变体后随机。返回 number | null */
export function pickIdleVariant(o, activeData) {
  const idle = activeData.idle;
  if (typeof idle === "number") return idle >= 0 ? idle : null;
  if (Array.isArray(idle) && idle.length) {
    const pool = activeData.repeat_flag
      ? idle
      : idle.filter((n) => n !== o.idleIndex);
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }
  return null;
}

/** 机器触发 -> 播放动作。action 非空且真的播出去（存在 + 白名单放行 + 引擎接受）才应用 activeData；action 为空则直接应用（游戏"空触发"分支）。 */
export async function onActionApply(o, machine, action, activeData) {
  if (action) {
    // action='idle' 先切变体后播：游戏里 play("idle") 的 SetAction 与 applyActiveData 的 SetInteger("idle",n) 同帧落账（live2d.lua CT:286-291），Animator 下一帧才评估迁移——实际播出的就是 activeData 指向的新变体子状态，且游戏播放器（整数迁移）不存在"重播正在循环的同支 idle"这回事，恒成功
    // 移植端 playLuaAction 重播在循环的同支会被引擎 MotionState.reserve 以 "Motion is already playing" 拒绝（播放失败 → activeData 不入账）
    // 先落账变体再播，playLuaAction 按 idleClipFor(新变体) 解析出新 clip；游戏对 idle_focus=1 的空动作机同款先切后播先例（CT:280-284）
    // 选支只做一次并带给 applyActiveData——数组 idle 的两次随机不得各选各的；新旧变体解析出同一 clip 时预切无意义（引擎照样拒绝同支），维持原序
    let picked;
    if (
      action === "idle" &&
      activeData?.idle != null &&
      o.model.internalModel.settings?.motions?.idle
    ) {
      const variant = pickIdleVariant(o, activeData);
      if (
        variant != null &&
        variant !== o.idleIndex &&
        o.idleClipFor(variant) !== o.idleClipFor(o.idleIndex)
      ) {
        picked = variant;
        o.changeIdleIndex(variant);
      }
    }
    // playAction 返回引擎的真实播放结果（async）：拒播时 activeData 不入账，否则 idle 变体号/白名单会记到一次没播出去的动作上
    // 先切路径的变体号是唯一例外——游戏侧该路径无失败形态（见上），变体先行落账与播出强绑定
    const played = await o.playAction(action);
    // debug 读数：触发链关键步，debugHook 接线见 l2d/mount/index.js
    o.debug?.(
      `${machine.parameterName} 触发 ${action}` +
        // type 10 的触发由 step 里归一化进度自动判定（DRAG_ANIMATION_PLAY），非点击路径
        (machine.actionTrigger?.type === 10 ? "[type10自动] " : "") +
        ` 播放${played ? "成功" : "失败"}` +
        (picked != null ? `(idle变体→${picked}已先切)` : "") +
        (Array.isArray(activeData?.enable)
          ? `,名单→${activeData.enable.length}项`
          : ",名单不变"),
    );
    if (played) {
      // 游戏在 checkEnablePlay 通过后、applyActiveData 之前发 PLAY 通知（live2d.lua:288）：type 1 监听机在此改 target/换挡
      o.notice(1, { action });
      // 下棋结算机清账（原文清在 apply 成功回调里，CT:330 回调实参恒 nil 死路径——按意图取"播出成功才清"，失败保留下帧由 type16 处理器重试）
      if (machine.actionTrigger?.type === 16) o.xiaqiResult = null;
      if (picked != null)
        o.applyActiveData(machine.id, activeData, true, null, picked);
      else o.applyActiveData(machine.id, activeData, true);
    }
  } else {
    o.applyActiveData(machine.id, activeData, true);
  }
}

/** 应用 activeData：白/黑名单 + idle 变体切换（游戏 applyActiveData）。
 * @param payloadIdle 事件负载里的 idle（联动层 EVENT_CHANGE_IDLE_INDEX 的负载值）：activeData.idle 缺省时回落到它（游戏 slot7 = activeData.idle or payload.idle）；idle_enable/idle_ignore 按这个变体号取对应名单
 * @param pickedIdle action='idle' 先切后播路径已选定的变体（onActionApply 挑好的那只）：数组 idle 不再重挑（两次随机会各选各的）、数字 idle 不再重复 changeIdleIndex（变体已落账，重复发 CHANGE_IDLE 通知是噪音）；仅在先切真正发生过时才传
 */
export function applyActiveData(o, machineId, activeData, save, payloadIdle = null, pickedIdle) {
  if (!activeData) return;
  // Lua 空表经 bake 序列化成 {} 而非 []：enable/ignore 是序列名单，空表 = 清空白/黑名单，游戏 setEnableActions({}) 照常落账——只认 isArray 会把收尾变体（touch_idle3/5/7/9 的 enable={}）的清空动作整个吞掉，白名单永久滞留在 touch_idle 链的 48 项上
  const asList = (v) =>
    Array.isArray(v)
      ? v
      : v && typeof v === "object"
        ? Object.values(v)
        : null;
  // 目标变体号（原始值）：idle_enable/idle_ignore 的按变体匹配用它——数组 idle（随机挑选）在游戏里跟数字变体号永远不相等，等价于不生效，原样保留这个语义
  const rawIdle = activeData.idle ?? payloadIdle;
  let idle = rawIdle;
  const enable = asList(activeData.enable);
  if (enable) {
    o.enablePlayActions = enable;
    // 落账机器追踪（HUD 读数）：白名单与 idle 由同一台机的 activeData 写入，HUD 直接点名最近写入方
    o.activeOwner = machineId;
  } else if (Array.isArray(activeData.idle_enable)) {
    // 按变体号取白名单（游戏 idle_enable 分支）：[[变体号,名单],...] 中匹配目标变体的那条生效；enable 在场时本分支整个不走（游戏 if/elseif）
    for (const [variant, list] of activeData.idle_enable) {
      if (variant === rawIdle) {
        o.enablePlayActions = asList(list) ?? [];
        o.activeOwner = machineId;
      }
    }
  }
  const ignore = asList(activeData.ignore);
  if (ignore) o.ignorePlayActions = ignore;
  else if (Array.isArray(activeData.idle_ignore)) {
    for (const [variant, list] of activeData.idle_ignore) {
      if (variant === rawIdle) o.ignorePlayActions = asList(list) ?? [];
    }
  }
  if (Array.isArray(idle) && idle.length) {
    // 数组 idle：随机挑一个；不开 repeat_flag 时剔除当前值（游戏 applyActiveData）。先切路径已选定 pickedIdle 时不重挑
    if (pickedIdle !== undefined) idle = pickedIdle;
    else {
      const pool = activeData.repeat_flag
        ? idle
        : idle.filter((n) => n !== o.idleIndex);
      idle = pool.length
        ? pool[Math.floor(Math.random() * pool.length)]
        : null;
    }
  } else if (pickedIdle !== undefined) {
    // 数字 idle 已在播放前落账（先切后播），重复 changeIdleIndex 只会重发 CHANGE_IDLE 通知
    idle = null;
  }
  if (idle != null && typeof idle === "number") {
    // 无 idleIndex 相等守卫：原文 CT:1159 的守卫比较的是恒 nil 的 indexIndex（反编译笔误），条件恒真——同值也走 changeIdleIndex（同值时广播照发、机器不复位，见 changeIdleIndex）
    o.changeIdleIndex(idle, save);
    if (save) o.saveValue("__action", machineId);
  }
}

export function changeIdleIndex(o, n, save = true) {
  const changed = o.idleIndex !== n;
  o.idleIndex = n;
  // 变体切换广播给机器：revert_idle_index 名单内的机器整体复位（游戏 updateStateData 的 revertIdleIndex 分支）。复位整体在 `l2dIdleIndex ~= idleIndex` 守卫内（DD:1355）——同值广播不复位
  if (changed) for (const m of o.machines) m.onIdleChanged(n);
  // CHANGE_IDLE 通知（游戏 changeIdleIndex 的 onListenerHandle）无条件发（CT:1206-1224，同值也发，idle_change 标志监听机不消费）：type 3 监听机同值也按变体号改 target
  o.notice(3, { idle: n });
  if (save) {
    o.saveValue("__idle", n);
    if (n === 0) o.saveValue("__action", 0);
  }
}

/** idle 变体号 -> 组内 clip 名（bake 产物 idle_index 表；未收录按基础 idle） */
export function idleClipFor(o, index) {
  return o.idleIndexMap[index] ?? o.idleIndexMap[0] ?? "idle";
}

// ---- 播放状态回报（L2dStage 挂到 motionManager 事件上）----

/** @param clipName 起播的 clip 名
 * @param idle 是否 idle 组（idle 是循环氛围动作，库内循环动作永不 isFinished、不产生 motionFinish，不能占用"反应动作播放中"状态——否则 isPlaying 永久滞留 true，点击触发恒被拦）
 */
export function noteMotionStart(o, clipName, idle = false) {
  // 被顶掉的旧反应动作不会再发 motionFinish（库只在动作队列排空且 playing 仍真时发一次 finish，FORCE 起播杀掉旧队列条目是无声的）：新动作起播即宣告旧反应终局，先清滞留的播放中
  // 否则长按姿势播放中松手、收尾切 idle 的场合 isPlaying 永久滞留真值，全机 ignore_action 拒按 + 触发处理器 l2dIsPlaying 早退，交互整体锁死
  o.isPlaying = false;
  o.playActionName = "";
  o.playingClip = clipName;
  o.playStartAt = performance.now() / 1000;
  // 最近一次起播是否 idle 组：noteMotionFinish 判定"反应动作播完"用（库的 motionFinish 事件不带 group 参数，只能在这里记）
  o._lastStartIdle = idle;
  if (!idle) {
    o.isPlaying = true;
    o.playActionName = clipName;
  }
  // 动作起播后机器进短冷却（游戏 onListenerTrigger ON_ACTION_PLAY，DD:211）：游戏是无条件覆写 nextTriggerTime = min(limitTime, 0.2)，且广播源 CT:288 对一切播出成功生效——含 idle（挂载起播、FinishAction 尾部 changeActionIdle 收尾重播、变体切换重播）
  // 触发时先设的 limitTime（默认 4s）冷却会被真正播出的动作塌缩回 0.2s，只在"触发被重复 idle 豁免/播放失败"等不产出 ON_ACTION_PLAY 的场合才足额生效
  // pixi 的 motionStart 只在动作启动时发、循环不重发
  for (const m of o.machines) {
    m.nextTriggerTime = Math.min(m.limitTime, 0.2);
  }
}

export function noteMotionFinish(o) {
  const wasPlaying = o.isPlaying;
  const name = o.playActionName;
  const idle = o._lastStartIdle;
  o.isPlaying = false;
  o.playActionName = "";
  o.playingClip = "";
  // 游戏 FinishAction 处理器（live2d.lua:666）尾部的 changeActionIdle：反应动作播完**显式** force 重播 "idle"——游戏没有"引擎随机回落"这回事，Unity Animator 由 "idle" 整数参数原子地选变体子状态；这里等价于 playLuaAction('idle')（组名路由会按 idleClipFor(idleIndex) 解析变体下标）
  // 引擎的 startRandomMotion 回落补丁只作兜底，变体选支以这条游戏本体的显式路径为准
  if (wasPlaying && name && !idle) o.playAction?.("idle");
}
