// 移动端平台装配：
// 1) 向 src/platform/assets.js 注册 siren:// 虚拟路径翻译（本项目代码的取数边界）
// 2) pixi-live2d-display 引擎注入：Live2DLoader 中间件把虚拟路径翻译成 blob URL——
//    settings.url 保持虚拟地址，默认 resolveURL（url.resolve 对虚拟地址拼相对路径）
//    天然在虚拟空间工作，仅取数边界需要翻译
// 3) ASTC 压缩纹理直通（CompressedTextureResource + 自定义容器 parse 插件）是 P2a 探针
//    验证项；当前提取走 textureMode png（浏览器 OffscreenCanvas 编码），贴图以 blob URL
//    经 Image 资源加载，无需本项即可挂载

import { fileStore } from "./fileStore.js";
import { registerAssets } from "../platform/assets.js";
import { Live2DFactory, Live2DLoader } from "pixi-live2d-display/cubism4";

// 取数边界翻译：siren:// -> blob URL；其余 URL（public/ 资产 catalog.json 等）原样直取
registerAssets({
  resolve: (url) =>
    url.startsWith("siren://") ? fileStore.resolve(url) : url,
});

// 引擎取数边界翻译（两层）：
// 1) Live2DLoader 中间件：模型入口 JSON 的 fetch（此时 settings 尚未创建，URL 原始为 siren://）
// 2) settings.resolveURL 覆写：settings.url 保持虚拟地址，库默认 resolveURL 在虚拟空间拼出
//    相对资源地址（moc3/motions/physics/贴图），覆写后翻译成 blob URL 交 XHR/Image——
//    第三方取数点（hud 的 settings.resolveURL 消费）随之自动获得可 fetch 地址
Live2DLoader.middlewares.unshift((context, next) => {
  if (typeof context.url === "string" && context.url.startsWith("siren://")) {
    context.url = fileStore.resolve(context.url);
  }
  return next();
});

// jsonToSettings 是 live2DModelMiddlewares 的第 3 项（FileLoader.factory unshift 后下标 2），
// 插到其后：settings 就绪即覆写 resolveURL
Live2DFactory.live2DModelMiddlewares.splice(3, 0, (context, next) => {
  const settings = context.settings;
  if (settings && typeof settings.url === "string" && settings.url.startsWith("siren://")) {
    const original = settings.resolveURL.bind(settings);
    settings.resolveURL = (path) => {
      const joined = original(path);
      return joined.startsWith("siren://") ? fileStore.resolve(joined) : joined;
    };
  }
  return next();
});
