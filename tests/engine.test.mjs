import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BattleEngine } from "../src/engine.mjs";
import { simulate } from "../src/runner.mjs";

const snapshot = JSON.parse(
  await readFile(new URL("../data/snapshot.json", import.meta.url), "utf8"),
);
const stage1 = snapshot.catalog.stages.find((stage) => stage.id === 1);
const mouse = (id) => snapshot.catalog.mice.find((entry) => entry.id === id);

function bareStage(base = stage1) {
  return { ...base, waves: [], scale: 1 };
}

function engineFor(team, stage = bareStage(), options = {}) {
  return new BattleEngine({
    catalog: snapshot.catalog,
    stage,
    team,
    seed: options.seed ?? 1,
    items: options.items ?? [],
    onEvent: options.onEvent ?? null,
  });
}

test("snapshot contains the current catalog and endless wave data", () => {
  assert.equal(snapshot.catalog.cats.length, 29);
  assert.equal(snapshot.catalog.mice.length, 28);
  assert.equal(snapshot.stage.id, 9101);
  assert.equal(snapshot.stage.time_limit, 900);
  assert.equal(snapshot.stage.waves.length, 84);

  const shadowWave = snapshot.stage.waves.find((wave) => wave.at === 745);
  assert.deepEqual(shadowWave.traits, ["rage"]);
  assert.equal(shadowWave.mouse, "m18");
  assert.equal(shadowWave.scale, 40.35);
  assert.equal(Math.round(mouse("m18").hp * shadowWave.scale), 80700);
  assert.equal(Math.round(mouse("m18").atk * shadowWave.scale), 6053);
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

test("the bundled endless example reproduces the expected late-round survival band", async () => {
  const scenario = JSON.parse(
    await readFile(new URL("../examples/endless-current.json", import.meta.url), "utf8"),
  );
  const result = simulate({
    snapshot,
    team: scenario.team,
    policy: scenario.policy,
    stageId: scenario.stageId,
    items: scenario.items,
    maxTime: scenario.maxTime,
    seed: 1,
  });
  assert.ok(result.duration >= 820 && result.duration <= 880, `unexpected duration ${result.duration}`);
  assert.ok(result.round >= 28, `unexpected round ${result.round}`);
  assert.equal(result.towerHp, 0);
});
