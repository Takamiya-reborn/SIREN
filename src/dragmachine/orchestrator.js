/**
 * 编排器（游戏 Live2D 类的路由面）：持有全部机器、idle 变体号与动作白/黑名单。
 * 本文件是 DragOrchestrator 壳：构造器 + 路由面 + 指针分发 + 播放闸 + 持久化/复位；播放路由在 playRoute.js、下棋小游戏在 xiaqi.js、参数图层在 layers.js、HUD 读数在 readouts.js——均为自由函数（首参传编排器实例），方法在此一行委托，公开方法签名不变。
 * == 编排器级状态契约（属主 × 写入点 × 复位责任） ==
 * | 变量 | 写入点 | 复位时机 |
 * | machineAble（按压锁） | pressLock 唯一入口（写入方全集：machine.onDown/applyClickTrigger/onUp/onCancel/step 窗口作废、triggers.js type3×4+type8、resetAll）；setMachineAble 仅供测试拦截与 pressLock 落底 | pressLock(…,false) 各收尾路径 / resetAll |
 * | isPlaying/playActionName | noteMotionStart 清后按需置真（被顶掉动作不发 finish，起播即清算旧反应）/noteMotionFinish 清 | resetAll；滞留即锁死一切点击（HUD playing 读数） |
 * | enablePlayActions/ignorePlayActions | applyActiveData 唯一写（enable 在场即遮蔽 idle_enable，原文 #x>=0 恒真语义） | resetAll |
 * | idleIndex | changeIdleIndex 唯一写（resetAll 直接置 0） | resetAll |
 * | _lastStartIdle | noteMotionStart 记，noteMotionFinish 用 | resetAll |
 * | activeOwner | applyActiveData 落账（HUD 读数） | resetAll |
 * | xiaqiLimitTime/xiaqiResult/xiaqiResultDelay/xiaqiPendingWin | xiaqiClick 限频戳与落子链；step 归零暂存写 result；onActionApply type16 播出成功清 result | resetAll |
 * 机器级状态（_active/isTriggerAtion/nextTriggerTime/…）契约见 machine.js 头注释；写机器状态前先查那张表。
 * @param model pixi Live2DModel
 * @param config loadL2dConfig 的结果
 * @param playAction (clipName) => boolean 播放回调，L2dStage 提供：解析 clip 名 -> 动作组并播放（FORCE），返回是否真的播了
 */
import { DragMachine } from "./machine.js";
import * as playRoute from "./playRoute.js";
import * as xiaqi from "./xiaqi.js";
import * as layers from "./layers.js";
import * as readouts from "./readouts.js";
import { fetchJson, metaSibling } from "../platform/assets.js";

/** 井字棋八连线表：真身与下棋逻辑同住 xiaqi.js，此处保持原导出面不变 */
export { XIAQI_LINES } from "./xiaqi.js";

/** 加载与模型同目录的拖拽参数机配置；缺失（未烘焙/非 L2D 皮肤）返回 null */
export async function loadL2dConfig(modelUrl) {
  return fetchJson(metaSibling(modelUrl, "l2d.json"));
}

export class DragOrchestrator {
  constructor(model, config, playAction) {
    this.model = model;
    this.skinId = config.skin_id;
    this.idleIndexMap = config.idle_index ?? {};
    this.playAction = playAction;
    this.idleIndex = 0; // 变体号不跨会话恢复，见 machines 读档处的注释
    this.enablePlayActions = [];
    this.ignorePlayActions = [];
    this.machineAble = false; // 有机器按下期间屏蔽动作播放（游戏 EVENT_ACTION_ABLE）
    this.isPlaying = false;
    this.playActionName = "";
    this.playingClip = ""; // 最近一次起播的 clip 名（含 idle 组——type 10 动作链的 state 名判据需要 idle clip 名，playActionName 只记反应动作）
    this.playStartAt = 0; // playingClip 的起播时刻（performance 时钟，秒）——type 10 归一化播进度的起算点
    this.clipDurationOf = null; // (clipName) => 秒 | undefined，查 clip 时长；mount/sim 从 interaction.json clips 表注入，type 10 用
    this.machines = config.entries.map((e) => new DragMachine(e, this));
    // 下棋（type 15/16，suweiaitongmeng_3 独占）：全局限频时间戳 / 共享终局结果 / 0.5s 终局延迟暂存对；棋盘状态直接记在各格子机的 parameterTargetValue（0 空 / +1 玩家 / -1 角色），复位清盘走 machine.reset
    this.xiaqiLimitTime = null;
    this.xiaqiResult = null;
    this.xiaqiResultDelay = null;
    this.xiaqiPendingWin = null;
    this._xiaqiCells = null;
    // 读档：只恢复机器拖拽参数值。idle 变体号/白名单不跨会话恢复——存档里只有变体号、没有交互图状态（菜单摊开与否），单独恢复变体号会造出"菜单没开但 touch_idle1 被重复 idle 豁免跳过"的自不一致死态；游戏里两者是配套恢复的，这里拿不到后者就干脆都从干净态起步
    for (const m of this.machines) {
      m.loadSaved(this.loadValue(String(m.id)));
      // 连点下标跨会话恢复（游戏 loadData 的 GetDragActionIndex or 1）
      const listIndex = this.loadValue(`${m.id}__listIndex`);
      if (listIndex != null) m.actionListIndex = listIndex;
    }
  }

