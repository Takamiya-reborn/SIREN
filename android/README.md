# 移动端工程（mobile 分支）

`main` 分支承载机制探究、调试与 bug 修复；`mobile` 分支在此之上构建 Android 安装版：给一般用户提供「装两个 App（SIREN + Shizuku）、手机上点开即用」的体验，脱离克隆仓库 / npm / adb 的开发者链路。

平台无关的重构（提取内核平台化、asset resolver）落在 main，mobile 只加 Android 壳与平台胶水；mobile 定期 merge main。

## 总体架构

```
桌面链路：adb 拉取 bundle → Node 提取烘焙落盘 models/ → dev server 伺服 → 浏览器渲染
移动链路：Shizuku 读设备 bundle → WebView 内纯内存提取 → blob URL 直喂引擎 → WebView 渲染
```

与桌面的三个本质差异：

1. **提取在 WebView 里实时做**，不落任何用户可见文件。产物进内存 Blob 主路径 + Android `cacheDir` 透明加速层（系统管理的缓存区，卸载/清除数据即净；失效键 = 皮肤 id + bundle 大小，设备侧 bundle 更新自动重提取）。缓存命中的加载是秒级水合，未命中才走提取。
2. **贴图 ASTC 原始块直通 GPU**：提取内核不解码 ASTC 成 PNG（桌面管线的最重一步），`readAstcRaw()` 原样搬出压缩块（块行逆序重排等价垂直翻转），打包为自定义容器（`packAstcTexture()`，magic "ASTCBIN" 头 + 原始块数据），由注入层构造 `CompressedTextureResource` 直接上传——对齐游戏本体做法。GPU 显存同步降一个量级（未压缩 RGBA 2048² ≈ 16MB/张 → ASTC 降 4-8 倍）。
3. **无 dev server**：清单三态（ready/cached/remote）由设备 bundle 列表 + 随包 `public/catalog.json`（纯名字元数据）在内存推导，桌面 UI 的 reactive 结构（`src/catalog.js` 的 MODELS/CATALOG）零改动复用。

## 虚拟路径空间

blob URL 不能作相对解析基座（`new URL` 以 blob 为 base 产出非法地址），所以**所有相对拼接都在虚拟路径空间完成**，只有取数边界翻译成真实 URL：

```
siren://<sessionId>/<dir>/<rel>   ← 挂载层、assets.js 的 modelDir/metaSibling 拼接全在此空间
blob:https://localhost/<uuid>     ← 仅 fetchAsset 取数边界（fileStore.resolve 翻译）
```

`src/platform/assets.js` 的两种拼接原语语义不同，勿混用：

- `metaSibling(url, name)`：入口文件名**后缀替换**（`fulici_2.model3.json` → `fulici_2.l2d.json`）——元数据文件带 id 前缀，目录拼接会丢前缀、请求落进 SPA 兜底返回 HTML，表现为优雅降级（参数机/取景 offset/转场时长全旁路）。
- `modelDir(url) + rel`：目录基座拼接——仅用于真相对路径（motion File 的 `motions/x.motion3.json`、spine 骨架）。

## 资源桥（两个实现，同一接口）

游戏 bundle 在 `Android/data/<游戏包>/files/AssetBundles/`，Android 11+ 分区存储对第三方 App 封死该目录（uid 级硬限制，`MANAGE_EXTERNAL_STORAGE` 也不豁免）。唯一入口是借 shell uid（=adb 同权），两个桥都实现同一组操作（`listFiles / sizeOf / readChunk / readText`）：

### 桥一：Shizuku（当前实现）

- 原生侧 `android/app/src/main/java/io/github/siren/viewer/`：`IFileBridge.aidl` + `FileBridgeService.java`（Shizuku UserService，跑在 shell uid）+ `ShizukuFilePlugin.java`（Capacitor 插件：授权流程、挂起调用队列、binder 死亡重绑）。
- JS 侧 `src/mobile/shizuku.js`：三服包名探测（`findGameRoot`）、bundle 分块拉取（`readBundle`，2MB/块 onChunk 流式回调）、`hashes.csv` spine 名单解析。
- 用户代价：装 Shizuku（商店/GitHub）→ 无线调试配对一次 → App 内点授权；每次重启手机需重新启动 Shizuku（root 用户可自启）。

### 桥二：内嵌 adb（规划中，同接口替换）

- 用 AOSP `ddmlib`（`com.android.tools.ddms:ddmlib`，Google Maven）承载连接栈（CNXN/AUTH/TLS）；配对协议 SPAKE2+ 在 ddmlib 有 `AdbPairingClient`（内部 API，或按 AOSP `adb/pairing/` 移植）；端口经 NSD/mDNS（`_adb-tls-connect._tcp`）免权限发现。
- 省掉 Shizuku 安装与授权步骤，前置条件相同（开发者选项 + 无线调试，重启后需重开无线调试）；Android 10 及以下无此墙，可直读。
- 桥无关性由 `src/mobile/extractor.js` 保证：bundle 字节来自 `readBundle` 流式回调，上游换桥不动编排层。

## 模块清单（src/mobile/）

