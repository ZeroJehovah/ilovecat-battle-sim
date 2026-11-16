import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BattleEngine } from "../src/engine.mjs";
import { aggregate, AutoPolicy, simulate } from "../src/runner.mjs";

const snapshot = JSON.parse(
  await readFile(new URL("../data/snapshot.json", import.meta.url), "utf8"),
);
const stage1 = snapshot.catalog.stages.find((stage) => stage.id === 1);
const mouse = (id) => snapshot.catalog.mice.find((entry) => entry.id === id);

function bareStage(base = stage1) {
  return { ...base, waves: [], scale: 1, modifier: null };
}

function engineFor(team, stage = bareStage(), options = {}) {
  return new BattleEngine({
    catalog: snapshot.catalog,
    stage,
    team,
    seed: options.seed ?? 1,
    items: options.items ?? [],
    teamSlots: options.teamSlots ?? null,
    onEvent: options.onEvent ?? null,
  });
}

test("snapshot contains the current catalog and endless wave data", () => {
  assert.equal(snapshot.catalog.cats.length, 33);
  assert.equal(snapshot.catalog.mice.length, 56);
  assert.equal(snapshot.catalog.stages.length, 40);
  assert.equal(snapshot.stage.id, 9101);
  assert.equal(snapshot.stage.modifier, "heatwave");
  assert.equal(snapshot.endlessMeta.season, "2026-11-16");
  assert.equal(snapshot.stage.time_limit, 900);
  assert.equal(snapshot.stage.waves.length, 84);

  const lateRageWave = snapshot.stage.waves.find((wave) => wave.at === 745);
  assert.deepEqual(lateRageWave.traits, ["rage"]);
  assert.equal(lateRageWave.mouse, "m16");
  assert.equal(lateRageWave.scale, 40.35);
  assert.equal(Math.round(mouse("m16").hp * lateRageWave.scale), 72630);
  assert.equal(Math.round(mouse("m16").atk * lateRageWave.scale), 4842);
});

test("level growth and Tian lightning use full primary and 50% secondary damage", () => {
  const engine = engineFor([{ id: "s1", level: 10 }], { ...stage1, waves: [] });
  engine.money = 1_000_000;
  assert.equal(engine.deploy(0), true);
  const tian = engine.units.find((unit) => unit.id === "s1");
  assert.equal(tian.atk, 418);

  engine.spawnMouse(mouse("m1"), 800, 1);
  engine.spawnMouse(mouse("m1"), 790, 1);
  engine.spawnMouse(mouse("m1"), 780, 1);
  const mice = engine.units.filter((unit) => unit.side === "mouse");
  assert.deepEqual(mice.map((unit) => unit.hp), [216, 216, 216]);

  engine.hit(tian);
  assert.equal(mice[0].hp, 0);
  assert.equal(mice[1].hp, 7);
  assert.equal(mice[2].hp, 7);
});

test("effective attack period includes the 0.28s windup and one 0.02s frame", () => {
  const hits = [];
  const engine = engineFor(
    [{ id: "s1", level: 10 }],
    bareStage(snapshot.stage),
    { onEvent: (type, payload) => type === "hit" && payload.side === "mouse" && hits.push(payload.time) },
  );
  engine.money = 1_000_000;
  engine.deploy(0);
  const durableMouse = { ...mouse("m1"), hp: 1e9, atk: 0, dodge: 0 };
  engine.spawnMouse(durableMouse, 800, 1);
  while (engine.time < 7.6) engine.step();

  assert.equal(hits.length, 3);
  assert.ok(Math.abs(hits[0] - 0.52) < 0.001);
  assert.ok(Math.abs(hits[1] - hits[0] - 3.3) < 0.001);
  assert.ok(Math.abs(hits[2] - hits[1] - 3.3) < 0.001);
});

