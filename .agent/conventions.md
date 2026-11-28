# 项目约定

## 提交消息（CM）

- 提交必须经过用户批准
- 格式沿用约定式提交 `type: subject`。
- 消息最后一行写样例标注 `- Use example (<Skin>)`，声明本次主要工作以哪个皮肤为准测试：`<Skin>` 填 models/ 下皮肤目录名（如 suweiaitongmeng_3）；一次提交覆盖多皮肤时取主要工作所依赖的那一只，不逐个罗列。
- 没跑皮肤样例的提交（未实机验证的功能、纯文档、构建工具链等）不写该行——有标注即代表已按该皮肤验证过。
- 目的：review 时按标注直接加载对应皮肤对照行为，不用从 diff 猜验证对象。
- 范例（首段可不写根因，要点逐条列工作项，每一项要*简洁*，最好不要超过一行，收敛在git默认要求的宽度，尽可能保持单行，样例行收尾）：

  ```text
  fix: emit slot dark color in baked spine JSON to fix twoColor crash

  - spineSkel dropped slot "dark" (two-color dark, RGB888 int, -1 sentinel)
  - pixi-spine leaves Slot.darkColor null without it; twoColor timelines
    crash on null.set every frame (game C# darkColor is non-nullable)
  - jianwu_3 is the only twoColor user (login/touch_special); re-baked
  - test: dark emission, twoColor frame keys, omission without dark color
  - Use example (jianwu_3)
  ```

## 代码风格

- 注释纯技术：句子不折断，分情况可分行；多步块每步一行短注释贴语句。
- 落盘代码与正式文档不出现工具溯源话术（「移植自 / ported from」等），只写行为与格式约定本身。
- 仓库不留特化脚本：探针、临时工具验证完即删；结论沉淀为合成配置单测或 .agent/ 文档。

## 排查方法

- 实现出现 bug 先查游戏逆向结果（dump.cs 签名、lua 控制层快照、bundle 内资产结构），以游戏本体行为为根修依据；不得凭直觉猜测机制后直接改码——猜测被证伪的成本高于先读证据。

## 资产

- 仓库零游戏资产：模型在根目录 models/（dev 中间件伺服），提取产物不入库、不再分发；版权条款见 README。
- public/ 下自绘资源（如 effects/click/click.png）属查看器自有资产。

## 中间文件

- 一切中间产物（探针 dump、反汇编窗口、临时解析样本、试验脚本输出等）一律写到根目录 `.tmp/` 下，工作完成后删除；不得散落在其他目录。`.tmp/` 已是 gitignore 的游戏文件工作区，与 bundle 缓存共用。
- 中间脚本若之后还用得上，抽象成正式实现放进 `scripts/`，不在 `.tmp/` 留活口；一次性验证脚本验证完即删。
