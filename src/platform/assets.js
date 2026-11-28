/**
 * 资产解析抽象（平台无关）：全部清单/模型/转场资源的 URL 拼接与取数收敛到本模块。
 * 默认实现 = 站内静态路径语义（dev server / vite build 伺服 /models 与 /api）；
 * 移动端宿主经 registerAssets() 注入自己的实现（虚拟路径 -> 可 fetch URL 的翻译）。
 *
 * 硬约束：blob: URL 不能作相对解析基座（new URL 的 base 为 blob 时产出非法地址），
 * 所有相对拼接必须在「虚拟路径空间」完成，只有取数边界（fetchAsset）允许把
 * 虚拟路径翻译成真实 URL。调用方一律经本模块拼接，禁止手写 url.replace / new URL 变体。
 */

let impl = {
  /** 皮肤清单端点（dev server 实时扫描生成） */
  manifestUrl: () => "/models/manifest.json",
  /** 皮肤目录端点（显示名映射 + 资源状态合并） */
  catalogUrl: () => "/api/catalog",
  /** changeskin 转场覆盖层目录（跨皮肤共享，不在皮肤清单内）；file 为空时返回带尾斜杠的目录基座 */
  changeskinUrl: (action, file = "") => `/models/changeskin/${action}/${file}`,
  /** 模型目录基座（剥掉末段文件名，保留尾斜杠语义与 url.replace(/[^/]*$/, "") 一致） */
  modelDir: (modelUrl) => modelUrl.replace(/[^/]*$/, ""),
  /** 取数前的最终翻译：虚拟路径 -> 可 fetch 的真实 URL（默认恒等） */
  resolve: (url) => url,
};

/** 宿主注入平台实现；只覆盖提供的键，其余保持默认语义 */
export function registerAssets(overrides) {
  impl = { ...impl, ...overrides };
}

export const manifestUrl = () => impl.manifestUrl();
export const catalogUrl = () => impl.catalogUrl();
export const changeskinUrl = (action, file) => impl.changeskinUrl(action, file);
export const modelDir = (modelUrl) => impl.modelDir(modelUrl);

/**
 * 模型同目录子资源 URL。两种形态，勿混用：
 * - metaSibling：入口文件名的后缀替换（suweiaitongmeng_3.model3.json -> suweiaitongmeng_3.l2d.json），
 *   用于 <id>.interaction.json / <id>.l2d.json / <id>.fades.json 这类带 id 前缀的元数据
 * - modelDir + rel：目录基座拼接，用于 motion File（"motions/x.motion3.json"）与 spine 骨架等真相对路径
 */
export const metaSibling = (modelUrl, fileName) =>
  modelUrl.replace(/model3\.json$/, fileName);

/** 模型同目录子资源 URL：rel 可带子路径（"motions/x.motion3.json"），也可传 "" 取目录基座 */
export const siblingModelUrl = (modelUrl, rel) => impl.modelDir(modelUrl) + rel;

/** 取数边界：先把虚拟路径翻译成真实 URL 再 fetch */
export async function fetchAsset(url) {
  return fetch(impl.resolve(url));
}

/** 宽容 JSON 取数：HTTP 非 ok / 网络异常 / 解析失败一律返 null（交互配置等缺失可降级的场景） */
export async function fetchJson(url) {
  try {
    const r = await fetchAsset(url);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** 严格 JSON 取数：HTTP 非 ok 抛错（元数据缺失即挂载失败的场景） */
export async function fetchJsonStrict(url) {
  const r = await fetchAsset(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