test("Phoenix Lv.17 heals each ally in range for 728", () => {
  const engine = engineFor([
    { id: "s4", level: 17 },
    { id: "c1", level: 1 },
  ], bareStage(snapshot.stage));
  engine.money = 1_000_000;
  engine.deploy(0);
  engine.deploy(1);
  const phoenix = engine.units.find((unit) => unit.id === "s4");
  const ally = engine.units.find((unit) => unit.id === "c1");
  assert.equal(phoenix.atk, 364);
  ally.maxHp = 5000;
  ally.hp = 1000;
  while (engine.time < 3.2) engine.step();
  assert.equal(ally.hp, 1728);
  assert.equal(engine.telemetry.healingByCat.s4, 728);
});

test("direct freeze stacks rage and rage immunity; frostproof only shortens direct freeze", () => {
  const engine = engineFor([{ id: "s1", level: 1 }], bareStage(snapshot.stage));
  engine.spawnMouse(mouse("m18"), 500, 1, ["rage"]);
  const shadow = engine.units[0];
  engine.control(shadow, 3, true);
  assert.equal(shadow.frozen, 3);
  assert.equal(shadow.rageMeter, 36);
  engine.control(shadow, 3, true);
  assert.equal(shadow.rageMeter, 72);
  engine.control(shadow, 3, true);
  assert.equal(shadow.rageMeter, 0);
  assert.equal(shadow.rageImmune, 6);
  assert.equal(shadow.frozen, 0);
  assert.equal(engine.stats.rageTriggers, 1);

  engine.spawnMouse(mouse("m18"), 400, 1, ["frostproof"]);
  const resistant = engine.units[1];
  engine.control(resistant, 3, true);
  assert.ok(Math.abs(resistant.frozen - 0.9) < 0.001);
  engine.control(resistant, 1.5, false);
  assert.equal(resistant.frozen, 1.5);
});

test("heatwave halves direct freeze but not Timewarp freeze", () => {
  const stage = { ...bareStage(snapshot.stage), modifier: "heatwave" };
  const engine = engineFor([{ id: "s1", level: 1 }], stage);
  engine.spawnMouse(mouse("m18"), 500, 1);
  const target = engine.units[0];
  engine.control(target, 3, true);
  assert.equal(target.frozen, 1.5);
  engine.control(target, 1.5, false);
  assert.equal(target.frozen, 1.5);
});

test("full moon restores 1% maximum mouse health per second", () => {
  const engine = engineFor([{ id: "c1", level: 1 }], {
    ...bareStage(snapshot.stage),
    modifier: "moon",
  });
  engine.spawnMouse(mouse("m1"), 500, 1);
  const target = engine.units[0];
  target.hp = 40;
  engine.step();
  assert.ok(Math.abs(target.hp - 40.02) < 1e-9);
});

test("cat armor and upgraded towers apply the updated numeric rules", () => {
  const engine = engineFor(
    [{ id: "a7", level: 1 }],
    bareStage(snapshot.stage),
    { items: ["cannon_lv:10", "base_lv:10", "cannon_ready"] },
  );
  assert.equal(engine.cannonTime, 25);
  assert.equal(engine.cannonDamage, 350);
  assert.equal(engine.cannonCharge, 25);
  assert.equal(engine.catBaseMax, 7500);
  engine.money = 1_000_000;
  engine.deploy(0);
  const knight = engine.units[0];
  engine.damage(knight, 100, null, "test");
  assert.equal(knight.hp, knight.maxHp - 70);

  engine.spawnMouse(mouse("m1"), 500, 1);
  const cannonPolicy = new AutoPolicy([{ id: "a7", level: 1 }], { autoCannon: true });
  assert.equal(cannonPolicy.shouldFireCannon(engine), true);
  assert.equal(engine.fireCannon(), true);
  assert.ok(engine.units[1].dead > 0);
});

