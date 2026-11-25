/** 判定引导环（游戏 UI 引导层的同角色复刻，常显不随"显示交互点"开关——是玩法引导不是诊断工具）：两层背景圆盘 + 中心芯，叠在判定分区网格质心。
 * 外盘静止在扫描起点半径；内盘随门参数现值从外盘半径向芯收缩，玩家按内盘沿的收紧节奏点判定分区；段界另画细环；内盘边色 = 现值所在区间段（段序调色板）；扫描停 ~0.25s 淡出。
 * 半径对值线性（lo→外盘、hi→芯）；门数据取编排器 gateInfo 的归并门；锚 = 分区 drawable 顶点质心（单网格逐帧变换，中心出画跳过）。
 * 子工厂持有图层与逐门动效状态。 */
import { Graphics } from "pixi.js";

// 外盘半径（扫描起点）与中心芯半径（扫描终点），px；区间段序调色板（现值落在哪段就取哪段色）
const RING_R0 = 84;
const RING_CORE = 16;
const RING_COLORS = [0x4fc08d, 0xe8b06f, 0x6fa8dc, 0xd98fb5];

/**
 * @param app pixi Application（ringG 挂到其 stage）
 * @param getOrch () => DragOrchestrator | null，每帧取当前编排器（gateInfo 数据源）
 * @returns {{ g: Graphics, draw(runtime, hints): void, hide(): void, destroy(): void, reads(): Array }}
 */
export function createJudgeRings(app, getOrch) {
  /** 逐门动效状态（value/lastMoveT/alpha/color），key = zone|param */
  const ringState = new Map();
  let ringClock = 0;
  /** 引导环逐门读数（HUD 诊断）：draw 每帧重写，记录 α/锚点/未画原因 */
  let ringReads = [];
  const g = new Graphics();

  /** 每帧重画（hints/index.js update 调用）：runtime 提供模型顶点，hints 提供分区名 -> drawable 下标的映射 */
  function draw(runtime, hints) {
    ringReads = [];
    const gates = getOrch?.()?.gateInfo?.() ?? [];
    if (!gates.length) {
      ringReads.push({ zone: "-", why: "无type11门" });
      g.visible = false;
      return;
    }
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - ringClock)) || 0.016;
    ringClock = now;
    const W = app.screen.width;
    const H = app.screen.height;
    g.visible = true;
    g.clear();
    for (const gate of gates) {
      const key = `${gate.zone}|${gate.param}`;
      const st = ringState.get(key) ?? {
        lastValue: null,
        lastMoveT: 0,
        alpha: 0,
        color: RING_COLORS[0],
      };
      ringState.set(key, st);
      if (gate.value == null) {
        ringReads.push({ zone: gate.zone, why: "无值" });
        continue;
      }
      if (st.lastValue != null && Math.abs(gate.value - st.lastValue) > 1e-4)
        st.lastMoveT = now;
      st.lastValue = gate.value;
      const active = now - st.lastMoveT < 0.25;
      st.alpha += ((active ? 1 : 0) - st.alpha) * Math.min(1, dt * 8);
      if (st.alpha < 0.02) {
        ringReads.push({ zone: gate.zone, v: gate.value, a: st.alpha, why: "停扫" });
        continue;
      }
      const h = hints.find((e) => e.name === gate.zone);
      if (!h) {
        ringReads.push({ zone: gate.zone, why: "无分区" });
        continue;
      }
      const verts = runtime.model.internalModel.getDrawableVertices(h.idx);
      let cx = 0;
      let cy = 0;
      for (let j = 0; j < verts.length; j += 2) {
        cx += verts[j];
        cy += verts[j + 1];
      }
      const p = runtime.model.toGlobal({
        x: cx / (verts.length / 2),
        y: cy / (verts.length / 2),
      });
      if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) {
        ringReads.push({
          zone: gate.zone,
          v: gate.value,
          a: st.alpha,
          x: p.x,
          y: p.y,
          why: "锚点出画",
        });
        continue;
      }
      ringReads.push({
        zone: gate.zone,
        v: gate.value,
        a: st.alpha,
        x: p.x,
        y: p.y,
        why: null,
      });
      const span = gate.hi - gate.lo;
      const k =
        span > 0 ? Math.max(0, Math.min(1, (gate.value - gate.lo) / span)) : 0;
      const hit = gate.bands.findIndex(
        (b) => gate.value >= b.lo && gate.value < b.hi,
      );
      if (hit >= 0) st.color = RING_COLORS[hit % RING_COLORS.length];
      const r = RING_R0 + (RING_CORE - RING_R0) * k;
      // 外盘（静止背景层）：扫描起点半径
      g.beginFill(0xffffff, 0.1 * st.alpha);
      g.drawCircle(p.x, p.y, RING_R0);
      g.endFill();
      g.lineStyle(1, 0xffffff, 0.25 * st.alpha);
      g.drawCircle(p.x, p.y, RING_R0);
      // 段界细环：内盘沿收进哪段一目了然
      g.lineStyle(1, 0xffffff, 0.3 * st.alpha);
      for (const b of gate.bands) {
        if (b.lo <= gate.lo) continue;
        g.drawCircle(
          p.x,
          p.y,
          RING_R0 + (RING_CORE - RING_R0) * ((b.lo - gate.lo) / span),
        );
      }
      // 内盘（收缩层）：现值所在半径，边色取段色
      g.beginFill(0xffffff, 0.16 * st.alpha);
      g.drawCircle(p.x, p.y, r);
      g.endFill();
      g.lineStyle(2, st.color, 0.9 * st.alpha);
      g.drawCircle(p.x, p.y, r);
      // 中心芯（静止）：扫描终点
      g.beginFill(0x86e3de, 0.85 * st.alpha);
      g.drawCircle(p.x, p.y, RING_CORE);
      g.endFill();
    }
  }

  return {
    g,
    draw,
    hide() {
      g.visible = false;
    },
    destroy() {
      app.stage.removeChild(g);
      g.destroy();
      ringState.clear();
    },
    reads: () => ringReads,
  };
}
