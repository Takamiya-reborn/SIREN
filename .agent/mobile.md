# 移动端制作

## reference

需要注意main分支的更新，保证功能同步

## 构建链路
- `npm run apk`（scripts/build_apk.mjs）= vite build → cap sync → gradle → 产物提升 android/SIREN.apk；`--skip-web` 只跑 gradle。环境要点（JDK 21 自动探测 / sdk.dir 正斜杠 / GRADLE_USER_HOME=.tmp/gradle-home）见脚本头注。
- lua 随包基线 public/lua/（gitignore）由构建期供给（本地 .tmp/lua/CN 快照优先，curl 社区仓库兜底）；lua.js 三层取数（随包 → IndexedDB → 社区双源）。

## ASTC 直通（P2a）
- 注入点是 `Texture.fromURL`（astcTexture.js + blob URL 注册表），非 Loader parse 插件——pixi-live2d-display 0.4 贴图不走 Loader；v6 CompressedTextureResource 对 ASTC 不可用，自写 AstcResource。
- 容器 packAstcTexture/astcBin.js：头 20 字节对齐布局，单测 test_astcbin.mjs；能力探测不支持时回退 png，缓存可挂载性按 hasAstcTextures 校验。
- spine/changeskin clamp 到 png（atlas 页名 .png 键承载），页名改写属 P2b；真机行序 A/B 对照未定案。

## 移动端差异（排障入口）
- 诊断：`android.loggingBehavior: none`（桥整段序列化 readChunk 返回值拖垮提取）→ console.* 经 ShizukuFilePlugin.log 进 logcat `SIREN` tag；未捕获异常同通道兜底。
- 过桥纪律：Uint8Array 被 JSON 数组逐字节装箱（4MB ≈ 百 MB Java 堆），大字节必须 base64；写盘串行队列，seal 先等队列再写元数据。
- 主进程 Java 堆配额 256MB（与物理内存无关），OOM 看 `logcat -b crash` 的 target footprint。
- 虚拟路径：fileStore.resolve 剥 dir 前缀（会话存裸相对键）；缓存路径 meta 按产物文件名判别 type。

## 遗留
- 挂载失败未结案：resolveURL 覆写对 moc3/贴图未生效（实测 siren:// 直达 XHR），探针已埋 platform.js。
- 模拟器（无 ASTC）回退 png 仍 wasm 崩溃；spine 大皮肤内存峰值未实测（P4）。