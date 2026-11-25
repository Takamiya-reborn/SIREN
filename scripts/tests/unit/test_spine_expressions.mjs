// 表情覆盖层识别：合成 spineData（时间轴形状逐字段构造，不依赖真实资产）。
// 覆盖判定三形态（全 attachment / 混入骨骼时间轴 / 空时间轴）与数字名升序默认选择。
import test from "node:test";
import assert from "node:assert/strict";
import { expressionOverlays } from "../../../src/l2d/spine/expressions.js";

const attTl = () => ({ attachmentNames: ["a", null] });
const boneTl = () => ({ rotate: [0] });

function spineDataOf(animations) {
  return {
    animations: animations.map(([name, timelines]) => ({ name, timelines })),
  };
}

test("全 attachment 时间轴的动画识别为表情覆盖层", () => {
  const data = spineDataOf([
    ["normal", [boneTl(), boneTl()]],
    ["1", [attTl()]],
    ["touch_head", [boneTl()]],
  ]);
  assert.deepEqual(expressionOverlays(data), ["1"]);
});

test("混入非 attachment 时间轴（骨骼/颜色/形变）即排除", () => {
  const data = spineDataOf([
    ["1", [attTl(), boneTl()]],
    ["2", [attTl()]],
  ]);
  assert.deepEqual(expressionOverlays(data), ["2"]);
});

test("空时间轴与无动画返回空名单", () => {
  assert.deepEqual(expressionOverlays(spineDataOf([["1", []]])), []);
  assert.deepEqual(expressionOverlays({ animations: [] }), []);
});

test("数字名升序，首个为默认表情；非数字名排数字名之后", () => {
  const data = spineDataOf([
    ["touch_blink", [attTl()]],
    ["10", [attTl()]],
    ["2", [attTl()]],
    ["abc", [attTl()]],
    ["1", [attTl()]],
  ]);
  assert.deepEqual(expressionOverlays(data), [
    "1",
    "2",
    "10",
    "abc",
    "touch_blink",
  ]);
});
