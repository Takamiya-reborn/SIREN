// 移动端平台装配：
// 1) 向 src/platform/assets.js 注册 siren:// 虚拟路径翻译（本项目代码的取数边界）
// 2) pixi-live2d-display 引擎注入：Live2DLoader 中间件把虚拟路径翻译成 blob URL——
//    settings.url 保持虚拟地址，默认 resolveURL（url.resolve 对虚拟地址拼相对路径）
//    天然在虚拟空间工作，仅取数边界需要翻译
// 3) ASTC 压缩纹理直通（P2a）：贴图不逐像素解码，ASTCBIN 容器经 patched
//    Texture.fromURL 构造压缩纹理直喂 GPU；实现与注册表见 astcTexture.js

import { Capacitor } from "@capacitor/core";
import { fileStore } from "./fileStore.js";
import { registerAssets } from "../platform/assets.js";
import { Live2DFactory, Live2DLoader } from "pixi-live2d-display/cubism4";
import { registerAstcTextureSupport } from "./astcTexture.js";
import { shizukuNative } from "./shizuku.js";

// 诊断日志直通 logcat（SIREN tag）：桥日志已关（capacitor.config.json
// android.loggingBehavior none，否则每个 readChunk 的 512KB 返回值都会被整段
// 序列化进日志拖垮提取），console 不再转发 logcat——console.* 镜像进原生
// log 方法，排障不依赖 Capacitor 日志链。全局兜底：未处理 rejection 与
// window.onerror 也走这里（静默挂载失败的唯一线索）
if (Capacitor.isNativePlatform()) {
  const stringify = (a) => {
    if (typeof a === "string") return a;
    // Error 的 JSON 形态是 {}，必须展开 message/stack 才有诊断价值
    if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
    try {
      return JSON.stringify(a) ?? String(a);
    } catch {
      return String(a);
    }
  };
  for (const level of ["info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      shizukuNative
        .log({ level, msg: args.map(stringify).join(" ").slice(0, 2000) })
        .catch(() => {});
    };
  }
  addEventListener("unhandledrejection", (e) => {
    console.error("[unhandledrejection]", stringify(e.reason));
  });
  addEventListener("error", (e) => {
    console.error("[window.onerror]", e.message, `${e.filename}:${e.lineno}`);
  });
}

// 取数边界翻译：siren:// -> blob URL；其余 URL（public/ 资产 catalog.json 等）原样直取
registerAssets({
  resolve: (url) => (url.startsWith("siren://") ? fileStore.resolve(url) : url),
});

// ASTC 加载注入：patched Texture.fromURL 按注册表分流（桌面 dev 无 siren:// 产物，
// 注册表恒空，patch 原样放行）
registerAstcTextureSupport();

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
  console.info(
    `[platform] override 检查: settings.url=${String(settings?.url).slice(0, 60)}`,
  );
  if (
    settings &&
    typeof settings.url === "string" &&
    settings.url.startsWith("siren://")
  ) {
    const original = settings.resolveURL.bind(settings);
    settings.resolveURL = (path) => {
      const joined = original(path);
      const resolved = joined.startsWith("siren://")
        ? fileStore.resolve(joined)
        : joined;
      console.info(
        `[platform] resolveURL ${path} -> ${joined.slice(0, 70)} -> ${resolved.slice(0, 46)}`,
      );
      return resolved;
    };
  }
  return next();
});
