/** 提示点路由：命中分区胜者判定与露出点重定位（消费方 hints/index.js）。纯函数，runtime/orch 均为参数。 */
import { boundaryEdges, meshHitTest } from "../hitTest.js";
import { pointInTri, attachTri, clipMidpoint } from "./geometry.js";

/** 点 (x,y)（舞台坐标）按手势同款规则路由到的机器分区：命中分区里 ship_l2d 名单序最大者胜（游戏 GetDragPart 反汇编语义：遍历 raycast 命中逐个 FindIndex 取 running max，同 gestures.js 的 machineZonesAt，纯几何无透明度过滤），并列取先遇者：'' = 该点没有可交互机器分区 */
export function routeWinner(runtime, orch, x, y) {
  const hits = meshHitTest(runtime.model, x, y);
  const areas = runtime.model.internalModel.hitAreas ?? {};
  let found = "";
  let bestOrder = -1;
  for (const name of hits) {
    const order = orch.zoneOrder(name);
    if (order < 0) continue;
    if (areas[name]?.index === undefined) continue;
    if (order > bestOrder) {
      bestOrder = order;
      found = name;
    }
  }
  return found;
}

/** 露出点重定位：提示点钉到"按下去真能触发本分区"的画布内位置。
 * 巨大网格（如 4374×4000 的背景板）顶点稀疏，全顶点质心会落在画布边缘的露出死角，不代表实际交互区，锚点按"画布内可见网格区"取：
 * ① 画布 12×12 采样点做本分区三角形的点测（只遍历本分区三角形），命中的 = 可见网格区，其质心即锚点；
 * ② 采样网格会漏低细露出区（细条带），边界环边中点兜底（必在网格上）。
 * 完全可见（全部顶点在画布内）且质心可路由的分区免采样，直接钉全顶点质心（位置精确）。
 * 候选按离锚点距离升序逐个做路由验证（机器分区：名单序路由回本分区；无机器分区：落在网格上即可点），第一个通过即返回——最近的可触发点，可路由区全被盖死才扫完。
 * 候选只收画布内的点：画布外的露出点物理上点不到，搬过去等于没搬。
 * 逐顶点变换与路由采样只在路由缓存重算时跑。返回落脚点的挂载信息：{ t, bary } = 三角形 t 的重心坐标（调用方每帧按当前顶点插值，点随呼吸/动作形变走）；{ centroid: true } = 每帧钉全顶点质心；{ lost: 原因 } = 画布内采不到（出画 = 整网格在画布外，无采样 = 擦边且边界裁剪也采不到的非流形退化，被盖 = 可路由区全被名单序压过）——调用方只画框不出点（dotLost） */
export function resolveRoute(
  runtime,
  orch,
  name,
  loops,
  verts,
  indices,
  g,
  W,
  H,
  byRoute,
) {
  const inView = (p) => p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
  const model = runtime.model;
  // 全顶点转全局（缓存重算时一次，巨大网格可接受），顺带统计画布内顶点数
  const nv = verts.length / 2;
  const gv = new Array(nv);
  let nIn = 0;
  for (let j = 0; j < nv; j++) {
    const p = model.toGlobal({ x: verts[j * 2], y: verts[j * 2 + 1] });
    gv[j] = p;
    if (inView(p)) nIn++;
  }
  if (!nIn) return { lost: "出画" };
  // 完全可见：质心可路由就钉质心（免采样，每帧重算跟随形变）；质心被盖（名单序被压过）走下面的采样
  if (nIn === nv && (!byRoute || routeWinner(runtime, orch, g.x, g.y) === name)) {
    return { centroid: true };
  }
  // 候选：画布采样点里落在本分区网格上的（可见网格区，记命中三角形下标）
  const pts = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = (W * i) / N;
      const y = (H * j) / N;
      for (let t = 0; t < indices.length; t += 3) {
        const a = gv[indices[t]];
        const b = gv[indices[t + 1]];
        const c = gv[indices[t + 2]];
        if (pointInTri(x, y, a.x, a.y, b.x, b.y, c.x, c.y)) {
          pts.push({ x, y, t: t / 3 });
          break;
        }
      }
    }
  }
  // 采样网格漏掉的低细露出区：边界环边中点兜底（必在网格上），记模型空间坐标供挂载
  if (loops) {
    for (const loop of loops) {
      const step = Math.max(1, Math.floor(loop.length / 24));
      for (let i = 0; i < loop.length; i += step) {
        const va = loop[i];
        const vb = loop[(i + 1) % loop.length];
        const p = {
          x: (gv[va].x + gv[vb].x) / 2,
          y: (gv[va].y + gv[vb].y) / 2,
          lp: {
            x: (verts[va * 2] + verts[vb * 2]) / 2,
            y: (verts[va * 2 + 1] + verts[vb * 2 + 1]) / 2,
          },
        };
        if (inView(p)) pts.push(p);
      }
    }
  }
  // 擦边细条带兜底：采样网格与边界中点全落空（网格与画布只交一条细缝），把边界边按画布矩形裁剪（Liang-Barsky），裁剩段中点必在网格边界上且在画布内
  if (!pts.length) {
    const edges = [];
    if (loops?.length) {
      for (const loop of loops) {
        for (let i = 0; i < loop.length; i++)
          edges.push([loop[i], loop[(i + 1) % loop.length]]);
      }
    } else {
      edges.push(...boundaryEdges(indices));
    }
    for (const [va, vb] of edges) {
      const m = clipMidpoint(gv[va].x, gv[va].y, gv[vb].x, gv[vb].y, W, H);
      if (m) pts.push(m);
    }
  }
  if (!pts.length) return { lost: "无采样" };
  // 锚点 = 可见网格区质心；候选按离锚点升序逐个路由验证，第一个通过即返回
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const ax = sx / pts.length;
  const ay = sy / pts.length;
  pts.sort(
    (a, b) =>
      (a.x - ax) ** 2 + (a.y - ay) ** 2 - ((b.x - ax) ** 2 + (b.y - ay) ** 2),
  );
  for (const p of pts) {
    if (byRoute && routeWinner(runtime, orch, p.x, p.y) !== name) continue;
    // 挂到三角形上（模型空间定住重心坐标，形变由插值吸收）；挂不上（凹形网格落点在网格外等）退化为每帧钉质心
    const lp = p.lp ?? model.toLocal(p);
    return attachTri(lp, verts, indices) ?? { centroid: true };
  }
  return { lost: "被盖" };
}