| 模块           | 职责                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `shizuku.js`   | Shizuku 桥 JS 封装 + M3 验收探针（`installProbe()` 暴露 `window.__sirenProbe`）                                     |
| `fileStore.js` | 虚拟路径会话库：内存 Blob 主路径 + cacheDir 透明加速（两层设计，单一 blob 服务机制）                                |
| `platform.js`  | 向 `src/platform/assets.js` 注册 `siren://` 翻译；引擎级注入（Live2DFactory 中间件 + 压缩纹理构造）是 P2 探针验证项 |
| `manifest.js`  | 设备 bundle + 随包 catalog.json → 三态清单（`initManifest` / `markReady`）                                          |
| `extractor.js` | 加载编排：缓存命中水合 / 未命中实时提取（`ensureSkin`），桥无关                                                     |
| `lua.js`       | l2d.json 烘焙数据源：双源拉取（jsdelivr 优先 + GitHub raw 兜底）+ IndexedDB 缓存 + TTL 静默刷新                     |
| `pngEncode.js` | OffscreenCanvas PNG 编码（ASTC 不支持设备的 wasm 解码降级路径；桌面 CLI 仍走 `scripts/extract/png.js`）             |

提取内核复用 main 的 `scripts/extract/`（平台无关化后的产物）：`extractSkin()` 以字节进/`sink(dir, rel, bytes)` 出，`textureMode: "astc"`、`lua` 文本注入、`includeInventory: false`。

## 构建链路（无 Android Studio，纯 CLI）

```
npx vite build          # dist/
npx cap sync android    # web 产物拷进原生壳
cd android && ./gradlew assembleDebug    # APK: app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

环境要点（本机踩过的坑，重装环境时对照）：

- **JDK 21**（Capacitor 8 的 AGP 工具链要求 languageVersion 21）：`D:/Android/openjdk/jdk-21/jdk-21.0.13.1+2`，构建时 `export JAVA_HOME` 指向它。
- **Android SDK**（`D:/Android/android-sdk`）：需 build-tools 35 + platform 36（Capacitor 8 variables.gradle 指定 compileSdk 36），许可经 `sdkmanager --licenses` 接受。
- **`android/local.properties`**：`sdk.dir` 用正斜杠（`sdk.dir=D:/Android/android-sdk`）——properties 格式把反斜杠当转义符，`D:\Android` 会吃掉 `\A` 产生非法路径（症状：配置阶段抛"文件名、目录名或卷标语法不正确"）。
- **Gradle 发行包下载**：`gradle-wrapper.properties` 的 distributionUrl 指向腾讯云镜像（services.gradle.org 直连超时）。
- **依赖下载走代理**：`JAVA_TOOL_OPTIONS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890 ..."`（端口按本机实际探测，会漂移）；或给 GRADLE_USER_HOME 写 systemProp。
- **构建会话缓存**：`GRADLE_USER_HOME=D:/Github/SIREN/.tmp/gradle-home`（.tmp 是 gitignore 的中间产物区）。中断过的构建留下的锁/半成品要用 `./gradlew --stop` + 清 `caches/` 整目录重建，单清 transforms 会与 daemon 文件占用打架。

## 验收探针

M3 验收（桥通）经 chrome://inspect 在 WebView 控制台执行 `window.__sirenProbe`：

```js
await __sirenProbe.status(); // Shizuku installed/granted
await __sirenProbe.requestAccess(); // 授权弹窗
await __sirenProbe.findGameRoot(); // 三服包名探测
await __sirenProbe.listBundles(); // AssetBundles 目录枚举
await __sirenProbe.verifyRead("fulici_2"); // 整读 bundle + CRC32（与 adb pull 侧比对）
await __sirenProbe.spineIndex(); // hashes.csv spine 名单
```

M4 验收（全链路）= 一个 L2D + 一个 ani（`_res` 配对）+ 双形态 + changeskin 从「设备 bundle → 内存提取 → blob 挂载 → 渲染交互」跑通；缓存正确性专项：首载走提取 → 重载 cacheDir 命中秒开 → 系统清除数据后缓存全净 → 卸载重装无残留。探针先行项（P1/P2a/P2b/P4）见实施计划：unityfs-js 浏览器加载耗时、pixi-live2d-display 压缩纹理注入、pixi-spine atlas 页名改写、40MB 皮肤内存/耗时账。

## 已知风险（实现期对照）

- pixi-live2d-display 0.4 / pixi-spine 3.8 的注入点与版本强耦合——P2 探针先行，版本锁定不轻动。
- 内存峰值（40MB bundle 提取期 ≈ 120-180MB，缓存命中路径无提取峰值）——低配 32-bit WebView 是风险点，P4 实测覆盖。
- blob 生命周期与换挂时序严格对齐：同皮肤重挂复用 session，revoke 在新模型揭幕完成后 +1 帧；`hud/index.js` 的 motionJsonCache 跨 session 会串档，键加 session id 或换挂时 clear。
- ASTC 块行反转的 GPU 采样对齐（块内 texel 行序是否还需 flipY）以 decodeAstcRgba 路径输出为参照 A/B 比对。
