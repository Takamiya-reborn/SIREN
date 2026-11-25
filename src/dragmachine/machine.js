/**
 * 单台拖拽参数机（游戏 Live2dDrag 类的 Web 还原）。模块级约定与触发类型总览见同目录 index.js 头注释；触发处理器表在 triggers.js。
 * 本文件是 DragMachine 壳：构造器 + 状态属主方法 + 状态变量契约表；触发链路在 machineTrigger.js、指针事件在 machinePointer.js、每帧步进与查询在 machineStep.js、数学件在 math.js——均为自由函数（首参传机器实例），方法在此一行委托，公开方法签名不变。
 * == 状态变量契约（属主 × 写入点 × 复位责任） ==（改任何状态前先查这张表：跨域残留类 bug 的根因几乎都是"绕过属主直改"或"漏了某条路径的复位"；行末标注原文依据，live2ddrag.lua = DD）
 * | 变量 | 写入点（复位责任见末列） | 复位时机 |
 * | _active | onDown 置真；onUp/onCancel/stopDragIfApply 置假 | reset |
 * | clickTriggerTime | onDown(down型)/onUp 判定成功置；applyClickTrigger/step 作废清 | reset |
 * | nextTriggerTime | triggerAction 置 limitTime；noteMotionStart 塌缩 0.2；type3+last（onUp/stopDragIfApply/checkResetTriggerTime）与 type3 松手清零 | step 递减 / reset |
 * | isTriggerAtion | triggerAction 置真；无 action 分支/focus=1/type3 下标≠1/step !playing 清——step 每帧 !playing 即清是刻意偏离（原文只在状态广播释放 DD:1389，播放失败会滞留到下次广播，移植版取更宽容语义，不改） | reset |
 * | parameterToStart | onUp/onCancel（revert>0）置；step 归零并回 startValue | reset |
 * | parameterSmoothTime | onDown=smooth；onUp/onCancel=smoothRevert；reset=smooth | reset（跨域残留防回归点） |
 * | actionListIndex | onDown(type3)/applyTrigger 推进回绕/onListenerEvent 命中/loadSaved | reset / clearData |
 * | triggerActionTime | onDown 归零；type 1/4 累加（触发不清零，防重发靠双闸 DD:246） | reset |
 * | extendActionFlag | type12 handler 置真（一次性） | reset |
 * | animationPlayApply | type10 handler 闩锁（state 命中触发后置真）；state 离开清 | reset |
 * | offsetDragX/Y/TargetX/Y | onMove 累加；step 每 tick 落 target（游戏 updateDrag）；commitDragBase 落账；updatePartsSnap 吸附覆盖；step(checkReset)/onIdleChanged/loadSaved/reset 回 startValue | 各自路径 + reset |
 * | parameterMoveTrigger/moveCheckStep/parameterMove/lastParameterMove | type 13 handler 闩锁/采样分频/采样基线 | step handler + reset |
 * | delayTargetTime | setTargetValueDelay 置；step 先减后判归零 | step + reset |
 * | relations[].value/velocity/enable | updateRelations 每帧 | reset |
 * 按压锁 machineAble 属主在编排器（orchestrator.pressLock），本文件禁止直改。
 */
import * as machineTrigger from "./machineTrigger.js";
import * as machinePointer from "./machinePointer.js";
import * as machineStep from "./machineStep.js";
import { fixRange } from "./math.js";

