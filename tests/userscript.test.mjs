import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { selectStage, normalizePolicyPhases as normalizeRunnerPhases } from "../src/runner.mjs";

const source = await readFile(
  new URL("../tools/ilovecat-workbench.user.js", import.meta.url),
  "utf8",
);

function markedFunction(name, dependencies = {}) {
  const startMarker = `// testable:${name}`;
  const endMarker = `// end testable:${name}`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  const body = source.slice(start + startMarker.length, end).trim();
  return new Function(
    ...Object.keys(dependencies),
    `return (${body})`,
  )(...Object.values(dependencies));
}

test("the userscript is syntactically valid and exposes both workflows", () => {
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /@match\s+https:\/\/api\.ilovecat520\.me\/\*/);
  assert.match(source, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/ZeroJehovah\/ilovecat-battle-sim\/main\/tools\/ilovecat-workbench\.user\.js/);
  assert.match(source, /@grant\s+GM_xmlhttpRequest/);
  assert.match(source, /@grant\s+GM_setValue/);
  assert.match(source, /@grant\s+GM_getValue/);
  assert.match(source, /@grant\s+GM_registerMenuCommand/);
  assert.match(source, /@grant\s+GM_unregisterMenuCommand/);
  assert.match(source, /@connect\s+github\.com/);
  assert.match(source, /@connect\s+raw\.githubusercontent\.com/);
  const metadataVersion = source.match(/^\/\/ @version[ \t]+(\S+)[ \t]*$/m)?.[1];
  assert.match(metadataVersion ?? "", /^\d+\.\d+\.\d+$/);
  const runtimeVersion = source.match(/\bconst USERSCRIPT_VERSION = "([^"]+)";/)?.[1];
  assert.equal(runtimeVersion, metadataVersion);
  assert.match(source, /isStrategyExpired/);
  assert.match(source, /activeOnlineStrategies/);
  assert.match(source, /scheduleOnlineStrategyExpiry/);
  assert.match(source, /onlineStrategyId: selectedOnlineStrategyId/);
  assert.match(source, /onlineStrategyExpiryError\(current\.onlineStrategyId\)/);
  assert.match(source, /<div class="title">喵喵的逆袭工具 <span class="version">v\$\{USERSCRIPT_VERSION\}<\/span><\/div>/);
  assert.match(source, /ilovecat-game-export/);
  assert.match(source, /ilovecat-battle-strategy/);
  assert.match(source, /battleBundles/);
  assert.match(source, /fallbackPriority/);
  assert.match(source, /deploySequence/);
  assert.match(source, /sequenceIndex/);
  assert.match(source, /选择本地 JSON/);
  assert.match(source, /strategyFile/);
  assert.match(source, /online-strategies/);
  assert.ok(source.includes('<button data-tab="online">在线策略</button>'));
  assert.ok(source.includes('<button data-tab="local">本地策略</button>'));
  assert.ok(!source.includes('data-tab="execute"'));
  assert.match(source, /online-stage-filters/);
  assert.match(source, /online-stage-filter.selected/);
  assert.match(source, /online-strategy-details/);
  assert.match(source, /const visible = filterStrategiesByStage/);
  assert.ok(source.includes("if (selected) {"));
  assert.ok(!source.includes('class="validate"'));
  assert.ok(!source.includes("ui.validate"));
  assert.ok(!source.includes("校验</button>"));
  assert.ok(source.split("await validateFromUi()").length - 1 >= 2);
  assert.match(source, /ilovecat-battle-sim-docs\/raw\/main\/strategies\/index\.json/);
  assert.match(source, /GM_xmlhttpRequest/);
  const strategyViewStart = source.indexOf('<div class="view" data-view="online"');
  const strategyViewEnd = source.indexOf("</section>", strategyViewStart);
  assert.notEqual(strategyViewStart, -1);
  assert.notEqual(strategyViewEnd, -1);
  assert.doesNotMatch(source.slice(strategyViewStart, strategyViewEnd), /<textarea/);
  assert.doesNotMatch(source, /粘贴 ilovecat-battle-strategy JSON/);
  assert.doesNotMatch(source, /ui\.strategy\b/);
  assert.match(source, /strictTimeline/);
  assert.match(source, /scheduleMiss/);
  assert.match(source, /autoStart/);
  assert.match(source, /findPreparationRuntime/);
  assert.match(source, /validatePreparation/);
  assert.match(source, /BATTLE_START_TIMEOUT_MS/);
  assert.match(source, /requirePlaying/);
  assert.match(source, /prep\.startButton\.click\(\)/);
  assert.match(source, /自动开始战斗/);
  assert.match(source, /自动开始战斗[\s\S]*?静默执行[\s\S]*?执行倍速/);
  assert.match(source, /class="silent-run"/);
  assert.match(source, /class="run-speed"/);
  assert.match(source, /<option value="1">1x<\/option>[\s\S]*?<option value="2">2x<\/option>[\s\S]*?<option value="3">3x<\/option>[\s\S]*?<option value="auto" selected>自动<\/option>/);
  assert.ok(source.includes('<button class="auto-run" type="button">自动执行</button>'));
  assert.doesNotMatch(source, /class="auto-speed"|ui\.autoSpeed|自动倍速<\/label>/);
  assert.doesNotMatch(source, /无战斗时由脚本点击“开始战斗”|autoItems|auto-items/);
  assert.match(source, /selectPreparationItems/);
  assert.match(source, /await selectPreparationItems\(strategy, prep\)/);
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
  assert.doesNotMatch(source, /自动勾选策略所需消耗品|请先在准备界面手动勾选/);
  assert.match(source, /item-warning/);
  assert.match(source, /readBattleSpeed/);
  assert.match(source, /autoSpeed/);
  assert.match(source, /manageAutoSpeed/);
  assert.match(source, /manageExecutionSpeed/);
  assert.match(source, /manageFixedSpeed/);
  assert.match(source, /parseSpeedChoice/);
  assert.match(source, /hideWorkbench/);
  assert.match(source, /restoreWorkbench/);
  assert.match(source, /armAutoExecute/);
  assert.match(source, /pollAutoExecution/);
  assert.match(source, /cancelAutoExecution/);
  assert.match(source, /AUTO_EXECUTE_TIMEOUT_MS/);
  assert.match(source, /isNewBattleForAutoExecution/);
  assert.match(source, /REVIEW_STORAGE_KEY/);
  assert.match(source, /reviewEndpointKind/);
  assert.match(source, /battleEngineFromReactValue/);
  assert.match(source, /collectReviewBattleState/);
  assert.match(source, /installReviewTap/);
  assert.match(source, /buildReviewPackage/);
  assert.match(source, /persistReviewPackage/);
  assert.ok(source.includes('register("导出上局复核包", exportLastReviewPackage)'));
  assert.ok(source.includes('register("重新打开脚本面板", reopenWorkbenchFromMenu)'));
  assert.match(source, /没有可导出的上局复核包/);
  assert.doesNotMatch(source, /if \(silent\) restoreWorkbench\(\)/);
  assert.match(source, /estimateNextAction/);
  assert.match(source, /BATTLE_SPEED_KEY/);
  assert.match(source, /空闲 3×/);
  assert.match(source, /当前不会执行策略动作/);
  assert.match(source, /pressDeployKey/);
  assert.match(source, /deployKeyForSlot/);
  assert.match(source, /new pageWindow\.KeyboardEvent\("keydown"/);
  assert.match(source, /return pressDeployKey\(slot, context\)/);
  assert.match(source, /policy\.actionGap/);
  assert.match(source, /autoCannonAfter/);
  assert.match(source, /autoCannonMinTargets/);
  assert.match(source, /autoCannonFallbackAfter/);
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
  assert.match(source, /<div class="fixed-stages"><label class="fixed-stage-label"><input class="fixed-stage-enable" type="checkbox"> 固定关卡<\/label>/);
  assert.doesNotMatch(source, /<label class="fixed-stages">/);
  assert.match(source, /fixed-stage-input/);
  assert.match(source, /placeholder="关卡 id，例如 1,2,3"/);
  assert.match(source, /js-enable/);
  assert.match(source, /JS源码<\/label>/);
  assert.doesNotMatch(source, /JS源码：/);
  assert.match(source, /JS源码<\/label>[\s\S]*?value="battle"> 战斗逻辑[\s\S]*?value="all"> 全部/);
  assert.doesNotMatch(source, /value="none"/);
  assert.doesNotMatch(source, /include-catalog" type="checkbox" checked/);
  assert.doesNotMatch(source, /ui\.fixedStages\.disabled|input\.disabled = !dailyEnabled/);
  assert.match(source, /ui\.fixedStageEnable\.checked = ui\.fixedStages\.value\.trim\(\) !== ""/);
  assert.match(source, /ui\.jsEnable\.checked = ui\.jsScopes\.some\(\(input\) => input\.checked\)/);
  assert.match(source, /dailyMaster\.checked = \[\.\.\.ui\.stageChoices\.querySelectorAll\("\.daily-difficulty-input"\)\]/);
  assert.match(source, /ui\.fixedStages\.value = "";/);
  assert.match(source, /for \(const input of ui\.jsScopes\) input\.checked = false;/);
  assert.match(source, /input\.checked = selectedBefore\.has\(entry\.key\)/);
  assert.match(source, /stageChoices\.querySelectorAll\("input\[data-stage-key\]:checked"\)/);
  assert.doesNotMatch(source, /!hadOptions|previouslyAll/);
  assert.doesNotMatch(source, /privacy:\s*\{/);
  assert.doesNotMatch(source, /\[data-view="execute"\] > textarea/);
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

test("phase policies share validation rules with the runner and require strategy format v2", () => {
  const normalizeDeployIntervals = markedFunction("normalizeDeployIntervals");
  const normalizePolicyPhases = markedFunction("normalizePolicyPhases", { normalizeDeployIntervals });
  const phases = [{ at: 30, walletTarget: 8 }, { at: 735,
    targetCounts: { a5: 0, c6: 2 }, priority: ["c6"], fallbackAfter: 735,
    fallbackPriority: ["c1"], automatic: true }];
  assert.deepEqual(normalizePolicyPhases(phases), normalizeRunnerPhases(phases));
  for (const invalid of [
    [{ at: -1 }], [{ at: 2 }, { at: 1 }], [{ at: 1 }, { at: 1 }],
    [{ at: 1, targetCounts: { c1: -1 } }], [{ at: 1, observationDelay: 0 }],
    [{ at: 1, priority: "c1" }], [{ at: 1, walletTarget: 9 }],
  ]) {
    assert.throws(() => normalizePolicyPhases(invalid));
    assert.throws(() => normalizeRunnerPhases(invalid));
  }
  const parseStrategy = markedFunction("parseStrategyDocument", {
    STRATEGY_FORMAT: "ilovecat-battle-strategy", normalizePolicyPhases, normalizeDeployIntervals, ACTION_GAP_MS: 250,
    clampInt: (x) => Number(x), finiteNumber: (x) => Number(x),
    stringArray: (x) => [...new Set(x)], repeatedStringArray: (x) => [...x],
  });
  const strategy = { format: "ilovecat-battle-strategy", version: 2,
    team: [{ id: "c1", level: 1 }, { id: "c6", level: 1 }, { id: "a5", level: 40 }], policy: { phases } };
  assert.equal(parseStrategy(JSON.stringify(strategy)).version, 2);
  assert.throws(() => parseStrategy(JSON.stringify({ ...strategy, version: 1 })), /version=2/);
  assert.throws(() => parseStrategy(JSON.stringify({ ...strategy, version: 3 })), /version/);
  assert.throws(() => parseStrategy(JSON.stringify({ ...strategy,
    policy: { phases: [{ at: 1, priority: ["s1"] }] } })), /不在 team/);
  assert.equal(parseStrategy(JSON.stringify({ ...strategy, version: 1, policy: {} })).version, 1);
  assert.throws(() => parseStrategy(JSON.stringify({ ...strategy, version: 1,
    policy: { deployIntervals: { c1: 5 } } })), /version=2/);
});

test("browser deployment intervals throttle actual deployments and ignore page switches", () => {
  const executor = { policy: { deployIntervals: { c1: 5 } }, lastDeployAt: { c1: 1 } };
  let presses = 0, outcome = true;
  const tryDeploy = markedFunction("tryDeploy", { executor, pressDeployKey: () => { presses++; return outcome; } });
  const context = { team: [{ id: "c1", cost: 50 }] };
  const view = { time: 5.98, cats: 1, cooldowns: [0], money: 500 };
  assert.equal(tryDeploy("c1", view, context), false);
  assert.equal(presses, 0);
  assert.equal(tryDeploy("c1", { ...view, time: 6 }, context), true);
  assert.equal(executor.lastDeployAt.c1, 6);
  outcome = "page";
  assert.equal(tryDeploy("c1", { ...view, time: 11 }, context), "page");
  assert.equal(executor.lastDeployAt.c1, 6);
  assert.equal(tryDeploy("c1", { ...view, time: 11, money: 0 }, context), false);
  assert.equal(tryDeploy("c1", { ...view, time: 11, cats: 20 }, context), false);
});

test("browser phase transitions replace target maps and reset for a new battle", () => {
  const applyPolicyPhases = markedFunction("applyPolicyPhases");
  const original = { targetCounts: { a5: 10 }, priority: ["a5"], phases: [
    { at: 735, targetCounts: { c6: 2 }, priority: ["c6"] },
    { at: 850, targetCounts: { c1: 4 }, priority: ["c1"] },
  ] };
  const execution = { policy: { ...original }, phaseIndex: 0 };
  applyPolicyPhases(execution, 734.98);
  assert.equal(execution.phaseIndex, 0);
  applyPolicyPhases(execution, 735);
  assert.deepEqual(execution.policy.targetCounts, { c6: 2 });
  applyPolicyPhases(execution, 900);
  assert.equal(execution.phaseIndex, 2);
  assert.deepEqual(execution.policy.targetCounts, { c1: 4 });
  assert.deepEqual(original.targetCounts, { a5: 10 });
  const nextBattle = { policy: { ...original }, phaseIndex: 0 };
  applyPolicyPhases(nextBattle, 0);
  assert.deepEqual(nextBattle.policy.targetCounts, { a5: 10 });
});

test("speed choices map to auto or fixed execution speeds", () => {
  const parseSpeedChoice = markedFunction("parseSpeedChoice");
  assert.equal(parseSpeedChoice("auto"), "auto");
  assert.equal(parseSpeedChoice("1"), 1);
  assert.equal(parseSpeedChoice("2"), 2);
  assert.equal(parseSpeedChoice("3"), 3);
  for (const value of ["", "0", "4", "1.5", null, undefined]) {
    assert.equal(parseSpeedChoice(value), "auto");
  }
});

test("fixed execution speed waits for the target before acting", () => {
  let now = 0;
  let current = 1;
  let clicks = 0;
  const executor = {
    nextActionAt: 0,
    autoSpeedMissingSince: 0,
    autoSpeedStuckSince: 0,
    autoSpeedRaised: false,
  };
  const manageFixedSpeed = markedFunction("manageFixedSpeed", {
    AUTO_SPEED_STUCK_MS: 1800,
    performance: { now: () => now },
    readBattleSpeedNumber: () => current,
    cycleBattleSpeed: () => {
      clicks++;
      current = current === 3 ? 1 : current + 1;
      return true;
    },
    executor,
  });

  assert.deepEqual(manageFixedSpeed(1), {
    current: 1, target: 1, eta: null, reason: "固定倍速", busy: false,
  });
  assert.equal(clicks, 0);

  now = 10;
  assert.equal(manageFixedSpeed(3).busy, true);
  assert.equal(clicks, 1);
  assert.equal(current, 2);
  assert.equal(executor.autoSpeedRaised, true);

  executor.nextActionAt = 500;
  now = 100;
  assert.equal(manageFixedSpeed(3).waiting, true);
  assert.equal(clicks, 1);

  executor.nextActionAt = 0;
  now = 260;
  assert.equal(manageFixedSpeed(3).busy, true);
  assert.equal(clicks, 2);
  assert.equal(current, 3);

  now = 520;
  const settled = manageFixedSpeed(3);
  assert.equal(settled.busy, false);
  assert.equal(settled.current, 3);
  assert.equal(clicks, 2);
});

test("review capture only listens to battle start and finish endpoints", () => {
  const reviewEndpointKind = markedFunction("reviewEndpointKind");
  assert.equal(reviewEndpointKind("/api/cat/battle/start"), "start");
  assert.equal(reviewEndpointKind("https://api.ilovecat520.me/api/cat/battle/finish?x=1"), "finish");
  assert.equal(reviewEndpointKind("/api/cat/battle/state"), "");
  assert.equal(reviewEndpointKind(null), "");
});

test("the review capture can read the battle engine from React hooks", () => {
  const battleEngineFromReactValue = markedFunction("battleEngineFromReactValue");
  const engine = {
    tick: 42,
    actions: [[0, 0, 0]],
    opts: { seed: 1 },
    snapshot() {},
  };
  assert.equal(battleEngineFromReactValue({ current: engine }), engine);
  assert.equal(battleEngineFromReactValue(engine), engine);
  assert.equal(battleEngineFromReactValue({ time: 1, result: "playing" }), null);
  assert.equal(battleEngineFromReactValue({ current: { tick: 1, actions: [] } }), null);
});

test("review packages keep the finish request but omit settlement response bodies", () => {
  const cloneReviewValue = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const unwrapReviewResponse = markedFunction("unwrapReviewResponse", { cloneReviewValue });
  const sanitizeReviewStartData = markedFunction("sanitizeReviewStartData", { cloneReviewValue });
  const buildReviewPackage = markedFunction("buildReviewPackage", {
    REVIEW_FORMAT: "ilovecat-battle-review",
    REVIEW_VERSION: 1,
    USERSCRIPT_VERSION: "test",
    pageWindow: { location: { href: "https://example.test/playground/battle" } },
    cloneReviewValue,
    sanitizeReviewStartData,
    sanitizeReviewStartRequest: markedFunction("sanitizeReviewStartRequest", { cloneReviewValue }),
    unwrapReviewResponse,
  });
  const review = buildReviewPackage({
    capturedAt: "2026-11-15T00:00:00.000Z",
    start: {
      request: {
        id: "start-request",
        body: { stage: { id: 1 }, team: ["c1"], items: [], borrow: { lender_id: 777, cat_id: "c9" } },
      },
      response: {
        status: 200,
        response: {
          success: true,
          data: {
            run_id: "run-1",
            seed: 123,
            stage: { id: 1 },
            team: [{ cat_id: "c1", level: 9 }],
            items: [],
            borrow: { lender_id: 777, cat_id: "c9" },
            cans: 999,
            best: 12345,
          },
        },
      },
    },
    finish: {
      request: {
        id: "finish-request",
        body: { run_id: "run-1", ticks: 100, actions: [[0, 0, 0]], gave_up: false },
      },
      response: {
        status: 200,
        at: "2026-11-15T00:01:00.000Z",
        response: { success: true, data: { cans: 50, best: 54321 } },
      },
    },
    battle: null,
  });

  assert.equal(review.format, "ilovecat-battle-review");
  assert.equal(review.start.data.cans, undefined);
  assert.equal(review.start.data.best, undefined);
  assert.equal(review.start.data.seed, 123);
  assert.deepEqual(review.start.data.borrow, { cat_id: "c9" });
  assert.deepEqual(review.start.request.body.borrow, { cat_id: "c9" });
  assert.equal(review.finish.request.body.ticks, 100);
  assert.equal(review.finish.request.body.gave_up, false);
  assert.equal(review.finish.response, undefined);
  assert.equal(review.finish.status, 200);
  assert.equal(review.battle.runId, "run-1");
  assert.equal(review.battle.seed, 123);
  assert.deepEqual(review.battle.team, [{ cat_id: "c1", level: 9 }]);
});

test("auto execution ignores a battle that was already playing when armed", () => {
  const isNewBattleForAutoExecution = markedFunction("isNewBattleForAutoExecution");
  const baseline = { time: 12, seed: 7 };
  const current = { context: { seed: 7 }, snapshot: { time: 12.5 } };
  assert.equal(isNewBattleForAutoExecution(baseline, current), false);
  assert.equal(isNewBattleForAutoExecution(baseline, {
    context: { seed: 8 },
    snapshot: { time: 12.5 },
  }), true);
  assert.equal(isNewBattleForAutoExecution(baseline, {
    context: { seed: 7 },
    snapshot: { time: 0 },
  }), true);
  assert.equal(isNewBattleForAutoExecution(undefined, current), true);
  assert.equal(isNewBattleForAutoExecution({ time: 12 }, {
    context: { seed: null },
    snapshot: { time: 12.5 },
  }), false);
});

test("automatic cannon waits for late live targets with a timed fallback", () => {
  const cannonTargetCount = markedFunction("cannonTargetCount");
  const shouldFireCannon = markedFunction("shouldFireCannon", {
    CANNON_READY: 1,
    cannonTargetCount,
  });
  const policy = {
    autoCannon: true,
    autoCannonAfter: 800,
    autoCannonMinTargets: 1,
    autoCannonFallbackAfter: 840,
  };
  const base = { time: 800, cannon: 1, cannonTargets: 0 };

  assert.equal(shouldFireCannon(base, policy), false);
  assert.equal(shouldFireCannon({ ...base, cannonTargets: 1 }, policy), true);
  assert.equal(shouldFireCannon({ ...base, time: 799, cannonTargets: 1 }, policy), false);
  assert.equal(shouldFireCannon({ ...base, cannon: 0.99, cannonTargets: 1 }, policy), false);
  assert.equal(shouldFireCannon({ ...base, time: 839, cannonTargets: undefined }, policy), false);
  assert.equal(shouldFireCannon({ ...base, time: 840, cannonTargets: undefined }, policy), true);
});

test("battle units can be read from the React engine ref", () => {
  const battleUnitsFromReactValue = markedFunction("battleUnitsFromReactValue");
  const cannonTargetCount = markedFunction("cannonTargetCount");
  const units = [
    { side: "mouse", dead: 0, x: 500 },
    { side: "mouse", dead: 0, x: 455 },
    { side: "mouse", dead: 0.2, x: 510 },
    { side: "cat", dead: 0, x: 800 },
  ];
  assert.equal(battleUnitsFromReactValue({ current: { units } }), units);
  assert.equal(battleUnitsFromReactValue({ units: [{ cat_id: "c1" }] }), null);
  assert.equal(cannonTargetCount({ units }), 1);
});

test("the online index lists upgrade plans while strategy metadata must match exactly", () => {
  const parseStrategyIndex = markedFunction("parseStrategyIndex");
  const validateIndexedStrategy = markedFunction("validateIndexedStrategy");
  const file = "boss.user-strategy.json";
  const rawRoot = "https://github.com/ZeroJehovah/ilovecat-battle-sim-docs/raw/main/strategies/";
  const rawIndex = JSON.stringify({
    format: "ilovecat-strategy-index",
    version: 1,
    updatedAt: "2026-10-29T23:05:13+08:00",
    roster: {
      capturedAt: "2026-10-29T00:15:17+08:00",
      levels: { c7: 48, b4: 16 },
    },
    strategies: [{
      id: "boss-fixed",
      title: "Boss fixed",
      description: "Use the fixed sequence.",
      expiresAt: "2026-11-16T00:00:00+08:00",
      file,
      rawUrl: rawRoot + file,
      stage: { id: 9001, name: "Boss" },
      team: [
        { id: "c7", name: "虎斑", level: 48 },
        { id: "b4", name: "布偶护士", level: 16 },
      ],
      tags: ["推荐"],
    }],
  });
  const index = parseStrategyIndex(rawIndex, rawRoot);
  assert.equal(index.strategies[0].rawUrl, rawRoot + file);
  assert.equal(index.strategies[0].expiresAt, "2026-11-16T00:00:00+08:00");
  assert.deepEqual(index.strategies[0].team.map((cat) => cat.id), ["c7", "b4"]);

  const strategy = {
    format: "ilovecat-battle-strategy",
    version: 1,
    stageId: 9001,
    team: [{ id: "c7", level: 48 }, { id: "b4", level: 16 }],
  };
  assert.equal(validateIndexedStrategy(index, index.strategies[0], strategy), true);
  for (const level of [15, 17]) {
    assert.throws(
      () => validateIndexedStrategy(index, index.strategies[0], {
        ...strategy,
        team: [{ id: "c7", level: 48 }, { id: "b4", level }],
      }),
      /等级与索引不一致/,
    );
  }

  const external = JSON.parse(rawIndex);
  external.strategies[0].rawUrl = "https://example.test/boss.json";
  assert.throws(() => parseStrategyIndex(JSON.stringify(external), rawRoot), /rawUrl 必须指向私有策略库/);

  for (const expiresAt of ["not-a-date", ""]) {
    const invalidExpiry = JSON.parse(rawIndex);
    invalidExpiry.strategies[0].expiresAt = expiresAt;
    assert.throws(() => parseStrategyIndex(JSON.stringify(invalidExpiry), rawRoot), /expiresAt 不是有效日期/);
  }
  const withoutExpiry = JSON.parse(rawIndex);
  delete withoutExpiry.strategies[0].expiresAt;
  assert.equal(parseStrategyIndex(JSON.stringify(withoutExpiry), rawRoot).strategies[0].expiresAt, null);

  const upgraded = JSON.parse(rawIndex);
  upgraded.roster.levels.c7 = 49;
  const upgradedIndex = parseStrategyIndex(JSON.stringify(upgraded), rawRoot);
  assert.equal(validateIndexedStrategy(upgradedIndex, upgradedIndex.strategies[0], strategy), true);

  for (const level of [47, undefined]) {
    const insufficient = JSON.parse(rawIndex);
    insufficient.roster.levels.c7 = level;
    const plannedIndex = parseStrategyIndex(JSON.stringify(insufficient), rawRoot);
    assert.equal(plannedIndex.strategies[0].team[0].level, 48);
    assert.equal(plannedIndex.roster.levels.c7, level);
    assert.equal(validateIndexedStrategy(plannedIndex, plannedIndex.strategies[0], strategy), true);

    const validateStrategy = markedFunction("validateStrategy", { ACTION_GAP_MS: 250, ITEM_NAMES: {} });
    for (const liveLevel of [47, undefined, 48, 49]) {
      const messages = validateStrategy({
        ...strategy,
        items: [],
        policy: { actions: [], openers: [], deploySequence: [], priority: [], targetCounts: {}, fallbackPriority: [] },
      }, { context: {
        stageId: strategy.stageId,
        team: strategy.team.map((cat) => ({ ...cat, level: cat.id === "c7" ? liveLevel : cat.level })),
        items: [],
      } });
      assert.equal(messages.some((message) => /^错误：等级未达要求/.test(message)), !(liveLevel >= 48));
    }
  }

  for (const level of [0, -1, 1.5, 1000]) {
    const invalid = JSON.parse(rawIndex);
    invalid.strategies[0].team[0].level = level;
    assert.throws(() => parseStrategyIndex(JSON.stringify(invalid), rawRoot), /team\[0\] 无效/);
  }
});

test("online strategies expire at their optional expiresAt and disappear from filters", () => {
  const isStrategyExpired = markedFunction("isStrategyExpired");
  const activeOnlineStrategies = markedFunction("activeOnlineStrategies", { isStrategyExpired });
  const buildOnlineStageFilters = markedFunction("buildOnlineStageFilters", { activeOnlineStrategies });
  const filterStrategiesByStage = markedFunction("filterStrategiesByStage", { activeOnlineStrategies });
  const expiresAt = "2026-11-16T00:00:00+08:00";
  const expiry = Date.parse(expiresAt);
  const index = {
    strategies: [
      { id: "boss-a", expiresAt, stage: { id: 9001, name: "世界王" } },
      { id: "boss-b", expiresAt: "2026-11-15T22:00:00+08:00", stage: { id: 9001, name: "世界王" } },
      { id: "endless", stage: { id: 9101, name: "无尽" } },
    ],
  };

  assert.equal(isStrategyExpired(index.strategies[0], expiry - 1), false);
  assert.equal(isStrategyExpired(index.strategies[0], expiry), true);
  assert.equal(isStrategyExpired(index.strategies[2], expiry), false);
  assert.equal(isStrategyExpired({ expiresAt: "not-a-date" }, expiry), false);

  assert.deepEqual(
    activeOnlineStrategies(index, expiry - 1).map((entry) => entry.id),
    ["boss-a", "endless"],
  );
  assert.deepEqual(buildOnlineStageFilters(index, expiry - 1), [
    { id: 9001, name: "世界王", count: 1 },
    { id: 9101, name: "无尽", count: 1 },
  ]);
  assert.deepEqual(filterStrategiesByStage(index, "9001", expiry - 1).map((entry) => entry.id), ["boss-a"]);
  assert.deepEqual(filterStrategiesByStage(index, 9101, expiry - 1).map((entry) => entry.id), ["endless"]);
  assert.deepEqual(filterStrategiesByStage(index, 1, expiry - 1), []);

  assert.deepEqual(activeOnlineStrategies(index, expiry).map((entry) => entry.id), ["endless"]);
  assert.deepEqual(buildOnlineStageFilters(index, expiry), [{ id: 9101, name: "无尽", count: 1 }]);
  assert.deepEqual(filterStrategiesByStage(index, "9001", expiry), []);
});

test("an armed auto execution refuses an online strategy that expired", () => {
  const isStrategyExpired = markedFunction("isStrategyExpired");
  const onlineStrategyExpiryError = markedFunction("onlineStrategyExpiryError", { isStrategyExpired });
  const now = Date.parse("2026-11-16T00:00:00+08:00");
  const index = {
    strategies: [
      { id: "live", expiresAt: "2026-11-16T00:00:01+08:00" },
      { id: "old", expiresAt: "2026-11-16T00:00:00+08:00" },
    ],
  };
  assert.equal(onlineStrategyExpiryError("live", index, now), "");
  assert.match(onlineStrategyExpiryError("old", index, now), /已过期/);
  assert.match(onlineStrategyExpiryError("missing", index, now), /已从有效索引移除/);
  assert.equal(onlineStrategyExpiryError("", index, now), "");
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
  const buildStrategySummary = markedFunction("buildStrategySummary", {
    sortCatsByTier: markedFunction("sortCatsByTier"),
  });
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
  const buildUiValidationResults = markedFunction("buildUiValidationResults", {
    validatePreparationStage: markedFunction("validatePreparationStage"),
  });
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
  const buildUiValidationResults = markedFunction("buildUiValidationResults", {
    validatePreparationStage: markedFunction("validatePreparationStage"),
  });
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
  assert.match(results[1].text, /^错误：当前准备界面/);
  assert.match(results[1].text, /策略关卡 id 20/);
  assert.match(results[2].text, /^配队不符：.*白糰子\(12\)/);
  assert.match(results[3].text, /^道具不足：/);
});

test("preparation and active battle validation enforce each cat's minimum level", () => {
  const buildUiValidationResults = markedFunction("buildUiValidationResults", {
    validatePreparationStage: markedFunction("validatePreparationStage"),
  });
  const strategy = {
    stageId: 20,
    team: [{ id: "c7", level: 48 }, { id: "c1", level: 12 }],
    items: [],
  };
  const cats = new Map([["c7", "虎斑"], ["c1", "白糰子"]]);
  for (const mode of ["preparation", "battle"]) {
    for (const level of [48, 49, 47, undefined, null]) {
      const context = {
        stageId: 20,
        stageMatch: true,
        team: [{ id: "c7", level }, { id: "c1", level: 99 }],
        items: [],
      };
      const results = buildUiValidationResults(
        strategy,
        mode === "battle" ? { context } : null,
        mode === "preparation" ? context : null,
        cats,
      );
      if (level === 48 || level === 49) {
        assert.ok(results.every((result) => result.type === "success"), `${mode}: level ${level}`);
        assert.equal(results.at(-1).text, "校验通过。");
      } else {
        const errors = results.filter((result) => result.type === "error");
        assert.equal(errors.length, 1, `${mode}: level ${level}`);
        assert.match(errors[0].text, /等级未达要求：虎斑 最低需要 48，当前/);
        assert.doesNotMatch(errors[0].text, /白糰子/);
        assert.ok(!results.some((result) => result.text === "校验通过。"));
      }
    }
  }
});

test("the first live snapshot rechecks minimum levels before executing actions", () => {
  const validateStrategy = markedFunction("validateStrategy", { ACTION_GAP_MS: 250, ITEM_NAMES: {} });
  const strategy = {
    stageId: 20,
    team: [{ id: "c7", level: 48 }, { id: "c1", level: 12 }],
    items: [],
    policy: { openers: [], priority: [], fallbackPriority: [], deploySequence: [], targetCounts: {}, actions: [] },
  };
  for (const level of [48, 49, 47, undefined, null]) {
    const messages = validateStrategy(strategy, { context: {
      stageId: 20,
      team: [{ id: "c7", level }, { id: "c1", level: 99 }],
      items: [],
    } });
    if (level === 48 || level === 49) {
      assert.ok(!messages.some((line) => /^(错误|警告)/.test(line)));
      assert.match(messages.at(-1), /^校验通过/);
    } else {
      assert.ok(messages.some((line) => /^错误：等级未达要求：c7 最低需要 48/.test(line)));
      assert.equal(messages.at(-1), "校验失败。");
    }
  }
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
