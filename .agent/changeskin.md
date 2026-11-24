# 换装转场（changeskin）探查纪要

> **状态标注：本文件为探查纪要，链路尚未经过专门测试与挖掘，未定案——不要当结论引用。**
> 已在查看器内跑通 jianwu（jianwu3c）单点，时序/标定与游戏源码对齐，但完整行为学（其他皮肤、
> 边界组合、音效）未经实机对照验证。

双形态皮肤（L2D↔spine 两形态，如 jianwu_2/jianwu_3）的形态开关动画不是模型自身动作，而是
独立的"换装转场"系统：专用 bundle + 专用管理器 + 骨架事件驱动。与 L2D 换装那套
change_out/change_in 模型动作链并存但语义不同。

## 游戏端数据与控制层（权威源）

- 配置：`ship_skin_template.change_skin = {group, action, next, state, index, ...}`，按皮肤
  逐条配置（双形态两侧各有 index）；普通皮肤该字段为空串。解析入口 scripts/extract/lua.js
  `readAllSkinTemplates()`（轻量归一为 {action, index}）。
- 资源：独立 bundle 类别 `changeskin/<action>`（设备 files/AssetBundles/changeskin/，与
  live2d/spinepainting 平级），共 7 个：jianwu3c、jianwu3change、changeblack、changeblackfade、
  changeempty、changeasmr、yuekechengii4。**不在皮肤自身 bundle 内**，pull_bundles.js 按名
  拉取不支持该类别，需 adb 手动 pull。control 层：.tmp/lua-community/mgr/changeskinmgr.lua。
- ChangeSkinMgr 语义（对齐实现的目标）：
  - 换出：`change_out` 组存在才放，缺失立即开转场。
  - state=1（spine 路径）：装载 changeskin prefab，取 `ad/spine` 节点的 SpineAnimUI，
    `SetAction("change_" .. index)`——动画名 change_N 与配置 index 同源。
  - state=4（Animator 路径，changeblack/changeasmr 系）：Unity Animator trigger
    `change_<index>` + DftAniEvent 回调，**查看器未实现**。
  - **骨架事件驱动**：spine 事件 `action` = 换挂时机（幕后换模型）、`finish` 事件 = 换入动画
    时机、finish 后 finish_delay（缺省 0.5s）才收覆盖层；其余事件是音效标记
    （`event:/ui/<名>`，音频在游戏语音包，查看器未实现）。
  - 换入动画两级 fallback：change_in 存在放 change_in，缺失回落 login（mainlive2dpainting
    与 mainspinepainting 两级视图层同语义）。
  - **方向定案**：play 传目标皮肤 id——切进谁的房间放谁的 index。jianwu 实测：change_2
    （门关特写→走回→开灯，镜头拉远见全景）= 切入 ani；change_1（开灯→走向门→开门，镜头
    推近门景）= 切回 l2d。

## 烘焙链

- extract.js spine 分支内：isSpineBundle 且缺 `<painting>_res` 且主 bundle 内嵌 .skel
  TextAsset → changeskin 转场 prefab，烘到 `models/changeskin/<action>/`（全局共享目录，
  跨皮肤复用），产物与皮肤 spine.json 同构（variants/canvas/raw）。
- dev 侧：scripts/dev/models.js `scanModels()` 排除 `changeskin/` 顶级目录（不进皮肤侧栏）；
  /models/* 静态伺服天然覆盖。
- 目录构建：gen_catalog.js 给双形态条目挂 `changeSkins`（按 painting 小写归档 {action, index}，
  合并时并入映射）。

## 转场骨架标定（jianwu3c 数值互证）

- 房间主画面四边形 = 附件 2022×1162 × 附件自缩放 8 × root 骨骼 0.5 = 8088×4648，恰好等于
  骨架画布（canvas）——画布即作者钦定的主画面幅面。
- `jingtou`（镜头骨）被动画推拉：缩放 change_1 1.407→2.46 / change_2 反向；平移纵向扫过
  -1608→-4332（raw）。房间是"幕布"，静态铺满必露边。
- **covers 镜头安全区**（spineBake.js `cameraCoverRects()`）：主画面四边形（最大附件，经
  其骨骼祖先链 setup 仿射 + 链上动画缩放/平移，采样点取时间轴帧时刻——角点分段线性，极值
  在端点）在各动画全程的**时间交集矩形**，按动画名归档进 variants[].covers（挂载本地 px，
  y-down，×解析 0.01）。曲线段（bezier）展开求值（spineBake.js `sampleAt()` 配 dense 表）
  ——ease 曲线无过冲，帧时刻采样即精确。
- 挂载层（src/l2d/changeskinOverlay.js `fitOverlay()`）：contain 语义贴合安全区
  （scale = max(vw/w, vh/h)）再乘 `SAFE_MARGIN = 1.1`——房间贴图边缘是羽化笔触（半透明），
  视口须小于四边形才不透底。纯数值换算，无顶点时序依赖（顶点探测路线曾因 visible=false
  挡住 updateTransform、顶点全零而全面失败，已弃用）。
- pixi-spine yDown=true：根骨骼 sy 取负，骨骼矩阵即 y-down 渲染空间；画布/安全区矩形
  均在此空间表达，无二次翻转。

## 查看器编排

- src/l2d/changeskinOverlay.js `playChangeOverlay()`：加载（warmCache 预热缓存单次消费）
  → fitOverlay（安全区 contain × SAFE_MARGIN）→ 起播 change_N → 事件 `action` 放行换挂
  （handle.swap）→ 事件 `finish` 挂起销毁计时（+0.5s）；complete/end/15s 兜底；提前销毁时
  两个 promise 一并放行防挂起。播放期逐帧自置顶（模型换挂会把新模型插到覆盖层之上）。
- src/App.vue `setForm()`：holdReveal → playChangeSkin → activeForm 切换开挂 →
  await overlay.swap → releaseReveal（幕后换挂）→ await overlay.finished →
  playChangeIn('change_in')（change_in→login fallback，L2dStage.vue `playChangeIn()`）→
  回填预热。覆盖层路径**不登记换入组**（login 压在 finish 之后，避免与转场后半段叠播）；
  未烘焙的 action 退化原 change_out 链。
- 换挂顿帧治理：旧模型销毁先摘离、destroy 推迟一帧（spineMount.js 换挂段、mount.js
  `reveal()`）；形态切换进行中不预热（App.vue `onStageMotions()`），切完回填反方向配置。
- 诊断日志：`[changeskin] 动画/取景/事件` 三行（对齐 [perf] 风格）。

## 未实现 / 待挖掘

- 转场音效（event:/ui/door1.wav 等，音频在游戏语音包）。
- state=4 Animator 路径（changeblack/changeblackfade/changeempty/changeasmr/yuekechengii4，
  其中 changeblack 系即 suweiaitongmeng 的转场）——未拉 bundle 未实现，当前走退化链。
- 专门测试与挖掘：完整行为学（其他皮肤、边界组合、实机对照）未验证；本文件所有时序/标定
  仅在 jianwu3c 单点上跑通。
