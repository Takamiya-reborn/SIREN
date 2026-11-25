# 皮肤小游戏（拖拽机 type 13 / 15 / 16 与棋盘清盘机制）

> 逆向自 .tmp/lua 船机 lua（live2ddrag/live2d/live2dextend/live2dconst）、社区全量仓（AzurLaneLuaScripts，主界面编排层）、C# dump 小窗反汇编。以下只记已验证的事实；未查证的猜测一律不写。注意：本文件结论建立在当前版本的 lua 与 dump 之上，若后续实机对照出现矛盾（例如清盘行为），以实测为准回头修订。

## 机制家族与数据分布

皮肤小游戏没有第二通道：逻辑层全部在船机 lua 拖拽机（live2ddrag.lua updateTrigger）。C# dump 无小游戏专属类；`view/minigame/` 是活动玩法系统、`dorm3d/` 是宿舍系统，与皮肤无关。

- type 13（DRAG_WITH_PARAMETER_MOVE 参数从动轮）：仅 qiye_10（137061）×6 + beilaosenlin_2（806011）×1
- type 15/16（下棋）：仅 suweiaitongmeng_3（705022）
- type 14（DRAG_MOVE_DOWN_UP）：CN 全量数据零实例，本仓不做
- 本仓实现落点：dragmachine/triggers.js [13]/[16]、dragmachine/xiaqi.js xiaqiClick/xiaqiCheckFinish、dragmachine/machine.js setTargetValueDelay/delayTargetTime 闸（细节见 machine.js 头部状态契约表，不在此重复）

## type 13 参数从动轮

- 每 10 帧采样一次外部参数 `action_trigger.parameter`（模型实时值，对应 EVENT_GET_PARAMETER），值变化时自身目标值步进 **外参差分 × rate**。
- 步进基数定案为差分而非 num：DD:1217 的 `math.abs(parameterMove - lastParameterMove)` 比较与 DD:1218 的乘数共用同一寄存器（SUB 结果复用，反编译器丢失对应）；且 num 读法在 beilaosenlin_2（无 num 配置）下是 `nil × rate`，Lua 必抛错，游戏实跑无错可排除。
- 本体参数进 `num ± |num|×0.1` 邻域（含等号）时播 action 并闩锁（parameterMoveTrigger），冷却闸解除后复位回 startValue 重爬。无 num 形态（beilaosenlin_2）邻域分支恒假，仅剩差分跟随。
- 播放中整支冻结（不采样/不闩锁/不复位）。采样分频按 30Hz 折算成秒累计（×dt×30），任意帧率周期恒 1/3s。

## type 15/16 下棋

配置形态（suweiaitongmeng_3 独占）：9 台 type 15（TouchDrag14..22，参数 a1..a3/b1..b3/c1..c3，index 1..9，range [-1,1]，revert=-1）+ 2 台 type 16（win=1→touch_idle6、win=0→touch_idle9，activeData 切 aftermath 变体 7/10）。

- 点击走 checkClickAction 松开判定链（无 down 配置、无 focus），不在播动作时才可点；EVENT_GAME_XIAQI 载荷的空格判定用 parameterValue（现值），落子/AI 应手/终局判定全部按 parameterTargetValue 数子。
- 规则：全局 1s 限频（无效点击也消耗窗口）→ 玩家子数≤AI 子数才轮到玩家 → 八连线终局（win=true/false）、满盘=平（win=true）→ 终局 0.5s 延迟写 commonData("xiaqi_result")。
- AI 应手 setTargetValueDelay(-1, 0.2)：目标立即入账，delayTargetTime 冻结参数平滑（DD:579/804-813，先减后判、到期当帧恢复）。
- 原文 EVENT_GAME_XIAQI 的 AI 应手判定（CheckXiaQiLast）用的是**落子后的新鲜计数**（GetXiaQiState 每次现查）——移植时用落子前旧账会导致 AI 永不应手。
- 终局无显式 game-over 态：锁盘 = 限频 + 终局后计数关系（CheckXiaQiFirst 恒假）+ 终局重写 result 三条合成。
- type16 的清账回调实参在游戏里恒 nil（CT:330，if-guard 永假）→ 游戏本体 commonData 从不清除；移植按意图取"播出成功才清"（onActionApply played 分支），重发由重复 idle 豁免挡（与原文跳过路径同形）。
- type 15 不走 applyTrigger/不发 DRAG_CLICK 通知（DD:1248-1258 原文如此），因此也从不走 stopDrag → 格子机的 saveData（revert=-1 机松手即存）对格子**从不触发**。

## 参数写入的 C# 语义（小窗反汇编定案）

