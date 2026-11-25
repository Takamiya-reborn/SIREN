# 架构与任务→文件映射

碧蓝航线 Live2D 皮肤查看器：从游戏客户端提取资源，重组为标准 Cubism 模型（moc3 v4/v5），在浏览器中还原动画与交互；ani 类动态皮肤（spine 骨架，见 spine.md）走独立提取与挂载链。技术栈 Vue 3 + Vite + PixiJS 6 + pixi-live2d-display + @pixi-spine/all-3.8，工具链纯 Node（见 extract.md）。

锚点格式为「文件 + 函数符号」，grep 函数名即达实现；改代码时同步更新本文锚点。

## 查看器运行时（src/l2d/）

| 逻辑 | 位置 |
|---|---|
| 挂载总入口（url 以 .spine.json 结尾分流 spine 链，两条链均动态 import） | mount/index.js `mountModel()` |
| L2D 挂载链（时序令牌、复位缓动登记、Breath 移除、trackMotionStart 补账、编排器装配、入口 idle） | mount/l2dMount.js `mountL2dModel()` |
| 揭幕时序（形态切换闸门等待循环 + 两帧后揭幕序列，两链共用） | mount/reveal.js `waitRevealGate()` / `scheduleReveal()` |
| 挂载内嵌诊断（锚点元凶自动取证、60 帧探针） | mount/diagnostics.js `maybeAnchorSweep()` / `installFrameProbe()` |
| Ani（spine）皮肤挂载链（皮肤激活、分层预制体、宿主钩子） | mount/spineMount.js `mountSpineModel()` / `applySkin()` / `startPart()` |
| spine 取景几何（hitArea 优先 → 内容分位数框 → 全包围盒） | mount/spineFit.js `fitSpine()` / `attachmentBoxes()` |
| 动作播放、动作变体切换、就地复位 | motion/actions.js `createActions()` → `playMotion()` / `resetInteraction()` / `handleHitAreas()` |
| 拖拽视线跟随与手势分发 | gestures.js `createGestures()` → `followGaze()` / `resetGaze()` / `machineZonesAt()` |
| 相机取景与锚点（游戏三层取景链 + 按宽适配 + userView 三轴、spine 分支转发，语义见 runtime.md 取景节） | camera.js `createCamera()` → `fitModel()` / `measureScene()` / `pickAnchorX()` |
| 誓约戒指（Paramring 逐帧写） | fx/ring.js `RING_PARAM` / `createOathRing()` |
| 调色板 keyform 颜色动画 | fx/palette.js `installPalette()`；渲染补丁 fx/colorPatches.js `installColorPatch()` |
| effect 组常驻氛围层（贝塞尔曲线采样叠加） | fx/ambient.js `loadAmbient()` / `sampleCurve()` |
| 触点涟漪（游戏 ui/clickeffect 同构） | fx/clickEffect.js `createClickEffect()` → `spawn()` / `updateParticle()` |
| 曲线目标序归一化（混排修复的运行时侧） | motion/patches.js `normalizeCurveTargetOrder()` / `installMotionPatches()` |
| 参数覆写层 | hud/paramOverride.js `createParamOverride()` |
| HUD 数据侧（含取景三轴注入 view 组） | hud/index.js `createTickerCallback()` → `motionDiffReadout()` / `overrideReadout()` / `paramListReadout()` / `view`；差分采样 motion/diff.js `diffMotion()` |

## 交互层（src/dragmachine/ + src/interaction/）