test("cats use the same dodge check as other combat units", () => {
  const engine = engineFor([{ id: "c1", level: 1 }], bareStage());
  engine.money = 1_000_000;
  engine.deploy(0);
  const cat = engine.units[0];
  cat.dodge = 0.5;

  engine.random = () => 0;
  assert.equal(engine.damage(cat, 100, null, "test"), false);
  assert.equal(cat.hp, cat.maxHp);

  engine.random = () => 0.99;
  assert.equal(engine.damage(cat, 100, null, "test"), true);
  assert.equal(cat.hp, cat.maxHp - 100);
});

test("Desert Traveler burn deals three delayed 20% attack ticks", () => {
  const engine = engineFor([{ id: "a9", level: 1 }], bareStage());
  engine.money = 1_000_000;
  engine.deploy(0);
  const traveler = engine.units[0];
  engine.spawnMouse({ ...mouse("m1"), hp: 1_000_000_000, atk: 0, speed: 0, range: 0 }, 800, 1);
  const target = engine.units[1];
  engine.hit(traveler);
  const afterHit = target.hp;
  assert.equal(target.burnDamage, 20);
  traveler.frozen = 10;
  for (let tick = 0; tick < 49; tick++) engine.step();
  assert.equal(target.hp, afterHit);
  engine.step();
  assert.equal(target.hp, afterHit - 20);
  for (let tick = 0; tick < 49; tick++) engine.step();
  engine.step();
  assert.equal(target.hp, afterHit - 40);
  for (let tick = 0; tick < 49; tick++) engine.step();
  engine.step();
  assert.equal(target.hp, afterHit - 60);
  for (let tick = 0; tick < 50; tick++) engine.step();
  assert.equal(target.hp, afterHit - 60);
});

test("Dune Kitten applies its configured movement slow", () => {
  const engine = engineFor([{ id: "c10", level: 1 }], bareStage());
  engine.money = 1_000_000;
  engine.deploy(0);
  const kitten = engine.units[0];
  engine.spawnMouse({ ...mouse("m1"), hp: 1_000_000_000, atk: 0 }, 800, 1);
  const target = engine.units[1];

  engine.hit(kitten);
  assert.equal(target.slowed, 2.5);
  assert.equal(target.slowFactor, 0.75);
});

test("Gear Artificer maintains one 300 HP turret with half its attack", () => {
  const engine = engineFor([{ id: "b9", level: 1 }], bareStage(snapshot.stage));
  engine.money = 1_000_000;
  engine.deploy(0);
  const artificer = engine.units[0];
  artificer.abilityTimer = 0;
  engine.tickAbility(artificer, 0.02);
  const turrets = () => engine.units.filter((unit) => unit.kind === "turret");
  assert.equal(turrets().length, 1);
  assert.equal(turrets()[0].hp, 300);
  assert.equal(turrets()[0].atk, 22);
  assert.equal(turrets()[0].expiresAt, engine.tickCount + 750);

  artificer.abilityTimer = 0;
  engine.tickAbility(artificer, 0.02);
  assert.equal(turrets().length, 1);
});

test("chapter-three intrinsic traits anchor, warm and armorbite work", () => {
  const engine = engineFor([{ id: "c1", level: 1 }], bareStage(snapshot.stage));
  engine.spawnMouse(mouse("m29"), 500, 1);
  const anchor = engine.units[0];
  assert.equal(anchor.anchor, true);
  assert.equal(engine.shove(anchor, 90, 18), false);
  engine.control(anchor, 2, true);
  assert.equal(anchor.frozen, 2);

  engine.spawnMouse(mouse("m30"), 350, 1);
  engine.spawnMouse(mouse("m18"), 400, 1);
  const warmed = engine.units[2];
  engine.control(warmed, 3, true);
  assert.equal(warmed.frozen, 1.5);
  engine.tickWarmAura(4);
  assert.equal(warmed.frozen, 0);

  engine.money = 1_000_000;
  engine.deploy(0);
  const cat = engine.units.find((unit) => unit.side === "cat");
  engine.spawnMouse(mouse("m32"), cat.x - 55, 1);
  const armored = engine.units.at(-1);
  engine.hit(armored);
  assert.equal(cat.hp, cat.maxHp - 61);
});