- `Live2dChar.AddParameterValue(parameter, value, blendMode)`：建立/更新 `_CustomParameterDic` 表项 {值@0x10, blendMode@0x14}；`ChangeParameterData(parameter, value)`：仅更新**已存在**表项的值，缺表项时是异常路径。
- 应用器（dump 里标作 SetParameterValue 的方法，RVA 0x3923664）遍历整张 dic，逐项以 blendMode + weight 1.0 写模型；无直接 BL 调用方 → Unity 生命周期回调（时序在动作求值之后，与"誓约戒指常驻"的实证一致）。**机器值是粘性覆盖，落定后仍逐帧赢过动作曲线**——所有动作把棋盘参数恒 0 驱动、棋子照样站着，就是这个机制。
- Lua 侧 setParameterValue（DD:957）只记账不写模型；模型写入唯一通路是每帧桥（live2d.lua slot18 函数）：`_parameterUpdateFlag && getParameter() && getParameterCom()` 三条件齐才 ChangeParameterData。type 15 的 flag 在 updateParameterUpdateFlag 恒置 true。
- 桥里 `ChangeParameterData(slot14, slot12)` 的实参是反编译寄存器伪影（无可见赋值，属外层作用域寄存器），自然读法是 (getParameterCom(), getParameterValue())；读这类 slot soup 时先分层再下结论。

## 棋盘清盘机制（真机对照存疑项见文末）

印章即棋子本体（a1..c3 的 keyform，±1 = X/O、0 = 无）。按现有证据，**游戏本体没有"终局自动清盘"**，已穷尽的层：

- 船机 lua：格子机唯一归零路径 = touch_idle8/touch_idle10 播出（9 台格子机 + TouchDrag23 的 listener_data 都是 `[[2,["touch_idle8","touch_idle10"],0]]`）。
- touch_idle8/10 的触发分区只有 TouchIdle11（70502221）/TouchIdle14（70502224）两台 type 2 点击机；其 HitArea 网格在静态可测的所有状态下仅 15×10 canvas px（画布 19310×13497，屏占比约千分之一量级）。
- 全仓唯一 `SetLive2dDirty` 调用方 = playervitaescene 的 btnLive2dReset（角色详情页手动"L2D重置"按钮）：ClearLive2dSave + 脏标记 → 下次启用时 resetL2dData（就地复位 + 清存档）。
- 主界面编排层（mainlive2dpainting/mainbasepainting/assistantinfo）：点角色的事件流只出 main_X 系（GetShipMainEvents）与 touch 系事件，与清盘无关。
- 持久化：saveLive2dData（OnUnload 调）对全部 revert=-1 机 saveData → **格子值会被存**；loadLive2dData（OnLoad）恢复 → 残局跨主界面进出保留（type 15 日常点击链不触发 saveData，但 unload 时统一存）。普通重载不清盘；只有脏标记路径（ClearLive2dSave）才清。
- 结算/aftermath 动作显式驱动 touch_drag1=0（棋盘参数，idle7/10/8/11 都有此曲线）与 touch_drag19=1——美术意图疑似收棋盘/亮印章层，但按粘性覆盖机制会被机器值顶掉；touch_drag1 的机器值复位只挂在 touch_drag5/touch_drag6 的 PLAY listener 上。这些参数与印章可见性的确切 keyform 关系未逐一验证，不下定论。

本仓查看器行为与上述一致（探针已端到端验证：结算态点 TouchIdle11 → touch_idle8 播出 → 九格归 0）。

## 待实机对照（可能推翻部分结论的方向）

- 真游戏终局后印章是否真的自动消失（用户观察与上述证据链暂未对齐）。若实机确认自动消失，剩余嫌疑只有 Unity 资产层（Animator StateMachineBehaviour 等，lua/C# 代码层不可见）。
- TouchIdle11/TouchIdle14 热区在实机是否可点（静态网格极小，若实机可点说明 raycast 判定另有放大机制）。
- type 13 的邻域闩锁"次帧复位"读法：实机看 qiye_10 触发瞬间 Paramtouch_idle4 是否跳 0 重爬。

## 排查方法备忘（下次少走弯路）

- 查"谁写模型/谁清状态"优先读桥与 com（live2d.lua 的 slot18 桥 + C# `_CustomParameterDic`），机器层 setParameterValue 是纯记账。
- 反编译寄存器（slotN）跨函数共享命名，实参来源要用上下文与调用链定，不迷信单行。
- 社区仓（.tmp/lua-community）是 blob:none 部分克隆：文件名可 `git ls-tree` 免网络搜；内容要 `git cat-file blob <sha>` 按需懒取（走代理）。
- 全 BL 调用方扫描用字节算术（BL 高 6 位 = 0x25，VA = 文件 offset + 0x4000），禁全量 capstone（见 [[no-full-capstone-scan]]）。
