/**
 * 交互点可视化提示（测试用）：每个命中区一个半透明圆点标在其 drawable 网格顶点质心，外加网格实际形状的绿框轮廓（= 游戏 CubismRaycaster 的精确判定范围，与 meshHitTest 同一几何）。
 * 只画当前可交互的分区（绿）；被挡下（冷却/单触发已播/播放中）、未实现触发类型、无机器的隐藏网格一律不画；机器分区的隐藏网格照画（游戏路由纯几何射线，隐藏但在位的标记照样可触发）；画布内采不到落脚点的出画/被盖分区同样不画（出屏分区游戏里物理上点不到）；位置每帧跟随模型，状态变化（冷却结束/变体切换）时点随之隐现。
 * 可交互判定按真实路由分家：机器分区（ship_l2d 有 draw_able_name 匹配）由拖拽参数机接管，不查 interaction.json 的参数门控——可见性按机器自身的可触发条件（冷却/单触发/播放中/重复 idle 豁免/type 9 点参档位，取编排器路由到的那台，与游戏 GetDragPart 的"注册顺序第一台赢"一致）判定；无机器的分区（touch_head/body 等 C# 路径）才按起播门控（canPlay）判定。
 * 标签显示分区驱动的参数（编排器 l2d.json 的 draw_able_name -> parameter），不用网格自己的名字：部分皮肤的网格名与反应编号是错位的（shengluyisi_5: TouchDrag23 网格驱动 touch_drag25、TouchDrag25 驱动 touch_drag29——游戏 sharecfg ship_l2d 原始数据即如此），按网格名标注会把 drag25 的范围/中心画到 TouchDrag25 网格上，与实际驱动参数对不上。
 * 多台机器共用同一分区时参数用 "+" 连接，无机器的分区（摸头/普通触摸等）沿用网格名；标签整体走紧凑记法（hintText）：剥 touch_/Param 前缀、同族参数只写数字差。
 * 判定引导环：type 11 区间机的判定参数被在播动作扫描时，在判定分区质心叠两层背景圆盘——外盘静止、内盘随扫描值向中心芯收缩（游戏 UI 引导层的同角色复刻，常显不随"显示交互点"开关），内盘边色 = 现值所在区间段。
 * 文件划分：本文件是工厂壳（闭包状态 + rebuild/destroy/update），路由在 route.js、几何件在 geometry.js、标签在 labels.js、判定引导环子工厂在 judgeRings.js、锚点元凶诊断在 anchorSweep.js。
 */
import { Container, Graphics, Text } from "pixi.js";
import { boundaryEdges, boundaryLoops, meshHitTest } from "../hitTest.js";
import { routeWinner, resolveRoute } from "./route.js";
import { zoneParams, hintText } from "./labels.js";
import { createJudgeRings } from "./judgeRings.js";

/**
 * 交互点提示层工厂：update 每帧调用，返回 HUD 读数（状态参数 + 非默认残留，供测试对照）；提示层未建/隐藏/无运行时时返回 null
 * @param app pixi Application（提示层挂到其 stage）
 * @param getRuntime () => InteractionRuntime | null，每帧取当前运行时
 * @param getVisible () => boolean，提示层开关
 * @param getOrch () => DragOrchestrator | null，拖拽参数机编排器
 * @returns {{ rebuild(model): void, destroy(): void, update(): {state: [string, number][], carried: [string, number][]} | null }}
 */
