# 喵喵的逆袭战斗模拟器

一个纯后端的离线战斗模拟器，用于批量比较“喵喵的逆袭”的猫咪编队、等级、上场顺序、经济节奏和补位策略。模拟器不渲染 UI，不访问游戏服务器，也不会消耗真实无尽次数。

## 能力

- 0.02 秒固定步长复现移动、攻击前摇、冷却、闪避、暴击、护甲、范围伤害、召唤与猫塔结算。
- 支持凤凰回血、时空冻结、直接冰冻、抗冻、热浪、重力、怒气与免控。
- 支持自动钱包升级、严格固定的上场序列、指定场上数量、后期炮灰补位和战斗道具。
- 支持单局复现、固定种子批量、多个候选方案对比及多线程 worker。
- 支持用 `--trace` 导出 0.02 秒动作时间线，并从 `policy.actions` 精确回放。
- 输出存活时间、轮次、Boss 伤害、猫塔生命、伤害、治疗、击杀、死亡时间、部署次数和最终场上构成。

## 环境

- Node.js 20 或更高版本。
- 运行时不依赖 npm 包。
- 可选：刷新数据时使用 Python 3 和本机 Camoufox 调试浏览器。

## 快速开始

```bash
npm test

npm run simulate -- run examples/endless-current.json --seed 1 --format table

npm run simulate -- batch examples/endless-current.json \
  --runs 30 --jobs 8 --format table

npm run simulate -- compare examples/endless-compare.json \
  --runs 30 --jobs 8 --format markdown
```

常用数据检查：

```bash
npm run simulate -- cats --tier S
npm run simulate -- waves --stage-id 9101
```

完整场景字段、自动策略、定时动作和输出定义见 [docs/scenario-schema.md](docs/scenario-schema.md)。

## 数据快照

`data/snapshot.json` 当前来自 2026-10-28 的实时页面，包含 29 只猫、28 种老鼠和当前第 9101 号无尽关卡的 84 组刷怪数据。快照只保留图鉴、关卡和赛季元数据，不保存账号最佳成绩、剩余次数或身份信息。

在已登录游戏并打开 Camoufox 调试标签页时，可以只读刷新：

```bash
python3 tools/capture_live.py
```

采集器默认调用本机的 `camoufox-remote-control` BiDi 客户端。其他环境可通过 `BIDI_CLIENT` 环境变量指定兼容客户端路径。刷新后必须重新运行 `npm test`。

## 页面导出与策略执行器

[`tools/ilovecat-workbench.user.js`](tools/ilovecat-workbench.user.js) 是可选篡改猴脚本，适合不便频繁启动 Camoufox 时手动导出当前数据。安装后打开游戏战斗页，页面右上角会出现“喵喵的逆袭工具”：

- 复制或下载前按需勾选图鉴、已拥有猫咪等级、当前无尽、当日每日任务四档难度和正在进行的限时全服头目；所有导出项默认关闭，固定关卡和 JS 源码需先勾选父项才能编辑；每日任务四档难度收在一行；
- 策略信息固定显示名称、适用关卡和“猫咪名称(等级)”配队，并按 C/B/A/S 评级着色；校验结果在下方单独显示，并以绿、黄、红三种颜色区分成功、警告和错误；
- 所选 JSON 的 `snapshot` 字段就是模拟器 `data/snapshot.json` 所需结构；可单独提取，账号信息或 JS 不会混入其中；
- 将策略 JSON 粘贴到“执行策略”页后，执行器在已经开始的战斗中通过页面按钮升级钱包、部署猫咪和发射猫爪炮；也可显式启用“自动开始战斗”；
- 导出不会上传数据，也不会写入 UID、Cookie、令牌、罐罐余额、通关/星级或抽卡信息。

完整安装说明、策略字段和执行边界见 [docs/tampermonkey-tool.md](docs/tampermonkey-tool.md)。

## 可信度与边界

战斗逻辑依据 2026-10-28 客户端战斗块 `14540.c41c2dcc43.js`，其 SHA-256 为 `d4864e885a3c250a06a9b9510775b65b66a79a18405a766b291082103d353333`。项目通过同版本隔离重放、实战观测和固定种子回归测试校准关键公式。

模拟器不覆盖服务器权威校验、计分、反作弊、隐藏未来配置和玩家反应延迟。相同 seed 只复现本模拟器的随机序列，不代表服务器抽到的随机序列。自动补位没有人工操作延迟，因此结果通常比手动实战乐观。

本项目是独立研究工具，与游戏运营方无隶属关系。
