import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { selectStage } from "../src/runner.mjs";

const source = await readFile(
  new URL("../tools/ilovecat-workbench.user.js", import.meta.url),
  "utf8",
);

function markedFunction(name) {
  const startMarker = `// testable:${name}`;
  const endMarker = `// end testable:${name}`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  const body = source.slice(start + startMarker.length, end).trim();
  return new Function(`return (${body})`)();
}

test("the userscript is syntactically valid and exposes both workflows", () => {
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /@match\s+https:\/\/api\.ilovecat520\.me\/\*/);
  assert.match(source, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/ZeroJehovah\/ilovecat-battle-sim\/main\/tools\/ilovecat-workbench\.user\.js/);
  assert.match(source, /USERSCRIPT_VERSION = "0\.3\.8"/);
  assert.match(source, /<div class="title">喵喵的逆袭工具 <span class="version">v\$\{USERSCRIPT_VERSION\}<\/span><\/div>/);
  assert.match(source, /ilovecat-game-export/);
  assert.match(source, /ilovecat-battle-strategy/);
  assert.match(source, /battleBundles/);
  assert.match(source, /fallbackPriority/);
  assert.match(source, /deploySequence/);
  assert.match(source, /sequenceIndex/);
  assert.match(source, /导入 JSON 文件/);
  assert.match(source, /strategyFile/);
  assert.match(source, /strategy:\s*root\.querySelector\('\[data-view="execute"\] textarea'\)/);
  assert.match(source, /strictTimeline/);
  assert.match(source, /scheduleMiss/);
  assert.match(source, /autoStart/);
  assert.match(source, /findPreparationRuntime/);
  assert.match(source, /validatePreparation/);
  assert.match(source, /BATTLE_START_TIMEOUT_MS/);
  assert.match(source, /requirePlaying/);
  assert.match(source, /prep\.startButton\.click\(\)/);
  assert.match(source, /自动开始战斗/);
  assert.match(source, /自动开始战斗[\s\S]*?自动倍速/);
  assert.doesNotMatch(source, /无战斗时由脚本点击“开始战斗”|autoItems|auto-items/);
  assert.match(source, /selectPreparationItems/);
  assert.match(source, /prep = await selectPreparationItems\(strategy, prep\)/);
  assert.match(source, /updateItemWarning/);
  assert.match(source, /buildStrategySummary/);
  assert.match(source, /buildUiValidationResults/);
  assert.match(source, /适用关卡：/);
  assert.match(source, /策略配队：/);
  assert.match(source, /validation-line\.success/);
  assert.doesNotMatch(source, /（成功）|（警告）|（错误）/);
  assert.match(source, /strategy-cat-name\.tier-s/);
  assert.match(source, /strategy-cat-level \{ color: #f7ead0; \}/);
  assert.match(source, /当前未处于战斗准备界面/);
  assert.doesNotMatch(source, /出战顺序/);
  assert.match(source, /matchesStageTitle/);
  assert.match(source, /readStageFromFiber/);
  assert.match(source, /validatePreparationStage/);
  assert.match(source, /stageMatch/);
  assert.match(source, /顺序不强制/);
  assert.doesNotMatch(source, /自动勾选策略所需消耗品|请先在准备界面手动勾选/);
  assert.match(source, /item-warning/);
  assert.match(source, /readBattleSpeed/);
  assert.match(source, /autoSpeed/);
  assert.match(source, /manageAutoSpeed/);
  assert.match(source, /estimateNextAction/);
  assert.match(source, /BATTLE_SPEED_KEY/);
  assert.match(source, /空闲 3×/);
  assert.match(source, /当前不会执行策略动作/);
  assert.match(source, /pressDeployKey/);
  assert.match(source, /deployKeyForSlot/);
  assert.match(source, /new KeyboardEvent\("keydown"/);
  assert.match(source, /return pressDeployKey\(slot, context\)/);
  assert.match(source, /policy\.actionGap/);
  assert.match(source, /节奏会不一致/);
  assert.match(source, /include-catalog/);
  assert.match(source, /include-owned/);
  assert.doesNotMatch(source, /include-team|include-inventory/);
  assert.match(source, /stage-choices/);
  assert.match(source, /\.scope-card \{[\s\S]*?display: flex; flex-direction: column; gap: 6px;/);
  assert.match(source, /\.stage-option, \.daily-stage-row \{[\s\S]*?min-height: 32px; padding: 0;/);
  assert.match(source, /\.scope-card input\[type="checkbox"\],\s*\.scope-card input\[type="radio"\] \{[\s\S]*?margin: 0;[\s\S]*?top: -1px;/);
  assert.match(source, /\.fixed-stage-input \{[\s\S]*?height: 30px;/);
  assert.match(source, /当前无尽/);
  assert.match(source, /每日任务/);
  assert.match(source, /限时活动/);
  assert.match(source, /daily-master/);
  assert.match(source, /daily-difficulty-input/);
  assert.match(source, /fixed-stage-enable/);
  assert.match(source, /fixed-stage-input/);
  assert.match(source, /placeholder="关卡 id，例如 1,2,3"/);
  assert.match(source, /js-enable/);
  assert.match(source, /JS源码<\/label>/);
  assert.doesNotMatch(source, /JS源码：/);
  assert.match(source, /JS源码<\/label>[\s\S]*?value="battle" disabled> 战斗逻辑[\s\S]*?value="all" disabled> 全部/);
  assert.doesNotMatch(source, /value="none"/);
  assert.doesNotMatch(source, /include-catalog" type="checkbox" checked/);
  assert.match(source, /ui\.fixedStages\.disabled = !ui\.fixedStageEnable\.checked/);
  assert.match(source, /input\.disabled = !dailyEnabled/);
  assert.match(source, /input\.checked = selectedBefore\.has\(entry\.key\)/);
  assert.match(source, /stageChoices\.querySelectorAll\("input\[data-stage-key\]:checked"\)/);
  assert.doesNotMatch(source, /!hadOptions|previouslyAll/);
  assert.doesNotMatch(source, /privacy:\s*\{/);
  assert.match(source, /\[data-view="execute"\] > textarea \{ height: 128px; min-height: 128px; resize: none; \}/);
  assert.doesNotMatch(source, /stage-all|stage-none|stage-endless|stage-raid/);
  assert.doesNotMatch(source, /v\$\{USERSCRIPT_VERSION\} · 只读导出；执行器只操作页面按钮和游戏键盘事件/);
  assert.doesNotMatch(source, /复制和下载共用下面的范围/);
  assert.doesNotMatch(source, /<div class="scope-title">导出范围<\/div>/);
  assert.doesNotMatch(source, /可选账号信息/);
  assert.doesNotMatch(source, /页面关卡（逐关勾选）/);
  assert.doesNotMatch(source, /已选 \$\{selectedCount\}/);
  assert.doesNotMatch(source, /所选 JSON 的 snapshot（?:字段|将包含）/);
  assert.doesNotMatch(source, /战斗逻辑 JS 源码（可选）/);
  assert.doesNotMatch(source, /这不是战斗记录/);
  assert.doesNotMatch(source, /全部同源已加载 JS/);
  assert.doesNotMatch(source, /先按策略配置好队伍和道具/);
  assert.doesNotMatch(source, /仅在估计至少约 9 个游戏秒/);
  assert.doesNotMatch(source, /自动开战只会在关卡名称/);
  assert.match(source, /twemoji\/blob\/main\/assets\/svg\/1f431\.svg/);
  assert.match(source, /CC-BY 4\.0/);
  assert.match(source, /<svg viewBox="0 0 36 36" aria-hidden="true">/);
  assert.doesNotMatch(source, />🐱<\/button>/);
  assert.match(source, /apiGet\("raid"\)/);
  assert.match(source, /apiGet\("state"\)/);
  assert.match(source, /js-scope/);
  assert.match(source, /复制所选 JSON/);
  assert.match(source, /下载所选 JSON/);
  assert.doesNotMatch(source, /download-snapshot/);
});

test("fixed campaign stages accept a compact comma-separated id list", () => {
  const parseFixedStageIds = markedFunction("parseFixedStageIds");
  assert.deepEqual(parseFixedStageIds(""), []);
  assert.deepEqual(parseFixedStageIds("1,2,3"), [1, 2, 3]);
  assert.deepEqual(parseFixedStageIds(" 3，1 2, 3 "), [3, 1, 2]);
  assert.throws(() => parseFixedStageIds("1,a"), /固定关卡格式有误/);
  assert.throws(() => parseFixedStageIds("0"), /固定关卡 id 无效/);
});

test("strategy summary uses cat names and never prints deploy sequence", () => {
  const buildStrategySummary = markedFunction("buildStrategySummary");
  const summary = buildStrategySummary({
    name: "daily-heavy",
    team: [
      { id: "c1", level: 12 },
      { id: "c2", level: 7 },
    ],
    policy: { deploySequence: ["c1", "c1", "c2"] },
  }, "万圣节之夜・地狱", new Map([
    ["c1", { name: "狮子王喵", tier: "A" }],
    ["c2", { name: "星空狙击喵", tier: "S" }],
  ]));
  assert.deepEqual(summary, {
    name: "daily-heavy",
    stage: "万圣节之夜・地狱",
    team: [
      { name: "狮子王喵", level: 12, tier: "A" },
      { name: "星空狙击喵", level: 7, tier: "S" },
    ],
  });
  assert.doesNotMatch(JSON.stringify(summary), /c1|c2|出战顺序/);
});

test("validation separates JSON success from an unavailable preparation screen", () => {
  const buildUiValidationResults = markedFunction("buildUiValidationResults");
  const results = buildUiValidationResults({
    name: "daily-heavy",
    stageId: 20,
    team: [{ id: "c7", level: 48 }],
    items: [],
  }, null, null, new Map([["c7", { name: "虎斑", tier: "C" }]]));
  assert.deepEqual(results, [
    { type: "success", text: "JSON 解析成功。" },
    { type: "warning", text: "当前未处于战斗准备界面。" },
  ]);
});

test("validation reports stage, team and item errors separately", () => {
  const buildUiValidationResults = markedFunction("buildUiValidationResults");
  const results = buildUiValidationResults({
    name: "broken",
    stageId: 20,
    team: [
      { id: "c7", level: 48 },
      { id: "c1", level: 12 },
    ],
    items: ["rally"],
  }, null, {
    title: "第 99 关",
    stageMatch: false,
    stage: { id: 99, name: "第 99 关" },
    team: [{ id: "c7", name: "虎斑", tier: "C", level: 48 }],
    items: [{ id: "rally", name: "全軍振奮", count: 0, selected: false }],
  }, new Map([
    ["c7", { name: "虎斑", tier: "C" }],
    ["c1", { name: "白糰子", tier: "C" }],
  ]));
  assert.deepEqual(results.map((result) => result.type), ["success", "error", "error", "error"]);
  assert.match(results[1].text, /^关卡不符：/);
  assert.match(results[2].text, /^配队不符：.*白糰子\(12\)/);
  assert.match(results[3].text, /^道具不足：/);
});

test("the export scope lists campaign, endless, daily and active raid stages", () => {
  const buildStageEntries = markedFunction("buildStageEntries");
  const catalog = {
    stages: [
      { id: 1, name: "one", waves: [{}, {}] },
      { id: 2, name: "two", waves: [{}] },
    ],
  };
  const endless = {
    stage: { id: 9101, name: "endless", waves: [{}, {}, {}] },
    season: "2026-10-26",
    ends: "2026-11-01",
  };
  const raid = {
    stage: { id: 9001, name: "raid", waves: [{}, {}, {}, {}] },
    raid: { id: "halloween-2026", start: "2026-10-25", end: "2026-11-01" },
    running: true,
    ended: false,
  };
  const daily = {
    choices: [
      { id: 501, name: "daily easy", daily: "easy", waves: [{}] },
      { id: 502, name: "daily normal", daily: "normal", waves: [{}] },
      { id: 503, name: "daily hard", daily: "hard", waves: [{}] },
      { id: 504, name: "daily hell", daily: "hell", waves: [{}, {}] },
    ],
    chosen: "hell",
    won: true,
  };
  const entries = buildStageEntries(catalog, endless, raid, daily);
  assert.deepEqual(entries.map((entry) => entry.key), [
    "endless:9101",
    "daily:501",
    "daily:502",
    "daily:503",
    "daily:504",
    "raid:9001",
    "campaign:1",
    "campaign:2",
  ]);
  assert.equal(entries[0].endlessMeta.ends, "2026-11-01");
  assert.equal(entries.find((entry) => entry.key === "daily:504").stage.daily, "hell");
  assert.equal(entries.find((entry) => entry.key === "daily:504").dailyChosen, true);
  assert.equal(entries.find((entry) => entry.key === "daily:501").dailyChosen, false);
  assert.equal(entries.find((entry) => entry.key === "raid:9001").raidMeta.eventId, "halloween-2026");
  assert.equal(entries.find((entry) => entry.key === "campaign:2").stage.waves.length, 1);
  assert.equal(buildStageEntries(catalog, endless, { ...raid, ended: true }, daily)
    .some((entry) => entry.kind === "raid"), false);
});

test("selected export creates a simulator snapshot from only chosen stages", () => {
  const buildStageEntries = markedFunction("buildStageEntries");
  const buildSelectedSnapshot = markedFunction("buildSelectedSnapshot");
  const catalog = {
    cats: [{ id: "c1" }],
    mice: [{ id: "m1" }],
    items: [{ id: "rally" }],
    rules: { max_level: 100 },
    stages: [
      { id: 1, name: "one", waves: [{}] },
      { id: 2, name: "two", waves: [{}, {}] },
    ],
  };
  const endless = {
    stage: { id: 9101, name: "endless", waves: [{}, {}, {}] },
    season: "2026-10-26",
    ends: "2026-11-01",
  };
  const raid = {
    stage: { id: 9001, name: "raid", waves: [{}, {}, {}, {}] },
    raid: { id: "halloween-2026", start: "2026-10-25", end: "2026-11-01" },
    running: true,
    ended: false,
  };
  const daily = {
    choices: [
      { id: 501, name: "daily easy", daily: "easy", waves: [{}] },
      { id: 502, name: "daily normal", daily: "normal", waves: [{}] },
      { id: 503, name: "daily hard", daily: "hard", waves: [{}] },
      { id: 504, name: "daily hell", daily: "hell", waves: [{}, {}] },
    ],
    chosen: "hell",
    won: true,
  };
  const entries = buildStageEntries(catalog, endless, raid, daily);
  const byKey = Object.fromEntries(entries.map((entry) => [entry.key, entry]));
  const snapshot = buildSelectedSnapshot({
    catalog,
    selectedStages: [byKey["endless:9101"], byKey["raid:9001"], byKey["campaign:2"]],
    includeCatalog: true,
    capturedAt: "2026-10-29T00:00:00.000Z",
    source: "https://example.test/playground/battle",
  });
  assert.equal(snapshot.stage.id, 9101);
  assert.deepEqual(snapshot.catalog.stages.map((stage) => stage.id), [9001, 2]);
  assert.equal(snapshot.catalog.cats[0].id, "c1");
  assert.equal(snapshot.endlessMeta.season, "2026-10-26");
  assert.equal(snapshot.raidMeta.eventId, "halloween-2026");
  assert.equal(selectStage(snapshot, 9101).id, 9101);
  assert.equal(selectStage(snapshot, 9001).id, 9001);
  assert.equal(selectStage(snapshot, 2).id, 2);
  assert.throws(() => selectStage(snapshot, 1), /stage 1 is not present/);

  const campaignOnly = buildSelectedSnapshot({
    catalog,
    selectedStages: [byKey["campaign:1"]],
    includeCatalog: true,
    capturedAt: "2026-10-29T00:00:00.000Z",
    source: "https://example.test/playground/battle",
  });
  assert.equal(campaignOnly.stage.id, 1);
  assert.equal(campaignOnly.endlessMeta, undefined);
  assert.equal(selectStage(campaignOnly, 1).id, 1);

  const raidOnly = buildSelectedSnapshot({
    catalog,
    selectedStages: [byKey["raid:9001"]],
    includeCatalog: true,
    capturedAt: "2026-10-29T00:00:00.000Z",
    source: "https://example.test/playground/battle",
  });
  assert.equal(raidOnly.stage.id, 9001);
  assert.deepEqual(raidOnly.catalog.stages.map((stage) => stage.id), [9001]);
  assert.equal(raidOnly.raidMeta.running, true);

  const stagesOnly = buildSelectedSnapshot({
    catalog,
    selectedStages: [byKey["campaign:1"]],
    includeCatalog: false,
    capturedAt: "2026-10-29T00:00:00.000Z",
    source: "https://example.test/playground/battle",
  });
  assert.equal(stagesOnly.catalog, undefined);
  assert.equal(stagesOnly.stage.id, 1);

  const dailyOnly = buildSelectedSnapshot({
    catalog,
    selectedStages: [byKey["daily:504"]],
    includeCatalog: true,
    capturedAt: "2026-10-29T00:00:00.000Z",
    source: "https://example.test/playground/battle",
  });
  assert.equal(dailyOnly.stage.id, 504);
  assert.equal(dailyOnly.stage.daily, "hell");
  assert.deepEqual(dailyOnly.catalog.stages.map((stage) => stage.id), [504]);
  assert.equal(dailyOnly.endlessMeta, undefined);
  assert.equal(dailyOnly.chosen, undefined);
  assert.equal(dailyOnly.won, undefined);
  assert.equal(dailyOnly.stage.chosen, undefined);
  assert.equal(dailyOnly.stage.won, undefined);
  assert.equal(selectStage(dailyOnly, 504).id, 504);

  const allDaily = buildSelectedSnapshot({
    catalog,
    selectedStages: ["daily:501", "daily:502", "daily:503", "daily:504"].map((key) => byKey[key]),
    includeCatalog: true,
    capturedAt: "2026-10-29T00:00:00.000Z",
    source: "https://example.test/playground/battle",
  });
  assert.equal(allDaily.stage.id, 504);
  assert.deepEqual(allDaily.catalog.stages.map((stage) => stage.id), [501, 502, 503, 504]);

  const dailyAndEndless = buildSelectedSnapshot({
    catalog,
    selectedStages: [byKey["endless:9101"], byKey["daily:504"]],
    includeCatalog: true,
    capturedAt: "2026-10-29T00:00:00.000Z",
    source: "https://example.test/playground/battle",
  });
  assert.equal(dailyAndEndless.stage.id, 9101);
  assert.deepEqual(dailyAndEndless.catalog.stages.map((stage) => stage.id), [504]);
});

test("only owned cat levels can be added to the export", () => {
  const buildRoster = markedFunction("buildRoster");
  const catalog = {
    cats: [{ id: "c1", name: "cat" }],
  };
  const state = {
    team: ["c1"],
    units: [{ cat_id: "c1", owned: true, level: 12 }],
  };
  assert.deepEqual(buildRoster(catalog, state), {
    ownedUnits: [{ id: "c1", name: "cat", level: 12 }],
  });
});

test("the userscript does not submit data or export unrelated account state", () => {
  assert.doesNotMatch(source, /method:\s*["']POST["']/i);
  assert.doesNotMatch(source, /fetch\([^\n]+,\s*\{[^}]*method:/s);
  assert.doesNotMatch(source, /privacy:\s*\{/);
  assert.doesNotMatch(source, /state\.cans/);
});
