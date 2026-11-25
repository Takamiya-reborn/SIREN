/** 机器参数图层（游戏 AddParameterValue/ChangeParameterData 的叠加源）：自由函数风格，首参 o = DragOrchestrator 实例（委托接线见 orchestrator.js）。 */

/** 机器参数图层（游戏 AddParameterValue/ChangeParameterData 的叠加源）：mode 1=Override 直接写机器值、2=Additive 叠加、3=Multiply 相乘；relation 联动参数随后写入（游戏对 enable 的 relation 逐帧 ChangeParameterData，mode 缺省回落机器 mode）。
 * 引擎的 save/loadParameters 会把本层写入滞留到下一帧（见 Cubism4InternalModel.update：save 在 afterMotionUpdate 之后、load 在帧尾），动作曲线没覆盖的 additive/multiply 参数会逐帧累积——游戏端是"每帧先还原参数再叠加"，这里对齐成两阶段：beforeMotionUpdate 先撤掉上帧叠加还原底值，afterMotionUpdate 取（动作求值后的）干净底重新叠加。
 * model3 里没有的参数不入层（游戏 GetCubismParameter nil 时同样不落）。 */
export function layerEntries(o) {
  if (!o._layer) {
    o._layer = [];
    for (const m of o.machines) {
      if (m.hasParam() && m.writesParam()) {
        o._layer.push({
          idx: o.paramIndex(m.parameterName),
          m,
          r: null,
          base: 0,
          additive: m.mode !== 1,
          inited: false,
        });
      }
      for (const r of m.relations) {
        const idx = o.paramIndex(r.name);
        if (idx >= 0) {
          const mode = r.mode ?? m.mode;
          o._layer.push({
            idx,
            m,
            r,
            base: 0,
            additive: mode !== 1,
            inited: false,
          });
        }
      }
    }
  }
  return o._layer;
}

/** 叠加层阶段一（挂 beforeMotionUpdate）：撤掉上帧叠加，还原动作求值的底 */
export function restoreLayer(o, core) {
  for (const e of layerEntries(o)) {
    if (!e.additive || !e.inited) continue;
    if (e.r && !e.r.enable) continue;
    core.setParameterValueByIndex(e.idx, e.base);
  }
}

/** 叠加层阶段二（挂 afterMotionUpdate）：取干净底重新叠加 */
export function applyLayer(o, core) {
  for (const e of layerEntries(o)) {
    const v = e.r ? e.r.value : e.m.parameterValue;
    if (e.r && !e.r.enable) continue;
    const cur = core.getParameterValueByIndex(e.idx);
    const mode = e.r ? (e.r.mode ?? e.m.mode) : e.m.mode;
    let out;
    if (mode === 2) out = cur + v;
    else if (mode === 3) out = cur * v;
    else out = v;
    core.setParameterValueByIndex(e.idx, out);
    if (e.additive) {
      e.base = cur;
      e.inited = true;
    }
  }
}
