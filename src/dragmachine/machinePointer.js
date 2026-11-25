/** 指针事件（游戏 startDrag / onDrag / stopDrag / pointercancel）：自由函数风格，首参 m = DragMachine 实例（委托接线见 machine.js）。 */
import { CLICK_RADIUS, CLICK_TIME, CLICK_CONFIRM } from "./math.js";

export function onDown(m, pos, playing) {
  if (m.ignoreAction && playing) {
    // debug 读数：触发链关键步，debugHook 接线见 l2d/mount/index.js
    m.orch.debug?.(`${m.drawAbleName} 播放中拒按(ignore_action=1)`);
    return;
  }
  if (m._active) return;
  m._active = true;
  m._downPos = pos;
  m._downTime = performance.now() / 1000;
  m.triggerActionTime = 0;
  // 连点下标只在 type 3（DRAG_DOWN_ACTION）按下时重置（游戏 startDrag 的 uv0 表只含该类型；type 6 的下标跨按压持续推进）
  if (m.actionTrigger?.type === 3) m.actionListIndex = 1;
  m.parameterSmoothTime = m.smooth;
  // 按压锁：原文只有无 down 配置的点击型在 checkClickAction firstActive 上锁（DD:1408-1410）；down 配置型按下即触发不上锁，type 3/8 的锁在各自 handler 分支里
  // 锁时机比原文（下一帧 updateTrigger）提前到按下同步，语义等价——本移植 onDown 没有 updateTrigger 帧
  const atDown = m.actionTrigger;
  if (
    atDown &&
    (atDown.type === 2 ||
      atDown.type === 6 ||
      atDown.type === 9 ||
      atDown.type === 11 ||
      atDown.type === 15) &&
    !atDown.down
  ) {
    m.orch.pressLock(`按下 ${m.drawAbleName}`, true);
  }
  // down 型触发：按下即排程（游戏 checkClickAction 的 firstActive 分支）
  if (m.actionTrigger?.down && (m.actionTrigger.focus === 1 || !playing)) {
    m.clickTriggerTime = performance.now() / 1000;
  }
}

export function onMove(m, pos) {
  if (!m._active) return;
  // 只累加拖动量不落 target——落 target 在 step 每 tick 做（游戏 updateDrag 与 onDrag 分离）
  if (m.offsetX) {
    m.offsetDragX =
      m.offsetDragTargetX + (pos.x - m._downPos.x) / m.offsetX;
  }
  if (m.offsetY) {
    // 游戏用 Unity 屏幕坐标（y 向上），浏览器 y 向下——y 分量取反，否则 offset_y 型机器方向镜像（drag_direct 闸门会把"展开方向"的拖动整个钳死）
    m.offsetDragY =
      m.offsetDragTargetY + (m._downPos.y - pos.y) / m.offsetY;
  }
}

/** 松手收尾的基准落账（游戏 stopDrag）：把本次拖到的值经 fix 后写成 offsetDragTarget——下次按住拖动从这里继续累加，滚动条手感就靠它 */
export function commitDragBase(m) {
  m.offsetDragTargetX = m.fixTarget(m.offsetDragX);
  m.offsetDragTargetY = m.fixTarget(m.offsetDragY);
}

export function onUp(m, pos) {
  if (!m._active) return;
  m._active = false;
  // 回弹：revert>0 启动倒计时，平滑时间换 revert_smooth
  if (m.revert > 0) {
    m.parameterToStart = m.revert;
    m.parameterSmoothTime = m.smoothRevert;
  }
  const now = performance.now() / 1000;
  m._upPos = pos;
  const dx = Math.abs(pos.x - m._downPos.x) < CLICK_RADIUS;
  const dy = Math.abs(pos.y - m._downPos.y) < CLICK_RADIUS;
  const quick = now - m._downTime < CLICK_TIME;
  const at = m.actionTrigger;
  // 走 checkClickAction 点击判定的类型（2 点击 / 6 连点 / 9 点参 / 11 点区间 / 15 下棋格，DD:1249 同调 checkClickAction）；其余类型松手只收尾
  const clickJudged =
    at?.type === 2 ||
    at?.type === 6 ||
    at?.type === 9 ||
    at?.type === 11 ||
    at?.type === 15;
  // 反应动作播放中点击不触发；例外是 focus=1 且播的正是本机动作（游戏 checkClickAction：未播放恒可点，播放中仅上述例外）
  const clickAllowed = m.orch.isPlaying
    ? at?.focus === 1 && m.orch.playActionName === at.action
    : true;
  if (at?.down) {
    // down 型在按下时已排程，松手只收尾
  } else if (clickJudged && dx && dy && quick && clickAllowed) {
    // 松手判定成功，0.1s 后触发（游戏 clickTriggerTime）
    m.clickTriggerTime = now + CLICK_CONFIRM;
    // debug 读数：触发链关键步，debugHook 接线见 l2d/mount/index.js
    m.orch.debug?.(`${m.parameterName} 点击判定成功,0.1s后触发`);
  } else {
    m.orch.pressLock(`非点击松手 ${m.drawAbleName}`, false);
    if (clickJudged) {
      // debug 读数：触发链关键步，debugHook 接线见 l2d/mount/index.js
      m.orch.debug?.(
        `${m.parameterName} 非点击松手` +
          (!dx || !dy ? "(位移超30px)" : "") +
          (!quick ? "(按压超0.5s)" : "") +
          (!clickAllowed ? "(反应动作播放中)" : ""),
      );
    }
  }
  // type 3 + last：松手清冷却，让收尾分支（step 的非按住路径）立即可判（游戏 stopDrag -> checkResetTriggerTime 的 last 分支）
  if (at?.type === 3 && at.last) m.nextTriggerTime = 0;
  commitDragBase(m);
  updatePartsSnap(m);
  m.saveData();
}

/** 松手取消（pointercancel）：不构成点击，直接收尾 */
export function onCancel(m) {
  if (!m._active) return;
  m._active = false;
  if (m.revert > 0) {
    m.parameterToStart = m.revert;
    m.parameterSmoothTime = m.smoothRevert;
  }
  m.orch.pressLock(`取消 ${m.drawAbleName}`, false);
  commitDragBase(m);
  updatePartsSnap(m);
  m.saveData();
}

/** parts_data 档位吸附：松手时目标值贴到档位（游戏 updatePartsParameter）。只对有拖拽量（offset_x/y）或 type 8 充能的机器生效；type 决定候选档位方向：1/缺省=最近档位、2=只取 ≤ 当前值（充能落位）、3=只取 ≥ 当前值 */
export function updatePartsSnap(m) {
  if (!m.partsData) return;
  if (!(m.offsetX || m.offsetY || m.actionTrigger?.type === 8)) return;
  const value = m.parameterTargetValue;
  let best = null;
  let bestDist = null;
  m.partsData.forEach((part, i) => {
    if (m.partsDataType === 2 && part > value) return;
    if (m.partsDataType === 3 && part < value) return;
    const dist = Math.abs(value - part);
    if (best === null || dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  if (best === null) return;
  const snapped = m.partsData[best];
  m.offsetDragTargetX = snapped;
  m.offsetDragTargetY = snapped;
  if (snapped !== m.parameterTargetValue) m.setTargetValue(snapped);
}
