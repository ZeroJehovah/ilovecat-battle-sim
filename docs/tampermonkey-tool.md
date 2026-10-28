# 页面数据导出与策略执行器

`tools/ilovecat-workbench.user.js` 是一个无第三方依赖的篡改猴用户脚本。模拟器本身仍然完全离线，不会加载该脚本或访问游戏接口。

## 安装

1. 在 Tampermonkey 中新建脚本，粘贴 `tools/ilovecat-workbench.user.js` 的完整内容并保存。
2. 打开 `https://api.ilovecat520.me/playground/battle`，确认右上角出现猫咪按钮。
3. 首次使用“导出数据”前，至少进入过一次战斗页，让浏览器加载当前战斗 JS。

脚本匹配游戏域名下的页面，但只有点击猫咪按钮后才读取数据。导出请求与普通页面请求使用同一登录态；脚本不会展示、复制或上传 UID、Cookie 或请求头。

## 导出内容

“完整 JSON”包含：

- `snapshot`：`schemaVersion`、采集时间、图鉴、当前无尽关卡和赛季结束时间，可直接作为模拟器的 `data/snapshot.json`；
- `roster.team`：当前队伍槽位、猫 ID、名称和等级；
- `roster.scenarioTeam`：可直接放进场景 JSON 的 `{ id, level }` 数组；
- `roster.ownedUnits`：已拥有猫的 ID、名称和等级；
- `roster.inventory`：五种战斗道具的当前数量；
- `client.battleBundles`：识别出的当前战斗 JS、URL、字节数和 SHA-256；
- `client.loadedScripts`：当前页面已加载的同源 JS 清单。

勾选“附带全部已加载 JS”时，`client.allScripts` 会额外保存所有同源脚本正文，文件通常有数 MiB。多数机制分析只需要 `battleBundles`。

导出明确排除 UID、Cookie、授权头、罐罐余额、通关数、星级、抽卡统计、保底计数、无尽次数和最佳成绩。

## 策略格式

策略必须是一个 JSON 对象：

```json
{
  "format": "ilovecat-battle-strategy",
  "version": 1,
  "name": "candidate",
  "stageId": 9101,
  "team": [
    { "id": "s4", "level": 1 },
    { "id": "s1", "level": 1 }
  ],
  "items": ["fast_coins", "rally"],
  "policy": {
    "walletTarget": 8,
    "economyFirst": true,
    "openers": [],
    "targetCounts": { "s4": 3, "s1": 10 },
    "priority": ["s4", "s1"],
    "fallbackAfter": 775,
    "fallbackPriority": [],
    "autoCannon": true,
    "automatic": true,
    "actions": []
  }
}
```

`policy` 的自动决策与模拟器场景保持一致：

- 钱包低于目标时，先完成尚未成功的 `openers`，再在金币足够时升级钱包；
- `economyFirst=true` 时，等待钱包达标后才铺正常阵容；
- 钱包达标后，按 `priority` 检查目标存活数，槽位冷却时跳过并检查下一只；
- 到达 `fallbackAfter` 后，在目标无法补位时使用 `fallbackPriority` 填场；
- 自动猫爪炮只会在没有更高优先级操作时发射。

`actions` 可覆盖自动决定，支持 `deploy`、`wallet`、`cannon` 和 `wait`：

```json
[
  { "at": 0, "type": "deploy", "id": "s4" },
  { "at": 30, "type": "cannon" },
  { "at": 45, "type": "wallet" }
]
```

## 执行方式

1. 按策略要求配置队伍和战斗道具，并手动开始战斗。
2. 粘贴策略，点“校验”；脚本会核对关卡、当前队伍、等级、道具和策略引用的猫。
3. 点“开始执行”。脚本约每 100 ms 检查一次 React 战斗快照，每次世界操作之间至少间隔 250 ms；操作仍由页面按钮触发。
4. 战斗结束、页面暂停、提示层出现或快照消失时，脚本停止或等待，不会自动重开战斗。

执行器依赖游戏当前页面的 React 内部快照和按钮标题。游戏大版本更新后，如果校验或快照读取失败，应重新核对战斗 bundle 和页面 DOM，不应盲点继续执行。

## 边界

- 服务器种子不可选择；策略只能缩小决策误差，不能保证达到某个离线种子成绩。
- 执行器不能补回脚本启动前已经错过的操作，也不能消除浏览器帧率、网络和人工准备造成的差异。
- 执行器不会选择队伍、购买升级、使用消耗品或开始战斗，这些都必须由用户完成。
- 页面工具不会修改模拟器文件；导出后仍需人工审阅并保存到合适位置。