test("Pharaoh summons mummies and restores 30% once below half health", () => {
  const engine = engineFor([{ id: "c1", level: 1 }], bareStage(snapshot.stage));
  engine.spawnMouse(mouse("m41"), 500, 1);
  const pharaoh = engine.units[0];
  pharaoh.abilityTimer = 0;
  engine.tickAbility(pharaoh, 0.02);
  assert.equal(engine.units.filter((unit) => unit.id === "m41s").length, 2);

  engine.damage(pharaoh, 15_000, null, "test");
  assert.equal(pharaoh.hp, 21_400);
  assert.equal(pharaoh.revive, 0);
  engine.damage(pharaoh, 5_000, null, "test");
  assert.equal(pharaoh.hp, 16_400);
});

test("chapter-four motion, weather and twist units follow the live rules", () => {
  const engine = engineFor([{ id: "c1", level: 1 }], bareStage(snapshot.stage));
  engine.spawnMouse(mouse("m39"), 500, 1, ["charge"]);
  const camel = engine.units[0];
  for (let tick = 0; tick < 50; tick++) engine.step();
  assert.ok(Math.abs(camel.x - 580) < 1e-9);
  assert.equal(engine.push(camel, 10, 10), true);
  assert.equal(camel.chargeTicks, 0);
  assert.equal(camel.chargeFirstHit, false);

  engine.money = 1_000_000;
  engine.deploy(0);
  const cat = engine.units.find((unit) => unit.side === "cat");
  cat.x = 700;
  engine.spawnMouse(mouse("m38"), 660, 1, ["leap"]);
  const burrower = engine.units.at(-1);
  burrower.cooldown = 0;
  engine.step();
  assert.equal(burrower.x, 850);
  assert.equal(burrower.leap, false);

  const mirage = engineFor([{ id: "c1", level: 1 }], {
    ...bareStage(snapshot.stage),
    twist: "mirage",
  });
  mirage.spawnMouse(mouse("m1"), 200, 1);
  mirage.spawnMouse(mouse("m1"), 210, 1);
  assert.equal(mirage.units[0].hp, 100);
  assert.equal(mirage.units[1].hp, 1);
  assert.equal(mirage.units[1].phantom, true);

  const weather = engineFor([{ id: "c1", level: 1 }], {
    ...bareStage(snapshot.stage),
    events: [{ kind: "sandstorm", at: 60, every: 60, last: 8, value: 200 }],
  });
  weather.time = 60;
  assert.equal(weather.attackRange({ range: 240 }, 240), 200);
  weather.time = 68;
  assert.equal(weather.attackRange({ range: 240 }, 240), 240);
});

test("caravan and treasure camel use neutral/timed twist mechanics", () => {
  const caravan = engineFor([{ id: "c1", level: 1 }], {
    ...bareStage(snapshot.stage),
    base_hp: 10_000,
    twist: "caravan",
  });
  caravan.spawnTwistUnit("caravan");
  const caravanUnit = caravan.units[0];
  caravanUnit.x = 80.01;
  caravan.step();
  assert.equal(caravanUnit.dead, -1);
  assert.equal(caravan.mouseBaseHp, 7000);

  const treasure = engineFor([{ id: "c1", level: 1 }], {
    ...bareStage(snapshot.stage),
    twist: "treasure_camel",
  });
  treasure.spawnTwistUnit("treasure");
  const camel = treasure.units[0];
  treasure.damage(camel, 1000, null, "test");
  assert.equal(camel.hp, 0);
  assert.equal(treasure.money, 450);
});

