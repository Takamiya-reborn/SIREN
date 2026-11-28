import { Capacitor } from "@capacitor/core";
import { createApp } from "vue";
import App from "./App.vue";
import { loadCatalog, loadModels } from "./catalog";
import { initManifest } from "./mobile/manifest.js";
import { installProbe } from "./mobile/shizuku.js";
import "./style.css";

// App 宿主内暴露 M3 验收探针（chrome://inspect 控制台用，桌面 dev 不注入）
installProbe();

// 清单与目录都到位后再挂载，避免首帧空列表；失败也照常挂载（空清单 + 控制台报错）
// 桌面 = dev server 端点；App = 设备 bundle + 随包 catalog.json（manifest.js）
const ready = Capacitor.isNativePlatform()
  ? initManifest()
  : Promise.all([loadModels(), loadCatalog()]);
ready.finally(() => createApp(App).mount("#app"));