  /** 参数下标缓存（机器层写值用；模型里不存在的参数返回 -1，只记账不写） */
  paramIndex(pid) {
    if (!this._idx) this._idx = new Map();
    if (!this._idx.has(pid)) {
      this._idx.set(
        pid,
        this.model.internalModel.coreModel.getParameterIndex(pid),
      );
    }
    return this._idx.get(pid);
  }

  /** 机器分区名（大小写不敏感）。两边命名风格不同：ship_l2d 的 draw_able_name 是驼峰（TouchDrag1），model3.json HitAreas 的 Name 是小写下划线形式（touch_drag1），hitTest 返回的是后者——比较前剔除下划线等分隔符，否则永不匹配、机器路由整体失效。 */
  machinesForZone(zoneName) {
    if (!zoneName || !this.machines.length) return [];
    const key = String(zoneName)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return this.machines.filter(
      (m) => m.drawAbleName.toLowerCase().replace(/[^a-z0-9]/g, "") === key,
    );
  }

  /** 同名分区的注册最早一台（兼容旧查询点；指针路由已改用 machinesForZone） */
  machineByZone(zoneName) {
    return this.machinesForZone(zoneName)[0] ?? null;
  }

  /** 分区的路由优先级键：该分区在注册名单里的最早位置（机器按 ship_l2d 条目序构建）。游戏 GetDragPart（C#）对全部射线命中取"DragParts 名单下标最大者胜"——名单 = assistantTouchParts 排最前 + 条目序的 draw_able_name，FindIndex 取首现位置，故这里同样取最早注册序作比较键。 */
  zoneOrder(zoneName) {
    const first = this.machinesForZone(zoneName)[0];
    return first ? this.machines.indexOf(first) : -1;
  }

  /** 分区可交互状态（HUD 着色）：同名分区常挂多台机器（wuzang_3 的 TouchDrag2 挂充能 + 双联动 + 长按 4 台），任意一台可响应即算可交互；全部被挡时红、全部类型未实现时橙 */
  zoneInteractable(zoneName) {
    const ms = this.machinesForZone(zoneName);
    if (!ms.length) return null;
    let blocked = false;
    for (const m of ms) {
      let s = m.interactable();
      if (s === true) {
        // 机器自身可触发还不够：动作还得过白名单（游戏 checkEnablePlay 前置于播放）——不查名单的话提示层会对过不了名单的触发点报可交互
        if (!this.actionPassable(m)) s = false;
      }
      if (s === true) return true;
      if (s === false) blocked = true;
    }
    return blocked ? false : null;
  }

  /** 机器本次触发将播的动作能否过白名单；空触发机（circle/target）不播动作，白名单无关，恒可过。type 6 取当前下标的条目，随机数组任一项可过即可 */
  actionPassable(m) {
    const at = m.actionTrigger;
    if (!at) return true;
    let action =
      Array.isArray(at.action_list) && at.action_list.length
        ? at.action_list[
            Math.min(Math.max(m.actionListIndex, 1), at.action_list.length) - 1
          ]?.action
        : at.action;
    if (Array.isArray(action))
      return action.some((a) => a && this.checkEnablePlay(a));
    return !action || this.checkEnablePlay(action);
  }

  /** 读模型参数实时值（游戏 EVENT_GET_PARAMETER：GetCubismParameter 缺失回 0）。机器参数每帧经 applyLayer 写入模型，读模型即读到机器叠加后的值 */
  readParameter(pid) {
    const idx = this.paramIndex(pid);
    if (idx < 0) return 0;
    return this.model.internalModel.coreModel.getParameterValueByIndex(idx);
  }

  /** type 12 扩展门的参数值源（游戏 EVENT_GET_DRAG_PARAMETER CT:347-358）：按 parameterName 在机器里匹配，取该机 parameterValue（机器当前值），后注册者胜出，无匹配默认 0——不是模型实时值、不是 targetValue */
  readDragParameter(pid) {
    let v = 0;
    for (const m of this.machines) {
      if (m.parameterName === pid) v = m.parameterValue;
    }
    return v;
  }