test("endless scenarios can model the borrowed extra team slot", () => {
  const team = snapshot.catalog.cats.slice(0, 11).map((cat) => ({ id: cat.id, level: 1 }));
  const endless = simulate({
    snapshot,
    team,
    teamSlots: 11,
    stageId: 9101,
    maxTime: 0.02,
    policy: { automatic: false },
  });
  assert.equal(endless.teamSlots, 11);

  assert.throws(
    () => simulate({
      snapshot,
      team,
      teamSlots: 11,
      stageId: 1,
      maxTime: 0.02,
      policy: { automatic: false },
    }),
    /only supported for endless stage 9101/,
  );
});

test("battle items apply their documented battle-only modifiers", () => {
  const engine = engineFor(
    [{ id: "c2", level: 1 }],
    bareStage(snapshot.stage),
    { items: ["start_coins", "fast_coins", "strong_base", "rally"] },
  );
  assert.equal(engine.money, 450);
  assert.equal(engine.cashRate, 1.3);
  assert.equal(engine.catBaseMax, 4500);
  engine.deploy(0);
  assert.equal(engine.units[0].atk, 7);
});

test("scheduled deploy and wallet actions run without automatic fill", () => {
  const scenario = {
    team: [
      { id: "c2", level: 1 },
      { id: "c1", level: 1 },
    ],
    policy: {
      automatic: false,
      actions: [
        { at: 0, type: "deploy", id: "c2" },
        { at: 4, type: "wallet" },
      ],
    },
    maxTime: 6,
  };
  const result = simulate({
    snapshot,
    team: scenario.team,
    policy: scenario.policy,
    stageId: 9101,
    maxTime: scenario.maxTime,
    seed: 1,
  });
  assert.equal(result.walletLevel, 2);
  assert.deepEqual({ ...result.field }, { c2: 1 });
  assert.equal(result.actions, 2);
});

test("deploySequence waits for the next fixed unit instead of buying a cheaper unit", () => {
  const result = simulate({
    snapshot,
    team: [
      { id: "c7", level: 1 },
      { id: "c3", level: 1 },
      { id: "c2", level: 1 },
    ],
    stageId: 9101,
    maxTime: 12,
    policy: {
      walletTarget: 1,
      deploySequence: ["c7", "c2"],
      priority: ["c3"],
      targetCounts: { c3: 1 },
    },
  });
  const first = result.telemetry.firstDeployAt;
  assert.ok(first.c7 > 0);
  assert.ok(first.c2 > first.c7);
  if (first.c3 != null) assert.ok(first.c3 > first.c2);
});

test("deploySequence may fire a charged cannon while saving for the next unit", () => {
  const team = [{ id: "c7", level: 1 }];
  const engine = engineFor(team, bareStage());
  engine.cannonCharge = 30;
  const policy = new AutoPolicy(team, {
    walletTarget: 1,
    deploySequence: ["c7"],
    targetCounts: { c7: 0 },
    autoCannon: true,
  });
  assert.equal(policy.act(engine), true);
  assert.equal(engine.actions[0].type, "cannon");
  assert.equal(engine.actions.length, 1);
});

test("automatic cannon can wait for its time window and live targets", () => {
  const team = [{ id: "c7", level: 1 }];
  const engine = engineFor(team, bareStage());
  engine.cannonCharge = 30;
  const policy = new AutoPolicy(team, {
    walletTarget: 1,
    targetCounts: { c7: 0 },
    autoCannon: true,
    autoCannonAfter: 800,
    autoCannonMinTargets: 1,
  });

  engine.time = 799;
  engine.spawnMouse(mouse("m1"), 500, 1);
  assert.equal(policy.act(engine), false);

  engine.time = 800;
  engine.units[0].x = 455;
  assert.equal(policy.act(engine), false);
  assert.equal(engine.cannonTargetCount, 0);

  engine.units[0].x = 456;
  assert.equal(policy.act(engine), true);
  assert.equal(engine.actions[0].type, "cannon");
  assert.equal(engine.cannonTargetCount, 0);
});