export function createInteractionHints(
  app,
  getRuntime,
  getVisible,
  getOrch = null,
) {
  let layer = null;
  let hints = [];
  /** drawable 下标 -> 边界环拓扑（顶点下标序列），随模型切换在 rebuild 清空 */
  let loopCache = new Map();
  /** 环序号 -> 全局坐标扁平数组（每帧复用，只重写值） */
  let scratchPolys = new Map();
  /** 分区质心路由缓存：key = idle 变体|在播动作，变了才整体重算——meshHitTest 全 drawable 遍历太重，不能每帧×每分区跑；姿态在变体间漂移小，够诊断用 */
  let routeKey = null;
  const routeMap = new Map();
  /** 判定引导环子工厂（常显，挂 stage 不随"显示交互点"开关）：ringG 图形、逐门动效状态与 HUD 读数都在里面 */
  let rings = null;

  return {
    rebuild(model) {
      this.destroy();
      layer = new Container();
      const areas = model.internalModel.hitAreas ?? {};
      hints = Object.entries(areas).map(([name, area]) => {
        const dot = new Graphics();
        const label = new Text(name, {
          fontSize: 10,
          fill: 0xffffff,
          letterSpacing: 0.5,
        });
        label.alpha = 0.85;
        layer.addChild(dot, label);
        return { name, idx: area.index, dot, label };
      });
      app.stage.addChild(layer);
      rings = createJudgeRings(app, getOrch);
      app.stage.addChild(rings.g);
    },

    destroy() {
      if (layer) {
        app.stage.removeChild(layer);
        layer.destroy({ children: true });
        layer = null;
      }
      if (rings) {
        rings.destroy();
        rings = null;
      }
      hints = [];
      loopCache = new Map();
      scratchPolys = new Map();
      routeMap.clear();
      routeKey = null;
    },

    update() {
      if (!layer) return null;
      const runtime = getRuntime();
      if (!runtime) {
        if (rings) rings.hide();
        layer.visible = false;
        return null;
      }
      // 判定引导环先画（常显层）；读数在无 runtime/无门时也产出（rings.reads）
      rings?.draw(runtime, hints);
      if (!getVisible()) {
        layer.visible = false;
        return null;
      }
      layer.visible = true;
      const core = runtime.model.internalModel.coreModel;
      const hasOpacity = typeof core.getDrawableOpacity === "function";
      // 提示层直挂 stage，坐标 = 舞台全局 = 画布 CSS px；可视区即画布矩形
      const W = app.screen.width;
      const H = app.screen.height;
      // 逐分区读数（HUD"交互点"组）：点 / 框无点 + 原因 / 被挡 / 出画，按真实现象分诊
      const dotReads = [];
      for (const h of hints) {
        // 标签 = 分区驱动的参数（见函数注释），逐帧解析：编排器随模型热切换
        // 网格名与反应编号错位的皮肤（shengluyisi_5 的 TouchDrag14 驱动 touch_drag21 等）标签里参数前带上分区名，才对得回分区
        const orch = getOrch?.();
        const hasMachine = !!orch?.machinesForZone(h.name).length;
        const verts = runtime.model.internalModel.getDrawableVertices(h.idx);
        // 画布内顶点数：被挡/无路由分区据此分"出画（泊位上的标记，物理上点不到）"与"入画（点得到却被挡，门控嫌疑）"；也作路由缓存失效信号（见下）
        let inView = 0;
        // 模型空间质心（相机无关）：健康/异常两态的锚点位移对照用，HUD 交互点组读数带出
        let mx = 0;
        let my = 0;
        for (let j = 0; j < verts.length; j += 2) {
          mx += verts[j];
          my += verts[j + 1];
          const p = runtime.model.toGlobal({ x: verts[j], y: verts[j + 1] });
          if (p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H) inView++;
        }
        const vn = verts.length / 2;
        mx = vn ? mx / vn : 0;
        my = vn ? my / vn : 0;
        // 不可交互一律不画：机器分区不按透明度跳过（游戏路由是纯几何射线，隐藏但在位的标记照样可触发，见 gestures.js machineZonesAt 注释），被挡下/未实现触发类型的分区跳过；无机器分区才按隐藏网格跳过（C# 路径的命中层恒可见，此分支兜底摆位零件等）
        if (
          !hasMachine &&
          (!hasOpacity || core.getDrawableOpacity(h.idx) <= 0.001)
        ) {
          h.dot.visible = h.label.visible = false;
          dotReads.push({
            name: h.name,
            status: "网格隐藏",
            bad: false,
            mx,
            my,
            op: hasOpacity ? core.getDrawableOpacity(h.idx) : null,
          });
          continue;
        }
        // 判定与颜色分家时的两套判据（见函数注释）：机器分区看参数机的可触发条件（type 9 点参机 parameter 为空、读的是他参，不能挂在 params 上判），无机器分区看 interaction.json 的起播门控
        const state = hasMachine ? orch.zoneInteractable(h.name) : null;
        const interactable = hasMachine
          ? state === true
          : runtime.canPlay(h.name);
        if (!interactable) {
          h.dot.visible = h.label.visible = false;
          dotReads.push({
            name: h.name,
            status: inView
              ? state === null
                ? "未实现:入画"
                : "挡:入画"
              : "挡:出画",
            bad: inView > 0,
            mx,
            my,
            op: hasOpacity ? core.getDrawableOpacity(h.idx) : null,
          });
          continue;
        }
        h.label.alpha = 0.85;
        const params = zoneParams(orch, h.name);
        const g = runtime.model.toGlobal({ x: mx, y: my });
        // 真实网格形状（边界环，模型空间顶点转全局坐标）：与 meshHitTest 同一几何 = 游戏 CubismRaycaster 的精确判定范围；包围盒会多出凹形/镂空处的大片空白，画框才能对照出"游戏点不到但包围盒覆盖"的区域
        let loops = loopCache.get(h.idx);
        if (loops === undefined) {
          loops = boundaryLoops(core.getDrawableVertexIndices(h.idx) ?? []);
          loopCache.set(h.idx, loops);
        }
        // 网格三角形下标：重定位的可见区点测与非流形网格的逐边描边共用
        const indices = core.getDrawableVertexIndices(h.idx) ?? [];
        // 遮挡/出画处理：提示点只钉在画布内的可触发位置（resolveRoute，锚点 = 画布内可见部分质心）。
        // 机器分区一律重定位——巨大网格的全顶点质心可能落在画布边缘的露出死角，不代表实际交互区；质心被其它分区盖住（名单序被压过）时同样靠它搬点
        // 无机器分区（摸头/普通触摸等 C# 路径，网格都在角色身上）只在质心出画时重定位，质心在画布内就钉质心
        // 出屏分区游戏里物理上点不到（C# GetDragPart 的射线恒过 Input.mousePosition，屏幕内坐标），画布内采不到落脚点（整网格出画/可路由区全被盖死/非流形网格连不成环）则藏点与标签，绿框照画（画布内的露出部分仍可见）
        // 路由结果按 idle 变体/在播动作缓存，变了才重算：缓存的是挂载信息（三角形重心坐标或质心锚），全局位置每帧随当前顶点重算，呼吸/动作形变时点跟着网格走；不追加"←胜者"文字标记：路由定案后点已搬走
        let spot = g;
        let dotLost = false;
        let lostWhy = "";
        const isMachine = !!orch?.machineByZone(h.name);
        const offView = g.x < 0 || g.y < 0 || g.x > W || g.y > H;
        if (isMachine || offView) {
          // 画布尺寸进键：resize 后搬点位置随可视区变化，旧值作废
          const key = `${orch?.idleIndex ?? ""}|${orch?.playActionName ?? ""}|${W}x${H}`;
          if (routeKey !== key) {
            routeKey = key;
            routeMap.clear();
          }
          // 缓存随姿态失效：标记网格由摆位参数驱动（不进上面的键），泊位↔上身切换时 idleIndex/playActionName 都不变，
          // 只按动作键缓存会让旧路由长期滞留（泊位上算出的 lost 挂住，网格上身后面框在点不在）。
          // 入画顶点数 + 质心位置变了即重算，呼吸形变（亚像素抖动）不触发
          const sig = `${inView}|${Math.round(g.x)}|${Math.round(g.y)}`;
          const cached = routeMap.get(h.name);
          let r = cached && cached.sig === sig ? cached.r : null;
          if (!r) {
            r = resolveRoute(
              runtime,
              orch,
              h.name,
              loops,
              verts,
              indices,
              g,
              W,
              H,
              isMachine,
            );
            routeMap.set(h.name, { r, sig });
          }
          if (r.lost) {
            dotLost = true;
            lostWhy = r.lost;
          } else if (r.bary) {
            // 钉在网格面上（三角形重心坐标）：每帧按当前顶点插值，随呼吸/动作形变走，与绿框同一几何
            const i3 = r.t * 3;
            const a = runtime.model.toGlobal({
              x: verts[indices[i3] * 2],
              y: verts[indices[i3] * 2 + 1],
            });
            const b = runtime.model.toGlobal({
              x: verts[indices[i3 + 1] * 2],
              y: verts[indices[i3 + 1] * 2 + 1],
            });
            const c = runtime.model.toGlobal({
              x: verts[indices[i3 + 2] * 2],
              y: verts[indices[i3 + 2] * 2 + 1],
            });
            spot = {
              x: r.bary[0] * a.x + r.bary[1] * b.x + r.bary[2] * c.x,
              y: r.bary[0] * a.y + r.bary[1] * b.y + r.bary[2] * c.y,
            };
          } else {
            // 质心锚（完全可见且可路由/落点挂不上三角形）：每帧用当前顶点重算，同样跟随
            spot = g;
          }
        }
        // 标签 = 分区驱动的参数（见 hintText 注释）：同名不重复、错位分区拼数字差（drag14:21），比全名短一个量级
        const text = hintText(h.name, params);
        if (h.label.text !== text) h.label.text = text;
        // 绿框恒画（含 dotLost）：出画/被盖只藏点与标签，网格露在画布内的部分仍是真实判定范围（= 游戏 CubismRaycaster 的判定几何），框必须可见；整网格出画时框画在画布外自然不可见
        h.dot.visible = true;
        h.dot.position.set(0, 0);
        h.dot.clear();
        // 走到这里的都是当前可交互的分区，恒绿
        const color = 0x4fc08d;
        if (loops) {
          // 顶点下标序列 -> 全局坐标扁平数组（缓存复用，每帧只重写值）
          const polys = loops.map((loop, li) => {
            let pts = scratchPolys.get(li);
            if (!pts || pts.length !== loop.length * 2) {
              pts = new Array(loop.length * 2);
              scratchPolys.set(li, pts);
            }
            for (let j = 0; j < loop.length; j++) {
              const p = runtime.model.toGlobal({
                x: verts[loop[j] * 2],
                y: verts[loop[j] * 2 + 1],
              });
              pts[j * 2] = p.x;
              pts[j * 2 + 1] = p.y;
            }
            return pts;
          });
          h.dot.lineStyle(1, color, 0.8);
          for (const pts of polys) {
            h.dot.moveTo(pts[0], pts[1]);
            for (let j = 1; j < pts.length / 2; j++) {
              h.dot.lineTo(pts[j * 2], pts[j * 2 + 1]);
            }
            h.dot.lineTo(pts[0], pts[1]);
          }
        } else {
          // 非流形网格连不成干净边界环：退化为逐条描边界边（boundaryEdges，只被一个三角形使用的边）——形状与环描边一致，只是没串成回路
          // 不做形状填充，统一只画绿框
          h.dot.lineStyle(1, color, 0.8);
          for (const [a, b] of boundaryEdges(indices)) {
            const pa = runtime.model.toGlobal({
              x: verts[a * 2],
              y: verts[a * 2 + 1],
            });
            const pb = runtime.model.toGlobal({
              x: verts[b * 2],
              y: verts[b * 2 + 1],
            });
            h.dot.moveTo(pa.x, pa.y);
            h.dot.lineTo(pb.x, pb.y);
          }
        }
        // 质心圆钉在 spot（画布内的可点位置，出画/被盖时已搬走）；真实质心不留痕（空心环会被当成第二个交互点的"幽灵点"），网格本尊的位置看绿框即可
        // dotLost（出画/被盖且画布内采不到落脚点）只藏点与标签：物理上点不到的位置不画误导性的点，绿框上面已照画
        if (dotLost) {
          h.label.visible = false;
          // 出画 = 整网格在画布外（框也不可见，泊位标记常态）；无采样/被盖 = 框在画布上却没点，诊断重点
          dotReads.push({
            name: h.name,
            status: lostWhy === "出画" ? "无点:出画" : `框无点:${lostWhy}`,
            bad: lostWhy !== "出画",
            mx,
            my,
            op: hasOpacity ? core.getDrawableOpacity(h.idx) : null,
          });
          continue;
        }
        h.label.visible = true;
        h.dot.beginFill(color, 0.35);
        h.dot.drawCircle(spot.x, spot.y, 9);
        h.dot.endFill();
        h.label.position.set(spot.x + 12, spot.y - 7);
        dotReads.push({
          name: h.name,
          status: isMachine || offView ? "点" : "点:质心",
          bad: false,
          mx,
          my,
          op: hasOpacity ? core.getDrawableOpacity(h.idx) : null,
        });
      }
      const state = [...runtime.statePids].map((pid) => [
        pid,
        Number(runtime.paramValue(pid).toFixed(2)),
      ]);
      // 连续摆位只报节点里的非默认残留（实时值被逐帧曲线扰动，不适合读数）
      const carried = [...runtime.carryPids]
        .filter(
          (pid) =>
            Math.abs((runtime.node.get(pid) ?? 0) - runtime.paramDefault(pid)) >
            runtime.eps,
        )
        .map((pid) => [pid, runtime.node.get(pid)]);
      return { state, carried, rings: rings ? rings.reads() : [], dots: dotReads };
    },
  };
}