  // ---- 指针事件分发（L2dStage 调用；返回是否被机器消费）----

  /** 按下命中分区：startDrag 广播给该分区的**全部**机器（游戏 onPointDown 遍历 drags 匹配 drawAbleName，非只第一台）——wuzang_3 的 TouchDrag2 上充能、联动、长按三套机器共享分区，靠同时按压协同；各机器自己的 ignoreAction/已激活守卫在 machine.onDown 内 */
  onDown(zoneName, pos) {
    const ms = this.machinesForZone(zoneName);
    if (!ms.length) return false;
    for (const m of ms) m.onDown(pos, this.isPlaying);
    return true;
  }

  onMove(pos) {
    // 移动路由只按 _active（游戏 updateDrag DD:688+ 遍历按压中的机器）：machineAble 是播放闸不是移动闸——down 配置型/type4 按压期间原文不上锁，挪用锁当移动门会把它们的拖动整个掐掉
    for (const m of this.machines) if (m._active) m.onMove(pos);
  }

  /** @returns true 手势被机器消费（不再走 playHitMotion 旧路径） */
  onUp(zoneName, pos) {
    let consumed = false;
    for (const m of this.machines) {
      if (m._active) {
        m.onUp(pos);
        consumed = true;
      }
    }
    if (!consumed && this.machineByZone(zoneName)) return true;
    return consumed;
  }

  onCancel() {
    for (const m of this.machines) if (m._active) m.onCancel();
  }

  // ---- 动作播放路由（游戏 checkEnablePlay + playAction + applyActiveData）----

  /** 按压锁唯一写入口（游戏 setAbleWithFlag DD:1316-1324 的语义：幂等值守卫 + 变迁广播）。
   * 锁滞留 = 一切播放被 machineAble 拦死，触发链里只剩"被机器按压拦下"却没有来由——reason 留痕让最后一条"按压锁→开"直接点名是哪次按压把锁带走的。
   * 全部写入方必须走这里，禁止直改 machineAble。 */
  pressLock(reason, able) {
    if (this.machineAble === able) return;
    this.debug?.(`按压锁→${able ? "开" : "关"}(${reason})`);
    this.setMachineAble(able);
  }

  /** 裸 setter：供测试 monkeypatch 拦截与 pressLock 落底，不留痕 */
  setMachineAble(able) {
    this.machineAble = able;
  }

  /** 白名单/黑名单检查，对一切动作播放生效（游戏 checkEnablePlay）。
   * 游戏里 "idle" 在白名单检查之前恒放行（Lua slot13 首条：触发改 idle 变体的收尾分支后白名单是 48 项 touch_idle/clip 名，重播 idle 走名单会被整个拦死）。
   * 按压锁（ableFlag）在游戏里是用 setEnableActions(['none action apply']) 换白名单实现的，idle 同样越过它，故豁免放最前。 */
  checkEnablePlay(actionName) {
    if (actionName === "idle") return true;
    // type 12 扩展门（CT:176-188）：先于白/黑名单——任一 extend 机 ignore 命中即拦、enable 命中即直通。原文 ableFlag 以白名单实现，直通同样越过按压锁；真实配置（shengluyisi_5）只用 ignore 屏蔽，enable 直通撬锁属原文潜在形态
    for (const m of this.machines) {
      if (!m.extendActionFlag) continue;
      const verdict = m.checkActionInExtend(actionName);
      if (verdict === "block") return false;
      if (verdict === "pass") return true;
    }
    if (this.machineAble) return false;
    if (
      this.enablePlayActions.length &&
      !this.enablePlayActions.includes(actionName)
    )
      return false;
    if (this.ignorePlayActions.includes(actionName)) return false;
    return true;
  }

  /** 诊断钩子：舞台侧注入 debugHook 后，触发链关键步写 console（既有消费方）。
   * 同时落环形缓冲 tapLog（上限 12 条，带 [s] 时间戳），供 HUD 面板读触发链（拒按/点击判定/豁免/窗口作废/播放结果/名单写入），按最后一条判定卡在哪道门。 */
  debug(line) {
    (this.tapLog ??= []).push({ t: performance.now() / 1000, line });
    if (this.tapLog.length > 12) this.tapLog.shift();
    this.debugHook?.(line);
  }