test("actionGap enforces the real page-action interval in simulation", () => {
  const result = simulate({
    snapshot,
    team: [
      { id: "c1", level: 1 },
      { id: "c6", level: 1 },
      { id: "c2", level: 1 },
    ],
    stageId: 9101,
    maxTime: 3,
    seed: 1,
    recordActions: true,
    policy: {
      walletTarget: 1,
      deploySequence: ["c1", "c6", "c2", "c1", "c6", "c2"],
      priority: ["c1", "c6", "c2"],
      targetCounts: { c1: 2, c6: 2, c2: 2 },
      actionGap: 0.25,
    },
  });
  const deploys = result.actionLog
    .filter((action) => action.type === "deploy")
    .map((action) => action.at);
  assert.ok(deploys.length >= 3);
  for (let index = 1; index < deploys.length; index++) {
    assert.ok(deploys[index] - deploys[index - 1] >= 0.25 - 1e-9);
  }
});

test("observationDelay models the executor's 10 Hz view", () => {
  const base = {
    snapshot,
    team: [{ id: "c1", level: 1 }],
    stageId: 9101,
    maxTime: 1,
    seed: 1,
    recordActions: true,
    policy: {
      automatic: false,
      actions: [{ at: 0.05, type: "deploy", id: "c1" }],
    },
  };
  const immediate = simulate(base);
  const delayed = simulate({
    ...base,
    policy: { ...base.policy, observationDelay: 0.1 },
  });
  assert.equal(immediate.actionLog[0].at, 0.06);
  assert.ok(delayed.actionLog[0].at >= 0.15 - 1e-9);
});

test("delayed deployments wait for observed income and observed cooldown expiry", () => {
  const base = {
    snapshot: { ...snapshot, catalog: { ...snapshot.catalog, rules: { ...snapshot.catalog.rules, start_coins: 0 } } },
    stage: { ...bareStage(snapshot.stage), time_limit: 10 },
    team: [{ id: "c1", level: 1 }], maxTime: 5, recordActions: true,
    policy: { walletTarget: 1, priority: ["c1"], targetCounts: { c1: 2 } },
  };
  const immediate = simulate(base).actionLog.filter((a) => a.type === "deploy");
  const delayed = simulate({ ...base, policy: { ...base.policy, observationDelay: 0.1 } })
    .actionLog.filter((a) => a.type === "deploy");
  assert.equal(immediate.length, 2);
  assert.equal(delayed.length, 2);
  assert.ok(delayed[0].at - immediate[0].at >= 0.1 - 1e-9, "income must first appear in the observed view");
  assert.ok(delayed[1].at - delayed[0].at >= 2.6 - 1e-9, "observed cooldown lasts another delay after live expiry");
});

test("policy phases switch targets on the observed clock and retain existing units", () => {
  const phases = [
    { at: 1, automatic: true, targetCounts: { c1: 1 }, priority: ["c1"] },
    { at: 2, targetCounts: { c1: 0, c6: 1 }, priority: ["c6"] },
  ];
  const base = { snapshot, stage: { ...bareStage(snapshot.stage), time_limit: 10 },
    team: [{ id: "c1", level: 1 }, { id: "c6", level: 1 }], maxTime: 5, recordActions: true,
    policy: { walletTarget: 1, automatic: false, observationDelay: 0.1, phases } };
  const run = simulate(base);
  assert.deepEqual(run.actionLog.map(({ at, id }) => ({ at, id })), [{ at: 1.1, id: "c1" }, { at: 2.1, id: "c6" }]);
  assert.equal(run.field.c1, 1);
  assert.equal(run.field.c6, 1);
  assert.deepEqual(simulate(base).actionLog, run.actionLog, "phase state must reset for every battle");
  assert.equal(phases[0].targetCounts.c1, 1, "input policy must remain reusable");
  const team = base.team;
  for (const invalid of [
    [{ at: -1 }], [{ at: 2 }, { at: 1 }], [{ at: 1 }, { at: 1 }],
    [{ at: 1, priority: ["s1"] }], [{ at: 1, targetCounts: { c1: -1 } }],
    [{ at: 1, actionGap: 0 }], [{ at: 1, walletTarget: 9 }], [{ at: 1, automatic: "true" }],
  ]) assert.throws(() => new AutoPolicy(team, { phases: invalid }));
});

