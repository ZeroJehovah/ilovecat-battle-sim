# ilovecat-battle-sim 源码约束

## 定位

本目录是“喵喵的逆袭”离线战斗模拟器的公开源码仓库。程序只负责后端战斗计算、批量实验、数据快照读取和结果输出，不包含前端界面，也不直接操作游戏账号。

## 目录

```text
src/
├── src/cli.mjs          # CLI 与场景调度
├── src/engine.mjs       # 0.02 秒步长的战斗引擎
├── src/runner.mjs       # 自动策略、单局执行与批量统计
├── src/worker.mjs       # 并行随机种子 worker
├── data/snapshot.json   # 图鉴、关卡与波次快照
├── examples/            # 场景与对比示例
├── tests/               # 回归测试
├── tools/capture_live.py# 只读快照采集器
├── tools/ilovecat-workbench.user.js # 页面只读导出与策略执行器
└── docs/scenario-schema.md
```

## 硬性约束

- 运行时只使用 Node.js 内置模块，不引入第三方运行时依赖；要求 Node.js 20 或更高版本。
- 正常模拟不得访问网络、打开游戏页面、调用游戏 API、修改账号或消耗无尽次数。
- `tools/capture_live.py` 是自动化的浏览器快照入口，只允许读取图鉴和当前无尽关卡。`tools/ilovecat-workbench.user.js` 是用户在登录页面手动触发的可选页面工具，可读取图鉴、当前无尽关卡、当日每日任务的四种难度、正在进行的限时全服头目、可选的已拥有猫咪等级和已加载战斗 JS；不得输出 UID、Cookie、令牌、账号余额、最佳成绩、剩余次数或抽卡信息。两个工具都不得被模拟器运行时导入。
- 页面策略执行器只允许读取页面战斗快照，并通过页面按钮执行用户明确启动的部署、钱包和猫爪炮操作；不得直接调用战斗引擎修改状态，不得自动开始战斗、消耗无尽次数或更改队伍。
- 执行策略页只允许从私有 docs 仓库的结构化索引选择在线策略，或选择本地 JSON 文件；不得提供自由粘贴/编辑 JSON 的入口。在线请求只能访问固定索引和索引校验过的策略 raw 地址，索引、配队或等级不一致时必须拒绝载入。
- `data/snapshot.json` 不得包含账号凭据、个人信息、拥有状态、喂食到期时间或物品库存。
- 战斗步长必须保持 0.02 秒。修改伤害、攻击周期、冰冻、怒气、刷怪、经济或补位逻辑时，必须同步更新测试和 `docs/scenario-schema.md`，并核对 `../docs/战斗机制与实现依据.md`。
- 不得把模拟结果表述为服务器权威结果。输出必须能追溯随机种子、场景参数、快照时间和关卡修正。
- `examples/` 中带账号等级的快照必须注明数据日期；不要把一次性模拟结果当成长期有效结论。

## 常用命令

```bash
npm test
npm run simulate -- run examples/endless-current.json --seed 1 --format table
npm run simulate -- batch examples/endless-current.json --runs 30 --jobs 8
npm run simulate -- compare examples/endless-compare.json --runs 30 --jobs 8
python3 tools/capture_live.py
```

## 仓库边界

- 本目录是公开仓库；项目级内部文档、研究记录和账号分析位于同级的 `../docs/` 私有仓库。
- 从 `../docs/` 搬运内容前，先确认不含账号、Cookie、令牌或内部记录。
- 提交、拉取和推送必须在本目录执行，或从项目父目录使用 `git -C src ...`。