| 逻辑 | 位置 |
|---|---|
| 单台参数机壳（构造器、状态契约表、状态属主方法） | dragmachine/machine.js `DragMachine`（契约表在文件头） |
| 触发链路（冷却、点击判定触发、联动事件、type 12 扩展门） | dragmachine/machineTrigger.js `triggerAble()` / `applyClickTrigger()` / `applyTrigger()` / `onListenerEvent()` |
| 指针事件（startDrag/onDrag/stopDrag、档位吸附） | dragmachine/machinePointer.js `onDown()` / `onMove()` / `onUp()` / `updatePartsSnap()` |
| 每帧步进与查询（平滑趋近、relation 联动求值、interactable） | dragmachine/machineStep.js `step()` / `updateRelations()` / `interactable()` |
| 数学件与阈值（SmoothDamp、fixRange） | dragmachine/math.js `smoothDamp()` / `fixRange()` |
| 编排器壳（路由面、指针分发、按压锁、白名单检查、复位） | dragmachine/orchestrator.js `DragOrchestrator` / `loadL2dConfig()` |
| 播放路由（activeData 应用、idle 变体切换、播放状态回报） | dragmachine/playRoute.js `onActionApply()` / `applyActiveData()` / `noteMotionStart()` |
| 下棋小游戏（type 15/16 棋局） | dragmachine/xiaqi.js `xiaqiClick()` / `xiaqiCheckFinish()` |
| 机器参数图层（Override/Additive/Multiply 两阶段叠加） | dragmachine/layers.js `layerEntries()` / `restoreLayer()` / `applyLayer()` |
| HUD 读数聚合 | dragmachine/readouts.js `gateInfo()` / `hudInfo()` |
| 触发处理器分发 | dragmachine/triggers.js `TRIGGER_HANDLERS` |
| 交互运行时（挂起动作结算、表外补账、平滑复位） | interaction/runtime.js `loadInteraction()` → `trackMotionStart()` / `applyEnd()` / `beginSmoothReset()` |
| 分区命中（网格三角形逐点判定、边界环提取） | interaction/hitTest.js `meshHitTest()` / `boundaryEdges()` / `boundaryLoops()` |
| 交互点提示层（工厂壳 + 逐分区绘制） | interaction/hints/index.js `createInteractionHints()` |
| 提示点路由（命中胜者、露出点重定位） | interaction/hints/route.js `routeWinner()` / `resolveRoute()`；几何件 hints/geometry.js；标签 hints/labels.js |
| 判定引导环（type 11 扫描动效） | interaction/hints/judgeRings.js `createJudgeRings()` |
| 锚点元凶扫描（诊断） | interaction/hints/anchorSweep.js `anchorCulpritSweep()` |
| 皮肤目录与模型清单（唯一 Vue 依赖模块） | src/catalog.js `MODELS` / `CATALOG` / `loadCatalog()` / `CAMP_LABELS` / `TRIGGER_LABELS` |

## 前端界面

- App.vue 总入口；components/stage/（L2dStage.vue 舞台壳 + stageContext.js ctx 工厂 + stageLifecycle.js pixi 装配/销毁 + usePersistedFlag.js 持久化开关）；components/hud/（HudPanel.vue 面板壳 + Toolbar.vue 工具排 + GroupSection.vue 折叠组壳 + groups/ 六面板组 + panelGroups.js 分组开合持久化 + panel.css 共享样式）；components/sidebar/（SkinTab.vue 皮肤页 + useSkinFilters.js 筛选状态 + StateTab.vue 状态页 + ScrollBar.vue）；components/PullDialog.vue 拉取浮层。

## 提取与工具链（scripts/）

| 逻辑 | 位置 |
|---|---|
| 提取/烘焙主脚本 | extract.js（用法见 docs/unpack.md） |
| bundle 解包、哈希死绑定、层级构建 | scripts/extract/bundle.js `loadBundle()` / `resolveHashBindings()` / `buildHierarchy()` |
| lua 模板解析与烘焙（offset/位移表与机器条目解耦等约定见 extract.md） | scripts/extract/lua.js `bakeL2d()` / `readAllSkinTemplates()` / `parseShipL2d()` / `readMainuiShift()` / `idleIndex()` |
| moc3 参数节表 | scripts/extract/moc3.js `moc3ParamTables()` |
| 动作转换（流式帧、常量段、边界状态、分组） | scripts/extract/motion.js `convertClip()` / `constantKeys()` / `denseKeys()` / `clipBoundaryState()` / `clipGroup()` |
| physics Normalization 注入 | scripts/extract/physics.js `injectPhysicsNormalization()` |
| ASTC 直解与 PNG 编码（flip 选项定翻转口径） | scripts/extract/texture.js `decodeAstcTexture()` / `encodePng()` |
| spine .skel 二进制解析与 3.8 JSON 转换（方言与修补见 spine.md） | scripts/extract/spineSkel.js `parseSkel()` / `toSpine38Json()` |
| spine 皮肤烘焙（双 bundle、变体表、产物布局） | scripts/extract/spineBake.js `isSpineBundle()` / `bakeSpine()` / `resolveComposition()` |
| animator 路由与 fades 表 | scripts/extract/animator.js `animatorRouting()` / `animatorFades()` |
| 客户端拉取 | pull_bundles.js / pull_cs.js / pull_lua.js（原理见 docs/azurlane.md） |
| dev server 白名单与单任务槽 | scripts/dev/api.js、scripts/dev/models.js |

## 测试

- `npm test` → scripts/tests/run_all.mjs；unit/ 单测、probe/ 真引擎探针、helpers/ 公共件、asset/ 测试资产。编写要求见 testing.md。

## 资产边界

- 仓库零游戏资产：模型在根目录 models/（dev 中间件伺服，不在 public/）；public/ 下自绘资源（如 effects/click/click.png）属查看器自有资产；版权条款见 README。
- tools/ 内为随仓库分发的第三方工具（adb、Il2CppDumper），非本项目代码。