  /** 联动广播（游戏 onListenerHandle → live2ddrag onListenerEvent）：全部机器无差别收到。
   * 有消费方的事件有三类：PLAY(1)（CT:288 播放成功后）、DRAG_CLICK(2)（type 2/9/11 点击应用后，载荷 draw_able_name=被点分区，见 machineTrigger.applyClickTrigger）、CHANGE_IDLE(3)（changeIdleIndex）。
   * DOWN(5)/XY_TRIGGER(6)/DRAG_TRIGGER(7) 在原文是死路径——apply 回调体带 if-slot0 守卫而回调实参恒 nil（CT:269/305），通知永远不出；ON_ACTION_PARAMETER 在 3759 条配置里零监听者，不发。 */
  notice(type, data) {
    for (const m of this.machines) m.onListenerEvent(type, data);
  }

  // ---- 每帧驱动（下棋终局延迟写账 + 全机器步进）----

  step(dt) {
    // 下棋终局 0.5s 延迟写账（游戏 onDelayTick 的帧驱动形态）
    if (this.xiaqiResultDelay != null) {
      this.xiaqiResultDelay -= dt;
      if (this.xiaqiResultDelay <= 0) {
        this.xiaqiResultDelay = null;
        this.xiaqiResult = this.xiaqiPendingWin;
        this.xiaqiPendingWin = null;
      }
    }
    for (const m of this.machines)
      m.step(dt, performance.now() / 1000, this.isPlaying, this.playActionName);
  }

  // ---- 持久化（localStorage 模拟 PlayerPrefs）----

  saveValue(key, value) {
    try {
      localStorage.setItem(`l2d_${this.skinId}_${key}`, JSON.stringify(value));
    } catch {
      /* 隐私模式等场景写入失败可忽略 */
    }
  }

  loadValue(key) {
    try {
      const raw = localStorage.getItem(`l2d_${this.skinId}_${key}`);
      return raw == null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** 全量复位（游戏 ClearLive2dSave）：清存档、机器回 startValue、idle 归零、白名单清空 */
  resetAll() {
    for (const m of this.machines) {
      this.saveValue(String(m.id), null);
      this.saveValue(`${m.id}__listIndex`, null);
    }
    this.saveValue("__idle", 0);
    this.saveValue("__action", 0);
    for (const m of this.machines) m.reset();
    // 按压锁一并清掉：machineAble 置真后若没走到任何清假路径（如按压中复位），checkEnablePlay 恒假会连"重置交互"自己的重播一起拦死
    this.pressLock("重置交互", false);
    this.idleIndex = 0;
    this.isPlaying = false;
    this.playActionName = "";
    this._lastStartIdle = false;
    this.enablePlayActions = [];
    this.ignorePlayActions = [];
    this.activeOwner = 0;
    // 下棋局清空（游戏 ResetL2dData 行为不可考，取干净态：格子机 reset 已归 startValue，这里清限频/结果/延迟暂存，消除终局 0.5s 写账与复位的竞态）
    this.xiaqiLimitTime = null;
    this.xiaqiResult = null;
    this.xiaqiResultDelay = null;
    this.xiaqiPendingWin = null;
  }

  // ---- 以下为委托桩：实现在同目录 playRoute/xiaqi/layers/readouts（自由函数，首参传 this）----

  pickIdleVariant(activeData) {
    return playRoute.pickIdleVariant(this, activeData);
  }

  async onActionApply(machine, action, activeData) {
    return playRoute.onActionApply(this, machine, action, activeData);
  }

  applyActiveData(machineId, activeData, save, payloadIdle = null, pickedIdle) {
    return playRoute.applyActiveData(
      this,
      machineId,
      activeData,
      save,
      payloadIdle,
      pickedIdle,
    );
  }

  changeIdleIndex(n, save = true) {
    return playRoute.changeIdleIndex(this, n, save);
  }

  idleClipFor(index) {
    return playRoute.idleClipFor(this, index);
  }

  noteMotionStart(clipName, idle = false) {
    return playRoute.noteMotionStart(this, clipName, idle);
  }

  noteMotionFinish() {
    return playRoute.noteMotionFinish(this);
  }

  xiaqiCells() {
    return xiaqi.xiaqiCells(this);
  }

  xiaqiCheckFinish(cells) {
    return xiaqi.xiaqiCheckFinish(this, cells);
  }

  xiaqiSchedule(win) {
    return xiaqi.xiaqiSchedule(this, win);
  }

  xiaqiClick(cell) {
    return xiaqi.xiaqiClick(this, cell);
  }

  layerEntries() {
    return layers.layerEntries(this);
  }

  restoreLayer(core) {
    return layers.restoreLayer(this, core);
  }

  applyLayer(core) {
    return layers.applyLayer(this, core);
  }

  gateInfo() {
    return readouts.gateInfo(this);
  }

  hudInfo() {
    return readouts.hudInfo(this);
  }
}
