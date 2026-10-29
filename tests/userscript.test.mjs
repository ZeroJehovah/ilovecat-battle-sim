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
  assert.match(source, /USERSCRIPT_VERSION = "0\.3\.3"/);
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
  assert.match(source, /无战斗时由脚本点击“开始战斗”/);
  assert.match(source, /autoItems/);
  assert.match(source, /selectPreparationItems/);
  assert.match(source, /updateItemWarning/);
  assert.match(source, /strategyRosterLines/);
  assert.match(source, /matchesStageTitle/);
  assert.match(source, /readStageFromFiber/);
  assert.match(source, /validatePreparationStage/);
  assert.match(source, /stageMatch/);
  assert.match(source, /顺序不强制/);
  assert.match(source, /自动勾选策略所需消耗品/);
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
  assert.match(source, /stage-list/);
  assert.match(source, /仅当前无尽/);
  assert.match(source, /仅限时活动/);
  assert.match(source, /apiGet\("raid"\)/);
  assert.match(source, /js-scope/);
  assert.match(source, /复制所选 JSON/);
  assert.match(source, /下载所选 JSON/);
  assert.doesNotMatch(source, /download-snapshot/);
});

test("the export scope lists campaign, endless and active raid stages", () => {
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
  const entries = buildStageEntries(catalog, endless, raid);
  assert.deepEqual(entries.map((entry) => entry.key), [
    "endless:9101",
    "raid:9001",
    "campaign:1",
    "campaign:2",
  ]);
  assert.equal(entries[0].endlessMeta.ends, "2026-11-01");
  assert.equal(entries[1].raidMeta.eventId, "halloween-2026");
  assert.equal(entries[3].stage.waves.length, 1);
  assert.equal(buildStageEntries(catalog, endless, { ...raid, ended: true })
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
  const entries = buildStageEntries(catalog, endless, raid);
  const snapshot = buildSelectedSnapshot({
    catalog,
    selectedStages: [entries[0], entries[1], entries[3]],
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
    selectedStages: [entries[2]],
    includeCatalog: true,
    capturedAt: "2026-10-29T00:00:00.000Z",
    source: "https://example.test/playground/battle",
  });
  assert.equal(campaignOnly.stage.id, 1);
  assert.equal(campaignOnly.endlessMeta, undefined);
  assert.equal(selectStage(campaignOnly, 1).id, 1);

  const raidOnly = buildSelectedSnapshot({
    catalog,
    selectedStages: [entries[1]],
    includeCatalog: true,
    capturedAt: "2026-10-29T00:00:00.000Z",
    source: "https://example.test/playground/battle",
  });
  assert.equal(raidOnly.stage.id, 9001);
  assert.deepEqual(raidOnly.catalog.stages.map((stage) => stage.id), [9001]);
  assert.equal(raidOnly.raidMeta.running, true);

  const stagesOnly = buildSelectedSnapshot({
    catalog,
    selectedStages: [entries[2]],
    includeCatalog: false,
    capturedAt: "2026-10-29T00:00:00.000Z",
    source: "https://example.test/playground/battle",
  });
  assert.equal(stagesOnly.catalog, undefined);
  assert.equal(stagesOnly.stage.id, 1);
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
  assert.match(source, /"uid", "cookies", "authorization", "cans"/);
  assert.doesNotMatch(source, /state\.cans/);
});
