/** 提示层几何件：三角形点测/重心挂载/画布裁剪（消费方 route.js）。纯函数。 */

/** 点 (x,y) 是否在三角形内（含边界，同号判定）：本分区网格点测用 */
export function pointInTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** 点 p 在三角形 (a,b,c) 里的重心坐标 [α,β,γ]（α 对应 a），退化三角形返回 null */
export function baryOf(px, py, ax, ay, bx, by, cx, cy) {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const det = e1x * e2y - e2x * e1y;
  if (Math.abs(det) < 1e-9) return null;
  const ex = px - ax;
  const ey = py - ay;
  const beta = (ex * e2y - e2x * ey) / det;
  const gamma = (e1x * ey - ex * e1y) / det;
  return [1 - beta - gamma, beta, gamma];
}

/** 落点挂载：找包含它的三角形记重心坐标（边界点取首个命中），挂不上（凹形网格质心落在网格外等）返回 null，调用方退化为每帧钉质心 */
export function attachTri(lp, verts, indices) {
  for (let t = 0; t < indices.length; t += 3) {
    const ax = verts[indices[t] * 2];
    const ay = verts[indices[t] * 2 + 1];
    const bx = verts[indices[t + 1] * 2];
    const by = verts[indices[t + 1] * 2 + 1];
    const cx = verts[indices[t + 2] * 2];
    const cy = verts[indices[t + 2] * 2 + 1];
    if (pointInTri(lp.x, lp.y, ax, ay, bx, by, cx, cy)) {
      const bary = baryOf(lp.x, lp.y, ax, ay, bx, by, cx, cy);
      return bary ? { t: t / 3, bary } : null;
    }
  }
  return null;
}

/** 边界边与画布矩形的裁剪交段中点（Liang-Barsky）：擦边细条带与画布只交一条缝，采样网格与边界中点全落空；不交返回 null */
export function clipMidpoint(ax, ay, bx, by, W, H) {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, ax)) return null;
  if (!clip(dx, W - ax)) return null;
  if (!clip(-dy, ay)) return null;
  if (!clip(dy, H - ay)) return null;
  return { x: ax + ((t0 + t1) / 2) * dx, y: ay + ((t0 + t1) / 2) * dy };
}
