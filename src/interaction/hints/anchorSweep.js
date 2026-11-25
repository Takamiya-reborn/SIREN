/** 锚点元凶扫描（诊断工具，与提示层无关）：分区锚点网格被形变链甩出视野时逐参数归因。挂载链在交互点过半出画时自动调用一次（l2d/mount/diagnostics.js）。 */

/**
 * 锚点元凶扫描：分区锚点网格被形变链甩出视野时，逐参数「写 moc 默认 → 全模型重算 →
 * 看锚点是否归位」，点名把锚点搬走的参数（多参数耦合时逐个报告各自的独立贡献）。
 * 纯查询：每个参数试完即还原原值，末帧一次全量重算恢复现场。
 * @param model pixi-live2d-display 的 Live2DModel
 * @param zoneName 分区名（HitArea Name，如 touch_drag1）
 * @returns Array<{id, cur, def}> 默认值可让锚点归位的参数清单（cur=当前值, def=moc 默认）
 */
export function anchorCulpritSweep(model, zoneName) {
  const internal = model.internalModel;
  const core = internal.coreModel;
  const area = internal.hitAreas?.[zoneName];
  if (!area) return { culprits: [], fixAll: null, probe: null };
  const didx = area.index;
  // 读数对象核对：hitArea 名 → 实际读到的 drawable id，与 moc 静态映射（drawables.ids.indexOf）
  // 必须一致，错位则全部坐标读数都是别的网格
  const raw = core.getModel?.() ?? core;
  const drawableIds = Array.from(raw.drawables.ids);
  const staticIdx = drawableIds.indexOf(area.id);
  const n = core.getParameterCount();
  const orig = [];
  for (let i = 0; i < n; i++) orig.push(core.getParameterValueByIndex(i));
  const canvasW = core.getCanvasWidth();
  const canvasH = core.getCanvasHeight();
  const sane = (verts) => {
    let cx = 0;
    let cy = 0;
    const vn = verts.length / 2;
    for (let j = 0; j < verts.length; j += 2) {
      cx += verts[j];
      cy += verts[j + 1];
    }
    cx /= vn;
    cy /= vn;
    return Math.abs(cx) < canvasW && Math.abs(cy) < canvasH;
  };
  const culprits = [];
  for (let i = 0; i < n; i++) {
    const def = core.getParameterDefaultValue(i);
    if (orig[i] === def) continue;
    core.setParameterValueByIndex(i, def);
    core.update();
    if (sane(internal.getDrawableVertices(didx))) culprits.push(i);
    core.setParameterValueByIndex(i, orig[i]);
  }
  // 全量还原测试：单参还原全部失败（culprits 空）时切开两种可能——全部非默认参数一次
  // 归位后锚点回位 = 多参数耦合错值；仍不回位 = 参数系外的形变状态损坏
  let fixAll = null;
  for (let i = 0; i < n; i++)
    core.setParameterValueByIndex(i, core.getParameterDefaultValue(i));
  core.update();
  fixAll = sane(internal.getDrawableVertices(didx));
  for (let i = 0; i < n; i++) core.setParameterValueByIndex(i, orig[i]);
  core.update();
  // 参数 id 经 raw model 取（核心包装层没有按序号取 id 的 API）
  const ids = raw.parameters.ids;
  return {
    culprits: culprits.map((i) => ({
      id: ids[i],
      cur: orig[i],
      def: core.getParameterDefaultValue(i),
    })),
    fixAll,
    probe: {
      hitAreaId: area.id,
      hitAreaIndex: didx,
      staticIdx,
      drawableIdAtRead: drawableIds[didx],
    },
  };
}
