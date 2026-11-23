/**
 * spine 表情覆盖层语义：ani 皮肤里眼球等表情件不落在身体动画上（槽位无 setup 附件、
 * 身体动画只驱动眼睑/睫毛），由一类只含 attachment 时间轴的动画挂载，游戏在第二条
 * track 常挂其一。本模块提供识别与默认选择，供挂载层与触发面板共用。
 */

/** 表情覆盖层名单：动画时间轴全为 attachment 类型（无骨骼/约束/形变/绘制序/事件）。
 * 数字名升序（非数字名排数字名之后、字典序），首个为默认表情。 */
export function expressionOverlays(spineData) {
  const overlays = spineData.animations.filter(
    (a) =>
      a.timelines.length > 0 &&
      a.timelines.every((t) => t.attachmentNames !== undefined),
  );
  const num = (name) =>
    Number.isFinite(Number(name)) ? Number(name) : Infinity;
  overlays.sort(
    (a, b) =>
      num(a.name) - num(b.name) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return overlays.map((a) => a.name);
}
