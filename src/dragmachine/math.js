/** 拖拽参数机的数学件与阈值常量：机器、relation 联动、触发链共用（消费方 machine.js 及 machine*.js） */

/** 游戏点击判定阈值（live2ddrag.lua checkClickAction）：位移 <30px 且时长 <0.5s */
export const CLICK_RADIUS = 30;
export const CLICK_TIME = 0.5;
/** 点击确认延迟：松手判定成功后 0.1s 才真正触发（游戏 clickTriggerTime） */
export const CLICK_CONFIRM = 0.1;
/** 数值吸附死区：与目标差 <0.05 直接贴合（游戏 updateParameterValue） */
export const VALUE_EPS = 0.05;
/** 平滑进度推进速率：游戏端 stepParameter 挂 30Hz 定时器，平滑进度每 tick 只走 Time.fixedDeltaTime(0.02s)（live2ddrag.lua DD:824），即每秒走 0.02×30=0.6——配置 100ms 的平滑实际耗时约 167ms，这就是拖拽阻尼感的来源。写成速率×dt 的形式使任意帧率下耗时一致；localStorage l2d_fixedDt 可覆盖 fixedDeltaTime 便于实机对照（Node 单测无 localStorage，须 typeof 守卫） */
export const SMOOTH_RATE =
  ((typeof localStorage !== "undefined" &&
    Number(localStorage.getItem("l2d_fixedDt"))) ||
    0.02) * 30;

/** Unity Mathf.SmoothDamp（maxSpeed 无穷）逐帧移植：relation_parameter 的联动参数用它平滑跟随拖动量，与线性 CustomSmoothValue 的手感不同——接近目标时先冲过再被阻尼拉回。vel 为速度状态（跨帧保持，存 relation 上）。 */
export function smoothDamp(current, target, vel, smoothTime, dt) {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const origTarget = target;
  let change = current - target;
  target = current - change;
  const temp = (vel + omega * change) * dt;
  vel = (vel - omega * temp) * exp;
  let output = target + (change + temp) * exp;
  if (origTarget - current > 0 === output > origTarget) {
    output = origTarget;
    vel = (output - origTarget) / dt;
  }
  return [output, vel];
}

/** 目标值修正（游戏 fixParameterTargetValue）：drag_direct 方向闸门 + range_abs 取绝对值 + range 钳制。机器与 relation 共用，参数各传 */
export function fixRange(v, range, rangeAbs, dragDirect) {
  if (v < 0 && dragDirect === 1) v = 0;
  else if (v > 0 && dragDirect === 2) v = 0;
  if (rangeAbs) v = Math.abs(v);
  if (v < range[0]) v = range[0];
  else if (range[1] < v) v = range[1];
  return v;
}