/** 单台参数机，对应一条 ship_l2d 条目（游戏 Live2dDrag 类） */
export class DragMachine {
  constructor(entry, orch) {
    this.orch = orch;
    this.id = entry.id;
    this.drawAbleName = entry.draw_able_name || "";
    this.parameterName = entry.parameter;
    this.mode = entry.mode && entry.mode !== 0 ? entry.mode : 1;
    this.startValue = entry.start_value || 0;
    this.range = Array.isArray(entry.range) ? entry.range : [0, 0];
    // offset = 拖动 1 单位参数所需像素数；0 视为无拖拽
    this.offsetX = entry.offset_x || 0;
    this.offsetY = entry.offset_y || 0;
    // 单位归一：配置值 ÷1000 = 秒
    this.smooth = (entry.smooth || 0) / 1000;
    this.smoothRevert = (entry.revert_smooth || 0) / 1000;
    this.revert = entry.revert === -1 ? -1 : (entry.revert || 0) / 1000;
    this.ignoreReact = entry.ignore_react === 1;
    this.ignoreAction = entry.ignore_action === 1;
    this.dragDirect = entry.drag_direct || 0;
    this.rangeAbs = entry.range_abs === 1;
    this.partsData = Array.isArray(entry.parts_data?.parts)
      ? entry.parts_data.parts
      : null;
    // parts_data.type：吸附方向（1/缺省=最近档位、2=只吸附 ≤ 当前值的档位、3=只吸附 ≥ 当前值的档位；充能机 type 2 配升序档位，松手落在已达档位）
    this.partsDataType = entry.parts_data?.type ?? null;
    // revert_idle_index：idle 变体切到名单内时参数整体复位（true = 任意变体都复位）。bake 产物里的字符串形态（如 "1"）在游戏里同样不匹配任何分支，视为未配置
    this.revertIdleIndex = Array.isArray(entry.revert_idle_index)
      ? entry.revert_idle_index
      : entry.revert_idle_index === true
        ? true
        : null;
    // relation_parameter 联动参数（游戏 _relationParameterList）：type 101/102 跟随拖动量、103 跟随连点下标查 relation_value、104 idle+计时（未实现），其余跟随机器参数目标值但 enable=false 恒不写。target 有值时直写不平滑；smooth/range/range_abs/drag_direct/mode 缺省回落机器自身配置
    this.relations = Array.isArray(entry.relation_parameter?.list)
      ? entry.relation_parameter.list.map((r) => ({
          type: r.type,
          name: r.name,
          start: r.start,
          target: r.target,
          smooth: r.smooth != null ? r.smooth / 1000 : null,
          range: Array.isArray(r.range) ? r.range : null,
          rangeAbs: r.range_abs === 1 ? true : null,
          dragDirect: r.drag_direct ?? null,
          mode: r.mode,
          relationValue: Array.isArray(r.relation_value)
            ? r.relation_value
            : null,
          // 运行时：平滑输出值 / SmoothDamp 速度 / 本帧是否可写
          value: r.start ?? this.startValue,
          velocity: 0,
          enable: false,
          warned: false,
        }))
      : [];
    this.actionTrigger =
      entry.action_trigger && typeof entry.action_trigger === "object"
        ? entry.action_trigger
        : null;
    this.actionTriggerActive = entry.action_trigger_active || null;
    // 联动层数据（游戏 live2ddrag.lua 的 listenerType/listenerChange/listenerApply）：{type, change: [[kind, matchList, value, listIndex?]], apply: [kind, ranges]}
    this.listenerData =
      entry.listener_data && typeof entry.listener_data === "object"
        ? entry.listener_data
        : null;
    this.revertActionIndex = entry.revert_action_index === 1;
    // save_parameter=-1 不持久化；revert=-1 的机器松手即存（游戏 saveData）
    this.saveParameterFlag = entry.save_parameter !== -1;
    this.limitTime = entry.limit_time > 0 ? entry.limit_time : 4;

    // ---- 运行时状态（字段名对齐游戏，便于对照逆向）----
    this.parameterValue = this.startValue;
    this.parameterTargetValue = this.startValue;
    this.parameterStartValue = this.startValue;
    this.parameterSmooth = 0;
    this.parameterSmoothTime = this.smooth;
    this.parameterToStart = null; // 回弹倒计时（秒），null = 未启动
    this._active = false;
    this._downPos = { x: 0, y: 0 };
    this._downTime = 0;
    this._upPos = { x: 0, y: 0 };
    this.clickTriggerTime = null;
    this.nextTriggerTime = 0; // 触发冷却
    this.isTriggerAtion = false; // 动作已触发未播完标记（游戏 isTriggerAtion）
    this.extendActionFlag = false; // type 12 扩展门置位（游戏 extendActionFlag）
    this.animationPlayApply = false; // type 10 动作链单次闩锁（游戏 animationPlayApply）
    this.offsetDragX = this.startValue;
    this.offsetDragY = this.startValue;
    this.offsetDragTargetX = this.startValue;
    this.offsetDragTargetY = this.startValue;
    // 连点循环下标（type 6，1 起；读档在编排器构造处，游戏 loadData 的 GetDragActionIndex or 1）
    this.actionListIndex = 1;
    // type 3/4 的按压累计计时（游戏 triggerActionTime：startDrag 归零）
    this.triggerActionTime = 0;
    // type 13 参数从动轮：邻域命中闩锁 / 采样分频（10 帧折算成 30Hz 秒累计）/ 外参采样基线
    this.parameterMoveTrigger = false;
    this.moveCheckStep = null;
    this.parameterMove = null;
    this.lastParameterMove = null;
    // 下棋 AI 落子延迟（游戏 delayTargetTime）：目标已入账，参数平滑冻结到归零
    this.delayTargetTime = null;
    this.warned = false;
  }

  /** 模型里是否存在本机参数（不存在则只记账不写模型，与游戏 GetCubismParameter 为 nil 一致） */
  hasParam() {
    return this.orch.paramIndex(this.parameterName) >= 0;
  }

  /** 本机参数是否写模型（游戏 _parameterUpdateFlag）：类型白名单（2 点击 / 5 idle 跟随 / 7 监听 / 8 充能 / 10 动作链 / 13 参数移动 / 14 上下行 / 15 下棋）恒写；有拖拽量的机器经 updateDrag 置真。
   * type 3/4/6/9/11/12 的参数只是内部记账（type 9 的点参判定读的就是模型实时值），写模型反而会把内部值漏到画面上。 */
  writesParam() {
    if (this.offsetX || this.offsetY) return true;
    const t = this.actionTrigger?.type;
    return (
      t === 2 ||
      t === 5 ||
      t === 7 ||
      t === 8 ||
      t === 10 ||
      t === 13 ||
      t === 14 ||
      t === 15
    );
  }