test("deployment intervals preserve game cooldowns and apply phase overrides from the last deployment", () => {
  const run = simulate({ snapshot, stage: { ...bareStage(), time_limit: 12 },
    team: [{ id: "c1", level: 1 }], maxTime: 9, recordActions: true,
    policy: { walletTarget: 1, targetCounts: { c1: 3 }, priority: ["c1"],
      deployIntervals: { c1: 3.5 }, phases: [{ at: 4, deployIntervals: { c1: 5 } }] } });
  assert.deepEqual(run.actionLog.map((a) => a.at), [0, 3.5, 8.5]);
  for (const invalid of [{ c1: -1 }, { c1: Infinity }, [], { s1: 1 }]) {
    assert.throws(() => new AutoPolicy([{ id: "c1", level: 1 }], { deployIntervals: invalid }));
  }
});

test("world-boss runs report direct boss damage and aggregate its distribution", () => {
  const worldBoss = {
    id: 9001,
    name: "World Boss Test",
    base_hp: 99_999_999,
    boss: "m28",
    time_limit: 30,
    scale: 1,
    waves: [{ at: 1, count: 1, gap: 0, mouse: "m28" }],
  };
  const run = (seed) => simulate({
    snapshot,
    stage: worldBoss,
    team: [{ id: "c7", level: 10 }],
    seed,
    policy: {
      walletTarget: 1,
      deploySequence: ["c7"],
      targetCounts: { c7: 1 },
    },
  });
  const runs = [run(1), run(2)];
  assert.ok(runs.every((result) => result.bossDamage > 0));
  assert.equal(runs[0].result, "timeup");
  const stats = aggregate(runs);
  assert.equal(stats.bossDamage.min, Math.min(...runs.map((result) => result.bossDamage)));
  assert.equal(stats.bossDamage.max, Math.max(...runs.map((result) => result.bossDamage)));
});

test("a recorded action log replays exactly", () => {
  const team = [
    { id: "c2", level: 1 },
    { id: "c1", level: 1 },
  ];
  const first = simulate({
    snapshot,
    team,
    stageId: 9101,
    seed: 1,
    maxTime: 30,
    policy: {
      walletTarget: 2,
      openers: ["c2"],
      priority: ["c1"],
      targetCounts: { c1: 0 },
      autoCannon: true,
    },
    recordActions: true,
  });
  const replay = simulate({
    snapshot,
    team,
    stageId: 9101,
    seed: 1,
    maxTime: 30,
    policy: {
      automatic: false,
      actions: first.actionLog,
    },
    recordActions: true,
  });
  assert.deepEqual(replay.actionLog, first.actionLog);
  assert.equal(replay.duration, first.duration);
  assert.equal(replay.result, first.result);
});

test("the historical bundled example retains its original moon survival band", async () => {
  const scenario = JSON.parse(
    await readFile(new URL("../examples/endless-current.json", import.meta.url), "utf8"),
  );
  const result = simulate({
    snapshot,
    team: scenario.team,
    policy: scenario.policy,
    stageId: scenario.stageId,
    stage: { ...snapshot.stage, modifier: "moon" },
    items: scenario.items,
    maxTime: scenario.maxTime,
    seed: 1,
  });
  assert.ok(result.duration >= 740 && result.duration <= 800, `unexpected duration ${result.duration}`);
  assert.ok(result.round >= 25, `unexpected round ${result.round}`);
  assert.equal(result.towerHp, 0);
});
