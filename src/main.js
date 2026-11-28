import { Capacitor } from "@capacitor/core";
import { createApp } from "vue";
import App from "./App.vue";
import { loadCatalog, loadModels } from "./catalog";
import { initManifest } from "./mobile/manifest.js";
import { installProbe } from "./mobile/shizuku.js";
import "./style.css";

// App 宿主内暴露 M3 验收探针（chrome://inspect 控制台用，桌面 dev 不注入）
installProbe();

// 移动端视口适配：CSS px 视口远小于桌面设计尺寸（如 854×384），px 定值的 UI 元素
// 相对过大。按视口高度对根节点做 CSS zoom 等比缩放，下限 0.5 防过度缩小
if (Capacitor.isNativePlatform()) {
  const fitViewport = () => {
    document.documentElement.style.zoom = String(
      Math.min(1, Math.max(0.5, innerHeight / 780)),
    );
  };
  addEventListener("resize", fitViewport);
  fitViewport();
}

// 清单与目录都到位后再挂载，避免首帧空列表；失败也照常挂载（空清单 + 控制台报错）
// 桌面 = dev server 端点；App = 设备 bundle + 随包 catalog.json（manifest.js）
const ready = Capacitor.isNativePlatform()
  ? initManifest()
  : Promise.all([loadModels(), loadCatalog()]);
ready.finally(() => createApp(App).mount("#app"));