  /** 目标值修正：drag_direct 方向闸门 + range_abs 取绝对值 + range 钳制（游戏 fixParameterTargetValue） */
  fixTarget(v) {
    return fixRange(v, this.range, this.rangeAbs, this.dragDirect);
  }

  /** relation 版修正：relation 自带 range/range_abs/drag_direct 优先，缺省回落机器配置（游戏 fixRelationParameter） */
  fixRelation(r, v) {
    return fixRange(
      v,
      r.range ?? this.range,
      r.rangeAbs ?? this.rangeAbs,
      r.dragDirect ?? this.dragDirect,
    );
  }

  setTargetValue(v) {
    this.parameterSmooth = 0;
    this.parameterStartValue = this.parameterTargetValue;
    this.parameterTargetValue = v;
  }

  setParameterValue(v) {
    this.parameterValue = v;
  }

  /** 下棋 AI 应手（游戏 setTargetValueDelay DD:579）：目标立即入账（终局判定按 target 数子立刻可见），参数平滑冻结 delay 秒——显形延迟由 step 的 delayTargetTime 闸实现 */
  setTargetValueDelay(v, delay) {
    this.setTargetValue(v);
    this.delayTargetTime = delay;
  }

  /** 读档（游戏 loadData）：revert=-1 的机器恢复持久化值 */
  loadSaved(value) {
    if (this.revert === -1 && this.saveParameterFlag && value != null) {
      this.setParameterValue(value);
      this.setTargetValue(value);
      this.offsetDragX = this.offsetDragTargetX = value;
      this.offsetDragY = this.offsetDragTargetY = value;
    }
  }

  /** 全量复位（游戏 clearData，对应"重置交互状态"） */
  reset() {
    this._active = false; // 按压中的机器一并松开（编排器 resetAll 调用）
    this.clickTriggerTime = null;
    this.parameterToStart = null;
    this.isTriggerAtion = false;
    this.extendActionFlag = false;
    this.animationPlayApply = false;
    this.nextTriggerTime = 0;
    // 平滑状态一并归位：松手路径会把 parameterSmoothTime 留在 smoothRevert，复位后若不还原，下次触发用回弹时长插值（跨域残留）
    this.parameterSmoothTime = this.smooth;
    this.parameterSmooth = 0;
    this.actionListIndex = 1;
    this.triggerActionTime = 0;
    this.parameterMoveTrigger = false;
    this.moveCheckStep = null;
    this.parameterMove = null;
    this.lastParameterMove = null;
    this.delayTargetTime = null;
    for (const r of this.relations) {
      r.value = r.start ?? this.startValue;
      r.velocity = 0;
      r.enable = false;
    }
    this.setParameterValue(this.startValue);
    this.setTargetValue(this.startValue);
    this.offsetDragX = this.offsetDragTargetX = this.startValue;
    this.offsetDragY = this.offsetDragTargetY = this.startValue;
  }

  // ---- 以下为委托桩：实现在同目录 machine*.js（自由函数，首参传 this）----

  triggerAble(dt) {
    return machineTrigger.triggerAble(this, dt);
  }

  async applyClickTrigger() {
    return machineTrigger.applyClickTrigger(this);
  }

  isApplyStopDrag() {
    return machineTrigger.isApplyStopDrag(this);
  }

  stopDragIfApply() {
    return machineTrigger.stopDragIfApply(this);
  }

  async applyTrigger() {
    return machineTrigger.applyTrigger(this);
  }

  filterAction(action) {
    return machineTrigger.filterAction(this, action);
  }

  onListenerEvent(type, data) {
    return machineTrigger.onListenerEvent(this, type, data);
  }

  triggerAction() {
    return machineTrigger.triggerAction(this);
  }

  checkActionInExtend(actionName) {
    return machineTrigger.checkActionInExtend(this, actionName);
  }

  onDown(pos, playing) {
    return machinePointer.onDown(this, pos, playing);
  }

  onMove(pos) {
    return machinePointer.onMove(this, pos);
  }

  commitDragBase() {
    return machinePointer.commitDragBase(this);
  }

  onUp(pos) {
    return machinePointer.onUp(this, pos);
  }

  onCancel() {
    return machinePointer.onCancel(this);
  }

  updatePartsSnap() {
    return machinePointer.updatePartsSnap(this);
  }

  step(dt, now, playing, playActionName) {
    return machineStep.step(this, dt, now, playing, playActionName);
  }

  updateRelations(dt) {
    return machineStep.updateRelations(this, dt);
  }

  onIdleChanged(n) {
    return machineStep.onIdleChanged(this, n);
  }

  saveData() {
    return machineStep.saveData(this);
  }

  interactable() {
    return machineStep.interactable(this);
  }
}
