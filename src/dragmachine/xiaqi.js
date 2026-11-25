/** 下棋小游戏（type 15/16；live2d.lua EVENT_GAME_XIAQI:359-398 + live2dextend.lua XiaQi 系列）：自由函数风格，首参 o = DragOrchestrator 实例（委托接线见 orchestrator.js）。
 * 点击入口 = machineTrigger.applyClickTrigger 的 type15 分支（不走 applyTrigger/不发 DRAG_CLICK 通知）；结果机在 triggers.js type16（清账在 playRoute.onActionApply 的 played 分支）。
 * 棋盘：全部 type 15 机即九宫格，actionTrigger.index 1..9（suweiaitongmeng_3 = TouchDrag14..22 / a1..c3），子的状态记在参数 target 上：0 空 / +1 玩家 / -1 角色。流程：全局 1s 限频（无效点击同样消耗窗口）→ 玩家回合（CheckXiaQiFirst：玩家子数 ≤ AI 子数）且格现值 ==0 落 +1 → 查终局，终局 0.5s 延迟写 result 并 return → AI 应手（CheckXiaQiLast：AI 子数 < 玩家子数）空格随机 setTargetValueDelay(-1, 0.2)（target 立即入账，终局判定立刻可见）→ 再查终局。终局锁盘 = 限频 + 计数关系（终局后 CheckXiaQiFirst 恒假）+ 终局重写 result 三条合成，无显式 game-over 态。清盘走 listener_data（touch_idle8/10 播出时全格归 0，联动层既有行为）+ resetAll。 */

/** 井字棋八连线表（live2dextend.lua 顶部：3 横 3 纵 2 斜，格号 1..9） */
export const XIAQI_LINES = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  [1, 4, 7],
  [2, 5, 8],
  [3, 6, 9],
  [1, 5, 9],
  [3, 5, 7],
];

export function xiaqiCells(o) {
  if (!o._xiaqiCells)
    o._xiaqiCells = o.machines.filter((m) => m.actionTrigger?.type === 15);
  return o._xiaqiCells;
}

/** 终局判定（游戏 CheckXiaQiFinish）：任一连线 target 全 1 = [true,true]、全 -1 = [true,false]；满盘（按 target 数子，AI 应手子立即计入）= 平局 [true,true] */
export function xiaqiCheckFinish(o, cells) {
  const mine = [];
  const theirs = [];
  let p = 0;
  let a = 0;
  for (const c of cells) {
    const t = c.parameterTargetValue;
    if (t > 0) p++;
    else if (t < 0) a++;
    if (t === 1) mine.push(c.actionTrigger.index);
    else if (t === -1) theirs.push(c.actionTrigger.index);
  }
  for (const line of XIAQI_LINES) {
    const win = line.every((i) => mine.includes(i));
    const lose = line.every((i) => theirs.includes(i));
    if (win || lose) return [true, win];
  }
  if (p + a >= 9) return [true, true];
  return [false, false];
}

/** 终局 0.5s 延迟写账的暂存（游戏 onDelayTick）：倒计时在 step 里帧驱动，不用 setTimeout——页签隐藏/模型卸载后不跨会话残留，单测以 step(dt) 驱动 */
export function xiaqiSchedule(o, win) {
  o.xiaqiResultDelay = 0.5;
  o.xiaqiPendingWin = win;
}

/** type 15 点击入口（限频戳用 performance 单调钟，对齐游戏 Time.realtimeSinceStartup） */
export function xiaqiClick(o, cell) {
  const now = performance.now() / 1000;
  if (o.xiaqiLimitTime != null && now - o.xiaqiLimitTime <= 1) return;
  o.xiaqiLimitTime = now;
  const cells = xiaqiCells(o);
  let p = 0;
  let a = 0;
  for (const c of cells) {
    if (c.parameterTargetValue > 0) p++;
    else if (c.parameterTargetValue < 0) a++;
  }
  // 玩家回合且点击的是空格（空格判定用现值 parameterValue——EVENT_GAME_XIAQI 载荷语义）
  if (p <= a && cell.parameterValue === 0) cell.setTargetValue(1);
  let [done, win] = xiaqiCheckFinish(o, cells);
  if (done) {
    xiaqiSchedule(o, win);
    return;
  }
  // AI 应手（CheckXiaQiLast 按落子后的新鲜计数，游戏 GetXiaQiState 每次现查）：空格随机落 -1，显形延迟 0.2s；原文空表会 math.random(1,0) 抛错（满盘先被终局分支拦住，实践不可达），移植取判空防御
  p = 0;
  a = 0;
  for (const c of cells) {
    if (c.parameterTargetValue > 0) p++;
    else if (c.parameterTargetValue < 0) a++;
  }
  if (a < p) {
    const empty = cells.filter((c) => c.parameterTargetValue === 0);
    if (empty.length)
      empty[Math.floor(Math.random() * empty.length)].setTargetValueDelay(
        -1,
        0.2,
      );
  }
  [done, win] = xiaqiCheckFinish(o, cells);
  if (done) xiaqiSchedule(o, win);
}
